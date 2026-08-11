# BIINA.ai — website

The bilingual (English + Arabic) marketing website for **BIINA** — an
early-stage company in Abu Dhabi building the application and Arabic-language
layer of an AI platform for education.

This is a **credibility site**, not a product site. It is built to load fast,
work on mobile, read well in both languages, and make honest, forward-looking
claims only.

---

## What you need to do before launch

There are exactly three placeholders to fill in. Search the project for each.

| # | What | Where | Current placeholder |
|---|------|-------|---------------------|
| 1 | **Contact email** | `src/i18n/ui.ts` — the `email:` line (appears twice, EN and AR) | `hello@biina.ai` |
| 2 | **Contact form endpoint** | `src/views/ContactView.astro` — the `FORMSPREE_ID` line | `your-form-id` |
| 3 | **Production domain** | `astro.config.mjs` — the `site:` line | `https://biina.ai` |

Everything else is ready.

### 1 & 2 — Contact email and form (Formspree)

The contact form uses [Formspree](https://formspree.io) so there is **no
backend, no database, and nothing to host**.

1. Create a free Formspree account using your real contact email.
2. Create a new form. Formspree gives you an endpoint like
   `https://formspree.io/f/abcdwxyz`.
3. Open `src/views/ContactView.astro` and set:
   ```js
   const FORMSPREE_ID = 'abcdwxyz'; // the part after /f/
   ```
4. Put the same contact email into `src/i18n/ui.ts` (two `email:` lines).

Until you do step 3, the form shows a small "placeholder form" notice and will
not deliver mail. Once set, the notice disappears automatically. The form
includes a spam honeypot and sends you the sender's name, email, organisation,
subject, and message, tagged with the language they wrote in.

---

## Editing the words

**All copy lives in plain text files** — you do not need to touch layout or
styling to change wording.

```
src/content/home.ts          Home page (English + Arabic)
src/content/approach.ts      Approach page
src/content/institutions.ts  For institutions page
src/content/about.ts         About page
src/content/contact.ts       Contact page
src/i18n/ui.ts               Navigation, footer, shared text, contact email
```

Each file has an `en` block and an `ar` block, side by side. Edit the text
between the quotation marks. Keep Arabic and English in sync when you change
meaning.

---

## Running it on your computer (optional)

You need [Node.js](https://nodejs.org) version 20 or newer.

```bash
npm install        # once, to download dependencies
npm run dev        # start a live preview at http://localhost:4321
npm run build      # produce the final site in dist/
npm run preview    # preview the built site
```

`npm run dev` reloads automatically as you edit, so it is the easiest way to
see wording changes.

---

## Publishing it (free)

The site is static HTML — it can go on any of these free tiers. Point the host
at this repository and it deploys on every push.

| Host | Build command | Publish directory | Notes |
|------|---------------|-------------------|-------|
| **Vercel** | `npm run build` | `dist` | `vercel.json` already included — just import the repo |
| **Netlify** | `npm run build` | `dist` | `netlify.toml` already included |
| **Cloudflare Pages** | `npm run build` | `dist` | Set these two values in the dashboard when creating the project |

After connecting the repo, add your custom domain (`biina.ai`) in the host's
dashboard and follow its DNS instructions. Then update the `site:` value in
`astro.config.mjs` to match, and redeploy.

---

## What's in here

```
src/
  pages/            One file per URL (English at root, Arabic under /ar/)
  views/            The layout of each page (shared by both languages)
  layouts/Base.astro  Page shell: SEO, Open Graph, hreflang, fonts
  components/        Header, footer, logo, reusable blocks
  content/          The words, in both languages
  i18n/ui.ts        Navigation, footer, routes, contact email
  styles/global.css Brand colours, typography, layout
public/             Favicon, Open Graph share images, robots.txt
scripts/make-og.mjs Regenerates the share images (run with: node scripts/make-og.mjs)
```

### Design and technology

- **Astro** — builds to plain static HTML, ships almost no JavaScript.
- **Fonts are self-hosted** (Manrope for English, IBM Plex Sans Arabic for
  Arabic). The site makes **no third-party requests** — nothing is loaded from
  Google or any external service, and nothing tracks visitors.
- **Right-to-left** Arabic is a first-class layout, not a mirror: navigation,
  forms, cards, and directional arrows all flow correctly.
- **Brand:** deep navy (`#0A1F3D`) with a single restrained blue accent.
- **SEO:** title, description, Open Graph and Twitter cards, and `hreflang`
  language alternates on every page, in both languages, plus a generated
  sitemap and `robots.txt`.

---

## Honesty guardrails (please keep these)

This site is deliberately careful. It **does not** claim — and should never be
edited to claim:

- that BIINA is the first or only sovereign AI platform anywhere;
- any partnership, agreement, or affiliation with any company or government
  body;
- any government endorsement or backing;
- that the platform is live, available, or in use (it is in development);
- any customer, user, or institution names;
- performance or capability claims that cannot be evidenced.

The language throughout is forward-looking on purpose: *building*,
*in development*, *designed to*. A short "currently in development" note and a
site-wide footer disclaimer keep the stage clear. Please preserve that posture
as the company and the copy evolve.
