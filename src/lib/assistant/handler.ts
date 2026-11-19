import type { MenuItem } from '../menu';
import { saltedRateLimitKey } from '../orders/place-order';
import { assistantFallback, RESTING_TEXT } from './fallback';
import { getKnowledgeOverrides, type KnowledgeOverride } from './facts';
import { assistantRequestSchema, type AssistantRequest } from './schema';
import { scrubAssistantText } from './scrub';
import {
  runAssistant,
  type ModelContent,
  type ModelResult,
  type ModelUsage,
} from './service';
import type { ToolDeclaration } from './tools';
import type { AssistantResponse } from './types';
import type { AvailabilityRow } from '../bookings/bookings';

export const ASSISTANT_GLOBAL_DAILY_CAP = 200;
export const DEFAULT_ASSISTANT_DAILY_TOKEN_CAP = 5_000_000;

export type AssistantLogInput = {
  sessionId: string;
  userText: string;
  assistantText: string;
  answered: boolean;
  unansweredTopic: string | null;
  toolCalls: { name: string; arguments: string }[];
};

export type AssistantHandlerDependencies = {
  salt: string;
  hash(value: string): Promise<string>;
  hitRateLimit(
    key: string,
    windowSeconds: number,
    maximum: number,
  ): Promise<boolean>;
  readDailyTokens(day: string): Promise<number>;
  dailyTokenCap: number;
  configured: boolean;
  loadMenu(): Promise<MenuItem[]>;
  loadOverrides(): Promise<KnowledgeOverride[]>;
  loadAvailability(date: string, partySize: number): Promise<AvailabilityRow[]>;
  callModel(input: {
    systemInstruction: string;
    contents: ModelContent[];
    tools: ToolDeclaration[];
    timeoutMs: number;
    budgetMs: number;
  }): Promise<ModelResult>;
  recordUsage(day: string, usage: ModelUsage): Promise<void>;
  logUnanswered(sessionId: string, topic: string): Promise<void>;
  logExchange(input: AssistantLogInput): Promise<void>;
  onPromptSize(characterCount: number): void;
  warnFallback(info: AssistantFallbackInfo): void;
};

export type AssistantFallbackInfo = {
  kind:
    | 'quota'
    | 'timeout'
    | 'unavailable'
    | 'notfound'
    | 'auth'
    | 'upstream'
    | 'response'
    | 'budget'
    | 'not_configured'
    | 'unknown';
  status?: number;
};

const fallbackKinds = new Set<AssistantFallbackInfo['kind']>([
  'quota',
  'timeout',
  'unavailable',
  'notfound',
  'auth',
  'upstream',
  'response',
  'budget',
  'not_configured',
]);

export function assistantFallbackDiagnostic(
  error: unknown,
): AssistantFallbackInfo {
  if (!error || typeof error !== 'object') return { kind: 'unknown' };
  const kind =
    'kind' in error &&
    typeof error.kind === 'string' &&
    fallbackKinds.has(error.kind as AssistantFallbackInfo['kind'])
      ? (error.kind as AssistantFallbackInfo['kind'])
      : 'unknown';
  const status =
    'status' in error &&
    typeof error.status === 'number' &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
      ? error.status
      : undefined;
  return { kind, ...(status ? { status } : {}) };
}

export function formatAssistantFallbackWarning(
  info: AssistantFallbackInfo,
): string {
  return `assistant_fallback kind=${info.kind}${info.status ? ` status=${info.status}` : ''}`;
}

export type AssistantHandlerResult = {
  status: 200 | 400 | 429 | 500;
  body: AssistantResponse | { message: string };
  retryAfter?: number;
};

const localDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
});

const limitedResponse = (text: string): AssistantResponse => ({
  text,
  actions: [],
  ids: [],
  logged: false,
  resting: true,
});

function cleanToolCalls(
  calls: { name: string; args: Record<string, unknown> }[],
): { name: string; arguments: string }[] {
  return calls.map((call) => ({
    name: call.name,
    arguments: scrubAssistantText(JSON.stringify(call.args)).slice(0, 1_000),
  }));
}

