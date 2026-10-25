// Build 149: grote server zoals de diagnose van build 148 (server 2: 123.340 films, 30.322 series, 11.929 zenders, ~80% van
// de films verborgen door categorieën). Meet het geheugen (heapUsed van de hoofdthread, piek; en RSS van het hele proces,
// inclusief de Worker) en de langste stap op de hoofdthread bij: ophalen + inlezen (Xtream), filteren/indexen en bewaren.
// De lijsten komen als JSON-tekst binnen (zoals XMLHttpRequest ze geeft). Er is een echte Worker (worker_threads) die
// web/js/json-worker.js draait, zoals in de browser. Een oudere build (zonder Worker) leest met JSON.parse op de hoofdthread.
// Draaien: node --expose-gc tools/test/bigserver_test.js   (WEB_JS=<map> = meten op een andere build, bijv. build 148)
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const WT = require('worker_threads');
const WEB = path.resolve(process.env.WEB_JS || path.join(__dirname, '../../web/js'));
const LIMIT = +(process.env.LIMIT_MS || 100), HEAP_LIMIT = +(process.env.HEAP_LIMIT_MB || 500);
const MB = (b) => Math.round(b / 1048576);
const N_MOV = +(process.env.N_MOV || 123340), N_SER = +(process.env.N_SER || 30322), N_CH = +(process.env.N_CH || 11929);
const gc = () => { if (global.gc) global.gc(); };

// nep-browser (zoals longtask_test.js)
const ls = new Map();
global.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i], get length() { return ls.size; } };
globalThis.document = { readyState: 'complete', hidden: false, visibilityState: 'visible', documentElement: { getAttribute: () => null }, addEventListener: () => {}, createElement: () => ({}) };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
let peakHeap = 0, peakRss = 0;
const sample = () => { const m = process.memoryUsage(); if (m.heapUsed > peakHeap) peakHeap = m.heapUsed; if (m.rss > peakRss) peakRss = m.rss; };
const realST = setTimeout, realSI = setInterval;
let maxStep = 0, measuring = false, steps = 0;
function timed(fn) {
  const t0 = performance.now();
  try { fn(); } finally { const d = performance.now() - t0; sample(); if (measuring) { steps++; if (d > maxStep) maxStep = d; } }
}
globalThis.setTimeout = function (fn, ms) { return realST(() => timed(fn), ms); };
globalThis.setInterval = () => 0;
const sampler = realSI(sample, 5); // ook tussen de stappen door (bijv. tijdens het wachten op de Worker)
sampler.unref();

// echte Worker: web/js/json-worker.js in een worker_thread (importScripts en postMessage zoals in de browser)
const BOOT = `
const { parentPort, workerData } = require('worker_threads'); const fs = require('fs'), path = require('path');
globalThis.self = globalThis; self.postMessage = (m) => parentPort.postMessage(m);
globalThis.importScripts = (f) => (0, eval)(fs.readFileSync(path.join(workerData.dir, f.split('?')[0]), 'utf8'));
(0, eval)(fs.readFileSync(path.join(workerData.dir, workerData.file), 'utf8'));
parentPort.on('message', (d) => self.onmessage({ data: d }));`;
class FakeWorker {
  constructor(url) {
    const file = String(url).replace(/^js\//, '').split('?')[0];
    if (!fs.existsSync(path.join(WEB, file))) throw new Error('geen worker ' + file);
    this.w = new WT.Worker(BOOT, { eval: true, workerData: { dir: WEB, file } });
    this.w.unref();
    // elk bericht is een eigen taak op de hoofdthread (zoals in de browser): meten
    this.w.on('message', (m) => timed(() => this.onmessage && this.onmessage({ data: m })));
    this.w.on('error', (e) => this.onerror && this.onerror(e));
  }
  postMessage(m) { this.w.postMessage(m); }
  terminate() { this.w.terminate(); }
}
globalThis.Worker = FakeWorker;

const load = (f) => (0, eval)(fs.readFileSync(path.join(WEB, f), 'utf8'));
load('core.js');
const B = globalThis.B;
B.L = (k, ...a) => { let i = 0; return String(k).replace(/%(d|s|@)/g, () => String(a[i++])); };
if (fs.existsSync(path.join(WEB, 'jsonpick.js'))) load('jsonpick.js');
if (fs.existsSync(path.join(WEB, 'diag.js'))) load('diag.js');
load('language.js');
// verborgen: films 80 van 100 categorieën, series 40 van 50, zenders 32 van 40 (= 80%)
const hide = (w, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [w + ' ' + (i + 1), true]));
const HIDDEN = Object.assign(hide('Films', 80), hide('Series', 40), hide('Zenders', 32));
B.data = { customization: () => ({}), ageLimit: () => null, strict: () => false, shared: (k, d) => d, lockedGroups: () => [], hiddenCategoryNames: () => HIDDEN, secret: () => '', sources: [{ id: 'SRC-2', kind: 'Xtream Codes' }] };
B.media = { isMediaServer: () => false };
load('providers.js');
load('library.js');
const Lib = B.lib, P = B.providers;

