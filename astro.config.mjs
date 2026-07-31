// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// BIINA.ai — static marketing site.
// Update `site` to the production domain before deploying so canonical URLs,
// sitemap, and Open Graph tags resolve correctly.
export default defineConfig({
  site: 'https://biina.ai',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  // Generates /sitemap-index.xml listing every page. Per-page hreflang
  // alternates (EN ⇄ AR) are declared in each page's <head> via Base.astro.
  integrations: [sitemap()],
});
