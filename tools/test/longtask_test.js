// Build 148: grote catalogus (37k films, 12k zenders, 9k series, plus categorieën, zoals de diagnose van 24 okt), sorteren
// in echt kleine stappen (B.sortChunked als merge sort die midden in een merge stopt), Top 10 / Nieuwste zonder alles te
// sorteren (B.topN), geleverd naast zichtbaar (stats per soort) en het geheugen (heapUsed, piek per fase; draai met
// --expose-gc voor een eerlijke beginstand). Op CI is een tijdsgrens een ::warning::, de uitkomst wordt altijd hard getest.
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
const WEB = process.env.WEB_JS || path.join(__dirname, '../../web/js'); // andere map = meten op een oudere build
const MB = (b) => Math.round(b / 1048576);
let peakHeap = 0;
const sampleHeap = () => { const h = process.memoryUsage().heapUsed; if (h > peakHeap) peakHeap = h; };
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
      sampleHeap();
      if (measuring) { steps++; if (d > maxStep) { maxStep = d; maxWhere = phase; } }
    }
  }, ms);
};
globalThis.setInterval = () => 0;
let phase = '';
const load = (f) => (0, eval)(fs.readFileSync(path.join(WEB, f), 'utf8'));
load('core.js');
const B = globalThis.B;
B.L = (k, ...a) => { let i = 0; return String(k).replace(/%(d|s|@)/g, () => String(a[i++])); };
if (fs.existsSync(path.join(WEB, 'diag.js'))) load('diag.js');
load('language.js');
// verborgen categorieën: films 1–42 van 60, zenders 1–36 van 40, series 1–35 van 50 (zoals 36.593 geleverd / 10.286 zichtbaar)
const hide = (w, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [w + ' ' + (i + 1), true]));
let HIDDEN = {};
B.data = { customization: () => ({}), ageLimit: () => null, strict: () => false, shared: (k, d) => d, lockedGroups: () => [], hiddenCategoryNames: () => HIDDEN, secret: () => '', sources: [{ id: 'SRC-1', kind: 'Xtream Codes' }] };
B.media = { isMediaServer: () => false };
load('providers.js');
load('library.js');
load('pin.js');
const Lib = B.lib, P = B.providers;

const N_MOV = +(process.env.N_MOV || 37000), N_CH = +(process.env.N_CH || 12000), N_SER = +(process.env.N_SER || 9000);
const vod = Array.from({ length: N_MOV }, (_, i) => ({ name: 'NL | Film nummer ' + i + ' (' + (1980 + i % 45) + ')', stream_id: 50000 + i, stream_icon: 'https://img.example.test/p/' + i + '.jpg',
  rating: String((i * 7 % 100) / 10), added: String(1600000000 + i * 3600), category_id: String(1 + i % 60), container_extension: 'mkv', year: String(1980 + i % 45) }));
const live = Array.from({ length: N_CH }, (_, i) => ({ num: i + 1, name: 'NL: Zender ' + i + ' HD', stream_id: 1000 + i, epg_channel_id: 'ch' + i, category_id: String(1 + i % 40), tv_archive: i % 5 === 0 ? 1 : 0, tv_archive_duration: 3 }));
const series = Array.from({ length: N_SER }, (_, i) => ({ name: 'NL | Serie ' + i, series_id: 90000 + i, cover: 'https://img.example.test/s/' + i + '.jpg',
  plot: 'Een serie over nummer ' + i, rating: String((i * 3 % 100) / 10), last_modified: String(1600000000 + i * 7200), category_id: String(1 + i % 50), year: String(1990 + i % 35), genre: 'Drama' }));
const cats = (n, w) => Array.from({ length: n }, (_, i) => ({ category_id: String(i + 1), category_name: w + ' ' + (i + 1) }));
// Xtream zonder netwerk: getJSON geeft een kopie van de lijsten (zoals JSON.parse: de app mag de invoer vrijgeven);
// SERIES_FAIL: series falen (films en zenders moeten gewoon doorgaan)
let SERIES_FAIL = false;
const copy = (l) => l.map((x) => Object.assign({}, x));
B.getJSON = (url) => {
  const a = new URL(url).searchParams.get('action');
  const m = { get_live_categories: cats(40, 'Zenders'), get_live_streams: live, get_vod_categories: cats(60, 'Films'), get_vod_streams: vod,
    get_series_categories: cats(50, 'Series'), get_series: series };
  if (a === 'get_series' && SERIES_FAIL) return Promise.reject(new B.NetError('timeout', true));
  return Promise.resolve(copy(m[a] || []));
};

