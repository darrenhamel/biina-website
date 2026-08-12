# BIINA.ai — Library Publishing

How an item moves from a draft to a published, installable listing — and how it is
updated, revoked, forked, and pinned. The governing rules: **deterministic validation is
a hard gate that cannot be skipped, executable items are never auto-published from AI
review, published versions are immutable, and a version that adds capability triggers
re-review.** Code: `apps/web/src/server/library/review.ts`, `versions.ts`, `updates.ts`.
Companion docs: [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md),
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md),
[`ORGANIZATION_LIBRARY.md`](./ORGANIZATION_LIBRARY.md).

## Lifecycle states

`library_item_status`:

```
DRAFT ─▶ SUBMITTED ─▶ IN_REVIEW ─▶ APPROVED ─▶ PUBLISHED
  │                        │
  │                        ├─▶ REJECTED            (rejected in review)
  │                        └─▶ DRAFT               (changes requested)
  └───────────────────────────────────────────────
PUBLISHED ─▶ SUSPENDED     (platform/admin revocation)
PUBLISHED ─▶ DEPRECATED    (no new installs; existing installs keep working)
          ─▶ ARCHIVED      (retired)
```

Version status (`library_version_status`): `DRAFT` → `PUBLISHED` → `SUPERSEDED`.
Review status (`library_review_status`): `PENDING` → `APPROVED` / `REJECTED` /
`CHANGES_REQUESTED` / `SUSPENDED`.

## Submission flow

```
Draft item + version → Submit → Automated (deterministic) validation → Human/admin review → Approve → Publish
```

1. **Create a version** (`createVersion`, `POST /api/library/[id]/versions`). Every
   version runs **deterministic validation** at creation; the result is stored on the
   version (`validationResult`) with its risk, required tools/connectors/capabilities,
   and a `configHash`. A version that fails validation cannot be published.
2. **Submit** (`submitForReview`, `POST /api/library/[id]/submit`). The item moves to
   `SUBMITTED` and a `PENDING` review row is created carrying the risk + validation
   metadata. **Non-BIINA submissions require `PUBLIC_CREATOR_PUBLISHING_ENABLED`**
   (default off) — otherwise `403 creator_publishing_disabled`.
3. **Automated validation** is already the gate: a human reviewer **cannot approve a
   version whose `validationResult.ok === false`** (`422 validation_failed`) nor one
   above `SCHEDULED_WRITE` risk (`422 risk_too_high`).
4. **Human/admin review** (`reviewQueue`, `GET /api/admin/library/reviews`;
   `decideReview`, `POST /api/admin/library/reviews/[id]`). Actions: `APPROVE`,
   `REJECT`, `REQUEST_CHANGES`, `SUSPEND`.
5. **Approve → Publish**: `APPROVE` publishes the version (`publishVersion`), supersedes
   the prior published version, points the item at it, and (for BIINA items) sets
   `verified`. BIINA-owned **content** items may be published directly (`publishDirect`,
   still validated); **executable** items always route through review even for BIINA.

**Executable items are never auto-published from AI review.** There is no path where a
model judgement alone publishes an agent or workflow.

## Immutable versions

A `PUBLISHED` version's `configurationSnapshot`, `manifest`, and `configHash` never
change. Any edit produces a **new** `DRAFT` version, re-validated (and, for executables,
re-reviewed) before it can publish. Publishing a new version supersedes the previous one
**for new installs only** — existing installations keep their pinned version until the
installer explicitly updates. `configHash` (SHA-256 of the canonical snapshot) detects
any unauthorized modification of a stored snapshot.

## Version updates & re-review

`diffVersions` / `versionEscalation` compare a candidate against the current published
version. A change is **security-sensitive** when it adds a tool, adds a connector,
raises the risk class, or changes the approval policy:

- On the **publisher** side, a security-sensitive new version is re-reviewed before it
  can publish (executables always route through review).
- On the **installer** side (`previewUpdate` / `updateInstallation`), a
  security-sensitive update **requires an explicit `confirm`** — without it,
  `updateInstallation` throws `409 update_requires_review` and logs
  `library.update_blocked`. **Existing permissions do not carry over to added
  capabilities**, and a workflow that gains capability **drops back to DRAFT**.
- Content-only refreshes may be applied freely.

## Revocation, suspension & deprecation

- **Suspend** (`suspendItem`, admin `action: "suspend"`) sets a published item
  `SUSPENDED` — a revocation. `LIBRARY_SUSPENDED_ITEMS` (env, comma-separated slugs/ids)
  additionally suspends items platform-wide and **hides them from discovery for
  everyone but the platform**, and blocks installs.
- **Deprecate** (`deprecateItem`, admin `action: "deprecate"`) sets `DEPRECATED` —
  non-destructive: no **new** installs, but existing installs keep working.
- Review-time `SUSPEND` blocks a submission.

## Version pinning

An installation can be `pinnedVersion: true`; a pinned install is **not auto-upgraded**
and `updateInstallation` refuses with `409 pinned`. Organizations can pin a specific
version for a curated item (`libraryOrgCuration.pinnedVersionId`) so members stay on a
vetted version — see [`ORGANIZATION_LIBRARY.md`](./ORGANIZATION_LIBRARY.md).

## Forking

`forkItem` (`POST /api/library/[id]/fork`) creates a **PRIVATE** copy the user/org owns:

- it copies the current configuration into the fork's first version, **re-validated**;
- it records **provenance** (change notes reference the source slug + version) and
  `derivedFromVersionId` in the audit event;
- the fork **no longer inherits upstream changes** and is reset to unverified /
  `monetizationStatus: FREE`.

A fork must pass validation (and, if executable, review) to be published, exactly like
any other item.

## Provenance, verified badge & readiness

- **Provenance** is recorded on forks (`library.forked`) and in every version's change
  notes.
- The **verified** badge is set only on **BIINA-owned** items on approval — it marks
  platform origin, not a third-party endorsement.
- **Publisher identity** (`publisher_profiles`) is **readiness** for verified external
  creators; there are **no creator payouts, no paid marketplace, and no public
  self-publishing** in Phase 16 (`PUBLIC_CREATOR_PUBLISHING_ENABLED` and
  `PAID_MARKETPLACE_ENABLED` default off; the latter is not implemented).

Every step logs a metadata-only `library.*` event (`submitted` / `approved` /
`published` / `rejected` / `changes_requested` / `suspended` / `deprecated` /
`forked` / `item_created` / `item_updated`). See
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md).
