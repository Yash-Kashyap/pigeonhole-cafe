import { getOpenState } from '../rules';
import type { AssistantResponse } from './types';

const RESTING_TEXT =
  'The assistant is resting. Browse the menu or contact the team.';

export function assistantFallback(
  question: string,
  now: Date,
): AssistantResponse {
  const lower = question.toLowerCase();
  if (/open|close|hour|monday|today/.test(lower)) {
    return {
      text: `${RESTING_TEXT} ${getOpenState(now).label}.`,
      actions: [],
      ids: [],
      logged: false,
      resting: true,
    };
  }
  if (/book|reserve|table|slot/.test(lower)) {
    return {
      text: `${RESTING_TEXT} You can check times at /reserve.`,
      actions: [],
      ids: [],
      logged: false,
      resting: true,
    };
  }
  if (/menu|dish|food|drink|vegan|jain|gluten/.test(lower)) {
    return {
      text: `${RESTING_TEXT} Browse the current menu at /menu.`,
      actions: [],
      ids: [],
      logged: false,
      resting: true,
    };
  }
  return {
    text: RESTING_TEXT,
    actions: [{ type: 'handoff' }],
    ids: [],
    logged: false,
    resting: true,
  };
}

export { RESTING_TEXT };
