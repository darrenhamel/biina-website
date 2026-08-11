// Generates the Open Graph share images (1200×630) for English and Arabic.
// Run once and commit the PNGs: `node scripts/make-og.mjs`
// Requires the dev dependency `sharp`.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og');

const NAVY = '#0a1f3d';
const NAVY2 = '#0e2748';
const ACCENT = '#2f6bed';
const ACCENT2 = '#5b8bf5';
const INK = '#f3f6fc';
const SOFT = '#b7c2d8';

function svg({ dir, title, sub }) {
  const anchor = dir === 'rtl' ? 'end' : 'start';
  const x = dir === 'rtl' ? 1120 : 80;
  const family = dir === 'rtl'
    ? 'IBM Plex Sans Arabic, Segoe UI, Tahoma, sans-serif'
    : 'Manrope, Segoe UI, sans-serif';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${NAVY}"/>
      <stop offset="1" stop-color="${NAVY2}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="6" fill="${ACCENT}"/>
  <!-- layered mark -->
  <g transform="translate(80,80)">
    <rect x="0" y="46" width="150" height="20" rx="10" fill="${INK}"/>
    <rect x="19" y="23" width="112" height="20" rx="10" fill="${ACCENT}"/>
    <rect x="38" y="0" width="74" height="20" rx="10" fill="${ACCENT2}"/>
  </g>
  <text x="260" y="150" font-family="Manrope, sans-serif" font-size="46" font-weight="800" fill="${INK}" letter-spacing="1">BIINA</text>
  <text x="${x}" y="360" text-anchor="${anchor}" font-family="${family}" font-size="66" font-weight="800" fill="${INK}">${title}</text>
  <text x="${x}" y="430" text-anchor="${anchor}" font-family="${family}" font-size="34" font-weight="500" fill="${SOFT}">${sub}</text>
  <text x="${x}" y="560" text-anchor="${anchor}" font-family="${family}" font-size="26" font-weight="600" fill="${ACCENT2}">${dir === 'rtl' ? 'قيد التطوير · أبوظبي' : 'In development · Abu Dhabi'}</text>
</svg>`;
}

const images = [
  {
    file: 'biina-og.png',
    dir: 'ltr',
    title: 'An AI platform for education',
    sub: 'Built around the Arabic language',
  },
  {
    file: 'biina-og-ar.png',
    dir: 'rtl',
    title: 'منصّة ذكاء اصطناعي للتعليم',
    sub: 'تبدأ من اللغة العربية',
  },
];

await mkdir(outDir, { recursive: true });
for (const img of images) {
  const buf = Buffer.from(svg(img));
  await sharp(buf).png().toFile(join(outDir, img.file));
  console.log('wrote', img.file);
}
