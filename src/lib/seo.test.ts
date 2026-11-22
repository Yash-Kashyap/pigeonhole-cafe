import { describe, expect, it } from 'vitest';
import { robotsText, sitemapXml, socialMetaTags } from './seo';

describe('SEO endpoints', () => {
  it('fails closed in robots when indexing is not exactly enabled', () => {
    expect(robotsText('false', 'https://cafe.example')).toBe(
      'User-agent: *\nDisallow: /\n',
    );
    expect(robotsText(undefined, 'https://cafe.example')).toContain(
      'Disallow: /',
    );
  });

  it('lists exclusions and sitemap only when indexing is enabled', () => {
    const output = robotsText('true', 'https://cafe.example');
    for (const path of [
      '/owner',
      '/api',
      '/whatsapp',
      '/order/confirmed',
      '/reserve/confirmed',
    ])
      expect(output).toContain(`Disallow: ${path}`);
    expect(output).toContain('Sitemap: https://cafe.example/sitemap.xml');
  });

  it('lists only public pages from the configured origin', () => {
    const output = sitemapXml('https://cafe.example/base/');
    expect(output).toContain('https://cafe.example/');
    expect(output).toContain('https://cafe.example/menu');
    expect(output).not.toContain('/owner');
    expect(output).not.toContain('/api');
  });
});

describe('social meta tags', () => {
  const tags = socialMetaTags({
    title: 'Menu | The Pigeonhole Café (demo)',
    description: 'Browse the menu.',
    pageUrl: 'https://cafe.example/menu/',
    siteUrl: 'https://cafe.example/base/',
  });
  const value = (key: string) => tags.find((tag) => tag.key === key)?.content;

  it('uses absolute URLs for the page and the share image', () => {
    expect(value('og:url')).toBe('https://cafe.example/menu/');
    expect(value('og:image')).toBe(
      'https://cafe.example/img/mood/mug-wall.jpg',
    );
    expect(value('twitter:image')).toBe(value('og:image'));
  });

  it('carries the page title and description into both card formats', () => {
    expect(value('og:title')).toBe('Menu | The Pigeonhole Café (demo)');
    expect(value('twitter:title')).toBe(value('og:title'));
    expect(value('og:description')).toBe('Browse the menu.');
    expect(value('twitter:card')).toBe('summary_large_image');
  });

  it('describes the image for people who cannot see it', () => {
    expect(value('og:image:alt')).toBeTruthy();
    expect(value('twitter:image:alt')).toBe(value('og:image:alt'));
  });
});
