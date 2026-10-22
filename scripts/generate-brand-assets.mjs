/**
 * Generates the app icon set from vector artwork (no fonts needed):
 *   node scripts/generate-brand-assets.mjs
 * Motif: a folded bolt of jacquard fabric with a dark label band, on Kantin Kwari forest green.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve('apps/api/package.json'));
const sharp = require('sharp');
const OUT = path.resolve('apps/mobile/assets/images');

const GREEN = '#174F33';
const GREEN_DARK = '#0F3824';
const GOLD = '#C9971C';
const GOLD_LIGHT = '#E3B84A';
const CREAM = '#FAF3E0';
const CREAM_LINE = '#E2D3AE';

/** Fabric artwork centred in a 1024 box; `scale` shrinks it for adaptive-icon safe zones. */
function motif({ scale = 1, mono = false } = {}) {
  const c = (colour) => (mono ? '#FFFFFF' : colour);
  const t = `translate(512 512) scale(${scale}) translate(-512 -512)`;
  return `
  <defs>
    <pattern id="zig" width="44" height="26" patternUnits="userSpaceOnUse">
      <path d="M0 13 L11 4 L22 13 L33 4 L44 13" stroke="${mono ? '#000' : CREAM_LINE}" stroke-width="5" fill="none" stroke-linejoin="round"/>
    </pattern>
    <pattern id="zigGold" width="44" height="26" patternUnits="userSpaceOnUse">
      <path d="M0 13 L11 4 L22 13 L33 4 L44 13" stroke="${mono ? '#000' : GOLD_LIGHT}" stroke-width="5" fill="none" stroke-linejoin="round"/>
    </pattern>
    <clipPath id="body"><rect x="292" y="196" width="440" height="632" rx="44"/></clipPath>
    <clipPath id="flap"><path d="M292 548 L732 360 L732 784 Q732 828 688 828 L336 828 Q292 828 292 784 Z"/></clipPath>
  </defs>
  <g transform="${t}">
    <!-- bolt of fabric -->
    <rect x="292" y="196" width="440" height="632" rx="44" fill="${c(CREAM)}"/>
    <rect x="292" y="196" width="440" height="632" fill="url(#zig)" clip-path="url(#body)" opacity="${mono ? 0 : 1}"/>
    <!-- folded flap -->
    <path d="M292 548 L732 360 L732 784 Q732 828 688 828 L336 828 Q292 828 292 784 Z" fill="${c(GOLD)}"/>
    <rect x="292" y="360" width="440" height="470" fill="url(#zigGold)" clip-path="url(#flap)" opacity="${mono ? 0 : 1}"/>
    <path d="M292 548 L732 360" stroke="${mono ? '#000' : '#FFFFFF'}" stroke-opacity="${mono ? 1 : 0.55}" stroke-width="${mono ? 18 : 8}"/>
    <!-- label band -->
    <rect x="352" y="246" width="320" height="120" rx="16" fill="${mono ? '#000' : GREEN_DARK}"/>
    <rect x="392" y="284" width="240" height="14" rx="7" fill="${c(GOLD_LIGHT)}"/>
    <rect x="432" y="316" width="160" height="10" rx="5" fill="${mono ? '#FFFFFF' : CREAM}" opacity="${mono ? 1 : 0.85}"/>
  </g>`;
}

/** Android 13+ themed icon: a single-colour silhouette where details are transparent cut-outs. */
function monoMotif(scale) {
  const t = `translate(512 512) scale(${scale}) translate(-512 -512)`;
  return `
  <defs>
    <mask id="cut">
      <rect x="0" y="0" width="1024" height="1024" fill="#fff"/>
      <rect x="352" y="246" width="320" height="120" rx="16" fill="#000"/>
      <path d="M292 548 L732 360" stroke="#000" stroke-width="22"/>
    </mask>
  </defs>
  <g transform="${t}">
    <rect x="292" y="196" width="440" height="632" rx="44" fill="#FFFFFF" mask="url(#cut)"/>
    <rect x="392" y="284" width="240" height="14" rx="7" fill="#FFFFFF"/>
    <rect x="432" y="316" width="160" height="10" rx="5" fill="#FFFFFF"/>
  </g>`;
}

const svg = (body, bg) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}${body}</svg>`);

async function write(name, buffer, size = 1024) {
  await sharp(buffer).resize(size, size).png().toFile(path.join(OUT, name));
  console.log('wrote', name);
}

// iOS / generic icon: full-bleed (iOS applies its own corner mask), no transparency.
await write('icon.png', svg(motif({ scale: 1.25 }), GREEN));
// Android adaptive icon: background + foreground kept inside the ~66% safe zone.
await write('android-icon-background.png', svg('', GREEN));
await write('android-icon-foreground.png', svg(motif({ scale: 0.95 })));
await write('android-icon-monochrome.png', svg(monoMotif(0.95)));
// Splash image (shown centred on the green splash background).
await write('splash-icon.png', svg(motif({ scale: 0.9 })), 512);
await write('favicon.png', svg(motif({ scale: 1.35 }), GREEN), 64);
