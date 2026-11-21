import { ProviderRequestError, type ProviderResult } from '../assistant/gemini';
import { parseGeneratedSummary } from './ai';

export type SummaryGenerationDependencies<T> = {
  generate(payload: string): Promise<ProviderResult>;
  recordUsage(usage: ProviderResult['usage']): Promise<void>;
  save(content: string): Promise<T>;
};

export type SummaryGenerationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'quota' | 'provider' | 'invalid' };

export async function createDailySummary<T>(
  payload: string,
  dependencies: SummaryGenerationDependencies<T>,
): Promise<SummaryGenerationResult<T>> {
  let response: ProviderResult;
  try {
    response = await dependencies.generate(payload);
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof ProviderRequestError && error.kind === 'quota'
          ? 'quota'
          : 'provider',
    };
  }
  await dependencies.recordUsage(response.usage);
  const text = response.content.parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  let content: string;
  try {
    content = JSON.stringify(parseGeneratedSummary(text));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, value: await dependencies.save(content) };
}
