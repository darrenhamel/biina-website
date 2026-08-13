# BIINA.ai — Cloudflare Production Setup (edge: TLS, DNS, WAF)

Operator guide to put **Cloudflare** in front of the Hetzner VPS for the invite-only beta:
TLS termination, DNS, and WAF/bot protection at the edge. Cloudflare is **additive** — the
app already sets its own security headers / CSP / HSTS in middleware. The origin app
listens on **`127.0.0.1:3000`** (see `docker-compose.production.yml`), so the edge (or a
Tunnel) is how traffic reaches it. Two hostnames: **`app.biina.ai`** (product) and
**`biina.ai`** (marketing site).

> **Posture.** **All DNS changes are HUMAN ACTION.** Claude Code / automation must not add
> the domain, change nameservers, or edit DNS records. There are **no application secrets
> in this doc** — DNS records (SPF/DKIM/DMARC, A/CNAME) are public by design. Any
> Cloudflare API token used for automation would be a secret and stays out of band.

Related: [`RESEND_PRODUCTION_SETUP.md`](./RESEND_PRODUCTION_SETUP.md) (email DNS) ·
[`DOMAIN_VERIFICATION.md`](./DOMAIN_VERIFICATION.md) ·
[`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md) ·
[`SECURITY.md`](./SECURITY.md)

---

## 1. Add the domain to Cloudflare — HUMAN ACTION

> **HUMAN ACTION.** Adding the site, and repointing the registrar's **nameservers** to
> Cloudflare, are human-only.

1. In Cloudflare → **Add a site**, add `biina.ai`.
2. At your **registrar**, change the nameservers to the pair Cloudflare assigns.
3. Wait for Cloudflare to report the zone **Active**.

---

## 2. DNS records — HUMAN ACTION

> **HUMAN ACTION — DNS.** All record changes below are human-only.

Point both hostnames at the Hetzner origin (recommend **proxied / orange-cloud** so TLS,
WAF, and the origin IP hide behind Cloudflare):

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `app` | `<hetzner-origin-ipv4>` | Proxied (orange) |
| A | `@` (`biina.ai`) | `<hetzner-origin-ipv4>` | Proxied (orange) |
| AAAA | `app` / `@` | `<hetzner-origin-ipv6>` (if used) | Proxied (orange) |

**Email verification records** (from [`RESEND_PRODUCTION_SETUP.md`](./RESEND_PRODUCTION_SETUP.md))
— add exactly as Resend provides; these are **DNS-only (grey-cloud)**:

| Type | Name | Value | Proxy |
|---|---|---|---|
| TXT | (SPF) | `v=spf1 include:...` as Resend shows | DNS only |
| CNAME/TXT | (DKIM) | as Resend shows | DNS only |
| TXT | `_dmarc` | `v=DMARC1; ...` as Resend shows | DNS only |

> Mail/verification records must be **DNS-only**; proxying them breaks delivery/validation.
> If you use [`DOMAIN_VERIFICATION.md`](./DOMAIN_VERIFICATION.md)'s
> `biina-domain-verification=<token>` TXT record for org ownership, add it DNS-only too.

---

## 3. TLS — Full (Strict)

1. Cloudflare → **SSL/TLS → Overview → Full (Strict)**. This requires a **valid
   certificate on the origin** — issue a Cloudflare **Origin Certificate** (or a public CA
   cert) and install it on the Hetzner box's reverse proxy in front of the app.
2. Enable **Always Use HTTPS** and **HSTS** at the edge. The app already emits HSTS; the
   edge setting is defense-in-depth and consistent with the app posture.
3. Do **not** use `Flexible` TLS — it would leave the edge→origin hop unencrypted.

---

## 4. Origin exposure — direct or Tunnel

The origin app binds to **`127.0.0.1:3000`** (loopback only) inside the compose stack. Pick
one way to reach it:

- **Reverse proxy on the VPS** (e.g. the box's own nginx/Caddy) terminating the Origin
  Certificate and proxying to `127.0.0.1:3000`, with the public port firewalled to
  Cloudflare's IP ranges only.
- **Cloudflare Tunnel (recommended)** — run `cloudflared` on the VPS pointing at
  `http://127.0.0.1:3000`. The origin then needs **no inbound public port** at all;
  Cloudflare reaches it over the outbound tunnel. This avoids exposing the origin IP
  entirely. The tunnel credential/token is a **secret** — store it out of band, never in
  git.

---

## 5. WAF / bot basics (sensible for an invite-only beta)

1. Cloudflare → **Security / WAF** — keep the **managed ruleset** on.
2. Enable **Bot Fight Mode** (or Super Bot Fight Mode) — reasonable for a small closed
   beta.
3. Keep **rate limiting sensible**: the app itself does **process-local** rate limiting
   (single instance, see [`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md));
   an edge rate-limit rule is additive, not a replacement. Do not set it so tight it blocks
   normal beta users.
4. Do **not** have Cloudflare strip or override the app's security headers/CSP — the app is
   authoritative for those.

---

## Verify

1. **DNS resolves through Cloudflare** — both hostnames resolve and are proxied:

   ```bash
   dig +short app.biina.ai
   dig +short biina.ai
   ```

2. **TLS is valid end-to-end** and the app answers through the edge:

   ```bash
   curl -fsSI https://app.biina.ai/api/health     # → HTTP/2 200, valid cert
   curl -fsS  https://app.biina.ai/api/health     # → { "status": "ok" }
   curl -fsSI https://biina.ai/                   # → marketing site, valid cert
   ```

3. **HTTPS is forced** — an `http://` request redirects to `https://`.

4. **Security headers present** — `curl -fsSI https://app.biina.ai/` shows the app's
   HSTS/CSP headers (the app emits them; the edge did not strip them).

5. **Email DNS validates** — Resend shows the domain **Verified** (SPF/DKIM/DMARC
   resolvable, DNS-only).

---

## What Claude / CI can check

- `npm run smoke:production -w apps/web` (with `BASE_URL=https://app.biina.ai`) — confirms
  `/api/health` is reachable **through the edge**, baseline security headers are present,
  the invite-only signup gate is enforced, and no secret-shaped value leaks.
- `npm run validate:production -w apps/web` — confirms the app-side production config
  (never prints a secret).

Automation can run these read-only checks against the public URL. It must **not** add the
Cloudflare site, change nameservers, or edit any DNS record — those are HUMAN ACTIONS.
