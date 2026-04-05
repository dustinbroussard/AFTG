interface GeminiTextOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

interface GeminiTextResponse {
  text: string | null;
  model: string;
  durationMs: number;
  status: number | null;
  rawBody: string | null;
  requestSummary: Record<string, unknown>;
}

const GEMINI_MODEL = 'gemini-1.5-flash';

function now() {
  return Date.now();
}

function summarizeText(text: string, limit = 200) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function createProviderError(options: {
  message: string;
  failureType: string;
  status?: number | null;
  rawBody?: string | null;
  requestSummary?: Record<string, unknown> | null;
}) {
  const error = new Error(options.message) as Error & {
    failureType: string;
    status: number | null;
    rawBody: string | null;
    requestSummary: Record<string, unknown> | null;
  };
  error.name = 'GeminiProviderError';
  error.failureType = options.failureType;
  error.status = options.status ?? null;
  error.rawBody = options.rawBody ?? null;
  error.requestSummary = options.requestSummary ?? null;
  return error;
}

function withTimeoutSignal(timeoutMs?: number) {
  if (!timeoutMs) {
    return {
      signal: undefined,
      cancel: () => {},
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`gemini timed out after ${timeoutMs}ms`)), timeoutMs);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
  };
}

export async function generateGeminiTextResponse(prompt: string, options: GeminiTextOptions = {}): Promise<GeminiTextResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const {
    systemInstruction,
    temperature = 0.9,
    maxOutputTokens = 180,
    timeoutMs,
  } = options;
  const startedAt = now();
  const requestSummary = {
    model: GEMINI_MODEL,
    temperature,
    maxOutputTokens,
    promptLength: prompt.length,
    promptPreview: summarizeText(prompt),
    systemInstructionLength: systemInstruction?.length ?? 0,
  };
  const { signal, cancel } = withTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: systemInstruction
            ? {
                parts: [{ text: systemInstruction }],
              }
            : undefined,
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens,
          },
        }),
      }
    );

    const rawText = await response.text();
    let data: any = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw createProviderError({
        message: 'gemini_non_json_payload',
        failureType: 'parse_failure',
        status: response.status,
        rawBody: rawText,
        requestSummary,
      });
    }

    if (!response.ok) {
      throw createProviderError({
        message: data?.error?.message || `gemini_status_${response.status}`,
        failureType: 'non_200',
        status: response.status,
        rawBody: rawText,
        requestSummary,
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string } | null | undefined) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim() || '';

    return {
      text,
      model: GEMINI_MODEL,
      durationMs: now() - startedAt,
      status: response.status,
      rawBody: rawText,
      requestSummary,
    };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'failureType' in error &&
      'status' in error &&
      'rawBody' in error &&
      'requestSummary' in error
    ) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw createProviderError({
      message,
      failureType:
        error instanceof Error && error.name === 'AbortError'
          ? /timed out/i.test(message)
            ? 'timeout'
            : 'aborted_request'
          : error instanceof Error && (/timed out/i.test(message))
            ? 'timeout'
            : error instanceof Error && (/fetch failed/i.test(message) || error.name === 'TypeError')
              ? 'network_error'
              : 'unknown_error',
      requestSummary,
    });
  } finally {
    cancel();
  }
}

export async function generateGeminiText(prompt: string, systemInstruction?: string) {
  const response = await generateGeminiTextResponse(prompt, { systemInstruction });
  return response.text ?? '';
}
