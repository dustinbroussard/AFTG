import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import {
  buildQuestionPrompt,
  dedupeQuestions,
  extractRetryDelayMs,
  ExistingQuestion,
  isRateLimitError,
  questionSchema,
  TRIVIA_PIPELINE_VERSION,
} from '../src/services/gemini';
import { buildStylingPrompt, normalizeStylingResults, questionStylingSchema } from '../src/services/questionStyling';
import {
  buildVerificationPrompt,
  isQuestionApprovedForStorage,
  normalizeVerificationResults,
  questionVerificationSchema,
} from '../src/services/questionVerification';
import { validateGeneratedQuestions } from '../src/services/questionValidation';
import { TriviaQuestion } from '../src/types';

type Difficulty = 'easy' | 'medium' | 'hard';

function getConfiguredProviderCount() {
  return Number(Boolean(process.env.GEMINI_API_KEY)) + Number(Boolean(process.env.OPENROUTER_API_KEY));
}

function parseBody(body: any) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function parseJsonEnvelope(text: string, errorLabel: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error(`${errorLabel} returned non-JSON content`);
  }

  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

function logPipelineWarning(message: string) {
  console.warn(`[questionPipeline] ${message}`);
}

async function requestGeminiJson(prompt: string, schema: any, errorLabel: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  return parseJsonEnvelope(response.text || '', errorLabel);
}

async function requestOpenRouterJson(prompt: string, requestUrl: string, errorLabel: string) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': requestUrl,
      'X-Title': 'AFTG Trivia',
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
    const error = new Error(detail || `OpenRouter returned ${response.status}`);
    (error as Error & { retryAfterMs?: number | null }).retryAfterMs = retryAfterMs;
    throw error;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return parseJsonEnvelope(content, errorLabel);
}

async function requestStageJson({
  prompt,
  schema,
  requestUrl,
  errorLabel,
}: {
  prompt: string;
  schema: any;
  requestUrl: string;
  errorLabel: string;
}) {
  try {
    return await requestGeminiJson(prompt, schema, errorLabel);
  } catch (error) {
    logPipelineWarning(`${errorLabel} Gemini failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!process.env.OPENROUTER_API_KEY) {
      throw error;
    }

    try {
      return await requestOpenRouterJson(prompt, requestUrl, errorLabel);
    } catch (fallbackError) {
      logPipelineWarning(`${errorLabel} OpenRouter failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      throw fallbackError;
    }
  }
}

function finalizeQuestions(questions: TriviaQuestion[], prefix = '') {
  return questions.map((question, index) => {
    const generatedId = `${prefix}${Date.now()}-${index}`;
    return {
      ...question,
      id: generatedId,
      questionId: generatedId,
      used: false,
      pipelineVersion: TRIVIA_PIPELINE_VERSION,
    };
  });
}

function logRejectedQuestions(
  stage: 'validation' | 'verification',
  rejected: Array<{ question: TriviaQuestion; reason: string }>
) {
  if (process.env.NODE_ENV === 'production') return;
  rejected.forEach(({ question, reason }) => {
    logPipelineWarning(`${stage} rejected "${question.question || question.id}": ${reason}`);
  });
}

