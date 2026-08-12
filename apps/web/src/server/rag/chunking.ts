/**
 * Centralized, provider-independent chunking. Parsers produce normalized pages;
 * this is the ONE place that splits them into overlapping, token-aware chunks —
 * preserving page and section boundaries so citations stay accurate.
 */

export interface NormalizedPage {
  page: number | null;
  sectionTitle?: string | null;
  text: string;
}

export interface Chunk {
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  tokenCount: number;
}

/** Rough, provider-agnostic token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface ChunkOptions {
  chunkSize: number; // characters
  chunkOverlap: number; // characters
}

/**
 * Split normalized pages into chunks. Never crosses a page boundary (keeps the
 * cited page correct); long pages are split with overlap; short adjacent pages
 * are NOT merged (so a citation maps to exactly one page).
 */
export function chunkPages(pages: NormalizedPage[], opts: ChunkOptions): Chunk[] {
  const size = Math.max(200, opts.chunkSize);
  const overlap = Math.min(opts.chunkOverlap, Math.floor(size / 2));
  const chunks: Chunk[] = [];
  let index = 0;

  for (const page of pages) {
    const text = page.text.replace(/\r\n/g, '\n').trim();
    if (!text) continue;
    if (text.length <= size) {
      chunks.push(mk(index++, text, page));
      continue;
    }
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + size, text.length);
      // Prefer to break on a paragraph/sentence boundary near the window end.
      if (end < text.length) {
        const window = text.slice(start, end);
        const brk = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '));
        if (brk > size * 0.5) end = start + brk + 1;
      }
      const slice = text.slice(start, end).trim();
      if (slice) chunks.push(mk(index++, slice, page));
      if (end >= text.length) break;
      start = end - overlap;
    }
  }
  return chunks;
}

function mk(chunkIndex: number, content: string, page: NormalizedPage): Chunk {
  return {
    chunkIndex,
    content,
    pageNumber: page.page ?? null,
    sectionTitle: page.sectionTitle ?? null,
    tokenCount: estimateTokens(content),
  };
}
