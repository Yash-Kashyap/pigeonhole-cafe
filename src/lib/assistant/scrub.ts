const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?:\+?\d[\d ()-]{7,}\d)/g;
const longDigitsPattern = /\d{5,}/g;

export function scrubAssistantText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(emailPattern, '[email removed]')
    .replace(phonePattern, '[phone removed]')
    .replace(longDigitsPattern, '[number removed]')
    .replace(/\s+/g, ' ')
    .trim();
}
