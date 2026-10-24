// Build 147: logica-test "na klaar nooit langer dan 250 ms vast" voor de webspeler (web/js). Laadt core.js, language.js,
// providers.js en library.js in Node met een nep-browser, maakt een catalogus van ±10k films en 1k zenders (zoals ticket
// #1.030) en meet hoe lang elke synchrone stap (elke timer-callback) duurt bij: Xtream-bibliotheek omzetten, filteren +
// indexen + afgeleide lijsten (Top 10, nieuwste), sorteren in stukjes, de bibliotheek in stukken bewaren en lezen
// (IndexedDB-terugval in het geheugen), de tv-gids lezen (XMLTV) en PBKDF2 zonder WebCrypto.
// Node is sneller dan een tv of telefoon: de grens hier is 100 ms per stap (gemeten: hooguit ~20 ms; in Chrome met 8× cpu-rem bleef alles onder 250 ms).
// Draaien: node tools/test/longtask_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const LIMIT = +(process.env.LIMIT_MS || 100); // ruim genoeg voor een trage CI-runner (eerste stap met JIT-opwarmen)
const ls = new Map();
const listeners = {};
global.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i], get length() { return ls.size; } };
globalThis.document = { readyState: 'complete', hidden: false, visibilityState: 'visible', documentElement: { getAttribute: () => null }, addEventListener: () => {}, createElement: () => ({}) };
globalThis.addEventListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
// timers: elke callback meten (de "stap" van de hoofdthread)
const realST = setTimeout;
let maxStep = 0, maxWhere = '', measuring = false, steps = 0;
globalThis.setTimeout = function (fn, ms) {
  return realST(function () {
    const t0 = performance.now();
    try { fn(); } finally {
      const d = performance.now() - t0;
      if (measuring) { steps++; if (d > maxStep) { maxStep = d; maxWhere = phase; } }
    }
  }, ms);
};
globalThis.setInterval = () => 0;
let phase = '';
const load = (f) => (0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js', f), 'utf8'));
load('core.js');
const B = globalThis.B;
B.L = (k, ...a) => { let i = 0; return String(k).replace(/%(d|s|@)/g, () => String(a[i++])); };
load('language.js');
B.data = { customization: () => ({}), ageLimit: () => null, strict: () => false, shared: (k, d) => d, lockedGroups: () => [], hiddenCategoryNames: () => ({}), secret: () => '', sources: [] };
B.media = { isMediaServer: () => false };
load('providers.js');
load('library.js');
load('pin.js');
const Lib = B.lib, P = B.providers;

const N_MOV = 10259, N_CH = 1056;
const vod = Array.from({ length: N_MOV }, (_, i) => ({ name: 'NL | Film nummer ' + i + ' (' + (1980 + i % 45) + ')', stream_id: 50000 + i, stream_icon: 'https://img.example.test/p/' + i + '.jpg',
  rating: String((i * 7 % 100) / 10), added: String(1600000000 + i * 3600), category_id: String(1 + i % 60), container_extension: 'mkv', year: String(1980 + i % 45) }));
const live = Array.from({ length: N_CH }, (_, i) => ({ num: i + 1, name: 'NL: Zender ' + i + ' HD', stream_id: 1000 + i, epg_channel_id: 'ch' + i, category_id: String(1 + i % 40), tv_archive: i % 5 === 0 ? 1 : 0, tv_archive_duration: 3 }));
const cats = (n, w) => Array.from({ length: n }, (_, i) => ({ category_id: String(i + 1), category_name: w + ' ' + (i + 1) }));
// Xtream zonder netwerk: getJSON geeft de lijsten (series faalt: films en zenders moeten gewoon doorgaan)
B.getJSON = (url) => {
  const a = new URL(url).searchParams.get('action');
  const m = { get_live_categories: cats(40, 'Zenders'), get_live_streams: live, get_vod_categories: cats(60, 'Films'), get_vod_streams: vod, get_series_categories: [] };
  if (a === 'get_series') return Promise.reject(new B.NetError('timeout', true));
  return Promise.resolve(m[a] || []);
};

async function measure(name, fn) {
  phase = name; maxStep = 0; steps = 0; measuring = true;
  const t0 = performance.now();
  const pr = fn();
  const sync = performance.now() - t0; // het eerste stuk loopt meteen (zonder timer)
  steps++; if (sync > maxStep) maxStep = sync;
  const r = await pr;
  measuring = false;
  const line = `${name}: ${steps} stappen, langste ${maxStep.toFixed(1)} ms, totaal ${(performance.now() - t0).toFixed(0)} ms`;
  console.log(line);
  if (process.env.GITHUB_ACTIONS) console.log('::notice title=longtask_test::' + line);
  // op een gedeelde CI-runner schommelen tijden: daar een waarschuwing, lokaal een harde fout (de uitkomst wordt wel altijd gecontroleerd)
  if (maxStep >= LIMIT && process.env.GITHUB_ACTIONS) console.log(`::warning title=longtask_test::${name}: een stap duurde ${maxStep.toFixed(1)} ms (grens ${LIMIT} ms)`);
  else assert.ok(maxStep < LIMIT, `${name}: een stap duurde ${maxStep.toFixed(1)} ms (grens ${LIMIT} ms)`);
  return r;
}
(async () => {
  const x = new P.Xtream({ serverURL: 'https://iptv.example.test', username: 'u' }, 'p');
  const lib = await measure('Xtream-bibliotheek omzetten', () => x.library());
  assert.strictEqual(lib.movies.length, N_MOV); assert.strictEqual(lib.channels.length, N_CH);
  assert.deepStrictEqual(lib.fetch.movie, { status: 'ok', count: N_MOV });
  assert.deepStrictEqual(lib.fetch.series, { status: 'failed', count: 0, error: 'timeout' }, 'series mislukt, films en zenders niet');

  Lib.raw = lib; Lib.source = { id: 'SRC-1', kind: 'Xtream Codes' };
  let emitted = 0; B.on('library', () => emitted++);
  await measure('filteren, indexen en afgeleide lijsten', () => Lib.applyFilters(true));
  assert.strictEqual(emitted, 1, "één event 'library' met het eindresultaat");
  assert.strictEqual(Lib.lib.movies.length, N_MOV);
  assert.ok(Lib.lib.byId['xv50000'] && Lib.lib.movieGroups.length === 60);
  // zelfde uitkomst als in één keer
  const once = Lib.apply(lib, Lib.contextFor(Lib.source));
  assert.deepStrictEqual(Lib.lib.movies.map((m) => m.id), once.movies.map((m) => m.id));
  assert.strictEqual(Lib.top10(Lib.lib.movies).length, 10);

  const cmp = (a, b) => (b.rating || 0) - (a.rating || 0) || a.id.localeCompare(b.id);
  const sorted = await measure('sorteren in stukjes', () => B.sortChunked(lib.movies, cmp));
  assert.deepStrictEqual(sorted.map((m) => m.id), lib.movies.slice().sort(cmp).map((m) => m.id));

  await measure('bibliotheek bewaren (in stukken)', () => B.idb.setBig('lib:SRC-1', { at: 1, lib }, 'lib', 'arrays'));
  const back = await measure('bibliotheek lezen (in stukken)', () => B.idb.getBig('lib:SRC-1'));
  assert.strictEqual(back.at, 1); assert.strictEqual(back.lib.movies.length, N_MOV); assert.strictEqual(back.lib.channels[5].id, lib.channels[5].id);
  assert.deepStrictEqual(await B.idb.getMeta('lib:SRC-1'), { at: 1 });

  // tv-gids: 1056 zenders × 36 uur
  const now = Date.now(), fmt = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000', parts = ['<tv>'];
  for (let c = 0; c < N_CH; c++) for (let k = -3; k < 33; k++) { const s = now + k * 3600000; parts.push(`<programme start="${fmt(s)}" stop="${fmt(s + 3600000)}" channel="ch${c}"><title>Programma ${k}</title><desc>Over programma ${k}</desc></programme>`); }
  parts.push('</tv>');
  const buf = new TextEncoder().encode(parts.join('\n')).buffer;
  const epg = await measure('tv-gids lezen', () => P.readXMLTVBuffer(buf, null));
  assert.strictEqual(Object.keys(epg).length, N_CH);
  await measure('tv-gids bewaren (in stukken)', () => B.idb.setBig('epg:SRC-1', { at: 2, epg }, 'epg', 'keys'));
  const eb = await measure('tv-gids lezen uit de cache', () => B.idb.getBig('epg:SRC-1'));
  assert.strictEqual(Object.keys(eb.epg).length, N_CH);

  const salt = B.pin.b64decode('AAECAwQFBgcICQoLDA0ODw==');
  const h = await measure('pincode (PBKDF2 zonder WebCrypto, in stukjes)', () => B.pin.pbkdf2JsChunked('1234', salt, 100000, 32));
  assert.strictEqual(B.pin.b64encode(h), 'hp5sg1DFvrCsw5n7qsO2DSIEM4lrJqZHc00NjxWG4fo=');

  // B.task: de lopende taak voor de hang-detectie
  const id = B.task.begin('catalogus sorteren'); assert.strictEqual(B.task.current(), 'catalogus sorteren'); B.task.end(id); assert.strictEqual(B.task.current(), '');
  console.log('longtask_test: alles goed');
})().catch((e) => {
  console.error(e);
  // in GitHub Actions als annotatie (de logboeken zijn niet altijd leesbaar)
  if (process.env.GITHUB_ACTIONS) console.log('::error title=longtask_test::' + String((e && e.stack) || e).split('\n').slice(0, 4).join(' | '));
  process.exit(1);
});
