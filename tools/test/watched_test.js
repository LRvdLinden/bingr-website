// Build 154: gezien over alle servers en betrouwbare Trakt-sync (contract docs/ACCOUNT.md van iptv-ios-appletv, sectie
// Build 154). Leest de gedeelde testgevallen uit ../iptv-ios-appletv/docs/watched_keys_cases.json als die repo ernaast
// staat, anders de kopie tools/test/watched_keys_cases.json (bron: iptv-ios-appletv/docs/watched_keys_cases.json, niet
// hier aanpassen). Draaien: node tools/test/watched_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const WEB = path.join(__dirname, '../../web/js');
global.window = globalThis;
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; },
  key: (i) => Object.keys(mem)[i] || null, get length() { return Object.keys(mem).length; } };
globalThis.document = { readyState: 'complete', hidden: false, visibilityState: 'visible', documentElement: { getAttribute: () => null, dir: 'ltr' }, addEventListener: () => {}, createElement: () => ({}) };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
const load = (f) => (0, eval)(fs.readFileSync(path.join(WEB, f), 'utf8'));
load('core.js');
load('watchkeys.js');
const B = globalThis.B, WK = B.wk;
const sibling = path.join(__dirname, '../../../iptv-ios-appletv/docs/watched_keys_cases.json');
const CASES = JSON.parse(fs.readFileSync(fs.existsSync(sibling) ? sibling : path.join(__dirname, 'watched_keys_cases.json'), 'utf8'));

// MARK: gedeelde gevallen
CASES.norm.forEach(([t, n]) => assert.strictEqual(WK.norm(t), n, 'norm ' + t));
CASES.clean.forEach(([t, title, year]) => { const p = B.parseTitle(t); assert.strictEqual(p.title, title, 'clean ' + t); assert.strictEqual(p.year, year, 'jaar ' + t); });
CASES.movieKeys.forEach((c) => assert.deepStrictEqual(WK.movieKeys(c), c.keys, 'film ' + c.title));
CASES.episodeKeys.forEach((c) => assert.deepStrictEqual(WK.episodeKeys({ title: c.show, year: c.year, tmdb: c.tmdb, imdb: c.imdb }, c.season, c.episode), c.keys, 'aflevering ' + c.show));
CASES.showKeys.forEach((c) => assert.deepStrictEqual(WK.showKeys({ title: c.show, year: c.year, tmdb: c.tmdb, imdb: c.imdb }), c.keys, 'serie ' + c.show));
CASES.lookup.forEach((c, i) => {
  const set = new Set(c.stored);
  assert.strictEqual(!!WK.movieHit((k) => set.has(k), c), c.watched, 'lookup ' + i + ' ' + JSON.stringify(c));
});
// nieuwste gebeurtenis over alle kandidaatsleutels wint (watched vóór removed bij gelijke tijd, zoals parseSetField)
CASES.latest.forEach((c, i) => {
  const m = {};
  Object.keys(c.watched || {}).forEach((k) => { m[k] = { at: c.watched[k], on: true }; });
  Object.keys(c.removed || {}).forEach((k) => { if (!m[k] || c.removed[k] > m[k].at) m[k] = { at: c.removed[k], on: false }; });
  assert.strictEqual(WK.latest((k) => m[k] || null, [], WK.movieKeys(c)), c.result, 'latest ' + i);
});
console.log('gedeelde gevallen: ' + ['norm', 'clean', 'movieKeys', 'episodeKeys', 'showKeys', 'lookup', 'latest'].map((k) => CASES[k].length + ' ' + k).join(', '));

// MARK: account (sync.js): schrijven, lezen, uitvinken, serie gezien, migratie, grootte
B.L = (k) => k;
const puts = [];
let server = {};
B.account = { isSignedIn: () => true, userId: () => 'u1', getState: () => Promise.resolve(JSON.parse(JSON.stringify(server))),
  putState: (n, d) => { puts.push({ n, d: JSON.parse(JSON.stringify(d)) }); return Promise.resolve(B.iso()); }, readProfiles: () => Promise.resolve([]), serverKey: () => 'cid' };
