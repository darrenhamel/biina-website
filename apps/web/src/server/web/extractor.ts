import type { FetchedPage } from './fetcher';

/**
 * WebContentExtractor — normalize a fetched page into clean text + metadata.
 * Strips scripts/styles/nav noise; pulls title, canonical, published/updated
 * dates, author, site. No browser rendering; JS-heavy pages are marked. Content
 * is treated as OPAQUE DATA — never executed, never rendered as HTML.
 */

export interface ExtractedWebContent {
  title: string | null;
  text: string;
  canonicalUrl: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  author: string | null;
  domain: string;
  likelyNeedsRendering: boolean;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function metaContent(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export async function extractWebContent(page: FetchedPage): Promise<ExtractedWebContent> {
  const domain = domainOf(page.finalUrl);
  if (/^application\/pdf/i.test(page.contentType)) {
    const { extractDocument } = await import('@/server/rag/processor');
    const res = await extractDocument(page.body, 'pdf').catch(() => ({ pages: [] as Array<{ text: string }> }));
    const text = res.pages.map((p) => p.text).join('\n').trim();
    return { title: null, text, canonicalUrl: page.finalUrl, publishedAt: null, updatedAt: null, author: null, domain, likelyNeedsRendering: false };
  }
  if (/^text\/plain/i.test(page.contentType)) {
    return { title: null, text: page.body.toString('utf-8').trim(), canonicalUrl: page.finalUrl, publishedAt: null, updatedAt: null, author: null, domain, likelyNeedsRendering: false };
  }
  return extractHtml(page.body.toString('utf-8'), page.finalUrl, domain);
}

export function extractHtml(html: string, finalUrl: string, domain = domainOf(finalUrl)): ExtractedWebContent {
  const title =
    metaContent(html, [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i]) ||
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null);
  const publishedAt = metaContent(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ]);
  const updatedAt = metaContent(html, [/<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i]);
  const author = metaContent(html, [/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i]);
  const canonicalUrl = metaContent(html, [/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i]) || finalUrl;

  // Strip noise, then tags → text.
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const textOnly = decodeEntities(body.replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  // Heuristic: a page with lots of markup but almost no text likely needs JS rendering.
  const likelyNeedsRendering = html.length > 4000 && textOnly.length < 200;
  return { title, text: textOnly, canonicalUrl, publishedAt, updatedAt, author, domain, likelyNeedsRendering };
}
