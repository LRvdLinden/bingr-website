// Covers voor de hero van de homepage (assets/img/covers/{nl,en}/<id>.webp).
// Alleen de verzonnen titels uit de App Store-generator van de app-repo (AppStore/generator/art.js: TITLES en
// posterURL(id, lang)); nooit echte posters van TMDB of IMDb. Een poster bevat de titel, dus per taal een eigen bestand.
// De site laadt ze als gewone <img>, zodat de 58 KB generator niet mee hoeft.
//
// Draaien (vanuit de map van bingr-website, met iptv-ios-appletv ernaast):
//   node tools/make_covers.mjs [pad/naar/art.js]
// Nodig: Playwright voor Node (playwright of playwright-core) met Chromium, en de lettertypen van de generator
// (Inter Display, Lora, TeX Gyre, Poppins, GFS Baskerville) op het systeem, anders vallen de titels terug op een ander font.
// Na het opnieuw maken: ?v= van assets/js/home-anim.js ophogen als de lijst met id's verandert.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..');
const artPath = resolve(process.argv[2] || join(site, '../iptv-ios-appletv/AppStore/generator/art.js'));
const out = join(site, 'assets/img/covers');
const W = 300, H = 450, QUALITY = 0.8;

const require = createRequire(import.meta.url);
let chromium;
for (const m of ['playwright', 'playwright-core']) {
  try { ({ chromium } = require(m)); break; } catch (e) { /* volgende proberen */ }
}
if (!chromium) { console.error('Playwright niet gevonden (npm i playwright, of NODE_PATH naar een map met playwright-core)'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
await page.addScriptTag({ content: readFileSync(artPath, 'utf8') });
const res = await page.evaluate(async ({ W, H, QUALITY }) => {
  /* global TITLES, posterURL */
  const load = (src) => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; });
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const r = [];
  for (const t of TITLES) for (const lang of ['nl', 'en']) {
    const im = await load(posterURL(t.id, lang));
    ctx.clearRect(0, 0, W, H); ctx.drawImage(im, 0, 0, W, H);
    r.push({ id: t.id, lang, data: c.toDataURL('image/webp', QUALITY) });
  }
  return r;
}, { W, H, QUALITY });
await browser.close();

let bytes = 0;
for (const { id, lang, data } of res) {
  mkdirSync(join(out, lang), { recursive: true });
  const buf = Buffer.from(data.split(',')[1], 'base64');
  if (!data.startsWith('data:image/webp')) throw new Error('geen webp voor ' + id);
  writeFileSync(join(out, lang, id + '.webp'), buf);
  bytes += buf.length;
}
const ids = [...new Set(res.map((x) => x.id))];
console.log(`${res.length} covers (${ids.length} titels, nl en en), ${Math.round(bytes / 1024)} KB in ${out}`);
console.log('id\'s: ' + ids.join(' '));
