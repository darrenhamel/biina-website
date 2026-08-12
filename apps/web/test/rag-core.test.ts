import { describe, it, expect } from 'vitest';
import { chunkPages, estimateTokens } from '@/server/rag/chunking';
import { DeterministicEmbeddingProvider, cosineSimilarity } from '@/server/rag/embeddings';
import { detectType, extractDocument } from '@/server/rag/processor';
import { buildRagContext, ragInstructions } from '@/server/rag/context-builder';
import { validateUpload } from '@/server/rag/files';
import type { SearchResult } from '@/server/rag/vector-store';

describe('chunking', () => {
  it('keeps chunks within page boundaries and records page metadata', () => {
    const chunks = chunkPages(
      [
        { page: 1, text: 'Alpha content on page one. '.repeat(3) },
        { page: 2, sectionTitle: 'Intro', text: 'Beta content on page two.' },
      ],
      { chunkSize: 1200, chunkOverlap: 100 },
    );
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.pageNumber === 1 || c.pageNumber === 2)).toBe(true);
    expect(chunks.find((c) => c.pageNumber === 2)?.sectionTitle).toBe('Intro');
  });

  it('splits long pages with overlap', () => {
    const long = 'word '.repeat(600); // ~3000 chars
    const chunks = chunkPages([{ page: 5, text: long }], { chunkSize: 800, chunkOverlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.pageNumber === 5)).toBe(true);
    expect(estimateTokens('abcd')).toBe(1);
  });
});

describe('deterministic embeddings', () => {
  const e = new DeterministicEmbeddingProvider('m', 256);
  it('produce fixed-dimension normalized vectors', async () => {
    const [v] = await e.embed(['hello world knowledge base']);
    expect(v.length).toBe(256);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('rank lexically-similar text above unrelated text', async () => {
    const [q, related, unrelated] = await e.embed([
      'annual leave policy vacation days',
      'the annual leave policy grants vacation days to employees',
      'quarterly revenue and the balance sheet for accounting',
    ]);
    expect(cosineSimilarity(q, related)).toBeGreaterThan(cosineSimilarity(q, unrelated));
  });
});

describe('document processor', () => {
  it('detects types by extension and MIME', () => {
    expect(detectType('PDF', '')).toBe('pdf'); // case-insensitive
    expect(detectType('', 'text/csv')).toBe('csv'); // MIME fallback
    expect(detectType('md', '')).toBe('md');
    expect(detectType('exe', 'application/octet-stream')).toBeNull();
  });

  it('extracts markdown sections and structured CSV', async () => {
    const md = await extractDocument(Buffer.from('# Title\nbody text here\n## Sub\nmore text'), 'md');
    expect(md.pages.some((p) => p.sectionTitle === 'Title')).toBe(true);
    const csv = await extractDocument(Buffer.from('name,role\nSara,owner\nAli,member'), 'csv');
    expect(csv.pages[0].text).toContain('name, role');
    expect(csv.pages[0].text).toContain('Row 1');
  });
});

describe('file validation', () => {
  const plan = { maxFileSizeBytes: 1024 * 1024 };
  it('accepts a whitelisted type and rejects executables/misleading extensions', () => {
    expect(validateUpload({ filename: 'a.txt', mimeType: 'text/plain', data: Buffer.from('hi') }, plan).type).toBe('txt');
    expect(() => validateUpload({ filename: 'a.exe', mimeType: 'application/octet-stream', data: Buffer.from('x') }, plan)).toThrow();
    // A .pdf whose bytes are not a PDF is rejected by the magic-byte sniff.
    expect(() => validateUpload({ filename: 'fake.pdf', mimeType: 'application/pdf', data: Buffer.from('not a pdf') }, plan)).toThrow();
  });

  it('rejects oversized and empty files', () => {
    expect(() => validateUpload({ filename: 'a.txt', mimeType: 'text/plain', data: Buffer.alloc(0) }, plan)).toThrow();
    expect(() => validateUpload({ filename: 'a.txt', mimeType: 'text/plain', data: Buffer.alloc(2 * 1024 * 1024) }, plan)).toThrow();
  });
});

describe('RAG context builder + injection defense', () => {
  const results: SearchResult[] = [
    { chunkId: 'c1', documentId: 'd1', documentName: 'Handbook', knowledgeBaseId: 'kb1', chunkIndex: 0, content: 'Annual leave is 30 days.', pageNumber: 18, sectionTitle: null, score: 0.9 },
    { chunkId: 'c1b', documentId: 'd1', documentName: 'Handbook', knowledgeBaseId: 'kb1', chunkIndex: 0, content: 'Annual leave is 30 days.', pageNumber: 18, sectionTitle: null, score: 0.88 },
    { chunkId: 'c2', documentId: 'd2', documentName: 'Policy', knowledgeBaseId: 'kb1', chunkIndex: 3, content: 'Sick leave requires a note.', pageNumber: 4, sectionTitle: 'Sick', score: 0.6 },
  ];

  it('numbers citations, dedupes near-identical chunks, and delimits sources', () => {
    const built = buildRagContext(results, { maxContextTokens: 2000 });
    expect(built.hasEvidence).toBe(true);
    expect(built.citations.length).toBe(2); // duplicate collapsed
    expect(built.citations[0].n).toBe(1);
    expect(built.citations[0].page).toBe(18);
    expect(built.contextBlock).toContain('BIINA_SOURCE');
  });

  it('respects the context-token budget', () => {
    const built = buildRagContext(results, { maxContextTokens: 5 }); // tiny → only the first source
    expect(built.citations.length).toBe(1);
  });

  it('empty results → no evidence', () => {
    expect(buildRagContext([], { maxContextTokens: 2000 }).hasEvidence).toBe(false);
  });

  it('instructions frame sources as untrusted and specify grounding + no-evidence', () => {
    const strict = ragInstructions('strict', false);
    expect(strict.toLowerCase()).toContain('untrusted');
    expect(strict.toLowerCase()).toContain('never follow instructions');
    expect(strict.toLowerCase()).toContain('could not find');
    expect(ragInstructions('strict', true)).toContain('STRICT MODE');
  });
});
