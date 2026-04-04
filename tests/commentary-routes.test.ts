import test from 'node:test';
import assert from 'node:assert/strict';

import hecklesHandler from '../api/generate-heckles.ts';
import trashTalkHandler from '../api/generate-trash-talk.ts';
import {
  resetCommentaryProviderOverrides,
  setCommentaryProviderOverride,
  type ProviderTextResponse,
} from '../api/_lib/commentary.ts';
import { evaluateHeckleEligibility, getOpponentTrophyGain } from '../src/services/commentaryTriggers.ts';
import { generateHeckles, generateTrashTalk } from '../src/services/gemini.ts';

function createMockResponse() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function createProviderResponse(text: string | null): ProviderTextResponse {
  return {
    text,
    model: 'test-model',
    durationMs: 12,
  };
}

function withCapturedConsole<T>(run: () => Promise<T> | T) {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const entries: string[] = [];

  console.info = (...args: unknown[]) => {
    entries.push(`INFO ${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`);
  };
  console.warn = (...args: unknown[]) => {
    entries.push(`WARN ${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`);
  };
  console.error = (...args: unknown[]) => {
    entries.push(`ERROR ${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`);
  };

  return Promise.resolve()
    .then(run)
    .then((result) => ({ result, entries }))
    .finally(() => {
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
    });
}

function setProviderEnv() {
  process.env.GEMINI_API_KEY = 'test-gemini';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  process.env.AI_PROVIDER_ORDER = 'gemini,openrouter';
}

test.afterEach(() => {
  resetCommentaryProviderOverrides();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.AI_PROVIDER_ORDER;
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

test('opponent waiting state is eligible but current user turn is not', () => {
  const eligible = evaluateHeckleEligibility({
    commentaryEnabled: true,
    isSolo: false,
    hasGame: true,
    gameStatus: 'active',
    playersCount: 2,
    currentPlayerCanAct: false,
    hasCurrentPlayer: true,
    hasOpponentPlayer: true,
  });

  const ineligible = evaluateHeckleEligibility({
    commentaryEnabled: true,
    isSolo: false,
    hasGame: true,
    gameStatus: 'active',
    playersCount: 2,
    currentPlayerCanAct: true,
    hasCurrentPlayer: true,
    hasOpponentPlayer: true,
  });

  assert.deepEqual(eligible, { allowed: true, reason: 'eligible_waiting_state' });
  assert.deepEqual(ineligible, { allowed: false, reason: 'current_player_can_act' });
});

test('heckles route falls back to OpenRouter when Gemini returns empty and logs the chain', async () => {
  setProviderEnv();
  setCommentaryProviderOverride('gemini', async () => createProviderResponse('   '));
  setCommentaryProviderOverride('openrouter', async () =>
    createProviderResponse('{"heckles":["OpenRouter landed the save.","The backup model had to do the grown-up work."]}')
  );

  const req = {
    method: 'POST',
    body: {
      playerName: 'Dustin',
      opponentName: 'Alex',
      trigger: 'prolonged_wait',
      waitingReason: 'Waiting for Alex to finish their turn.',
      playerScore: 0,
      opponentScore: 1,
      scoreDelta: -1,
      playerMissedLastQuestion: true,
      isSolo: false,
    },
  };
  const res = createMockResponse();
  const { entries } = await withCapturedConsole(() => hecklesHandler(req, res));

  assert.equal(res.statusCode, 200);
  assert.equal((res.body as { source: string }).source, 'openrouter');
  assert.ok(((res.body as { heckles: string[] }).heckles.length) > 0);
  assert.ok(entries.some((entry) => entry.includes('[heckles/api] Gemini attempt started')));
  assert.ok(entries.some((entry) => entry.includes('[heckles/api] OpenRouter fallback started')));
  assert.ok(entries.some((entry) => entry.includes('[heckles/api] Final response payload')));
});

test('heckles route falls back to OpenRouter when Gemini returns malformed content', async () => {
  setProviderEnv();
  setCommentaryProviderOverride('gemini', async () => createProviderResponse('{"heckles":[1,2,3]}'));
  setCommentaryProviderOverride('openrouter', async () =>
    createProviderResponse('{"heckles":["OpenRouter cleaned up the mess."]}')
  );

  const req = {
    method: 'POST',
    body: {
      playerName: 'Dustin',
      opponentName: 'Alex',
      trigger: 'wrong_answer',
      waitingReason: 'Waiting for Alex to finish their turn.',
      playerScore: 1,
      opponentScore: 2,
      scoreDelta: -1,
      playerMissedLastQuestion: true,
      isSolo: false,
    },
  };
  const res = createMockResponse();

  await hecklesHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal((res.body as { source: string }).source, 'openrouter');
  assert.equal((res.body as { debug: { geminiAttempted: boolean; openrouterAttempted: boolean } }).debug.geminiAttempted, true);
  assert.equal((res.body as { debug: { geminiAttempted: boolean; openrouterAttempted: boolean } }).debug.openrouterAttempted, true);
});

test('heckles route returns structured provider failure when both providers fail', async () => {
  setProviderEnv();
  setCommentaryProviderOverride('gemini', async () => createProviderResponse(null));
  setCommentaryProviderOverride('openrouter', async () => createProviderResponse(''));

  const req = {
    method: 'POST',
    body: {
      playerName: 'Dustin',
      opponentName: 'Alex',
      trigger: 'prolonged_wait',
      waitingReason: 'Waiting for Alex to finish their turn.',
      playerScore: 0,
      opponentScore: 0,
      scoreDelta: 0,
      playerMissedLastQuestion: false,
      isSolo: false,
    },
  };
  const res = createMockResponse();

  await hecklesHandler(req, res);

  assert.equal(res.statusCode, 502);
  assert.equal((res.body as { error: string }).error, 'all_providers_failed');
  assert.deepEqual((res.body as { heckles: string[] }).heckles, []);
});

test('client treats empty 200 heckle payload as failure and renders no commentary', async () => {
  (globalThis as typeof globalThis & { window: typeof globalThis }).window = globalThis as typeof globalThis & { window: typeof globalThis };
  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ source: 'gemini', heckles: [] }),
    } as Response);

  const result = await generateHeckles({
    playerName: 'Dustin',
    opponentName: 'Alex',
    trigger: 'prolonged_wait',
    waitingReason: 'Waiting for Alex to finish their turn.',
    playerScore: 0,
    opponentScore: 0,
    scoreDelta: 0,
    recentPerformanceSummary: 'None.',
    playerMissedLastQuestion: false,
    isSolo: false,
  });

  assert.deepEqual(result, []);
});