// de server: lijsten als JSON-tekst (met de extra velden die een echte Xtream-server meestuurt)
const vod = Array.from({ length: N_MOV }, (_, i) => ({ num: i + 1, name: 'NL | Film nummer ' + i + ' (' + (1980 + i % 45) + ')', stream_type: 'movie', stream_id: 50000 + i,
  stream_icon: 'https://img.example.test/p/' + i + '.jpg', rating: String((i * 7 % 100) / 10), rating_5based: (i * 7 % 100) / 20, added: String(1600000000 + i * 3600),
  is_adult: '0', category_id: String(1 + i % 100), category_ids: [1 + i % 100], container_extension: 'mkv', custom_sid: '', direct_source: '', year: String(1980 + i % 45), tmdb: String(1000 + i), trailer: '' }));
const series = Array.from({ length: N_SER }, (_, i) => ({ num: i + 1, name: 'NL | Serie ' + i, series_id: 90000 + i, cover: 'https://img.example.test/s/' + i + '.jpg',
  plot: 'Een serie over nummer ' + i + '. Met een korte beschrijving van wat er gebeurt.', cast: 'Acteur A, Acteur B', director: 'Regisseur', genre: 'Drama', releaseDate: '2019-01-01',
  last_modified: String(1600000000 + i * 7200), rating: String((i * 3 % 100) / 10), rating_5based: 3, backdrop_path: ['https://img.example.test/b/' + i + '.jpg'],
  youtube_trailer: '', episode_run_time: '45', category_id: String(1 + i % 50), category_ids: [1 + i % 50], year: String(1990 + i % 35) }));
const live = Array.from({ length: N_CH }, (_, i) => ({ num: i + 1, name: 'NL: Zender ' + i + ' HD', stream_type: 'live', stream_id: 1000 + i, stream_icon: 'https://img.example.test/l/' + i + '.png',
  epg_channel_id: 'ch' + i, added: '1600000000', is_adult: 0, category_id: String(1 + i % 40), category_ids: [1 + i % 40], custom_sid: null, tv_archive: i % 5 === 0 ? 1 : 0, direct_source: '', tv_archive_duration: 3 }));
const cats = (n, w) => Array.from({ length: n }, (_, i) => ({ category_id: String(i + 1), category_name: w + ' ' + (i + 1), parent_id: 0 }));
const TEXT = {
  get_live_categories: JSON.stringify(cats(40, 'Zenders')), get_vod_categories: JSON.stringify(cats(100, 'Films')), get_series_categories: JSON.stringify(cats(50, 'Series')),
  get_live_streams: JSON.stringify(live), get_vod_streams: JSON.stringify(vod), get_series: JSON.stringify(series)
};
vod.length = 0; series.length = 0; live.length = 0;
const action = (url) => new URL(url).searchParams.get('action') || '';
// zoals xhr(): de tekst, en JSON.parse alleen als de app daar niet om vraagt (noJSON, build 149)
B.http = (url, opt) => { const t = TEXT[action(url)] || '[]'; return Promise.resolve({ status: 200, text: t, json: opt && opt.noJSON ? null : JSON.parse(t) }); };
B.getJSON = (url) => B.http(url).then((r) => r.json);

