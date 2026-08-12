# BIINA.ai — Organizations & Multi-Tenancy

Organizations are shared workspaces. A user can belong to several; each request
runs in exactly one **workspace context** — either *personal* or one org.

## Data model (`server/db/schema.ts`)

- `organizations` — `slug` (unique, stable, URL-safe), `displayName`, `status`
  (`ACTIVE`/`SUSPENDED`), `createdByUserId`, plus `planSlug` / `maxSeats`
  readiness columns for future org billing and routing.
- `organization_members` — unique on `(organizationId, userId)`, carries the
  org `role` (OWNER/ADMIN/MEMBER) and `joinedAt`.
- `organization_invitations` — hashed single-use token, `email`, `role`,
  `status` (PENDING/ACCEPTED/EXPIRED/REVOKED), `expiresAt`.
- `conversations.organizationId` (nullable) — a conversation belongs to the
  workspace it was created in; personal chats keep it `null`.
- `usage_events.organizationId` — usage is attributed to the active workspace so
  org usage rolls up without scanning conversation content.

## Slugs

Stable identifiers, never the mutable display name. `server/org/slug.ts`
normalizes input and validates: 3–48 chars, `^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$`,
no `--`, and not in `RESERVED_SLUGS` (which protects first-party routes like
`admin`, `api`, `app`, `login`, `billing`). Unit-tested in `test/org-slug.test.ts`.

## The security-critical resolver

`resolveOrgContext(userId, slug)` is the **only** trusted way to obtain a user's
role in an org. It verifies ACTIVE membership server-side and returns `null`
otherwise. Callers never trust a client-supplied org id. This is the backbone of
tenant isolation — see `docs/AUTHORIZATION.md` (IDOR).

## Workspace context

- `POST /api/workspace { workspace }` sets the active workspace to `personal` or
  an org slug. Membership is **verified before** the `biina_workspace` cookie is
  written.
- The cookie is a **hint only**. Every AI request re-resolves membership from it
  (`/api/ai/chat`), so a tampered cookie grants nothing and a suspended org is
  refused with 403. New conversations are stamped with the resolved org id.

## Memberships

`server/org/members.ts` enforces the **owner-count invariant**: an org must
always keep at least one OWNER. The last owner can't be removed, demoted, or
leave (409 `conflict`). Removal authority follows `canRemoveMember`
(OWNER anyone; ADMIN members-only). Every mutation writes a security event.

## Invitations

`server/org/invitations.ts`:

- Token is random; only its **SHA-256 hash** is stored. Raw token goes out in
  the email link and is **never** returned by any listing endpoint.
- Creating an invite revokes any prior PENDING invite for the same
  `(org, email)` (dedupe + rotation) and refuses if the person is already a
  member.
- **Accept is atomic** (single transaction): validate PENDING + not-expired +
  email-match, flip PENDING→ACCEPTED with a guarded `UPDATE` (so two concurrent
  accepts can't both win), then insert membership `onConflictDoNothing`
  (idempotent). Expired tokens are marked EXPIRED on touch.
- Invitations expire after **7 days** and are single-use.

## API surface

| Purpose | Endpoint | Who |
|---------|----------|-----|
| List my orgs / create | `GET` / `POST /api/orgs` | any user |
| Accept an invite | `POST /api/orgs/accept` | invited user |
| Set active workspace | `POST /api/workspace` | member |
| Org overview | `GET /api/orgs/:slug` | member |
| Update settings | `PATCH /api/orgs/:slug` | manager |
| Members list | `GET /api/orgs/:slug/members` | member |
| Remove / change role | `DELETE` / `PATCH /api/orgs/:slug/members/:userId` | manager / owner |
| Leave | `POST /api/orgs/:slug/leave` | member |
| Invitations list / create | `GET` / `POST /api/orgs/:slug/invitations` | manager |
| Revoke invitation | `DELETE /api/orgs/:slug/invitations/:id` | manager |
| Org usage | `GET /api/orgs/:slug/usage` | manager |

## Platform administration

ADMINs can list all orgs (`GET /api/admin/orgs`, with member count + owner email)
and suspend/reactivate them (`PUT /api/admin/orgs/:id/status`). A suspended org
blocks AI use for its members until reactivated.

## Readiness, not scope

Org-level **plans/billing** and org-scoped **routing** have schema seams
(`planSlug`, `maxSeats`, `usage_events.organizationId`) but are **not** activated
in Phase 6. Payments arrive in Phase 7. Nothing here couples the app to a vendor
or a payment processor.