async function logResult(
  request: AssistantRequest,
  response: AssistantResponse,
  toolCalls: { name: string; args: Record<string, unknown> }[],
  unansweredTopic: string | undefined,
  deps: AssistantHandlerDependencies,
): Promise<void> {
  try {
    await deps.logExchange({
      sessionId: request.sessionId,
      userText: scrubAssistantText(request.messages.at(-1)?.text ?? ''),
      assistantText: scrubAssistantText(response.text),
      answered: !response.logged,
      unansweredTopic: unansweredTopic
        ? scrubAssistantText(unansweredTopic)
        : null,
      toolCalls: cleanToolCalls(toolCalls),
    });
  } catch {
    // A logging failure must not expose internal details to the guest.
  }
}

export async function handleAssistantRequest(
  raw: unknown,
  ip: string,
  now: Date,
  deps: AssistantHandlerDependencies,
): Promise<AssistantHandlerResult> {
  const parsed = assistantRequestSchema.safeParse(raw);
  if (!parsed.success)
    return { status: 400, body: { message: 'Check the assistant request.' } };
  const request = parsed.data;
  const day = localDayFormatter.format(now);
  try {
    const ipKey = await saltedRateLimitKey(deps, 'assistant-ip', ip);
    if (!(await deps.hitRateLimit(ipKey, 600, 20)))
      return {
        status: 429,
        body: limitedResponse('Please wait before sending another message.'),
        retryAfter: 600,
      };
    const sessionKey = await saltedRateLimitKey(
      deps,
      'assistant-session',
      request.sessionId,
    );
    if (!(await deps.hitRateLimit(sessionKey, 86_400, 60)))
      return {
        status: 429,
        body: limitedResponse('This chat has reached its daily message limit.'),
        retryAfter: 86_400,
      };
    const globalKey = await saltedRateLimitKey(
      deps,
      'assistant-global-day',
      day,
    );
    if (
      !(await deps.hitRateLimit(globalKey, 86_400, ASSISTANT_GLOBAL_DAILY_CAP))
    ) {
      const response = limitedResponse(RESTING_TEXT);
      await logResult(request, response, [], undefined, deps);
      return { status: 200, body: response };
    }
    if ((await deps.readDailyTokens(day)) >= deps.dailyTokenCap) {
      const response = limitedResponse(RESTING_TEXT);
      await logResult(request, response, [], undefined, deps);
      return { status: 200, body: response };
    }
    const [menu, overrides] = await Promise.all([
      deps.loadMenu(),
      getKnowledgeOverrides(deps.loadOverrides, now.getTime()),
    ]);
    const question = request.messages.at(-1)?.text ?? '';
    if (!deps.configured) {
      deps.warnFallback({ kind: 'not_configured' });
      const response = assistantFallback(question, now);
      await logResult(request, response, [], undefined, deps);
      return { status: 200, body: response };
    }
    try {
      const result = await runAssistant(request, {
        menu,
        overrides,
        now,
        loadAvailability: deps.loadAvailability,
        async logUnanswered(topic) {
          await deps.logUnanswered(
            request.sessionId,
            scrubAssistantText(topic),
          );
        },
        callModel: deps.callModel,
        recordUsage: (usage) => deps.recordUsage(day, usage),
        onPromptSize: deps.onPromptSize,
      });
      const response: AssistantResponse = {
        text: result.text,
        actions: result.actions,
        ids: result.ids,
        logged: result.logged,
        ...(result.resting ? { resting: true } : {}),
      };
      await logResult(
        request,
        response,
        result.toolCalls,
        result.unansweredTopic,
        deps,
      );
      return { status: 200, body: response };
    } catch (error) {
      deps.warnFallback(assistantFallbackDiagnostic(error));
      const response = assistantFallback(question, now);
      await logResult(request, response, [], undefined, deps);
      return { status: 200, body: response };
    }
  } catch {
    return {
      status: 500,
      body: { message: 'Assistant service is unavailable.' },
    };
  }
}
