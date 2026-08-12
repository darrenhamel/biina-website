import type { NormalizedPage } from './chunking';

/**
 * Provider-independent document processing. Identifies the file type, extracts
 * text into NORMALIZED pages (with page/section metadata for citations), and
 * reports errors clearly. The rest of BIINA never sees parser-specific output.
 *
 * SECURITY: uploaded content is treated as OPAQUE data — never executed, no
 * macros, no HTML rendering. Parsers are text extractors only.
 */

export type SupportedType = 'txt' | 'md' | 'csv' | 'pdf' | 'docx';

export interface ExtractionResult {
  pages: NormalizedPage[];
  pageCount: number;
  /** True when a PDF has almost no extractable text (likely scanned → needs OCR). */
  likelyScanned?: boolean;
  meta?: Record<string, unknown>;
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

const EXT_TO_TYPE: Record<string, SupportedType> = {
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  csv: 'csv',
  pdf: 'pdf',
  docx: 'docx',
};

export function detectType(extension: string, mimeType: string): SupportedType | null {
  const ext = extension.replace(/^\./, '').toLowerCase();
  if (EXT_TO_TYPE[ext]) return EXT_TO_TYPE[ext];
  // Fall back to MIME sniffing for a few common types.
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/plain') return 'txt';
  if (mimeType === 'text/markdown') return 'md';
  if (mimeType === 'text/csv') return 'csv';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return null;
}

/** Extract normalized pages from raw bytes for a supported type. */
export async function extractDocument(data: Buffer, type: SupportedType): Promise<ExtractionResult> {
  switch (type) {
    case 'txt':
    case 'md':
      return extractPlain(data);
    case 'csv':
      return extractCsv(data);
    case 'pdf':
      return extractPdf(data);
    case 'docx':
      return extractDocx(data);
    default:
      throw new UnsupportedFileError(`Unsupported type: ${type}`);
  }
}

function extractPlain(data: Buffer): ExtractionResult {
  const text = data.toString('utf-8');
  // Split on Markdown headings into sections (keeps citations meaningful).
  const sections = splitByHeadings(text);
  const pages: NormalizedPage[] = sections.map((s) => ({ page: null, sectionTitle: s.title, text: s.text }));
  return { pages: pages.length ? pages : [{ page: null, text }], pageCount: 1 };
}

function splitByHeadings(text: string): Array<{ title: string | null; text: string }> {
  const lines = text.split('\n');
  const out: Array<{ title: string | null; text: string }> = [];
  let current: { title: string | null; text: string } = { title: null, text: '' };
  for (const line of lines) {
    const h = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (h) {
      if (current.text.trim()) out.push(current);
      current = { title: h[1].trim(), text: '' };
    } else {
      current.text += line + '\n';
    }
  }
  if (current.text.trim()) out.push(current);
  return out;
}

function extractCsv(data: Buffer): ExtractionResult {
  // Structured, readable representation — never a giant unbroken blob.
  const text = data.toString('utf-8').replace(/\r\n/g, '\n').trim();
  const rows = text.split('\n').map((r) => splitCsvLine(r));
  if (rows.length === 0) return { pages: [{ page: null, text: '' }], pageCount: 1 };
  const headers = rows[0];
  const bodyRows = rows.slice(1);
  const rendered = bodyRows
    .map((cells, i) => {
      const pairs = headers.map((h, ci) => `${h}: ${cells[ci] ?? ''}`).join('; ');
      return `Row ${i + 1} — ${pairs}`;
    })
    .join('\n');
  const header = `CSV columns: ${headers.join(', ')}`;
  return { pages: [{ page: null, sectionTitle: 'Table', text: `${header}\n${rendered}` }], pageCount: 1, meta: { rows: bodyRows.length, columns: headers.length } };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

async function extractPdf(data: Buffer): Promise<ExtractionResult> {
  let pdfParse: (b: Buffer, opts?: unknown) => Promise<{ text: string; numpages: number }>;
  try {
    // Lazy import so a parser issue never breaks unrelated code paths.
    pdfParse = (await import('pdf-parse')).default as never;
  } catch {
    throw new UnsupportedFileError('PDF processing is not available');
  }
  const perPage: string[] = [];
  const parsed = await pdfParse(data, {
    // Capture text per page to preserve page boundaries for citations.
    pagerender: (pageData: { getTextContent: (o: unknown) => Promise<{ items: Array<{ str: string }> }> }) =>
      pageData
        .getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
        .then((tc) => {
          const t = tc.items.map((it) => it.str).join(' ');
          perPage.push(t);
          return t;
        }),
  }).catch((e: unknown) => {
    throw new ExtractionError(`PDF extraction failed: ${String(e)}`);
  });

  const pages: NormalizedPage[] = perPage.map((t, i) => ({ page: i + 1, text: t }));
  const totalChars = perPage.reduce((s, t) => s + t.trim().length, 0);
  const likelyScanned = parsed.numpages > 0 && totalChars < parsed.numpages * 20;
  return {
    pages: pages.length ? pages : [{ page: 1, text: parsed.text }],
    pageCount: parsed.numpages || pages.length || 1,
    likelyScanned,
  };
}

async function extractDocx(data: Buffer): Promise<ExtractionResult> {
  let mammoth: { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> };
  try {
    mammoth = (await import('mammoth')) as never;
  } catch {
    throw new UnsupportedFileError('DOCX processing is not available');
  }
  const { value } = await mammoth.extractRawText({ buffer: data }).catch((e: unknown) => {
    throw new ExtractionError(`DOCX extraction failed: ${String(e)}`);
  });
  // DOCX has no page model here; split by headings/blank lines into sections.
  return extractPlain(Buffer.from(value, 'utf-8'));
}
