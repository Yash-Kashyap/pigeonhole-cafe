export type OwnerDatabaseErrorCode =
  | 'bad_transition'
  | 'reason_required'
  | 'not_found'
  | 'slot_taken'
  | 'too_few_seats'
  | 'bad_slots'
  | 'closed_day'
  | 'outside_window'
  | 'bad_time'
  | 'too_late'
  | 'notice_required'
  | 'party_too_large'
  | 'bad_preorder'
  | 'bad_customer';

const knownCodes: readonly OwnerDatabaseErrorCode[] = [
  'bad_transition',
  'reason_required',
  'not_found',
  'slot_taken',
  'too_few_seats',
  'bad_slots',
  'closed_day',
  'outside_window',
  'bad_time',
  'too_late',
  'notice_required',
  'party_too_large',
  'bad_preorder',
  'bad_customer',
];

export function ownerDatabaseErrorCode(
  error: unknown,
): OwnerDatabaseErrorCode | null {
  const message =
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
      ? error.message
      : error instanceof Error
        ? error.message
        : '';
  return knownCodes.find((code) => message.includes(code)) ?? null;
}

export function ownerErrorResponse(error: unknown): {
  status: 400 | 404 | 409 | 422 | 500;
  message: string;
} {
  const code = ownerDatabaseErrorCode(error);
  if (code === 'not_found')
    return { status: 404, message: 'Record not found.' };
  if (code === 'bad_transition')
    return { status: 409, message: 'That status change is not allowed.' };
  if (code === 'slot_taken')
    return { status: 409, message: 'One or more slots were just taken.' };
  if (code === 'too_few_seats')
    return { status: 422, message: 'The selected slots have too few seats.' };
  if (code === 'reason_required' || code === 'bad_slots')
    return { status: 400, message: 'Check the requested change.' };
  if (code)
    return { status: 422, message: 'This booking breaks the booking rules.' };
  return { status: 500, message: 'The owner service is unavailable.' };
}
