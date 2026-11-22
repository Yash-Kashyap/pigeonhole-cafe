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

export const SHARE_IMAGE_PATH = '/img/mood/mug-wall.jpg';
export const SHARE_IMAGE_ALT =
  'Rows of ceramic mugs on rustic wooden shelves against a wall';
const SHARE_SITE_NAME = 'The Pigeonhole Café (demo)';

export interface SocialMetaTag {
  attribute: 'property' | 'name';
  key: string;
  content: string;
}

/**
 * Open Graph and Twitter card tags, so a shared link shows a title, a
 * description and a photo in chat apps and social feeds. Every URL is made
 * absolute from the site origin because crawlers do not resolve relative ones.
 */
export function socialMetaTags(input: {
  title: string;
  description: string;
  pageUrl: string | URL;
  siteUrl: string;
}): SocialMetaTag[] {
  const image = new URL(SHARE_IMAGE_PATH, input.siteUrl).href;
  return [
    { attribute: 'property', key: 'og:type', content: 'website' },
    { attribute: 'property', key: 'og:site_name', content: SHARE_SITE_NAME },
    { attribute: 'property', key: 'og:title', content: input.title },
    {
      attribute: 'property',
      key: 'og:description',
      content: input.description,
    },
    {
      attribute: 'property',
      key: 'og:url',
      content: new URL(input.pageUrl).href,
    },
    { attribute: 'property', key: 'og:image', content: image },
    { attribute: 'property', key: 'og:image:alt', content: SHARE_IMAGE_ALT },
    { attribute: 'name', key: 'twitter:card', content: 'summary_large_image' },
    { attribute: 'name', key: 'twitter:title', content: input.title },
    {
      attribute: 'name',
      key: 'twitter:description',
      content: input.description,
    },
    { attribute: 'name', key: 'twitter:image', content: image },
    { attribute: 'name', key: 'twitter:image:alt', content: SHARE_IMAGE_ALT },
  ];
}
