export type CartAddAction = {
  type: 'cart_add';
  items: { id: string; name: string; qty: number; price: number }[];
};

export type BookingProposalAction = {
  type: 'booking_proposal';
  date: string;
  time: string;
  partySize: number;
  name?: string;
  phone?: string;
  occasion?: string;
  notes?: string;
};

export type HandoffAction = { type: 'handoff' };

export type AssistantAction =
  CartAddAction | BookingProposalAction | HandoffAction;

export type AssistantFallbackKind =
  'timeout' | 'quota' | 'unavailable' | 'tool_limit' | 'model';

export type AssistantResponse = {
  text: string;
  actions: AssistantAction[];
  ids: string[];
  logged: boolean;
  resting?: boolean;
  fallback?: AssistantFallbackKind;
};
