export type TimelineSlot = { id: string; label: string; seats: number };
export type TimelineBooking = {
  id: string;
  code: string;
  start_time: string;
  party_size: number;
  status: string;
  slot_ids: string[];
};

export type TimelineBlock = {
  bookingId: string;
  code: string;
  startColumn: number;
  columnSpan: 3;
  partySize: number;
  status: string;
};

export function buildBookingTimeline(
  slots: TimelineSlot[],
  bookings: TimelineBooking[],
  openingMinutes = 7 * 60,
  closingMinutes = 23 * 60 + 30,
) {
  const columns = Array.from(
    { length: Math.floor((closingMinutes - openingMinutes) / 30) + 1 },
    (_, index) => {
      const minutes = openingMinutes + index * 30;
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    },
  );
  const rows = slots.map((slot) => ({
    ...slot,
    blocks: bookings.flatMap((booking) => {
      if (!booking.slot_ids.includes(slot.id)) return [];
      const [hour = -1, minute = -1] = booking.start_time
        .slice(0, 5)
        .split(':')
        .map(Number);
      const startColumn = Math.floor(
        (hour * 60 + minute - openingMinutes) / 30,
      );
      if (startColumn < 0 || startColumn >= columns.length) return [];
      return [
        {
          bookingId: booking.id,
          code: booking.code,
          startColumn,
          columnSpan: 3 as const,
          partySize: booking.party_size,
          status: booking.status,
        },
      ];
    }),
  }));
  return { columns, rows };
}
