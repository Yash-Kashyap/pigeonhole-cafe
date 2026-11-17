const MAX_MESSAGE_LENGTH = 1000;

/** Digits only, with country code and no plus sign. Returns null when the value cannot be a phone number. */
export function normaliseWhatsAppNumber(
  value: string | undefined,
): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

/** Trims, collapses control characters and caps the length of a prefilled message. */
export function cleanWhatsAppMessage(text: string | null | undefined): string {
  const printable = Array.from(text ?? '')
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join('');
  return printable.trim().slice(0, MAX_MESSAGE_LENGTH);
}

/** The only place a wa.me address is built. Call it on the server so the number never reaches the page. */
export function buildWhatsAppUrl(number: string, text?: string | null): string {
  const message = cleanWhatsAppMessage(text);
  const base = `https://wa.me/${number}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** The link the site shows. It points at our own redirect route, so the number stays out of the HTML. */
export function whatsAppRedirectPath(text?: string | null): string {
  const message = cleanWhatsAppMessage(text);
  return message
    ? `/whatsapp?text=${encodeURIComponent(message)}`
    : '/whatsapp';
}

export function buildOrderWhatsAppText(order: {
  code: string;
  firstName: string;
  pickupAt: string;
  items: { name: string; qty: number }[];
}): string {
  const lines = order.items
    .map((item) => `${item.qty} × ${item.name}`)
    .join(', ');
  return cleanWhatsAppMessage(
    `Order ${order.code}\nName: ${order.firstName}\nPickup: ${order.pickupAt}\nItems: ${lines}`,
  );
}

function icsTimestamp(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** A UTC ICS event. `pickupAt` is already an instant from the Asia/Kolkata order rules. */
export function buildOrderCalendarIcs(order: {
  code: string;
  pickupAt: string;
}): string {
  const start = new Date(order.pickupAt);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid pickup time.');
  const end = new Date(start.getTime() + 30 * 60_000);
  const stamp = icsTimestamp(new Date());
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Pigeonhole Café//Order//EN',
    'BEGIN:VEVENT',
    `UID:${order.code}@pigeonhole-cafe.demo`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsTimestamp(start)}`,
    `DTEND:${icsTimestamp(end)}`,
    'SUMMARY:Takeaway pickup — The Pigeonhole Café',
    `DESCRIPTION:Show order code ${order.code} at the counter.`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