B.pin = { parse: () => null, valid: () => false, make: () => Promise.resolve(null) };
B.noSyncWorker = true;
load('syncmerge.js');
load('sync.js');
const D = B.data, SM = B.syncMerge;
D.loadProfileState('p1');
const dune = { id: 'xv1', title: 'Dune', year: 2021, tmdb: 438631, imdbID: 'tt1160419' };
D.setMovieWatched(dune, true);
// zelfde film op een andere server (ander id, geen ids, ander jaar ±1): gezien
assert.ok(D.movieWatched({ id: 'xv999', title: 'Dune', year: 2022 }), 'andere server, titel + jaar ±1');
assert.ok(D.movieWatched({ id: 'xv998', title: 'Duin', year: 1990, tmdb: '438631' }), 'andere server, tmdb');
assert.ok(!D.movieWatched({ id: 'xv997', title: 'Dune', year: 2024 }), 'ander jaar');
// uitvinken (vanaf de andere server): de id-sleutel en alle inhoudssleutels in removed, met dezelfde tijd
// uitvinken op een server zonder ids: zijn eigen (titel)sleutels, ook de gevonden met jaar ±1 (in removed); de tmdb-sleutel
// van de andere kopie blijft staan, maar de nieuwste gebeurtenis over alle sleutels is nu de verwijdering
D.setMovieWatched({ id: 'xv999', title: 'Dune', year: 2022 }, false);
assert.ok(!D.movieWatched({ id: 'xv999', title: 'Dune', year: 2022 }), 'uitgevinkt waar het uitgevinkt werd');
assert.ok(!D.hasWatchedKey('w:m:t:dune|2021') && D.hasWatchedKey('w:m:tmdb:438631'), 'titelsleutel ±1 weg, tmdb blijft staan');
assert.ok(!D.movieWatched(dune), 'nieuwste gebeurtenis (verwijdering titelsleutel) wint: ook uit op de server met tmdb');
D.setMovieWatched(dune, true);
assert.ok(D.movieWatched(dune) && D.movieWatched({ id: 'xv999', title: 'Dune', year: 2022 }), 'opnieuw gezien: nieuwste is weer een toevoeging');
D.setMovieWatched(dune, true);
D.setMovieWatched(dune, false);
let json = SM.toJSON({}, B.data._st());
const rem = json.removed.watched;
['xv1', 'w:m:tmdb:438631', 'w:m:imdb:tt1160419', 'w:m:t:dune|2021'].forEach((k) => assert.ok(rem[k], 'in removed: ' + k));
assert.strictEqual(new Set(['xv1', 'w:m:tmdb:438631', 'w:m:imdb:tt1160419', 'w:m:t:dune|2021'].map((k) => rem[k])).size, 1, 'zelfde tijd');
assert.ok(!json.watched.some((x) => /dune|438631|xv1$/.test(x.id)), 'niets meer gezien');
// aflevering + serie gezien
const got = { id: 'xs5', title: 'Game of Thrones', year: 2011, tmdb: 1399 };
const eps = [1, 2, 3].map((n) => ({ id: 'xe' + n, seriesID: 'xs5', season: 1, number: n }));
D.setEpisodesWatched(eps.slice(0, 2), true, got, { all: eps });
assert.ok(D.episodeWatched({ title: 'Game of Thrones', year: 2011 }, { id: 'other', season: 1, number: 2 }), 'aflevering op een andere server');
assert.ok(!D.seriesWatched(got), 'nog niet alle afleveringen');
D.setEpisodesWatched([eps[2]], true, got, { all: eps });
assert.ok(D.seriesWatched(got) && D.hasWatchedKey('w:s:tmdb:1399') && D.hasWatchedKey('w:s:t:gameofthrones|2011'), 'w:s: na alle afleveringen');
assert.strictEqual(D.contentEpisodeCount({ title: 'Game of Thrones', year: 2012 }), 3, 'telling via inhoudssleutels (jaar ±1)');
D.setEpisodesWatched([eps[1]], false, got, { all: eps });
assert.ok(!D.seriesWatched(got), 'w:s: weg als een aflevering niet meer gezien is');
assert.ok(!D.episodeWatched(got, eps[1]) && D.episodeWatched(got, eps[0]), 'alleen die aflevering uit');
// Trakt aired_episodes gaat voor het aantal op de server
D.setEpisodesWatched([eps[1]], true, got, { all: eps, aired: 5 });
assert.ok(!D.seriesWatched(got), 'aired 5 > 3 gezien');
// migratie: oude id-sleutels krijgen inhoudssleutels met dezelfde at; onbekend of tegenstrijdig blijft zoals het is
const st = B.data._st();
const t0 = Date.now() - 86400000;
st.sets.watched['xv50'] = { at: t0, on: true };
st.sets.watched['ep:xs60|2-3'] = { at: t0 + 1, on: true };
st.sets.watched['xv70'] = { at: t0 + 2, on: true };
st.sets.watched['xv80'] = { at: t0 + 3, on: true };
const catalog = {
  xv50: [{ type: 'movie', item: { id: 'xv50', title: 'Amélie', year: 2001, tmdb: 194 } }],
  xs60: [{ type: 'series', item: { id: 'xs60', title: 'Flikken Maastricht', year: null } }],
  xv80: [{ type: 'movie', item: { id: 'xv80', title: 'Heat', year: 1995 } }, { type: 'movie', item: { id: 'xv80', title: 'Up', year: 2009 } }]
};
const added = D.migrateWatchedKeys((id) => catalog[id] || []);
assert.strictEqual(added, 3, 'drie sleutels erbij');
assert.deepStrictEqual(st.sets.watched['w:m:tmdb:194'], { at: t0, on: true });
assert.deepStrictEqual(st.sets.watched['w:m:t:amelie|2001'], { at: t0, on: true });
assert.deepStrictEqual(st.sets.watched['w:e:t:flikkenmaastricht|0|2-3'], { at: t0 + 1, on: true });
assert.ok(!Object.keys(st.sets.watched).some((k) => /heat|up\|/.test(k)), 'tegenstrijdig: niets geraden');
assert.strictEqual(D.migrateWatchedKeys((id) => catalog[id] || []), 0, 'idempotent');
// grootte: boven 1 MB vallen eerst titelsleutels van films met een tmdb-sleutel weg, de oudste eerst
const big = { sets: { myList: {}, favorites: {}, watched: {}, recentChannels: {}, hiddenCategories: {} }, progress: {}, history: {} };
for (let i = 0; i < 6000; i++) { const at = Date.now() - i * 1000; big.sets.watched['w:m:tmdb:' + i] = { at, on: true }; big.sets.watched['w:m:t:titel' + i + '|2000'] = { at, on: true }; big.sets.watched['xv' + i] = { at, on: true }; }
const capped = SM.normalize(big);
const titles = Object.keys(capped.sets.watched).filter((k) => k.indexOf('w:m:t:') === 0);
assert.ok(titles.length < 6000 && titles.length > 4000, 'titelsleutels deels weg: ' + titles.length);
assert.ok(capped.sets.watched['w:m:t:titel0|2000'] && !capped.sets.watched['w:m:t:titel5999|2000'], 'de oudste eerst');
assert.strictEqual(Object.keys(capped.sets.watched).filter((k) => k.indexOf('w:m:tmdb:') === 0).length, 6000, 'tmdb-sleutels blijven');
assert.ok(JSON.stringify(SM.toJSON({}, capped)).length <= 1000000, 'hooguit 1 MB');
console.log('account: schrijven, lezen ±1, uitvinken, serie gezien, migratie, grootte ok');

