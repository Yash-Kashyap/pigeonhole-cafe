import type { AssistantRequest } from './schema';
import { buildAssistantPrompt, type KnowledgeOverride } from './facts';
import {
  ASSISTANT_TOOL_DECLARATIONS,
  executeAssistantTool,
  type AssistantToolContext,
  type ToolExecution,
  type ToolDeclaration,
} from './tools';
import type {
  AssistantAction,
  AssistantFallbackKind,
  AssistantResponse,
} from './types';

export type ModelPart = {
  text?: string;
  functionCall?: {
    id?: string;
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
  thoughtSignature?: string;
};

export type ModelContent = {
  role: 'user' | 'model';
  parts: ModelPart[];
};

export type ModelUsage = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  cachedContentTokenCount: number;
  thoughtsTokenCount: number;
  totalTokenCount: number;
};

export type ModelResult = { content: ModelContent; usage: ModelUsage };

export type AssistantServiceDependencies = AssistantToolContext & {
  overrides: readonly KnowledgeOverride[];
  callModel(input: {
    systemInstruction: string;
    contents: ModelContent[];
    tools: ToolDeclaration[];
    timeoutMs: number;
    budgetMs: number;
  }): Promise<ModelResult>;
  recordUsage(usage: ModelUsage): Promise<void>;
  onPromptSize(characterCount: number): void;
  clock?: () => number;
  totalBudgetMs?: number;
};

export const ASSISTANT_TOTAL_BUDGET_MS = 40_000;
export const ASSISTANT_CALL_TIMEOUT_MS = 20_000;
export const ALLERGY_EMERGENCY_TERMS = [
  'emergency',
  'anaphylaxis',
  'anaphylactic',
  'cannot breathe',
  "can't breathe",
  'trouble breathing',
  'throat closing',
  'swelling',
  'epipen',
  'ambulance',
  'hospital',
  'severe reaction',
  'collapsed',
] as const;

export function isAllergyEmergencyMessage(value: string): boolean {
  const normalized = value.toLowerCase().replaceAll('’', "'");
  return ALLERGY_EMERGENCY_TERMS.some((term) => normalized.includes(term));
}

const COMPLAINT_PATTERNS = [
  /\bcomplaints?\b/,
  /\bcomplain\b/,
  /\b(?:i|we)\s+(?:want|need|demand|expect|would\s+like)\s+(?:a|my|our)\s+refund\b/,
  /\bmy\s+refund\b/,
  /\brude\b/,
  /\bunhappy\b/,
  /\bterrible\s+service\b/,
  /\bfood\s+poisoning\b/,
  /\bovercharged\b/,
  /\bwrong\s+order\b/,
] as const;

export function isComplaintMessage(value: string): boolean {
  const normalized = value.toLowerCase().replaceAll('’', "'");
  return COMPLAINT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export class AssistantBudgetError extends Error {
  readonly kind = 'budget';
}

const actionKey = (action: AssistantAction) => JSON.stringify(action);

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  return value;
}

function toolCallKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(canonicalValue(args))}`;
}

function collectIds(value: unknown, ids: Set<string>): void {
  if (typeof value === 'string') {
    for (const id of value.match(/PH\d{4}/g) ?? []) ids.add(id);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectIds(item, ids));
    return;
  }
  if (value && typeof value === 'object')
    Object.values(value).forEach((item) => collectIds(item, ids));
}

function cleanReply(value: string, guestIds: ReadonlySet<string>): string {
  return value
    .replace(/\s*\(?(PH\d+)\)?/gi, (match, id: string) =>
      guestIds.has(id.toUpperCase()) ? match : '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export async function runAssistant(
  request: AssistantRequest,
  deps: AssistantServiceDependencies,
): Promise<
  AssistantResponse & {
    unansweredTopic?: string;
    toolCalls: { name: string; args: Record<string, unknown> }[];
  }
> {
  const latestUserMessage =
    request.messages.findLast((message) => message.role === 'user')?.text ?? '';
  if (isAllergyEmergencyMessage(latestUserMessage))
    return {
      text: 'Please contact emergency services or seek medical help right away.',
      actions: [{ type: 'handoff' }],
      ids: [],
      logged: false,
      toolCalls: [],
    };

  if (isComplaintMessage(latestUserMessage)) {
    await deps.logUnanswered(latestUserMessage);
    return {
      text: "I'm sorry about that. I'll hand this to the team.",
      actions: [{ type: 'handoff' }],
      ids: [],
      logged: true,
      unansweredTopic: latestUserMessage,
      toolCalls: [],
    };
  }

  const extractedPhIds = latestUserMessage.match(/PH\d+/gi);
  if (extractedPhIds) {
    const menuById = new Map(
      deps.menu.map((item) => [item.id.toUpperCase(), item]),
    );
    for (const rawId of extractedPhIds) {
      const id = rawId.toUpperCase();
      const menuItem = menuById.get(id);
      if (!menuItem) {
        return {
          text: `Item ${id} is not on the menu. I can help you find something similar if you would like.`,
          actions: [],
          ids: [],
          logged: false,
          toolCalls: [],
        };
      }
      if (!menuItem.available) {
        return {
          text: `Item ${id} is not available right now. I can help you find something similar if you would like.`,
          actions: [],
          ids: [],
          logged: false,
          toolCalls: [],
        };
      }
    }
  }

  const guestIds = new Set(
    (latestUserMessage.match(/PH\d+/gi) ?? []).map((id) => id.toUpperCase()),
  );
  const dynamicContext = JSON.stringify({
    page: request.page,
    cart: request.cart ?? [],
    currentTime: deps.now.toISOString(),
  });
  const prompt = buildAssistantPrompt(
    deps.menu,
    deps.overrides,
    dynamicContext,
  );
  deps.onPromptSize(prompt.characterCount);
  const clock = deps.clock ?? Date.now;
  const totalBudgetMs = deps.totalBudgetMs ?? ASSISTANT_TOTAL_BUDGET_MS;
  const startedAt = clock();

  const contents: ModelContent[] = request.messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.text }],
  }));
  const actions = new Map<string, AssistantAction>();
  const ids = new Set<string>();
  const availableIds = new Set(
    deps.menu.filter((item) => item.available).map((item) => item.id),
  );
  const responseIds = () =>
    [...ids].filter((id) => availableIds.has(id)).slice(0, 8);
  let logged = false;
  let unansweredTopic: string | undefined;
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const toolResults = new Map<string, ToolExecution>();
  let toolRounds = 0;

  const finalResponse = async (
    text: string,
    responseActions: AssistantAction[] = [...actions.values()],
    fallback?: AssistantFallbackKind,
  ) => {
    let resolvedFallback = fallback;
    const isStockPhrase = /^I'll check with the team\.?$/.test(text);
    if (isStockPhrase && !resolvedFallback) {
      resolvedFallback = 'model';
    }
    if (isStockPhrase && !logged) {
      const topic = request.messages.at(-1)?.text ?? '';
      await deps.logUnanswered(topic);
      logged = true;
      unansweredTopic = topic;
    }
    return {
      text,
      actions: responseActions,
      ids: responseIds(),
      logged,
      toolCalls,
      ...(unansweredTopic ? { unansweredTopic } : {}),
      ...(resolvedFallback ? { fallback: resolvedFallback } : {}),
    };
  };

  for (let callIndex = 0; callIndex < 6; callIndex += 1) {
    const remainingBudgetMs = totalBudgetMs - (clock() - startedAt);
    if (remainingBudgetMs <= 0) throw new AssistantBudgetError();
    const result = await deps.callModel({
      systemInstruction: prompt.text,
      contents,
      tools: ASSISTANT_TOOL_DECLARATIONS,
      timeoutMs: Math.min(ASSISTANT_CALL_TIMEOUT_MS, remainingBudgetMs),
      budgetMs: remainingBudgetMs,
    });
    await deps.recordUsage(result.usage);
    const calls = result.content.parts.flatMap((part) =>
      part.functionCall ? [part.functionCall] : [],
    );
    if (!calls.length) {
      const rawText = result.content.parts
        .map((part) => part.text ?? '')
        .join(' ')
        .trim();
      collectIds(rawText, ids);
      const text = cleanReply(rawText, guestIds) || "I'll check with the team.";
      return finalResponse(text);
    }
    const hasNewCall = calls.some(
      (call) => !toolResults.has(toolCallKey(call.name, call.args)),
    );
    if (hasNewCall && toolRounds >= 3)
      return finalResponse(
        "I'll check with the team.",
        [{ type: 'handoff' }],
        'tool_limit',
      );
    if (hasNewCall) toolRounds += 1;
    contents.push(result.content);
    const responseParts: ModelPart[] = [];
    for (const call of calls) {
      toolCalls.push({ name: call.name, args: call.args });
      const key = toolCallKey(call.name, call.args);
      let execution = toolResults.get(key);
      if (!execution) {
        execution = await executeAssistantTool(call.name, call.args, deps);
        toolResults.set(key, execution);
      }
      execution.actions.forEach((action) =>
        actions.set(actionKey(action), action),
      );
      collectIds(execution.output, ids);
      logged ||= execution.logged;
      unansweredTopic ??= execution.unansweredTopic;
      responseParts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response: execution.output,
        },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return finalResponse(
    "I'll check with the team.",
    [{ type: 'handoff' }],
    'tool_limit',
  );
}
