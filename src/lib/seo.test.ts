import { describe, expect, it } from 'vitest';
import { robotsText, sitemapXml } from './seo';

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
