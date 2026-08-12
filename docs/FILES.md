# BIINA.ai — Files

Phase 8 adds user-uploaded files as the input side of retrieval-augmented
generation (RAG). A file is **opaque data**: BIINA stores it, extracts text from
it, and indexes that text — it is **never executed**. Companion docs:
`KNOWLEDGE_BASES.md`, `RAG_ARCHITECTURE.md`, `VECTOR_STORAGE.md`,
`EMBEDDINGS.md`, `RAG_SECURITY.md`. Code lives under
`apps/web/src/server/rag/`.

## Lifecycle

```
Upload → validate → store → record (UPLOADED)
      → ingest:  PROCESSING → extract → chunk → embed → vector upsert → READY
                                             ↘ FAILED / UNSUPPORTED (status reflects outcome)
Delete → purge storage object + chunks → DELETED (no searchable embeddings remain)
```

Status enum (`files.status`): `UPLOADED` · `QUEUED` · `PROCESSING` · `READY` ·
`FAILED` · `UNSUPPORTED` · `DELETED`. A `failureReason` accompanies non-READY
terminal states. `pageCount`/`chunkCount` are set on success.

## Storage abstraction (`storage.ts`)

Files go through a `FileStorageProvider` interface; the default is
`LocalFileStorage`, selected by `getFileStorage()`. Key properties:

- Writes **outside** any `public/`/static directory — files are **never**
  web-served. Reads are server-only.
- **Path-traversal-guarded**. Storage keys are **server-generated random opaque
  keys**, never the user's filename, and are never exposed to the browser.
- S3 / R2 / Azure adapters slot in behind the same interface later (set
  `FILE_STORAGE_PROVIDER`); nothing else changes.
- A **malware-scanning hook** belongs at the storage `put` boundary — files are
  stored and read as opaque bytes, never opened or run, so a scanner can gate
  ingestion without touching the rest of the pipeline.

## Validation & security boundary (`files.ts`)

Validation is **server-side and layered** — the browser's MIME type is never
trusted alone:

- **Extension whitelist**: PDF, DOCX, TXT, MD, CSV. Dangerous or misleading
  extensions are rejected.
- **Magic-byte sniff**: PDF must start `%PDF-`, DOCX must start `PK` (zip).
- **Parser-support check**: a type the processor can't handle fails clearly
  (`UnsupportedFileError`) rather than silently.
- **Content is opaque data** — never executed, no macro evaluation, no HTML
  rendering. This is the core document-security posture (see `RAG_SECURITY.md`).

## Supported types (`processor.ts`)

| Type | Extraction | Notes |
|---|---|---|
| TXT / MD | native | Markdown split into sections by heading (aids citations) |
| CSV | native | structured "Row N — col: val"; never a giant blob. Large analytical CSVs are better served by a future data-analysis system |
| PDF | `pdf-parse` | per-page text, **page numbers preserved**; a likely-**scanned** PDF (little/no extractable text) is marked `UNSUPPORTED` with an OCR-needed message |
| DOCX | `mammoth` | raw text → section split |

OCR is an **extension point**, not auto-run: scanned PDFs are detected and
flagged, never silently OCR'd.

## Plan limits (enforced server-side)

Upload/RAG entitlements reuse the Phase 5 plans (see `PLANS_AND_ENTITLEMENTS.md`):

| Field | Meaning |
|---|---|
| `filesEligible` | uploads enabled at all |
| `maxFileSizeBytes` | per-file size cap |
| `maxFiles` | total file count |
| `storageBytesLimit` | aggregate storage per owner |

FREE is **not** unlimited; `null` means unlimited (ENTERPRISE/ADMIN). Limits are
checked in `files.ts` before storing — a rejected upload consumes no storage.

## Deletion & reprocessing

- **Delete** purges the storage object, deletes the file's chunks, and marks the
  row `DELETED`. No searchable embeddings survive a delete.
- **Reprocess** (`ingestFile`) is **idempotent**: prior chunks are removed before
  new ones are written, so a retry never duplicates content.
- Ingestion **never throws** — status always reflects the real outcome, so a
  partially-processed file is never left ambiguously `READY`.

## Known limitations

- Ingestion runs **synchronously inline** for small, plan-bounded files. A queue
  is the documented next step for large/slow documents; the single `ingestFile`
  job boundary is already structured for it.
- Malware scanning is a **documented hook**, not yet wired to a scanner.
- OCR for scanned PDFs is detected-and-flagged, not performed.
