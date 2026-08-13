# BIINA.ai — Hetzner VPS Deployment (invite-only beta)

How to run the BIINA.ai product app on **one small Hetzner Linux VPS**, fronted by
Cloudflare, for a 5–20 user invite-only beta. This is the single-box half of the
[minimum production topology](./MINIMUM_PRODUCTION_TOPOLOGY.md): the app + its scheduler
sidecar run **on** this box; **everything stateful runs OFF it** (managed services).

> **What runs OFF this box (managed, never on it):**
> Postgres + pgvector → **Supabase** · Object storage → **Supabase Storage (S3)** ·
> Inference + embeddings → **RunPod / OpenAI-compatible** · Email → **Resend** ·
> TLS + DNS + WAF → **Cloudflare**. The VPS is stateless application compute only —
> if it burns down, no user data is lost with it.

Related: [`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md) ·
[`STAGING_DEPLOYMENT.md`](./STAGING_DEPLOYMENT.md) ·
[`PRODUCTION_SECRET_CHECKLIST.md`](./PRODUCTION_SECRET_CHECKLIST.md) ·
[`BETA_MONITORING_SETUP.md`](./BETA_MONITORING_SETUP.md) ·
[`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md) ·
[`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md) ·
[`HUMAN_LAUNCH_ACTIONS.md`](./HUMAN_LAUNCH_ACTIONS.md)

> Status legend: **IMPLEMENTED** = shipped in the repo today · **REQUIRES INFRA** = a
> resource you provision · **HUMAN ACTION** = a human/business step automation must not
> take (create paid accounts, accept terms, add a card, buy compute, change DNS).

Repo artifacts this doc drives (already in the repo):
[`docker-compose.production.yml`](../docker-compose.production.yml),
[`Dockerfile`](../Dockerfile),
[`deploy/Caddyfile`](../deploy/Caddyfile),
[`scripts/deploy-production.sh`](../scripts/deploy-production.sh),
[`.env.production.example`](../.env.production.example).

---

## 0. Prerequisites (before you touch the box)

- [ ] **HUMAN ACTION** — All managed providers are provisioned and their credentials are
      in hand, tracked in the [provider activation status tracker](./HUMAN_LAUNCH_ACTIONS.md#provider-activation-status-tracker):
      Supabase (DB + Storage), RunPod (inference + embeddings), Resend (email), Cloudflare
      (edge/DNS). The app cannot pass its own validator without them.
- [ ] Every secret and config value is collected per
      [`PRODUCTION_SECRET_CHECKLIST.md`](./PRODUCTION_SECRET_CHECKLIST.md). Secrets stay in
      your secret manager; you assemble the git-ignored `.env.production` on the box at §4.
- [ ] You can reach the box over SSH as a user who can `sudo`.

---

## 1. Provision the VPS — HUMAN ACTION

- [ ] **HUMAN ACTION** — Create/pay for the Hetzner account and order **one** small Cloud
      VPS (a shared-vCPU tier such as CX22/CPX11-class is enough for a 5–20 user beta; the
      box only runs a Node standalone server + a curl sidecar). Automation must **not**
      create the account, accept terms, add a payment card, or purchase the server.
- [ ] Choose a Linux image with a current LTS kernel (Debian 12 or Ubuntu 22.04/24.04).
- [ ] Add your SSH public key at create time so password login is never needed.
- [ ] Record the server's public IPv4/IPv6. **DNS is set at Cloudflare, not here** (§8).

**Verify** — `ssh <user>@<server-ip>` succeeds using your key.

---

## 2. OS hardening basics — detect → act → verify

Do this once, first boot. Keep it minimal and standard; this is a beta, not a fortress.

**Act**

1. **Create a non-root sudo user** and stop using `root` for daily work:
   ```bash
   adduser deploy && usermod -aG sudo deploy
   # copy your SSH key to the new user, then test login before locking root
   ```
2. **Harden SSH** — key-only, no root login. In `/etc/ssh/sshd_config` set
   `PasswordAuthentication no` and `PermitRootLogin no`, then `sudo systemctl reload ssh`.
   Keep your current session open until you've confirmed a new one works.
3. **Firewall** — allow only SSH plus the edge path. Two supported shapes:

   **A. Cloudflare terminates TLS, talks to the origin over 80/443** (default for beta):
   ```bash
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow OpenSSH
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```
   Optionally restrict 80/443 to [Cloudflare's published IP ranges](https://www.cloudflare.com/ips/)
   so the origin only accepts edge traffic.

   **B. Cloudflare Tunnel (no public inbound web ports)** — preferred if you want the box
   to have **no** open 80/443 at all. Run `cloudflared` as an outbound-only connector; the
   firewall then allows **only** SSH:
   ```bash
   sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw enable
   ```
   The tunnel dials out to Cloudflare, so no inbound web port is exposed. Installing/enabling
   the tunnel and its token is a **HUMAN ACTION** (Cloudflare dashboard). See
   [`CLOUDFLARE_PRODUCTION_SETUP.md`](./CLOUDFLARE_PRODUCTION_SETUP.md).
4. **Unattended security updates** — apply OS security patches automatically:
   ```bash
   sudo apt-get update && sudo apt-get install -y unattended-upgrades
   sudo dpkg-reconfigure -plow unattended-upgrades   # enable
   ```
5. Optional but cheap: `fail2ban` for SSH brute-force throttling.

**Verify**

- `sudo ufw status` shows only the intended ports open.
- A fresh SSH session as `deploy` works; `ssh root@…` is refused.
- `systemctl status unattended-upgrades` is active.

---

## 3. Install Docker + Compose — detect → act → verify

**Detect** — `docker --version` fails or is absent (a fresh VPS has neither).

**Act** — install Docker Engine + the Compose v2 plugin from Docker's official repo (do
**not** use random curl-pipe scripts):

```bash
# Debian/Ubuntu, official Docker repo (abbreviated — follow docs.docker.com/engine/install)
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
# add Docker's GPG key + apt source per the official instructions, then:
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy   # log out/in for the group to take effect
```

**Verify**

```bash
docker --version                 # Engine present
docker compose version           # Compose v2 plugin present
docker run --rm hello-world      # daemon works without sudo (after re-login)
```

---

## 4. Place the git-ignored `.env.production` — detect → act → verify

The real env file is **never committed** (`.env.production` is git-ignored;
[`.env.production.example`](../.env.production.example) is the only committed template).

**Detect** — `ls .env.production` on the box: absent on a fresh checkout.

**Act**

1. Get the code onto the box (clone the repo or copy a release tarball) into e.g.
   `/opt/biina`.
2. Assemble `.env.production` **on the box** from your secret manager, using
   [`.env.production.example`](../.env.production.example) as the field list and
   [`PRODUCTION_SECRET_CHECKLIST.md`](./PRODUCTION_SECRET_CHECKLIST.md) for where each value
   comes from. Fill every `__set_out_of_band__` / placeholder with the real value.
3. Lock it down so only the deploy user can read it:
   ```bash
   chmod 600 .env.production
   ```

> **Never** paste real secret values into this repo, a PR, a chat, a ticket, or a log.
> The file lives only on the box (mode `600`) and in your secret manager. The app's
> `validate:production` gate and `/api/health` never print secret values.

**Verify** — `grep -c '__' .env.production` returns `0` (no placeholders left), and the
file is owned by `deploy` with mode `600`.

---

## 5. Deploy — detect → act → verify

**Act** — run the repo's production deploy script. It is idempotent and re-runnable, and
it is the **only** thing you run to ship a release:

```bash
cd /opt/biina
ENV_FILE=.env.production ./scripts/deploy-production.sh
```

What [`scripts/deploy-production.sh`](../scripts/deploy-production.sh) does, in order:

1. Refuses to run without the env file (and warns/aborts on a dirty tree in CI).
2. Runs **`npm run validate:production -w apps/web`** as a **BLOCKER gate** — any BLOCKER
   aborts the deploy before anything changes. It prints OK/WARNING/BLOCKER and **never a
   secret value**.
3. Applies DB migrations against managed Postgres (`npm run db:migrate`, additive-only;
   set `SKIP_MIGRATE=1` if already migrated).
4. Builds the image and rolls the `web` + `scheduler` containers
   ([`docker-compose.production.yml`](../docker-compose.production.yml)).
5. **Health-gates** on the `web` container becoming `healthy` (polls `/api/health`).

The `web` service binds **only** to `127.0.0.1:3000` — it is never directly public. The
edge (Cloudflare, or the optional Caddy proxy in §7) fronts it.

**Verify**

```bash
# From the box (loopback):
curl -s http://127.0.0.1:3000/api/health          # → 200 {"status":"ok"}
docker compose -f docker-compose.production.yml ps # web + scheduler up, web healthy

# Black-box smoke suite against the public URL (once Cloudflare/DNS is live, §8):
BASE_URL=https://app.biina.ai npm run smoke:production -w apps/web
```

`smoke:production` is a black-box check: health is `ok`, security headers present, the
invite-only signup gate returns **403** for a non-allowlisted email, and no secret-shaped
strings appear in the health payload. All four must pass.

---

## 6. How the scheduler sidecar works

The workflow scheduler is **DB-authoritative** — the database is the queue; there are no
in-memory timers. The `scheduler` service in
[`docker-compose.production.yml`](../docker-compose.production.yml) is a tiny
`curlimages/curl` sidecar that simply **advances** the queue:

- Every `TICK_INTERVAL_SECONDS` (default **60**) it POSTs
  `http://web:3000/api/internal/workflows/tick` with the
  `x-workflow-tick-secret: $WORKFLOW_TICK_SECRET` header.
- The app compares the secret in **constant time**. If `WORKFLOW_TICK_SECRET` is **unset**,
  the endpoint returns **503** so it can never be called anonymously.
- The sidecar holds **no application logic and no DB credentials** — only the tick secret
  and the internal URL. If it dies, **no data is lost**; scheduled workflows just pause
  until it (or a manual tick) resumes. See [`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md#3-restart-worker--scheduler).

Manual tick (to confirm the endpoint) — read the secret from the env file, don't hard-code:
```bash
curl -s -X POST http://127.0.0.1:3000/api/internal/workflows/tick \
  -H "x-workflow-tick-secret: $(grep -E '^WORKFLOW_TICK_SECRET=' .env.production | cut -d= -f2-)" \
  -H "x-worker-id: manual"
# → {"claimed":…,"executed":…,"recovered":…,"skippedDuplicates":…}
```

Single sidecar is correct for beta (see
[why single-instance is correct](./MINIMUM_PRODUCTION_TOPOLOGY.md#why-single-instance-is-correct-for-beta)).
Do not run a second tick caller.

---

## 7. Edge: Cloudflare vs the optional Caddy proxy

Two supported ways to terminate TLS in front of the loopback-bound `web`:

- **Cloudflare fronts the box (recommended for beta).** Cloudflare terminates TLS and
  provides WAF/DNS; it talks to the origin (either over 80/443 with an origin cert, or via
  a Cloudflare Tunnel). Leave the `proxy` profile **off**. Configure the app's public URL
  and CSP to trust the edge. See [`CLOUDFLARE_PRODUCTION_SETUP.md`](./CLOUDFLARE_PRODUCTION_SETUP.md).
- **Terminate TLS on the box with Caddy.** Enable the optional `proxy` profile, which runs
  Caddy from [`deploy/Caddyfile`](../deploy/Caddyfile) and reverse-proxies `web:3000`:
  ```bash
  SITE_ADDRESS=app.biina.ai \
    docker compose --env-file .env.production -f docker-compose.production.yml \
    --profile proxy up -d
  ```
  The domain is injected via `SITE_ADDRESS` (nothing hard-coded). Set `SITE_ADDRESS=:80`
  for a plain-HTTP origin behind Cloudflare (Full/Strict via the CF cert). The Caddyfile
  health-checks `/api/health` and adds baseline hardening headers; the app still emits its
  own CSP/HSTS.

Pick one. Running Caddy **and** Cloudflare-terminated TLS is fine (Full/Strict), but do not
expose `web:3000` to the internet directly — it is loopback-bound for exactly this reason.

---

## 8. DNS — HUMAN ACTION

- [ ] **HUMAN ACTION** — Point `app.biina.ai` at the box (an A/AAAA record to the VPS IP, or
      a Cloudflare Tunnel CNAME) in the Cloudflare dashboard. Automation must **not** change
      DNS. Set `NEXT_PUBLIC_APP_URL=https://app.biina.ai` in the env file to match. Details
      and the SPF/DKIM/DMARC records for Resend are in
      [`CLOUDFLARE_PRODUCTION_SETUP.md`](./CLOUDFLARE_PRODUCTION_SETUP.md) and
      [`RESEND_PRODUCTION_SETUP.md`](./RESEND_PRODUCTION_SETUP.md).

**Verify** — `curl -s https://app.biina.ai/api/health` → `200 {"status":"ok"}` from off-box.

---

## 9. Logs & rotation

- **Container logs** use the `json-file` driver with rotation limits already set in
  [`docker-compose.production.yml`](../docker-compose.production.yml): `web` keeps
  `max-size: 10m × max-file: 5`; `scheduler` keeps `5m × 3`. This bounds disk use on the
  box without extra configuration.
- App logs are **structured JSON to stdout** and **secret-redacted** already
  (`REDACT_KEYS`; provider URLs/keys are never logged). See
  [`OBSERVABILITY.md`](./OBSERVABILITY.md).
- **Shipping logs off the box** (a retained sink) is **REQUIRES INFRA / HUMAN ACTION** —
  see [`BETA_MONITORING_SETUP.md`](./BETA_MONITORING_SETUP.md). The on-box rotation above
  is enough to keep the disk healthy for the beta; it is **not** a durable log archive.

```bash
docker logs -f --tail 100 biina-web         # tail app logs
docker logs -f --tail 100 biina-scheduler   # confirm ticks / spot tick failures
```

---

## 10. Roll a new release — detect → act → verify

**Detect** — a reviewed, tagged release is ready (see [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)).

**Act**

1. Pull the new code/tag onto the box.
2. **Snapshot the DB first** if migrations are pending (Supabase snapshot/PITR — see
   [`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md)). Never deploy a migration
   without a fresh backup.
3. Re-run the same deploy script — it re-validates, migrates, rebuilds, and rolls with the
   health gate:
   ```bash
   ENV_FILE=.env.production ./scripts/deploy-production.sh
   ```
   Optionally pin the image tag: `IMAGE_TAG=<release-tag> ENV_FILE=.env.production ./scripts/deploy-production.sh`.

**Verify** — health `200`; `smoke:production` passes; scheduler ticks resume.

---

## 11. Rollback — detect → act → verify

**Detect** — health stays `503`, error rate spikes, or `smoke:production` fails after a deploy.

**Act**

1. **Re-point `web` to the previous known-good image tag** and roll:
   ```bash
   IMAGE_TAG=<previous-good-tag> \
     docker compose --env-file .env.production -f docker-compose.production.yml up -d web
   ```
   Because `web` is stateless, a code rollback is fast and safe **when no migration ran**.
2. If a migration ran and is incompatible, prefer **roll forward** (deploy a fix) — Drizzle
   migrations here are forward-only; restore from a Supabase snapshot only if data is
   corrupted ([`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md)).
3. For a single bad feature, prefer a **kill switch** over a full rollback
   ([`OPERATIONS_RUNBOOK.md` §8](./OPERATIONS_RUNBOOK.md#8-kill-switches-disable-a-feature-safely)).

> Keep the previous image tag available (in your registry or as a local image) so rollback
> is a one-liner. Tag every release; never rely on `latest` alone for the rollback target.

**Verify** — health `200`; error rate back to baseline; `smoke:production` passes.

---

## Off-box services (reminder)

This box is application compute only. Durability, backups, and cost live with the managed
providers, not the VPS:

| Concern | Where it lives | Setup doc |
|---|---|---|
| Postgres + pgvector | Supabase (managed) | [`SUPABASE_PRODUCTION_SETUP.md`](./SUPABASE_PRODUCTION_SETUP.md) |
| Object storage (files) | Supabase Storage, S3 adapter | [`SUPABASE_STORAGE_SETUP.md`](./SUPABASE_STORAGE_SETUP.md) |
| Inference | RunPod / OpenAI-compatible | [`RUNPOD_BETA_ACTIVATION.md`](./RUNPOD_BETA_ACTIVATION.md) |
| Embeddings | RunPod / endpoint | [`EMBEDDINGS_BETA_ACTIVATION.md`](./EMBEDDINGS_BETA_ACTIVATION.md) |
| Email | Resend | [`RESEND_PRODUCTION_SETUP.md`](./RESEND_PRODUCTION_SETUP.md) |
| TLS / DNS / WAF | Cloudflare | [`CLOUDFLARE_PRODUCTION_SETUP.md`](./CLOUDFLARE_PRODUCTION_SETUP.md) |
| Backups / restore | Supabase + secrets manager | [`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md) |
| Monitoring / alerts | external | [`BETA_MONITORING_SETUP.md`](./BETA_MONITORING_SETUP.md) |