const gc = () => { if (global.gc) global.gc(); };
const report = [];
async function measure(name, fn) {
  phase = name; maxStep = 0; steps = 0; measuring = true;
  sampleHeap(); const heap0 = process.memoryUsage().heapUsed; peakHeap = heap0;
  const t0 = performance.now();
  const pr = fn();
  const sync = performance.now() - t0; // het eerste stuk loopt meteen (zonder timer)
  steps++; if (sync > maxStep) maxStep = sync;
  const r = await pr;
  measuring = false;
  sampleHeap();
  const line = `${name}: ${steps} stappen, langste ${maxStep.toFixed(1)} ms, totaal ${(performance.now() - t0).toFixed(0)} ms, heap ${MB(heap0)} → piek ${MB(peakHeap)} MB`;
  report.push({ name, steps, maxMs: +maxStep.toFixed(1), peakMB: MB(peakHeap) });
  console.log(line);
  if (process.env.GITHUB_ACTIONS) console.log('::notice title=longtask_test::' + line);
  // op een gedeelde CI-runner schommelen tijden: daar een waarschuwing, lokaal een harde fout (de uitkomst wordt wel altijd gecontroleerd)
  if (maxStep >= LIMIT && process.env.GITHUB_ACTIONS) console.log(`::warning title=longtask_test::${name}: een stap duurde ${maxStep.toFixed(1)} ms (grens ${LIMIT} ms)`);
  else assert.ok(maxStep < LIMIT, `${name}: een stap duurde ${maxStep.toFixed(1)} ms (grens ${LIMIT} ms)`);
  return r;
}
(async () => {
  const x = new P.Xtream({ serverURL: 'https://iptv.example.test', username: 'u' }, 'p');
  gc();
  const lib = await measure('Xtream-bibliotheek omzetten', () => x.library());
  assert.strictEqual(lib.movies.length, N_MOV); assert.strictEqual(lib.channels.length, N_CH); assert.strictEqual(lib.series.length, N_SER);
  assert.deepStrictEqual(lib.fetch.movie, { status: 'ok', count: N_MOV });
  assert.deepStrictEqual(lib.fetch.series, { status: 'ok', count: N_SER });
  // series mislukt: films en zenders niet (kleine lijst)
  SERIES_FAIL = true;
  const lib2 = await new P.Xtream({ serverURL: 'https://iptv2.example.test', username: 'u' }, 'p').library();
  SERIES_FAIL = false;
  assert.deepStrictEqual(lib2.fetch.series, { status: 'failed', count: 0, error: 'timeout' }, 'series mislukt, films en zenders niet');
  assert.strictEqual(lib2.movies.length, N_MOV);

  Lib.raw = lib; Lib.source = { id: 'SRC-1', kind: 'Xtream Codes' };
  let emitted = 0; B.on('library', () => emitted++);
  gc();
  await measure('filteren, indexen en afgeleide lijsten', () => Lib.applyFilters(true));
  assert.strictEqual(emitted, 1, "één event 'library' met het eindresultaat");
  assert.strictEqual(Lib.lib.movies.length, N_MOV);
  assert.ok(Lib.lib.byId['xv50000'] && Lib.lib.movieGroups.length === 60);
  // zelfde uitkomst als in één keer
  const once = Lib.apply(lib, Lib.contextFor(Lib.source));
  assert.deepStrictEqual(Lib.lib.movies.map((m) => m.id), once.movies.map((m) => m.id));
  assert.strictEqual(Lib.top10(Lib.lib.movies).length, 10);
  if (B.topN) {
    // Top 10 en Nieuwste: zelfde uitkomst als alles sorteren (stabiel, ook bij gelijke waarden)
    const byRating = (a, b) => (b.rating || 0) - (a.rating || 0), byAdded = (a, b) => b.addedAt - a.addedAt;
    assert.deepStrictEqual(Lib.top10(Lib.lib.movies).map((m) => m.id), Lib.lib.movies.filter((m) => m.poster && m.rating > 0).sort(byRating).slice(0, 10).map((m) => m.id));
    assert.deepStrictEqual(Lib.recent(Lib.lib.series).map((m) => m.id), Lib.lib.series.filter((m) => m.addedAt).sort(byAdded).slice(0, 30).map((m) => m.id));
    const nums = Array.from({ length: 5000 }, (_, i) => ({ v: (i * 7919) % 97, i }));
    assert.deepStrictEqual(B.topN(nums, 25, (a, b) => a.v - b.v), nums.slice().sort((a, b) => a.v - b.v).slice(0, 25));
  }

  // build 148: met verborgen categorieën: geleverd naast zichtbaar, met de reden
  HIDDEN = Object.assign(hide('Films', 42), hide('Zenders', 36), hide('Series', 35));
  gc();
  await measure('filteren met verborgen categorieën', () => Lib.applyFilters(true));
  const visM = lib.movies.filter((m) => !HIDDEN[m.group]).length;
  assert.strictEqual(Lib.lib.movies.length, visM);
  if (Lib.lib.stats) {
    assert.deepStrictEqual(Lib.lib.stats.movie, { delivered: N_MOV, visible: visM, hidden: { categories: N_MOV - visM, kids: 0, duplicates: 0, other: 0 } });
    assert.strictEqual(Lib.lib.stats.live.visible + Lib.lib.stats.live.hidden.categories, N_CH);
    assert.strictEqual(Lib.lib.stats.series.delivered, N_SER);
    const rows = B.diag.fetchRows();
    const rm = rows.find((r) => r.server === 's1' && r.kind === 'movie');
    assert.ok(rm && rm.delivered === N_MOV && rm.visible === visM && rm.hidden.categories === N_MOV - visM, 'fetch[] met delivered/visible/hidden');
  }
  HIDDEN = {};

  // sorteren: 37k films met localeCompare als tweede sleutel (build 147: één stap van 173 ms bij 10k)
  const cmp = (a, b) => (b.rating || 0) - (a.rating || 0) || a.id.localeCompare(b.id);
  gc();
  const sorted = await measure('sorteren in stukjes', () => B.sortChunked(lib.movies, cmp));
  assert.deepStrictEqual(sorted.map((m) => m.id), lib.movies.slice().sort(cmp).map((m) => m.id));
  // A–Z op titel met localeCompare (de duurste vergelijking; build 147 deed de laatste merge in één stap)
  const az = (a, b) => a.title.localeCompare(b.title, 'nl');
  gc();
  const sortedAZ = await measure('sorteren op titel (localeCompare)', () => B.sortChunked(lib.movies, az));
  assert.deepStrictEqual(sortedAZ.map((m) => m.id), lib.movies.slice().sort(az).map((m) => m.id));
  // trage tv of CI-runner nagebootst: elke vergelijking ~3 µs. Build 147: de laatste merge (n vergelijkingen) in één stap.
  const slow = (a, b) => { const e = performance.now() + 0.003; while (performance.now() < e); return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; };
  const shuffled = lib.movies.slice().sort((a, b) => ((a.addedAt * 7919) % 1000) - ((b.addedAt * 7919) % 1000));
  const sortedSlow = await measure('sorteren met trage vergelijking (3 µs)', () => B.sortChunked(shuffled, slow));
  assert.deepStrictEqual(sortedSlow.map((m) => m.id), lib.movies.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((m) => m.id));
  // stabiel: gelijke sleutels houden hun volgorde
  const eq = (a, b) => (a.year || 0) - (b.year || 0);
  const s2 = await measure('sorteren in stukjes (stabiel, zenders)', () => B.sortChunked(lib.channels, (a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0)));
  assert.deepStrictEqual(s2.map((c) => c.id), lib.channels.slice().sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0)).map((c) => c.id));
  const s3 = await B.sortChunked(lib.series, eq);
  assert.deepStrictEqual(s3.map((c) => c.id), lib.series.slice().sort(eq).map((c) => c.id));

  await measure('bibliotheek bewaren (in stukken)', () => B.idb.setBig('lib:SRC-1', { at: 1, lib }, 'lib', 'arrays'));
  const back = await measure('bibliotheek lezen (in stukken)', () => B.idb.getBig('lib:SRC-1'));
  assert.strictEqual(back.at, 1); assert.strictEqual(back.lib.movies.length, N_MOV); assert.strictEqual(back.lib.channels[5].id, lib.channels[5].id);
  assert.deepStrictEqual(await B.idb.getMeta('lib:SRC-1'), { at: 1 });

  // tv-gids: 1056 zenders × 36 uur
  const now = Date.now(), fmt = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000', parts = ['<tv>'];
  for (let c = 0; c < N_CH; c++) for (let k = -3; k < 33; k++) { const s = now + k * 3600000; parts.push(`<programme start="${fmt(s)}" stop="${fmt(s + 3600000)}" channel="ch${c}"><title>Programma ${k}</title><desc>Over programma ${k}</desc></programme>`); }
  parts.push('</tv>');
  const buf = new TextEncoder().encode(parts.join('\n')).buffer;
  parts.length = 0; // de testtekst zelf niet in het geheugen houden (anders meet de test de GC van de test)
  gc();
  const epg = await measure('tv-gids lezen', () => P.readXMLTVBuffer(buf, null));
  assert.strictEqual(Object.keys(epg).length, N_CH);
  await measure('tv-gids bewaren (in stukken)', () => B.idb.setBig('epg:SRC-1', { at: 2, epg }, 'epg', 'keys'));
  const eb = await measure('tv-gids lezen uit de cache', () => B.idb.getBig('epg:SRC-1'));
  assert.strictEqual(Object.keys(eb.epg).length, N_CH);

  const salt = B.pin.b64decode('AAECAwQFBgcICQoLDA0ODw==');
  const h = await measure('pincode (PBKDF2 zonder WebCrypto, in stukjes)', () => B.pin.pbkdf2JsChunked('1234', salt, 100000, 32));
  assert.strictEqual(B.pin.b64encode(h), 'hp5sg1DFvrCsw5n7qsO2DSIEM4lrJqZHc00NjxWG4fo=');

  // B.task: de lopende taak voor de hang-detectie (build 148: codes)
  const id = B.task.begin('catalog_sort'); assert.strictEqual(B.task.current(), 'catalog_sort'); B.task.end(id); assert.strictEqual(B.task.current(), '');
  if (B.diag.code) {
    assert.strictEqual(B.diag.code('catalogus filteren'), 'catalog_filter', 'oude taaknaam → code');
    assert.strictEqual(B.diag.code('main'), 'home', 'oude mijlpaal → code');
    assert.ok(B.diag.milestones().every((m) => /^[a-z][a-z0-9_]*$/.test(m.name) && B.diag.CODES[m.name]), 'alleen bekende codes als mijlpaal');
    // bijwerken met fasen (max. 5, nieuwste eerst)
    for (let k = 0; k < 7; k++) { const u = B.diag.update({ id: 'SRC-1' }); u.phase('parse'); u.close(); u.add('apply', 12); u.end('ok'); }
    const ups = B.diag.updates();
    assert.strictEqual(ups.length, 5);
    assert.deepStrictEqual(ups[0].phases.map((p) => p.code), ['fetch', 'parse', 'apply']);
    assert.strictEqual(ups[0].server, 's1'); assert.strictEqual(ups[0].result, 'ok');
    B.diag.stall(1200, 5100, 'hls');
    assert.strictEqual(B.diag.stalls()[0].code, 'playback_stall');
  }
  if (B.diag.code) {
    // de bijlage zelf: schema 3, codes, app.lang, updates, fetch met delivered/visible, langste hang
    B.data.profiles = [];
    globalThis.screen = { width: 1920, height: 1080 };
    const r = await B.diag.collect('start');
    const pl = r.payload;
    assert.strictEqual(pl.schema, 3); assert.strictEqual(pl.app.lang, B.lang);
    assert.ok(pl.milestones.length && pl.milestones.every((m) => m.code && m.code === m.name), 'milestones[].code');
    assert.strictEqual(pl.updates.length, 5);
    assert.ok(pl.fetch.some((f) => f.kind === 'movie' && f.delivered === N_MOV && f.visible === Lib.lib.movies.length && f.hidden.categories === N_MOV - Lib.lib.movies.length));
    assert.strictEqual(pl.playback.stalls[0].code, 'playback_stall');
    assert.ok(JSON.stringify(pl).length < 20000, 'bijlage klein genoeg');
  }
  console.log('longtask_test: samenvatting ' + JSON.stringify(report));
  console.log('longtask_test: alles goed');
})().catch((e) => {
  console.error(e);
  // in GitHub Actions als annotatie (de logboeken zijn niet altijd leesbaar)
  if (process.env.GITHUB_ACTIONS) console.log('::error title=longtask_test::' + String((e && e.stack) || e).split('\n').slice(0, 4).join(' | '));
  process.exit(1);
});
