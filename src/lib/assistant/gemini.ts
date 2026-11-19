import { z } from 'zod';
import type { ToolDeclaration } from './tools';

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

export type ProviderFunctionCall = {
  id?: string;
  name: string;
  args: Record<string, unknown>;
};

export type ProviderPart = {
  text?: string;
  functionCall?: ProviderFunctionCall;
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
  thoughtSignature?: string;
};

export type ProviderContent = {
  role: 'user' | 'model';
  parts: ProviderPart[];
};

export type ProviderUsage = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  cachedContentTokenCount: number;
  thoughtsTokenCount: number;
  totalTokenCount: number;
};

export type ProviderResult = {
  content: ProviderContent;
  usage: ProviderUsage;
};

export type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class ProviderRequestError extends Error {
  constructor(
    public readonly kind:
      | 'quota'
      | 'timeout'
      | 'unavailable'
      | 'notfound'
      | 'auth'
      | 'upstream'
      | 'response',
    public readonly status?: number,
  ) {
    super('Assistant provider request failed.');
  }
}

export type ProviderCallOptions = {
  timeoutMs?: number;
  budgetMs?: number;
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const functionCallSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const partSchema = z
  .object({
    text: z.string().optional(),
    functionCall: functionCallSchema.optional(),
    thoughtSignature: z.string().optional(),
  })
  .loose();

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          role: z.literal('model').default('model'),
          parts: z.array(partSchema),
        }),
      }),
    )
    .min(1),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().nonnegative().default(0),
      candidatesTokenCount: z.number().int().nonnegative().default(0),
      cachedContentTokenCount: z.number().int().nonnegative().default(0),
      thoughtsTokenCount: z.number().int().nonnegative().default(0),
      totalTokenCount: z.number().int().nonnegative().default(0),
    })
    .default({
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      cachedContentTokenCount: 0,
      thoughtsTokenCount: 0,
      totalTokenCount: 0,
    }),
});

export async function callProvider(
  input: {
    apiKey: string;
    model?: string;
    systemInstruction: string;
    contents: ProviderContent[];
    tools: ToolDeclaration[];
  },
  fetchFn: ProviderFetch = fetch,
  options: ProviderCallOptions = {},
): Promise<ProviderResult> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const budgetMs = options.budgetMs ?? 25_000;
  const retryDelayMs = options.retryDelayMs ?? 700;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();

  const requestOnce = async (attemptTimeoutMs: number) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
    let response: Response;
    try {
      response = await fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model || DEFAULT_MODEL)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': input.apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: input.systemInstruction }] },
            contents: input.contents,
            tools: [{ functionDeclarations: input.tools }],
            toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
            generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
          }),
        },
      );
    } catch {
      if (controller.signal.aborted) throw new ProviderRequestError('timeout');
      throw new ProviderRequestError('upstream');
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401 || response.status === 403)
      throw new ProviderRequestError('auth', response.status);
    if (response.status === 404)
      throw new ProviderRequestError('notfound', response.status);
    if (response.status === 429)
      throw new ProviderRequestError('quota', response.status);
    if (response.status === 503)
      throw new ProviderRequestError('unavailable', response.status);
    if (!response.ok)
      throw new ProviderRequestError('upstream', response.status);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ProviderRequestError('response', response.status);
    }
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success)
      throw new ProviderRequestError('response', response.status);
    const candidate = parsed.data.candidates[0]!;
    return {
      content: {
        role: 'model' as const,
        parts: candidate.content.parts.map((part) => ({
          ...(part.text !== undefined ? { text: part.text } : {}),
          ...(part.functionCall ? { functionCall: part.functionCall } : {}),
          ...(part.thoughtSignature
            ? { thoughtSignature: part.thoughtSignature }
            : {}),
        })),
      },
      usage: parsed.data.usageMetadata,
    };
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = budgetMs - (now() - startedAt);
    if (remaining <= 0) throw new ProviderRequestError('timeout');
    try {
      return await requestOnce(Math.min(timeoutMs, remaining));
    } catch (error) {
      const retryable =
        error instanceof ProviderRequestError &&
        (error.kind === 'timeout' || error.kind === 'unavailable');
      if (!retryable || attempt === 1) throw error;
      if (budgetMs - (now() - startedAt) <= retryDelayMs) throw error;
      await sleep(retryDelayMs);
    }
  }
  throw new ProviderRequestError('upstream');
}
