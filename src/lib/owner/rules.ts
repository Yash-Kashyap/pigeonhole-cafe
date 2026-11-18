export type OrderStatus =
  'new' | 'preparing' | 'ready' | 'collected' | 'cancelled';

const legalOrderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['collected', 'cancelled'],
  collected: [],
  cancelled: [],
};

export function isLegalOrderTransition(
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  return legalOrderTransitions[current].includes(next);
}

export type BookingStatus =
  'confirmed' | 'requested' | 'declined' | 'cancelled' | 'seated' | 'no_show';

export function isLegalBookingAction(
  current: BookingStatus,
  action: 'confirm' | 'decline' | 'seated' | 'no_show' | 'cancel',
): boolean {
  if (action === 'confirm') return current === 'requested';
  if (action === 'decline')
    return current === 'requested' || current === 'confirmed';
  if (action === 'seated' || action === 'no_show')
    return current === 'confirmed';
  return current === 'requested' || current === 'confirmed';
}
