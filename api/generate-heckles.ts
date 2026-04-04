import { buildHecklePrompt, type HeckleGenerationContext } from '../src/content/heckles.js';
import { MODERN_HOST_SYSTEM_PROMPT } from '../src/content/hostPersona.js';
import {
  generateWithDiagnostics,
  type CommentaryGenerationDebug,
  type CommentaryProvider,
  validateHeckles,
} from './_lib/commentary.js';

type HeckleResponse = {
  source: CommentaryProvider;
  heckle: string | null;
  heckles: string[];
  debug: CommentaryGenerationDebug;
};

type HeckleErrorResponse = {
  error: string;
  heckle: null;
  heckles: [];
  debug?: CommentaryGenerationDebug;
};

function parseBody(body: unknown) {
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

function summarizeContext(context: Partial<HeckleGenerationContext>) {
  return {
    playerName: context.playerName ?? null,
    opponentName: context.opponentName ?? null,
    trigger: context.trigger ?? null,
    waitingReason: context.waitingReason ?? null,
    playerScore: context.playerScore ?? null,
    opponentScore: context.opponentScore ?? null,
    scoreDelta: context.scoreDelta ?? null,
    playerMissedLastQuestion: context.playerMissedLastQuestion ?? null,
    category: context.category ?? null,
    difficulty: context.difficulty ?? null,
    hasLastQuestion: !!context.lastQuestion,
    hasRecentFailure: !!context.recentFailure,
    recentQuestionHistoryCount: context.recentQuestionHistory?.length ?? 0,
    isSolo: context.isSolo ?? null,
  };
}

function logProviderDiagnostics(debug: CommentaryGenerationDebug) {
  for (const diagnostic of debug.providerDiagnostics) {
    const providerLabel = diagnostic.provider === 'gemini' ? 'Gemini' : 'OpenRouter';
    console.info(`[heckles/api] ${providerLabel} attempt started`, {
      provider: diagnostic.provider,
      model: diagnostic.model,
      attempted: diagnostic.attempted,
    });
    console.info(`[heckles/api] ${providerLabel} raw result`, {
      provider: diagnostic.provider,
      rawText: diagnostic.rawText,
      rawPreview: diagnostic.rawPreview,
      normalizedResponse: diagnostic.normalizedResponse,
      error: diagnostic.error,
    });
    console.info(`[heckles/api] ${providerLabel} parse/validation result`, {
      provider: diagnostic.provider,
      parser: diagnostic.parser,
      parsed: diagnostic.parsed,
      normalizedLength: diagnostic.normalizedLength,
      itemCount: diagnostic.itemCount,
      validationOk: diagnostic.validationOk,
      validationReason: diagnostic.validationReason,
      error: diagnostic.error,
    });
  }
}

function sendSuccess(res: any, payload: HeckleResponse, status = 200) {
  console.info('[heckles/api] Final response payload', {
    status,
    source: payload.source,
    payload,
  });
  res.status(status).json(payload);
}

function sendError(res: any, status: number, payload: HeckleErrorResponse) {
  console.error('[heckles/api] Final error payload', {
    status,
    payload,
  });
  res.status(status).json(payload);
}

export default async function handler(req: any, res: any) {
  const body = parseBody(req.body) as Partial<HeckleGenerationContext>;
  const requestSummary = summarizeContext(body);

  console.info('[heckles/api] Request received', {
    method: req.method,
    requestSummary,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
  });
  console.info('[heckles/api] Eligibility context received from client', requestSummary);

  if (req.method !== 'POST') {
    sendError(res, 405, {
      error: 'method_not_allowed',
      heckle: null,
      heckles: [],
    });
    return;
  }

  if (body.isSolo) {
    sendError(res, 400, {
      error: 'solo_mode_requests_do_not_generate_heckles',
      heckle: null,
      heckles: [],
    });
    return;
  }

  if (!body.playerName || !body.waitingReason) {
    sendError(res, 400, {
      error: 'missing_required_fields',
      heckle: null,
      heckles: [],
    });
    return;
  }

  try {
    const context: HeckleGenerationContext = {
      playerName: body.playerName,
      opponentName: body.opponentName,
      trigger: body.trigger ?? 'prolonged_wait',
      waitingReason: body.waitingReason,
      playerScore: body.playerScore ?? 0,
      opponentScore: body.opponentScore ?? 0,
      scoreDelta: body.scoreDelta ?? 0,
      recentPerformanceSummary: body.recentPerformanceSummary ?? 'No recent summary',
      lastQuestion: body.lastQuestion,
      playerMissedLastQuestion: !!body.playerMissedLastQuestion,
      category: body.category,
      difficulty: body.difficulty,
      recentFailure: body.recentFailure,
      recentQuestionHistory: body.recentQuestionHistory ?? [],
      isSolo: false,
    };
    const prompt = buildHecklePrompt(context);

    const result = await generateWithDiagnostics({
      task: 'heckles',
      prompt,
      systemInstruction: MODERN_HOST_SYSTEM_PROMPT,
      temperature: 0.9,
      maxTokens: 120,
      validate: validateHeckles,
      localFallback: () => [],
      fallbackMode: 'empty',
    });

    if (result.debug.geminiAttempted) {
      console.info('[heckles/api] Gemini attempt started', { attempted: true });
    }
    if (result.debug.openrouterAttempted) {
      console.info('[heckles/api] OpenRouter fallback started', { attempted: true });
    }
    logProviderDiagnostics(result.debug);

    if (result.ok === false) {
      sendError(res, 502, {
        error: result.error,
        heckle: null,
        heckles: [],
        debug: result.debug,
      });
      return;
    }

    if (result.value.length === 0 || !result.value.some((heckle) => typeof heckle === 'string' && heckle.trim().length > 0)) {
      sendError(res, 502, {
        error: 'non_renderable_success_payload',
        heckle: null,
        heckles: [],
        debug: result.debug,
      });
      return;
    }

    if (result.source === 'local_fallback') {
      sendError(res, 502, {
        error: 'unexpected_local_fallback',
        heckle: null,
        heckles: [],
        debug: result.debug,
      });
      return;
    }

    sendSuccess(res, {
      source: result.source,
      heckle: result.value[0] ?? null,
      heckles: result.value,
      debug: result.debug,
    });
  } catch (error) {
    console.error('[heckles/api] Unhandled provider failure', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    sendError(res, 500, {
      error: error instanceof Error ? error.message : 'unknown_error',
      heckle: null,
      heckles: [],
    });
  }
}
