export const publicPaths = [
  '/',
  '/menu',
  '/order',
  '/reserve',
  '/gatherings',
  '/trek-stop',
  '/visit',
  '/story',
] as const;

export function robotsText(allowIndex: string | undefined, siteUrl: string) {
  if (allowIndex !== 'true') return 'User-agent: *\nDisallow: /\n';
  return [
    'User-agent: *',
    'Disallow: /owner',
    'Disallow: /api',
    'Disallow: /whatsapp',
    'Disallow: /order/confirmed',
    'Disallow: /reserve/confirmed',
    `Sitemap: ${new URL('/sitemap.xml', siteUrl).href}`,
    '',
  ].join('\n');
}

export function sitemapXml(siteUrl: string) {
  const urls = publicPaths
    .map((path) => `  <url><loc>${new URL(path, siteUrl).href}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
