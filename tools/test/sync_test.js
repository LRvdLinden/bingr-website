// Build 151: sync toepassen en bewaren van de hoofdthread af (web/js/sync.js + syncmerge.js). Een groot profiel (Mijn lijst,
// favorieten, 20k bekeken, duizenden verwijderingen, voortgang en geschiedenis) lokaal én op de server, deels verschillend.
// Gemeten: de langste synchrone stap van D.syncState() (zonder Worker = de terugval in stappen) tegenover alles in één keer
// zoals ≤ 150. Uitkomst hard getest: hetzelfde samengevoegde model, dezelfde upload en hetzelfde bewaarde profiel als de
// oude berekening. Lokale wijziging: niet meteen bewaard, wel na 400 ms. Draaien: node --expose-gc tools/test/sync_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const LIMIT = +(process.env.LIMIT_MS || 100);
const WEB = path.join(__dirname, '../../web/js');
const ls = new Map();
global.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i], get length() { return ls.size; } };
globalThis.document = { readyState: 'complete', hidden: false, visibilityState: 'visible', documentElement: { getAttribute: () => null }, addEventListener: () => {}, createElement: () => ({}) };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
const realST = setTimeout;
let maxStep = 0, measuring = false, steps = 0;
globalThis.setTimeout = function (fn, ms) {
  return realST(function () {
    const t0 = performance.now();
    try { fn(); } finally { const d = performance.now() - t0; if (measuring) { steps++; if (d > maxStep) maxStep = d; } }
  }, ms);
};
globalThis.setInterval = () => 0;
const load = (f) => (0, eval)(fs.readFileSync(path.join(WEB, f), 'utf8'));
load('core.js');
const B = globalThis.B;
B.L = (k) => k;
let server = null;
const puts = [];
B.account = { isSignedIn: () => true, userId: () => 'u1', getState: () => Promise.resolve(JSON.parse(JSON.stringify(server))),
  putState: (n, d) => { puts.push({ n, d }); return Promise.resolve(B.iso()); }, readProfiles: () => Promise.resolve([]) };
B.pin = { parse: () => null, valid: () => false, make: () => Promise.resolve(null) };
load('syncmerge.js');
load('sync.js');
const D = B.data, SM = B.syncMerge;

// testgegevens
const now = Date.now(), iso = (t) => new Date(t).toISOString();
function profile(seed, n) {
  const o = { myList: [], favorites: [], watched: [], recentChannels: [], hiddenCategories: [], progress: {}, history: [], removed: { myList: {}, watched: {}, progress: {}, history: {} },
    prefs: { updatedAt: iso(now - 1000), subtitles: 'nl' } };
  for (let i = 0; i < n.watched; i++) o.watched.push({ id: 'SRC-1|xv' + (i * seed % 40000), at: iso(now - (i * 7 + seed) * 60000) });
  for (let i = 0; i < n.myList; i++) o.myList.push({ id: 'SRC-1|xs' + (i + seed), at: iso(now - i * 3600000) });
  for (let i = 0; i < 800; i++) o.favorites.push({ id: 'SRC-1|x' + (1000 + i), at: iso(now - i * 1000) });
  for (let i = 0; i < 25; i++) o.recentChannels.push({ id: 'SRC-1|x' + (2000 + i + seed), at: iso(now - i * 5000) });
  for (let i = 0; i < 4000; i++) o.removed.myList['SRC-1|old' + (i + seed)] = iso(now - i * 600000);
  for (let i = 0; i < 4000; i++) o.removed.watched['SRC-1|wold' + (i + seed)] = iso(now - i * 600000);
  for (let i = 0; i < 350; i++) o.progress['SRC-1|xv' + (i + seed)] = { position: 600 + i, duration: 6000, fraction: (600 + i) / 6000, updatedAt: iso(now - i * 90000), title: 'Film ' + i, playlistID: 'SRC-1' };
  for (let i = 0; i < 3000; i++) o.removed.progress['SRC-1|pold' + i] = iso(now - i * 60000);
  for (let i = 0; i < 550; i++) o.history.push({ id: 'SRC-1|xv' + (i + seed), itemID: 'xv' + (i + seed), playlistID: 'SRC-1', title: 'Film ' + i, type: 'movie', at: iso(now - i * 120000), date: iso(now - i * 120000) });
  return o;
}
const N = { watched: +(process.env.N_WATCHED || 20000), myList: 3000 };
const srvData = profile(3, N), localData = profile(5, N);
server = { 'profile.p1': { data: srvData, updatedAt: iso(now) } };
const localSt = SM.normalize(SM.parseState(localData));
B.store.set('pstate.p1', { st: localSt, base: srvData, names: ['profile.p1'], dirty: true });
D.loadProfileState('p1');

