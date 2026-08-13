# BIINA.ai — First Admin Bootstrap

How the **first platform administrator** is created for a production deployment — securely,
with **no hard-coded credentials and no default password anywhere in the product**.

Grounded in `apps/web/scripts/bootstrap-admin.ts` (`npm run bootstrap:admin`) and the
production guards in `apps/web/src/server/config/production.ts`.

> **Why it works this way.** There is intentionally **no seeded admin account**. The
> production seed (`npm run db:seed:production`) creates plans + deployment profiles **only**
> — no users, no default-password admin, no mock provider, no test data — and the dev seed
> **refuses to run in production**. The first admin is therefore an ordinary user who signs
> up through the app and is then **promoted** out-of-band by an operator.

---

## Procedure

1. **Deploy the app** to production with a valid config. Confirm
   `npm run validate:production` reports **0 blockers** and `/api/health` is ok for app +
   database + aiGateway. (A real email adapter must be wired first, LB-02, so the next step's
   verification email can actually be delivered.)

2. **The operator signs up normally** through the app UI, using their real work email
   (e.g. the launch owner's account). This creates a standard, non-privileged user and runs
   the normal email-verification flow — no special path, no elevated form.

3. **Promote that user to admin** by running the bootstrap script against the production
   database, with the operator's exact signup email:

   ```bash
   BOOTSTRAP_ADMIN_EMAIL=<operator-email> DATABASE_URL=<prod-db-url> npm run bootstrap:admin
   ```

   The script:
   - looks up the **existing** user by (lower-cased) email;
   - **fails** with a clear message if no such user exists ("Ask them to sign up first,
     then re-run") — it never creates a user;
   - sets `role=SUPER_ADMIN` and `plan=ADMIN`;
   - never sets or prints a password, and contains **no credentials**.

4. **Verify the promotion.** Confirm the account now has `SUPER_ADMIN` in the admin surface
   (kill switches, maintenance mode, production-readiness view are reachable).

5. **Enforce MFA** on this account where available (the script prints a reminder:
   "Enforce MFA on this account where available").

6. **Bootstrap is a one-time, deliberate act.** Run it once for the first admin; create any
   further admins through the in-app admin tools, not by re-running the script broadly.

---

## Guarantees (grounded in code)

- **No hard-coded creds / no default password** — `bootstrap-admin.ts` only updates an
  existing row's `role`/`plan`; it never writes a password.
- **No seeded admin** — `seed-production.ts` seeds plans + deployment profiles + the core AI
  settings singleton only; explicitly "NO test users, NO seeded admin with a default
  password, NO mock AI provider, NO test billing prices, NO test library items."
- **Dev seed refuses in production** — `seed-production.ts` refuses a localhost `DATABASE_URL`
  unless `ALLOW_LOCAL_PROD_SEED=true` (a test-only override), and refuses to seed at all if the
  production config validator reports any CRITICAL finding.
- **Promotion requires an inbox you control** — because step 2 is a real signup, whoever gets
  promoted must have proven control of the email address (once the email adapter is live).

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `No user found with email …` | Operator has not signed up yet, or email mismatch/case. | Sign up in the app first; re-run with the exact email. |
| `DATABASE_URL is required.` | Env not set for the script. | Provide the production `DATABASE_URL`. |
| Verification email never arrives | Email adapter still mock (LB-02). | Wire a real email provider first (see [`LAUNCH_BACKLOG.md`](./LAUNCH_BACKLOG.md) LB-02). |
| Seed refuses to run | Localhost DB or a CRITICAL config finding. | Point at the managed prod DB; fix config (`npm run validate:production`). |

See also [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md),
[`CURRENT_LAUNCH_STATUS.md`](./CURRENT_LAUNCH_STATUS.md).