test('opponent trophy collection is detected and trash-talk client calls the endpoint', async () => {
  (globalThis as typeof globalThis & { window: typeof globalThis }).window = globalThis as typeof globalThis & { window: typeof globalThis };
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ source: 'gemini', trashTalk: 'That trophy looked better on them than your whole strategy.' }),
    } as Response;
  };

  const gainedCategory = getOpponentTrophyGain(
    {
      uid: 'opponent',
      name: 'Alex',
      score: 1,
      streak: 0,
      completedCategories: ['History'],
    },
    {
      uid: 'opponent',
      name: 'Alex',
      score: 2,
      streak: 1,
      completedCategories: ['History', 'Science'],
    }
  );

  const message = await generateTrashTalk({
    event: 'OPPONENT_CORRECT',
    playerName: 'Dustin',
    opponentName: 'Alex',
    playerScore: 1,
    opponentScore: 2,
    scoreDelta: -1,
    playerTrophies: 1,
    opponentTrophies: 2,
    latestCategory: gainedCategory ?? undefined,
    outcomeSummary: 'Alex just collected the Science trophy.',
    recentQuestionHistory: [],
    isSolo: false,
  });

  assert.equal(gainedCategory, 'Science');
  assert.equal(calls[0], '/api/generate-trash-talk');
  assert.match(message ?? '', /strategy/i);
});

test('trash-talk route falls back to OpenRouter and never returns empty success payloads', async () => {
  setProviderEnv();
  setCommentaryProviderOverride('gemini', async () => createProviderResponse(''));
  setCommentaryProviderOverride('openrouter', async () => createProviderResponse('OpenRouter finished the sentence Gemini dropped.'));

  const req = {
    method: 'POST',
    body: {
      event: 'OPPONENT_CORRECT',
      playerName: 'Dustin',
      opponentName: 'Alex',
      playerScore: 1,
      opponentScore: 2,
      scoreDelta: -1,
      playerTrophies: 1,
      opponentTrophies: 2,
      latestCategory: 'Science',
      outcomeSummary: 'Alex just collected the Science trophy.',
      isSolo: false,
    },
  };
  const res = createMockResponse();
  const { entries } = await withCapturedConsole(() => trashTalkHandler(req, res));

  assert.equal(res.statusCode, 200);
  assert.equal((res.body as { source: string }).source, 'openrouter');
  assert.ok(((res.body as { trashTalk: string }).trashTalk ?? '').length > 0);
  assert.ok(entries.some((entry) => entry.includes('[trash-talk/api] Gemini attempt started')));
  assert.ok(entries.some((entry) => entry.includes('[trash-talk/api] OpenRouter fallback started')));
});

test('trash-talk route returns structured provider failure when both providers fail', async () => {
  setProviderEnv();
  setCommentaryProviderOverride('gemini', async () => createProviderResponse(''));
  setCommentaryProviderOverride('openrouter', async () => createProviderResponse(''));

  const req = {
    method: 'POST',
    body: {
      event: 'OPPONENT_CORRECT',
      playerName: 'Dustin',
      opponentName: 'Alex',
      playerScore: 1,
      opponentScore: 2,
      scoreDelta: -1,
      playerTrophies: 1,
      opponentTrophies: 2,
      latestCategory: 'Science',
      outcomeSummary: 'Alex just collected the Science trophy.',
      isSolo: false,
    },
  };
  const res = createMockResponse();

  await trashTalkHandler(req, res);

  assert.equal(res.statusCode, 502);
  assert.equal((res.body as { error: string }).error, 'all_providers_failed');
  assert.equal((res.body as { trashTalk: null }).trashTalk, null);
});