async function runQuestionPipeline({
  categories,
  countPerCategory,
  existingQuestions,
  requestedDifficulty,
  requestUrl,
}: {
  categories: string[];
  countPerCategory: number;
  existingQuestions: ExistingQuestion[];
  requestedDifficulty?: Difficulty;
  requestUrl: string;
}) {
  const generationPrompt = buildQuestionPrompt(categories, countPerCategory, existingQuestions, requestedDifficulty);
  const generatedPayload = await requestStageJson({
    prompt: generationPrompt,
    schema: questionSchema,
    requestUrl,
    errorLabel: 'Generator',
  });

  const generatedDrafts = dedupeQuestions(generatedPayload.questions || [], existingQuestions, countPerCategory);
  const { approved: structurallyValid, rejected: structurallyRejected } = validateGeneratedQuestions(generatedDrafts);
  logRejectedQuestions('validation', structurallyRejected);

  if (structurallyValid.length === 0) {
    return [];
  }

  let verificationResults = normalizeVerificationResults(structurallyValid, {});

  try {
    const verificationPrompt = buildVerificationPrompt(structurallyValid);
    const verificationPayload = await requestStageJson({
      prompt: verificationPrompt,
      schema: questionVerificationSchema,
      requestUrl,
      errorLabel: 'Verifier',
    });
    verificationResults = normalizeVerificationResults(structurallyValid, verificationPayload);
  } catch (error) {
    logPipelineWarning(`Verifier batch request failed, retrying one question at a time: ${error instanceof Error ? error.message : String(error)}`);

    verificationResults = await Promise.all(structurallyValid.map(async (question) => {
      try {
        const verificationPayload = await requestStageJson({
          prompt: buildVerificationPrompt([question]),
          schema: questionVerificationSchema,
          requestUrl,
          errorLabel: 'Verifier',
        });
        return normalizeVerificationResults([question], verificationPayload)[0];
      } catch (singleError) {
        logPipelineWarning(`Verifier single-question retry failed: ${singleError instanceof Error ? singleError.message : String(singleError)}`);
        return normalizeVerificationResults([question], {})[0];
      }
    }));
  }
  const verifiedQuestions: TriviaQuestion[] = structurallyValid.map((question, questionIndex) => {
    const verification = verificationResults[questionIndex];
    const approvedForStorage = verification.verdict === 'pass' && verification.confidence === 'high';

    return {
      ...question,
      validationStatus: approvedForStorage ? 'approved' as const : 'rejected' as const,
      verificationVerdict: verification.verdict,
      verificationConfidence: verification.confidence,
      verificationIssues: verification.issues,
      verificationReason: verification.reason,
      pipelineVersion: TRIVIA_PIPELINE_VERSION,
    };
  });

  const verificationRejected = verifiedQuestions
    .filter((question) => !isQuestionApprovedForStorage(question))
    .map((question) => ({
      question,
      reason: question.verificationReason || 'verification rejected',
    }));
  logRejectedQuestions('verification', verificationRejected);

  const approvedQuestions = verifiedQuestions.filter(isQuestionApprovedForStorage);
  if (approvedQuestions.length === 0) {
    return [];
  }

  try {
    const stylingPrompt = buildStylingPrompt(approvedQuestions);
    const stylingPayload = await requestStageJson({
      prompt: stylingPrompt,
      schema: questionStylingSchema,
      requestUrl,
      errorLabel: 'Styler',
    });
    const stylingResults = normalizeStylingResults(approvedQuestions, stylingPayload);

    return approvedQuestions.map((question, questionIndex): TriviaQuestion => ({
      ...question,
      questionStyled: stylingResults[questionIndex].questionStyled,
      explanationStyled: stylingResults[questionIndex].explanationStyled,
      ...(stylingResults[questionIndex].hostLeadIn ? { hostLeadIn: stylingResults[questionIndex].hostLeadIn } : {}),
    }));
  } catch (error) {
    logPipelineWarning(`styling failed, returning verified plain questions: ${error instanceof Error ? error.message : String(error)}`);
    return approvedQuestions;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = parseBody(req.body);
  const categories = Array.isArray(body.categories) ? body.categories : [];
  const countPerCategory = Number.isInteger(body.countPerCategory) ? body.countPerCategory : 3;
  const existingQuestions = Array.isArray(body.existingQuestions) ? body.existingQuestions as ExistingQuestion[] : [];
  const requestedDifficulty = body.requestedDifficulty as Difficulty | undefined;

  if (categories.length === 0) {
    res.status(400).json({ error: 'categories are required' });
    return;
  }

  if (getConfiguredProviderCount() === 0) {
    res.status(503).json({
      error: 'Question generation is not configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY.',
    });
    return;
  }

  try {
    const requestUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host || ''}`;
    const approvedQuestions = await runQuestionPipeline({
      categories,
      countPerCategory,
      existingQuestions,
      requestedDifficulty,
      requestUrl,
    });

    res.status(200).json({ questions: finalizeQuestions(approvedQuestions) });
    return;
  } catch (error) {
    if (isRateLimitError(error)) {
      const retryAfterMs = (error as Error & { retryAfterMs?: number | null }).retryAfterMs
        ?? extractRetryDelayMs(error instanceof Error ? error.message : String(error));
      res.status(429).json({
        error: 'AI generation is temporarily cooling down. Please try again shortly.',
        retryAfterMs,
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    logPipelineWarning(`handler failed: ${message}`);
    res.status(500).json({ error: message || 'Question generation failed' });
  }
}
