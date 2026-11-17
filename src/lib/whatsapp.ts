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