// MARK: Trakt (connections.js): token, nooit null, wachtrij over een herstart, ids, zoektreffers, gezien als sleutels
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  B.app = { profile: { id: 'p1' } }; B.plan = { has: () => true };
  B.data.isMain = () => true;
  const calls = [];
  let http = () => ({ status: 200, json: {} });
  B.http = (url, o) => { calls.push({ url, o }); return Promise.resolve().then(() => http(url, o || {})); };
  const exp = (ms) => new Date(Date.now() + ms).toISOString();
  function setTokens(expMs) {
    const d = { trakt: { accessToken: 'A1', refreshToken: 'R1', expiresAt: exp(expMs), username: 'u' }, updatedAt: B.iso() };
    B.store.set('connections', { data: d, at: Date.parse(d.updatedAt) });
    server = { connections: { data: JSON.parse(JSON.stringify(d)), updatedAt: d.updatedAt } };
  }
  const refreshes = () => calls.filter((c) => /\/oauth\/token$/.test(c.url)).length;
  setTokens(2 * 3600000);
  load('connections.js');
  let T = B.trakt;
  assert.ok(T.isLoggedIn(), 'ingelogd');
  // > 1 uur geldig: niet verversen
  await Promise.all([T._get('/sync/last_activities'), T._get('/sync/last_activities')]);
  assert.strictEqual(refreshes(), 0, 'niet verversen bij > 1 uur geldig');
  // < 1 uur: één verversing voor drie verzoeken tegelijk (single-flight)
  setTokens(30 * 60000); load('connections.js'); T = B.trakt; calls.length = 0;
  http = (url) => /\/oauth\/token$/.test(url) ? { status: 200, json: { access_token: 'A2', refresh_token: 'R2', expires_in: 7776000, created_at: Math.floor(Date.now() / 1000) } } : { status: 200, json: {} };
  await Promise.all([T._get('/a'), T._get('/b'), T._get('/c')]);
  assert.strictEqual(refreshes(), 1, 'één verversing tegelijk');
  assert.strictEqual(B.connections.trakt().accessToken, 'A2');
  // 401: één keer verversen en het verzoek opnieuw
  setTokens(5 * 86400000); load('connections.js'); T = B.trakt; calls.length = 0;
  let n401 = 0;
  http = (url, o) => {
    if (/\/oauth\/token$/.test(url)) return { status: 200, json: { access_token: 'A3', refresh_token: 'R3', expires_in: 7776000, created_at: Math.floor(Date.now() / 1000) } };
    if (o.headers.Authorization === 'Bearer A1') { n401++; return { status: 401, json: null }; }
    return { status: 200, json: { ok: 1 } };
  };
  const r401 = await T._get('/sync/last_activities');
  assert.deepStrictEqual(r401, { ok: 1 }); assert.strictEqual(refreshes(), 1, 'verversen na 401'); assert.strictEqual(n401, 1, 'één keer 401');
  // mislukte verversing: nooit trakt: null; een nieuwer token van een ander apparaat wordt overgenomen
  setTokens(10 * 60000); load('connections.js'); T = B.trakt; calls.length = 0; puts.length = 0;
  http = (url) => /\/oauth\/token$/.test(url) ? { status: 500, json: null } : { status: 200, json: {} };
  await T._get('/x');
  assert.ok(B.connections.trakt(), 'koppeling blijft na een mislukte verversing');
  assert.ok(!puts.some((p) => p.n === 'connections' && p.d.trakt === null), 'geen trakt: null naar het account');
  http = (url) => /\/oauth\/token$/.test(url) ? { status: 400, json: null } : { status: 200, json: {} };
  setTokens(10 * 60000); load('connections.js'); T = B.trakt; puts.length = 0;
  const other = { accessToken: 'B9', refreshToken: 'R9', expiresAt: exp(90 * 86400000), username: 'u' };
  const origSync = B.connections.sync;
  let syncs = 0;
  B.connections.sync = () => { syncs++; if (syncs >= 2) { const d = { trakt: other, updatedAt: B.iso(Date.now() + 5000) }; server.connections = { data: d, updatedAt: d.updatedAt }; } return origSync(); };
  await T._get('/x');
  assert.strictEqual(B.connections.trakt().accessToken, 'B9', 'nieuwer token uit het account overgenomen');
  assert.ok(!puts.some((p) => p.n === 'connections' && p.d.trakt === null), 'ook bij 400 geen null');
  B.connections.sync = origSync;

  // wachtrij: offline gezien markeren, herstart, daarna versturen met ids en watched_at
  setTokens(30 * 86400000); B.store.del('trakt.queue'); load('connections.js'); T = B.trakt; calls.length = 0;
  http = () => Promise.reject(new Error('offline'));
  T.queueWatched({ type: 'movie', id: 'xv1', title: 'Dune', year: 2021, tmdb: 438631, imdbID: 'tt1160419' }, true, Date.UTC(2026, 9, 1), false);
  T.queueWatched({ type: 'episode', id: 'e1', title: 'Game of Thrones', year: 2011, tmdb: 1399, season: 1, episode: 2 }, false, Date.UTC(2026, 9, 2), false);
  assert.ok(T.isMovieWatched({ title: 'Dune', year: 2021 }), 'meteen gezien in het geheugen');
  await T.queue.flush();
  assert.strictEqual(T.queue.list().length, 2, 'blijft in de wachtrij');
  assert.ok(T.queue.list().every((e) => e.tries === 1 && e.next > Date.now()), 'backoff');
  // herstart: nieuwe instantie leest de wachtrij uit de opslag
  load('connections.js'); T = B.trakt;
  assert.strictEqual(T.queue.list().length, 2, 'wachtrij overleeft een herstart');
  const sent = [];
  http = (url, o) => { sent.push({ url, body: o.body }); return { status: 201, json: { added: {}, not_found: { movies: [], shows: [], episodes: [] } } }; };
  B.store.set('trakt.queue', T.queue.list().map((e) => Object.assign(e, { next: 0 }))); T.queue.reload();
  await T.queue.flush();
  assert.strictEqual(T.queue.list().length, 0, 'verstuurd');
  const add = sent.find((s) => /\/sync\/history$/.test(s.url)), del = sent.find((s) => /\/sync\/history\/remove$/.test(s.url));
  assert.deepStrictEqual(add.body, { movies: [{ ids: { tmdb: 438631, imdb: 'tt1160419' }, watched_at: '2026-10-01T00:00:00.000Z' }] }, 'ids tmdb + imdb en watched_at');
  assert.deepStrictEqual(del.body, { shows: [{ ids: { tmdb: 1399 }, seasons: [{ number: 1, episodes: [{ number: 2 }] }] }] });
  // 429 met Retry-After; not_found = niet gelukt (diagnose)
  http = () => ({ status: 429, json: null, headers: { get: (h) => (h === 'Retry-After' ? '120' : null) } });
  T.queueWatched({ type: 'movie', id: 'xv2', title: 'Heat', year: 1995, tmdb: 949 }, true, Date.now(), false);
  await T.queue.flush();
  const e429 = T.queue.list()[0];
  assert.ok(e429.next - Date.now() > 110000 && e429.next - Date.now() <= 121000, 'Retry-After gevolgd');
  B.store.set('trakt.queue', T.queue.list().map((e) => Object.assign(e, { next: 0 }))); T.queue.reload();
  http = () => ({ status: 201, json: { added: { movies: 0 }, not_found: { movies: [{ ids: { tmdb: 949 } }] } } });
  await T.queue.flush();
  assert.strictEqual(T.queue.list().length, 0, 'not_found valt eruit');
  assert.ok(/Heat/.test(T.notFound[0].title), 'not_found in de diagnose');

  // zoeken: alleen een treffer met de juiste titel en het juiste jaar (±1)
  const res = [{ movie: { title: 'Dune', year: 1984, ids: { tmdb: 841 } } }, { movie: { title: 'Dune: Part Two', year: 2024, ids: { tmdb: 693134 } } }, { movie: { title: 'Dune', year: 2021, ids: { tmdb: 438631 } } }];
  assert.strictEqual(T._pickHit(res, 'Dune', 2022, false).ids.tmdb, 438631, 'titel + jaar ±1');
  assert.strictEqual(T._pickHit(res, 'Dune', 2010, false), null, 'jaar klopt niet');
  assert.strictEqual(T._pickHit(res, 'Dune', 0, false), null, 'zonder jaar en twee treffers: niets');
  assert.strictEqual(T._pickHit([res[1]], 'Dune', 2024, false), null, 'blind list[0] niet');
  // gezien van Trakt als inhoudssleutels, ook zonder IMDb-id; serie gezien met aired_episodes
  const c = T._buildCache([{ movie: { title: 'Vaiana', year: 2016, ids: { tmdb: 277834, imdb: null } } }],
    [{ show: { title: 'Flikken Maastricht', year: 2007, aired_episodes: 2, ids: { tmdb: 3, imdb: null } }, seasons: [{ number: 1, episodes: [{ number: 1 }, { number: 2 }] }] }]);
  assert.ok(c.keys.includes('w:m:tmdb:277834') && c.keys.includes('w:m:t:vaiana|2016'), 'film zonder IMDb');
  assert.ok(c.keys.includes('w:e:t:flikkenmaastricht|2007|1-2') && c.keys.includes('w:s:tmdb:3'), 'aflevering + serie gezien');
  console.log('Trakt: token (> 1 uur niet, < 1 uur en 401 wel, één tegelijk), nooit null, wachtrij + herstart, 429, not_found, zoeken, sleutels ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
