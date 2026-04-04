import type { TrashTalkGenerationContext } from '../src/content/trashTalk.js';
import { buildTrashTalkPrompt } from '../src/content/trashTalk.js';
import { MODERN_HOST_SYSTEM_PROMPT } from '../src/content/hostPersona.js';
import {
  generateWithDiagnostics,
  type CommentaryGenerationDebug,
  type CommentaryProvider,
  validateTrashTalk,
} from './_lib/commentary.js';

type TrashTalkResponse = {
  source: CommentaryProvider;
  trashTalk: string;
  debug: CommentaryGenerationDebug;
};

type TrashTalkErrorResponse = {
  error: string;
  trashTalk: null;
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

function summarizeContext(context: Partial<TrashTalkGenerationContext>) {
  return {
    event: context.event ?? null,
    playerName: context.playerName ?? null,
    opponentName: context.opponentName ?? null,
    playerScore: context.playerScore ?? null,
    opponentScore: context.opponentScore ?? null,
    scoreDelta: context.scoreDelta ?? null,
    playerTrophies: context.playerTrophies ?? null,
    opponentTrophies: context.opponentTrophies ?? null,
    latestCategory: context.latestCategory ?? null,
    hasOutcomeSummary: !!context.outcomeSummary,
    recentQuestionHistoryCount: context.recentQuestionHistory?.length ?? 0,
    isSolo: context.isSolo ?? null,
  };
}

function logProviderDiagnostics(debug: CommentaryGenerationDebug) {
  for (const diagnostic of debug.providerDiagnostics) {
    const providerLabel = diagnostic.provider === 'gemini' ? 'Gemini' : 'OpenRouter';
    console.info(`[trash-talk/api] ${providerLabel} attempt started`, {
      provider: diagnostic.provider,
      model: diagnostic.model,
      attempted: diagnostic.attempted,
    });
    console.info(`[trash-talk/api] ${providerLabel} raw result`, {
      provider: diagnostic.provider,
      rawText: diagnostic.rawText,
      rawPreview: diagnostic.rawPreview,
      normalizedResponse: diagnostic.normalizedResponse,
      error: diagnostic.error,
    });
    console.info(`[trash-talk/api] ${providerLabel} parse/validation result`, {
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

function sendSuccess(res: any, payload: TrashTalkResponse, status = 200) {
  console.info('[trash-talk/api] Final response payload', {
    status,
    source: payload.source,
    payload,
  });
  res.status(status).json(payload);
}

function sendError(res: any, status: number, payload: TrashTalkErrorResponse) {
  console.error('[trash-talk/api] Final error payload', {
    status,
    payload,
  });
  res.status(status).json(payload);
}

export default async function handler(req: any, res: any) {
  const body = parseBody(req.body) as Partial<TrashTalkGenerationContext>;
  const requestSummary = summarizeContext(body);

  console.info('[trash-talk/api] Request received', {
    method: req.method,
    requestSummary,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
  });
  console.info('[trash-talk/api] Eligibility context received from client', requestSummary);

  if (req.method !== 'POST') {
    sendError(res, 405, {
      error: 'method_not_allowed',
      trashTalk: null,
    });
    return;
  }

  if (body.isSolo) {
    sendError(res, 400, {
      error: 'solo_mode_requests_do_not_generate_trash_talk',
      trashTalk: null,
    });
    return;
  }

  if (!body.event || !body.playerName || !body.opponentName) {
    sendError(res, 400, {
      error: 'missing_required_fields',
      trashTalk: null,
    });
    return;
  }

  try {
    const context: TrashTalkGenerationContext = {
      event: body.event,
      playerName: body.playerName,
      opponentName: body.opponentName,
      playerScore: body.playerScore ?? 0,
      opponentScore: body.opponentScore ?? 0,
      scoreDelta: body.scoreDelta ?? 0,
      playerTrophies: body.playerTrophies ?? 0,
      opponentTrophies: body.opponentTrophies ?? 0,
      latestCategory: body.latestCategory,
      outcomeSummary: body.outcomeSummary ?? 'Momentum shifted.',
      recentQuestionHistory: body.recentQuestionHistory ?? [],
      isSolo: false,
    };
    const prompt = buildTrashTalkPrompt(context);

    const result = await generateWithDiagnostics({
      task: 'trash-talk',
      prompt,
      systemInstruction: MODERN_HOST_SYSTEM_PROMPT,
      temperature: 0.95,
      maxTokens: 120,
      validate: validateTrashTalk,
      localFallback: () => null,
      fallbackMode: 'empty',
    });

    if (result.debug.geminiAttempted) {
      console.info('[trash-talk/api] Gemini attempt started', { attempted: true });
    }
    if (result.debug.openrouterAttempted) {
      console.info('[trash-talk/api] OpenRouter fallback started', { attempted: true });
    }
    logProviderDiagnostics(result.debug);

    if (result.ok === false) {
      sendError(res, 502, {
        error: result.error,
        trashTalk: null,
        debug: result.debug,
      });
      return;
    }

    if (!result.value || !result.value.trim()) {
      sendError(res, 502, {
        error: 'non_renderable_success_payload',
        trashTalk: null,
        debug: result.debug,
      });
      return;
    }

    if (result.source === 'local_fallback') {
      sendError(res, 502, {
        error: 'unexpected_local_fallback',
        trashTalk: null,
        debug: result.debug,
      });
      return;
    }

    sendSuccess(res, {
      source: result.source,
      trashTalk: result.value,
      debug: result.debug,
    });
  } catch (error) {
    console.error('[trash-talk/api] Unhandled provider failure', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    sendError(res, 500, {
      error: error instanceof Error ? error.message : 'unknown_error',
      trashTalk: null,
    });
  }
}