const report = [];
async function measure(name, fn) {
  gc(); await new Promise((r) => realST(r, 20)); gc();
  const base = process.memoryUsage();
  peakHeap = base.heapUsed; peakRss = base.rss; maxStep = 0; steps = 0; measuring = true;
  const t0 = performance.now();
  const pr = fn();
  const sync = performance.now() - t0;
  steps++; if (sync > maxStep) maxStep = sync;
  const r = await pr;
  measuring = false; sample();
  const row = { name, steps, maxMs: +maxStep.toFixed(1), totalMs: Math.round(performance.now() - t0), heapBaseMB: MB(base.heapUsed), heapPeakMB: MB(peakHeap), rssPeakMB: MB(peakRss) };
  report.push(row);
  const line = `${name}: ${steps} stappen, langste ${row.maxMs} ms, totaal ${row.totalMs} ms, heap ${row.heapBaseMB} → piek ${row.heapPeakMB} MB, rss piek ${row.rssPeakMB} MB`;
  console.log(line);
  if (process.env.GITHUB_ACTIONS) console.log('::notice title=bigserver_test::' + line);
  return r;
}
(async () => {
  console.log(`bigserver_test: ${N_MOV} films, ${N_SER} series, ${N_CH} zenders, 80% verborgen, build-map ${path.relative(process.cwd(), WEB) || '.'}`);
  const src = { id: 'SRC-2', kind: 'Xtream Codes', serverURL: 'https://iptv.example.test', username: 'u' };
  Lib.source = src;
  const x = new P.Xtream(src, 'p');
  const hidden = Lib.hiddenTest ? Lib.hiddenTest(Lib.contextFor(src)) : null;
  const lib = await measure('ophalen en inlezen (Xtream)', () => x.library({ hidden }));
  Lib.raw = lib;
  await measure('filteren, indexen en afgeleide lijsten', () => Lib.applyFilters(true));
  await measure('bibliotheek bewaren (in stukken)', () => B.idb.setBig('lib:SRC-2', { at: 1, lib }, 'lib', 'arrays'));
  const back = await measure('bibliotheek lezen (in stukken)', () => B.idb.getBig('lib:SRC-2'));

  const visM = Math.round(N_MOV * 0.2), visS = Math.round(N_SER * 0.2);
  assert.ok(Math.abs(Lib.lib.movies.length - visM) <= 100, 'zichtbare films ' + Lib.lib.movies.length);
  assert.ok(Math.abs(Lib.lib.series.length - visS) <= 50, 'zichtbare series ' + Lib.lib.series.length);
  if (Lib.lib.stats) {
    // geleverd · zichtbaar blijft kloppen, ook als de verborgen items niet zijn ingelezen
    assert.strictEqual(Lib.lib.stats.movie.delivered, N_MOV, 'geleverd films');
    assert.strictEqual(Lib.lib.stats.movie.visible + Lib.lib.stats.movie.hidden.categories, N_MOV, 'zichtbaar + verborgen = geleverd');
    assert.strictEqual(Lib.lib.stats.series.delivered, N_SER);
    assert.strictEqual(Lib.lib.stats.live.delivered, N_CH);
    assert.deepStrictEqual(lib.fetch.movie, { status: 'ok', count: N_MOV });
  }
  assert.strictEqual(back.lib.movies.length, lib.movies.length);
  if (Lib.needsRefetch) {
    assert.strictEqual(Lib.needsRefetch(lib, Lib.contextFor(src)), false, 'niets opnieuw ophalen zolang de categorieën verborgen blijven');
    delete HIDDEN['Films 3'];
    assert.strictEqual(Lib.needsRefetch(lib, Lib.contextFor(src)), true, 'categorie weer aan: opnieuw ophalen');
    HIDDEN['Films 3'] = true;
  }
  const worst = Math.max(...report.map((r) => r.heapPeakMB));
  const longest = Math.max(...report.map((r) => r.maxMs));
  console.log('bigserver_test: samenvatting ' + JSON.stringify({ heapPeakMB: worst, rssPeakMB: Math.max(...report.map((r) => r.rssPeakMB)), longestStepMs: longest, phases: report }));
  if (!process.env.NO_LIMITS) {
    assert.ok(worst < HEAP_LIMIT, `piekgeheugen ${worst} MB (grens ${HEAP_LIMIT} MB)`);
    if (longest >= LIMIT && process.env.GITHUB_ACTIONS) console.log(`::warning title=bigserver_test::langste stap ${longest} ms (grens ${LIMIT} ms)`);
    else assert.ok(longest < LIMIT, `langste stap ${longest} ms (grens ${LIMIT} ms)`);
  }
  console.log('bigserver_test: alles goed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  if (process.env.GITHUB_ACTIONS) console.log('::error title=bigserver_test::' + String((e && e.stack) || e).split('\n').slice(0, 4).join(' | '));
  process.exit(1);
});
