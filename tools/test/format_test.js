// Build 149: snelle ISO-parser (B.parseISO zonder Date.parse per item), gedeelde datumopmakers (B.dateFmt) en de
// naam-, kleur- en logo-logica van "Ontdek categorieën" (web/js/discovercats.js). Draaien: node tools/test/format_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const WEB = path.join(__dirname, '../../web/js');
global.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };
globalThis.document = { readyState: 'complete', hidden: false, documentElement: { getAttribute: () => null, dir: 'ltr' }, addEventListener: () => {}, createElement: () => ({}) };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
const load = (f) => (0, eval)(fs.readFileSync(path.join(WEB, f), 'utf8'));
load('core.js');
const B = globalThis.B;
// parseISO: zelfde uitkomst als Date.parse voor alle vormen die de apps schrijven
const cases = ['2026-10-12T18:00:00.000Z', '2026-10-12T18:00:00Z', '2026-10-12T18:00Z', '2026-10-12', '2026-10-12T18:00:00.1234567Z',
  '2026-10-12T18:00:00+02:00', '2026-10-12T18:00:00.5-05:30', '2026-10-12 18:00:00', '2024-02-29T23:59:59.999Z', '2026-10-12T18:00:00+0200'];
const ref = (s) => { s = s.replace(/\.(\d+)/, (m, d) => '.' + (d + '000').slice(0, 3)); if (s.length === 10) s += 'T00:00:00Z'; if (/^\d{4}-\d\d-\d\d \d/.test(s)) s = s.replace(' ', 'T') + 'Z'; s = s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'); return Date.parse(s); };
cases.forEach((c) => assert.strictEqual(B.parseISO(c), ref(c), c));
assert.strictEqual(B.parseISO(''), null); assert.strictEqual(B.parseISO('onzin'), null); assert.strictEqual(B.parseISO(null), null);
assert.strictEqual(B.parseISO(1700000000), 1700000000000);
assert.ok(Number.isNaN(B.fastISO('2026-13-01')), 'maand 13');
assert.strictEqual(B.parseISO('Mon, 12 Oct 2026 18:00:00 GMT'), Date.parse('Mon, 12 Oct 2026 18:00:00 GMT'), 'terugval Date.parse');
// snel: 200k keer
let t0 = performance.now(); for (let i = 0; i < 200000; i++) B.parseISO('2026-10-12T18:00:00.000Z'); const fast = performance.now() - t0;
console.log(`parseISO 200k: ${fast.toFixed(0)} ms`);
// gedeelde opmaker
B.lang = 'nl';
assert.strictEqual(B.dateFmt({ day: 'numeric', month: 'long' }), B.dateFmt({ day: 'numeric', month: 'long' }), 'één opmaker per taal + opties');
assert.strictEqual(B.fmtDate(Date.UTC(2026, 9, 12, 12), { day: 'numeric', month: 'long', timeZone: 'UTC' }), new Date(Date.UTC(2026, 9, 12, 12)).toLocaleDateString('nl', { day: 'numeric', month: 'long', timeZone: 'UTC' }));
// fold: ASCII snel, accenten nog steeds weg
assert.strictEqual(B.fold('Amélie ÇA'), 'amelie ca'); assert.strictEqual(B.fold('Plain Title'), 'plain title');
// json-lezen: velden en verborgen categorieën
load('jsonpick.js');
const r = B.jsonPick(JSON.stringify([{ stream_id: 1, name: 'a', category_id: '1', extra: 'x' }, { stream_id: 2, name: 'b', category_id: 2 }, { stream_id: 3, category_id: '2' }]), { fields: ['stream_id', 'name', 'category_id'], skip: { 2: true } });
assert.deepStrictEqual(r, { list: [{ stream_id: 1, name: 'a', category_id: '1' }], skipped: { 2: 2 }, total: 3 });
assert.deepStrictEqual(B.jsonPick('{"a":{"x":1}}', {}).list, [{ x: 1 }]);
assert.strictEqual(B.jsonPick('<html>', {}).error, 'bad_json');
// Ontdek categorieën (zonder DOM)
B.ui = { h: () => ({}), router: { link: (p) => '#/' + p.join('/') } }; B.lib = { memo: (k, f) => f() }; B.on = () => {};
load('discovercats.js');
const DC = B.discoverCats;
assert.strictEqual(DC.cleanName('NL | Netflix'), 'Netflix'); assert.strictEqual(DC.cleanName('4K - Disney+'), 'Disney+');
assert.strictEqual(DC.cleanName('[EN] Prime Video'), 'Prime Video'); assert.strictEqual(DC.cleanName('Sci-Fi'), 'Sci-Fi');
assert.strictEqual(DC.cleanName('NL: 4K | Actie'), 'Actie');
assert.strictEqual(DC.colorIndex('NL | Actie'), DC.colorIndex('Actie')); assert.ok(DC.colorIndex('Actie') >= 0 && DC.colorIndex('Actie') < 10);
const idx = DC.buildIndex([{ results: [{ provider_name: 'Netflix', logo_path: '/n.jpg', display_priority: 1 }, { provider_name: 'Disney Plus', logo_path: '/d.jpg' },
  { provider_name: 'HBO Max', logo_path: '/h.jpg' }, { provider_name: 'Amazon Prime Video', logo_path: '/p.jpg' }, { provider_name: 'Apple TV+', logo_path: '/a.jpg' },
  { provider_name: 'SkyShowtime', logo_path: '/s.jpg' }, { provider_name: 'Videoland', logo_path: '/v.jpg' }, { provider_name: 'Viaplay', logo_path: '/vp.jpg' }] }]);
const logo = (g) => (DC.logoFor(g, idx) || '').replace('https://image.tmdb.org/t/p/w300', '');
assert.strictEqual(logo('NL | Netflix Series'), '/n.jpg'); assert.strictEqual(logo('4K - Disney+ Movies'), '/d.jpg');
assert.strictEqual(logo('HBO'), '/h.jpg'); assert.strictEqual(logo('NL: Prime Video'), '/p.jpg'); assert.strictEqual(logo('Apple TV+'), '/a.jpg');
assert.strictEqual(logo('SkyShowtime'), '/s.jpg'); assert.strictEqual(logo('Videoland 4K'), '/v.jpg'); assert.strictEqual(logo('Viaplay'), '/vp.jpg');
assert.strictEqual(logo('NL | Actie'), ''); assert.strictEqual(logo('Netflixen en chillen'), '');
console.log('format_test: alles goed');