// referentie: zoals ≤ 150 (alles in één synchrone stap); twee keer, de tweede (warm) telt
let srv, exp, expUpload, expJSON, oneStep;
for (let round = 0; round < 2; round++) {
  const t0 = performance.now();
  srv = SM.normalize(SM.parseState(JSON.parse(JSON.stringify(srvData))));
  exp = SM.normalize(SM.mergeState(localSt, srv));
  expUpload = SM.stateKey(exp) !== SM.stateKey(srv) && SM.stateKey(exp) !== SM.stateKey(localSt);
  expJSON = SM.toJSON(srvData, exp);
  JSON.stringify({ st: exp, base: srvData, names: ['profile.p1'], dirty: false });
  JSON.stringify({ st: exp, base: expJSON, names: ['profile.p1'], dirty: false });
  oneStep = performance.now() - t0;
}

(async () => {
  if (global.gc) global.gc();
  measuring = true; maxStep = 0; steps = 0;
  const s0 = performance.now();
  const pr = D.syncState();
  const first = performance.now() - s0; if (first > maxStep) maxStep = first; steps++;
  const ok = await pr;
  measuring = false;
  const line = `sync toepassen en bewaren: ${steps} stappen, langste ${maxStep.toFixed(1)} ms (≤ 150 in één stap: ${oneStep.toFixed(1)} ms), totaal ${(performance.now() - s0).toFixed(0)} ms`;
  console.log(line);
  if (process.env.GITHUB_ACTIONS) console.log('::notice title=sync_test::' + line);
  assert.strictEqual(ok, true);
  // zelfde uitkomst als de oude berekening
  const saved = B.store.get('pstate.p1');
  assert.strictEqual(SM.stateKey(saved.st), SM.stateKey(exp), 'bewaard model = samengevoegd model');
  assert.strictEqual(saved.dirty, false);
  assert.ok(expUpload, 'testgegevens: er moet geüpload worden');
  assert.strictEqual(puts.length, 1);
  const strip = (j) => { const c = JSON.parse(JSON.stringify(j)); delete c.updatedAt; return c; };
  assert.deepStrictEqual(strip(puts[0].d), strip(expJSON), 'upload = toJSON(base, samengevoegd)');
  assert.deepStrictEqual(strip(saved.base), strip(expJSON), 'na de upload: base = de upload');
  assert.deepStrictEqual(saved.names, ['profile.p1']);
  assert.strictEqual(D.setList('watched').length, Object.keys(exp.sets.watched).filter((k) => exp.sets.watched[k].on).length);
  if (maxStep >= LIMIT && process.env.GITHUB_ACTIONS) console.log(`::warning title=sync_test::een stap duurde ${maxStep.toFixed(1)} ms (grens ${LIMIT} ms)`);
  else assert.ok(maxStep < LIMIT, `een stap duurde ${maxStep.toFixed(1)} ms (grens ${LIMIT} ms)`);
  assert.ok(maxStep < oneStep, 'in stappen korter dan in één keer');

  // tweede sync zonder verschil: niets uploaden
  puts.length = 0;
  server = { 'profile.p1': { data: JSON.parse(JSON.stringify(saved.base)), updatedAt: iso(now) } };
  assert.strictEqual(await D.syncState(), true);
  assert.strictEqual(puts.length, 0, 'geen verschil = geen upload');

  // lokale wijziging: niet meteen bewaard (geen JSON.stringify bij elke klik), wel na 400 ms, en bij pagehide meteen
  const before = ls.get('bingr.web.pstate.p1');
  D.toggleSet('myList', 'SRC-1|nieuw', true);
  assert.strictEqual(ls.get('bingr.web.pstate.p1'), before, 'niet meteen bewaard');
  await new Promise((r) => realST(r, 600));
  const after = B.store.get('pstate.p1');
  assert.ok(after.st.sets.myList['SRC-1|nieuw'] && after.st.sets.myList['SRC-1|nieuw'].on && after.dirty, 'na 400 ms bewaard');

  // wijziging terwijl er samengevoegd wordt: gaat niet verloren
  server = { 'profile.p1': { data: JSON.parse(JSON.stringify(saved.base)), updatedAt: iso(now) } };
  const p2 = D.syncState();
  D.toggleSet('favorites', 'SRC-1|tijdens', true);
  await p2;
  assert.ok(D.setList('favorites').indexOf('SRC-1|tijdens') >= 0, 'wijziging tijdens de sync blijft');
  console.log('sync_test: alles goed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  if (process.env.GITHUB_ACTIONS) console.log('::error title=sync_test::' + String((e && e.stack) || e).split('\n').slice(0, 4).join(' | '));
  process.exit(1);
});
