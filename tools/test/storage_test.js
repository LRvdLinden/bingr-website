// Build 158: lokale opslag van de webspeler (ook de Windows-app, WebView2) binnen de grenzen.
// - localStorage heeft ~5 MB per origin: het model per profiel (`pstate.<id>`, 1-2 MB met de inhoudssleutels van build 154)
//   staat nu in IndexedDB (sleutel `ls:pstate.<id>`), met migratie uit localStorage; kleine sleutels blijven in localStorage.
// - Een volle localStorage (QuotaExceededError) gooit nooit: eerst caches weg (discover, nowplaying, splash) en opnieuw,
//   anders in het geheugen voor deze sessie. Een volle of afgebroken IndexedDB valt terug op localStorage.
// - Tombstones (removed.*) ouder dan 90 dagen gaan weg; profile.<id> blijft onder de grens van de server (1 MiB tekst).
// Elke "sessie" is een eigen vm-context met dezelfde localStorage en IndexedDB eronder (zoals een herstart).
// Draaien: node tools/test/storage_test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const WEB = path.join(__dirname, '../../web/js');
const src = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');

// MARK: neppe localStorage met een grens in tekens (Chromium/WebView2: ~5M UTF-16-tekens per origin)
function makeLS(limit) {
  const m = new Map();
  const used = () => { let n = 0; for (const [k, v] of m) n += k.length + v.length; return n; };
  return {
    map: m, used,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      v = String(v);
      const old = m.has(k) ? k.length + m.get(k).length : 0;
      if (used() - old + k.length + v.length > limit) { const e = new Error('quota'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
      m.set(k, v);
    },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
}

// MARK: kleine neppe IndexedDB (één database, store `cache`; genoeg voor core.js), met een quotum in tekens
function makeIDB(limit) {
  const data = new Map();
  const size = (v) => (typeof v === 'string' ? v.length : JSON.stringify(v).length);
  const used = () => { let n = 0; for (const v of data.values()) n += size(v); return n; };
  const later = (fn) => setImmediate(fn);
  function Tx() {
    const tx = { oncomplete: null, onerror: null, onabort: null, error: null, ops: [] };
    tx.objectStore = () => ({
      get(k) { const r = { result: undefined, onsuccess: null }; tx.ops.push(() => { r.result = data.has(k) ? clone(data.get(k)) : undefined; r.onsuccess && r.onsuccess(); }); return r; },
      put(v, k) { tx.ops.push(() => { const old = data.has(k) ? size(data.get(k)) : 0; if (used() - old + size(v) > idb.limit) { tx.error = { name: 'QuotaExceededError' }; return false; } data.set(k, clone(v)); return true; }); return {}; },
      delete(k) { tx.ops.push(() => { data.delete(k); return true; }); return {}; },
      clear() { tx.ops.push(() => { data.clear(); return true; }); return {}; },
      openCursor(range) {
        const r = { result: null, onsuccess: null };
        tx.ops.push(() => {
          const keys = [...data.keys()].filter((k) => k >= range.lower && k <= range.upper).sort();
          let i = 0;
          const step = () => {
            if (i < keys.length) { const k = keys[i++]; r.result = { key: k, value: clone(data.get(k)), continue: () => later(step) }; r.onsuccess && r.onsuccess(); }
            else { r.result = null; r.onsuccess && r.onsuccess(); finish(); }
          };
          tx.cursor = true; later(step);
        });
        return r;
      }
    });
    function finish() { later(() => (tx.error ? tx.onabort && tx.onabort() : tx.oncomplete && tx.oncomplete())); }
    later(() => {
      const snapshot = new Map(data);
      for (const op of tx.ops) { if (op() === false) { data.clear(); for (const [k, v] of snapshot) data.set(k, v); break; } }
      if (!tx.cursor) finish();
    });
    return tx;
  }
  function clone(v) { return v === undefined ? undefined : (typeof v === 'string' ? v : JSON.parse(JSON.stringify(v))); }
  const idb = {
    data, limit,
    open() {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => { req.result = { transaction: () => Tx(), close() {} }; req.onsuccess && req.onsuccess(); });
      return req;
    }
  };
  return idb;
}
const KeyRange = { bound: (lower, upper) => ({ lower, upper }) };

/** Een sessie: core.js (+ syncmerge.js, sync.js als sync) in een eigen context op dezelfde opslag. */
function session(ls, idb, opts) {
  opts = opts || {};
  const ctx = { console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, setImmediate, Promise, Date, JSON, Math,
    localStorage: ls, indexedDB: idb || undefined, IDBKeyRange: KeyRange, performance,
    document: { readyState: 'complete', hidden: false, visibilityState: 'visible', documentElement: { getAttribute: () => null }, addEventListener() {}, createElement: () => ({}) },
    navigator: { userAgent: 'node', language: 'nl-NL', onLine: true }, addEventListener() {} };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(src('core.js'), ctx);
  const B = ctx.B;
  B.log = () => {};
  if (opts.sync) {
    B.L = (k) => k;
    B.account = { isSignedIn: () => true, userId: () => 'u1', getState: () => Promise.resolve({}), putState: () => Promise.resolve(B.iso()), readProfiles: () => Promise.resolve([]) };
    B.pin = { parse: () => null, valid: () => false, make: () => Promise.resolve(null) };
    B.noSyncWorker = true;
    vm.runInContext(src('syncmerge.js'), ctx);
    vm.runInContext(src('sync.js'), ctx);
  }
  return B;
}
const tick = () => new Promise((r) => setTimeout(r, 30));
const big = (n, seed) => JSON.stringify({ st: { sets: { watched: Object.fromEntries(Array.from({ length: n }, (_, i) => ['w:m:tmdb:' + (seed * 1e6 + i), { at: 1730000000000 + i, on: true }])) }, progress: {}, history: {} }, base: null, names: ['profile.' + seed], dirty: seed % 2 === 1 });
const LS_LIMIT = 5 * 1024 * 1024;

(async () => {
  let pass = 0;
  const ok = (name) => { pass++; console.log('ok', name); };

  // 1. migratie: pstate uit localStorage naar IndexedDB; kleine sleutels blijven staan
  {
    const ls = makeLS(LS_LIMIT), idb = makeIDB(500e6);
    const p1 = big(20000, 1);
    ls.setItem('bingr.web.pstate.p1', p1);
    ls.setItem('bingr.web.deviceId', JSON.stringify('dev-1'));
    const B = session(ls, idb);
    assert.strictEqual(B.store.get('pstate.p1').names[0], 'profile.1', 'vóór init: uit localStorage');
    await B.store.init(); await tick();
    assert.ok(B.store.bigInIDB());
    assert.strictEqual(idb.data.get('ls:pstate.p1'), p1);
    assert.strictEqual(ls.getItem('bingr.web.pstate.p1'), null, 'oude kopie weg');
    assert.strictEqual(B.store.get('deviceId'), 'dev-1');
    assert.strictEqual(B.store.raw('pstate.p1'), p1);
    assert.strictEqual(JSON.stringify(B.store.keys('pstate.')), '["pstate.p1"]');
    // herstart: uit IndexedDB
    const B2 = session(ls, idb);
    await B2.store.init();
    assert.strictEqual(B2.store.raw('pstate.p1'), p1);
    ok('migratie naar IndexedDB en herstart');
  }

  // 2. vier grote profielen (~1,5 MB elk): localStorage blijft klein en niets gaat verloren
  {
    const ls = makeLS(LS_LIMIT), idb = makeIDB(500e6);
    const B = session(ls, idb);
    await B.store.init();
    const vals = [1, 2, 3, 4].map((i) => big(30000, i));
    vals.forEach((v, i) => assert.strictEqual(B.store.setRaw('pstate.p' + (i + 1), v), true));
    assert.strictEqual(B.store.set('deviceId', 'dev-2'), true);
    await tick();
    assert.ok(vals[0].length > 1e6, 'testprofiel is groot: ' + vals[0].length);
    assert.ok(ls.used() < 50000, 'localStorage klein: ' + ls.used());
    const B2 = session(ls, idb);
    await B2.store.init();
    vals.forEach((v, i) => assert.strictEqual(B2.store.raw('pstate.p' + (i + 1)), v));
    assert.strictEqual(B2.store.get('deviceId'), 'dev-2');
    assert.strictEqual(B2.store.keys('pstate.').length, 4);
    B2.store.del('pstate.p4'); await tick();
    assert.ok(!idb.data.has('ls:pstate.p4'));
    const B3 = session(ls, idb); await B3.store.init();
    assert.strictEqual(B3.store.keys('pstate.').length, 3, 'verwijderd blijft weg na herstart');
    ok('vier profielen van ' + (vals[0].length / 1048576).toFixed(1) + ' MB buiten localStorage');
  }

  // 3. volle localStorage: nooit een fout; eerst caches weg, dan opnieuw; anders in het geheugen
  {
    const ls = makeLS(400000);
    ls.setItem('bingr.web.discover.upcoming.nl.NL', 'x'.repeat(200000));
    ls.setItem('bingr.web.nowplaying.nl.NL', 'x'.repeat(150000));
    const B = session(ls, null);
    assert.strictEqual(B.store.set('connections', { data: { trakt: { access: 'a'.repeat(100000) } } }), true, 'na het opruimen gelukt');
    assert.strictEqual(ls.getItem('bingr.web.discover.upcoming.nl.NL'), null);
    assert.ok(ls.getItem('bingr.web.connections'));
    // geen caches meer over: false, geen exceptie, waarde in het geheugen
    assert.strictEqual(B.store.set('collections', { big: 'y'.repeat(500000) }), false);
    assert.strictEqual(B.store.get('collections').big.length, 500000);
    assert.strictEqual(B.store.get('connections').data.trakt.access.length, 100000);
    // een cache zelf ruimt geen andere caches op en gooit ook niet
    assert.doesNotThrow(() => B.store.set('discover.known', { a: 'z'.repeat(500000) }));
    ok('QuotaExceededError opgevangen met terugval');
  }

  // 4. zonder IndexedDB (geblokkeerd): alles zoals vóór 158 in localStorage
  {
    const ls = makeLS(LS_LIMIT);
    const B = session(ls, null);
    await B.store.init();
    assert.strictEqual(B.store.bigInIDB(), false);
    B.store.setRaw('pstate.p1', big(100, 1));
    assert.ok(ls.getItem('bingr.web.pstate.p1'));
    ok('zonder IndexedDB: localStorage');
  }

  // 5. IndexedDB vol: terugval op localStorage, de oude kopie in IndexedDB weg; na herstart de nieuwste
  {
    const ls = makeLS(LS_LIMIT), idb = makeIDB(500e6);
    const B = session(ls, idb);
    await B.store.init();
    const v1 = big(1000, 1), v2 = big(2000, 3);
    B.store.setRaw('pstate.p1', v1); await tick();
    assert.strictEqual(idb.data.get('ls:pstate.p1'), v1);
    idb.limit = 10;  // vol
    B.store.setRaw('pstate.p1', v2); await tick(); await tick();
    assert.strictEqual(B.store.raw('pstate.p1'), v2);
    assert.strictEqual(ls.getItem('bingr.web.pstate.p1'), v2, 'terugval');
    assert.ok(!idb.data.has('ls:pstate.p1'), 'oude kopie weg');
    idb.limit = 500e6;
    const B2 = session(ls, idb);
    await B2.store.init(); await tick();
    assert.strictEqual(B2.store.raw('pstate.p1'), v2);
    assert.strictEqual(idb.data.get('ls:pstate.p1'), v2, 'weer verhuisd');
    ok('IndexedDB vol: terugval en herstel');
  }

  // 6. vóór init geschreven gaat voor op een oudere kopie in IndexedDB
  {
    const ls = makeLS(LS_LIMIT), idb = makeIDB(500e6);
    idb.data.set('ls:pstate.p1', big(10, 1));
    const B = session(ls, idb);
    const fresh = big(20, 3);
    B.store.setRaw('pstate.p1', fresh);
    await B.store.init(); await tick();
    assert.strictEqual(B.store.raw('pstate.p1'), fresh);
    assert.strictEqual(idb.data.get('ls:pstate.p1'), fresh);
    ok('schrijven vóór init wint');
  }

  // 6b. ander account (D.wipe → B.idb.clear) terwijl init nog leest: niets van het vorige account komt terug
  {
    const ls = makeLS(LS_LIMIT), idb = makeIDB(500e6);
    idb.data.set('ls:pstate.oud', big(10, 1));
    const B = session(ls, idb);
    const p = B.store.init();
    B.store.keys('pstate.').forEach((k) => B.store.del(k));
    B.idb.clear();
    await p; await tick();
    assert.strictEqual(B.store.keys('pstate.').length, 0);
    assert.strictEqual(B.store.raw('pstate.oud'), null);
    ok('wissen tijdens init');
  }

  // 7. dirty van een ander profiel zonder het hele model te parsen (uploadDirtyOthers, hasLocalChanges)
  {
    const ls = makeLS(LS_LIMIT), idb = makeIDB(500e6);
    const B = session(ls, idb, { sync: true });
    await B.store.init();
    B.store.setRaw('pstate.a', big(10, 1));   // dirty: true
    B.store.setRaw('pstate.b', big(10, 2));   // dirty: false
    B.store.set('pstate.c', { st: null, base: { x: 1 }, names: [], dirty: true });
    B.store.setRaw('pstate.d', '{"dirty":true,"st":null}');  // andere volgorde: toch goed (parsen)
    const D = B.data;
    assert.strictEqual(D._savedDirty('pstate.a'), true);
    assert.strictEqual(D._savedDirty('pstate.b'), false);
    assert.strictEqual(D._savedDirty('pstate.c'), true);
    assert.strictEqual(D._savedDirty('pstate.d'), true);
    assert.strictEqual(D._savedDirty('pstate.zz'), false);
    assert.strictEqual(D.hasLocalChanges('b'), false);
    assert.strictEqual(D.hasLocalChanges('A'), true);
    ok('dirty zonder JSON.parse');
  }

  // 8. tombstones ouder dan 90 dagen weg; profile.<id> onder 1 MiB (grens van put_state) bij veel gezien
  {
    const ctx = { console, setTimeout, clearTimeout, localStorage: makeLS(LS_LIMIT), document: { documentElement: { getAttribute: () => null }, addEventListener() {} }, navigator: { userAgent: 'node' }, addEventListener() {} };
    ctx.window = ctx; vm.createContext(ctx);
    vm.runInContext(src('core.js'), ctx); vm.runInContext(src('syncmerge.js'), ctx);
    const SM = ctx.B.syncMerge, now = Date.now(), iso = (t) => new Date(t).toISOString(), day = 86400000;
    const o = { watched: [], removed: { watched: {}, myList: {}, progress: {}, history: {} } };
    for (let i = 0; i < 400; i++) o.removed.watched['w:m:tmdb:old' + i] = iso(now - (91 + i) * day);
    for (let i = 0; i < 300; i++) o.removed.watched['w:m:tmdb:new' + i] = iso(now - (i % 89) * day);
    o.removed.myList['x|1'] = iso(now - 200 * day);
    o.removed.progress['x|2'] = iso(now - 120 * day);
    o.removed.history['x|3'] = iso(now - 100 * day);
    o.progressRemoved = { 'x|4': iso(now - 300 * day) };
    const json = SM.toJSON(o, SM.normalize(SM.parseState(o)));
    assert.strictEqual(Object.keys(json.removed.watched).length, 300);
    assert.ok(!Object.keys(json.removed.watched).some((k) => k.indexOf('old') >= 0));
    assert.strictEqual(Object.keys(json.removed.myList).length, 0);
    assert.strictEqual(Object.keys(json.removed.progress).length, 0);
    assert.strictEqual(Object.keys(json.removed.history).length, 0);
    assert.ok(json.progressRemoved, 'oude iOS-velden blijven staan (contract)');
    // groot: 3000 films (id + tmdb + imdb + titel) en 8000 afleveringen (id + 2 inhoudssleutels)
    const w = [];
    for (let i = 0; i < 3000; i++) { const at = iso(now - i * 3600e3); ['8F2A1C3D-1111-2222-3333-444455556666|xv' + (1e5 + i), 'w:m:tmdb:' + (1e4 + i * 7), 'w:m:imdb:tt' + (1e6 + i * 13), 'w:m:t:somemovietitlenr' + i + '|20' + (10 + i % 15)].forEach((id) => w.push({ id, at })); }
    for (let i = 0; i < 8000; i++) { const at = iso(now - i * 600e3), s = i % 80, se = (1 + i % 7) + '-' + (i % 20 + 1); ['8F2A1C3D-1111-2222-3333-444455556666|ep:' + (5000 + s) + '|' + se, 'w:e:tmdb:' + (6e4 + s) + '|' + se, 'w:e:t:someseriestitle' + s + '|20' + (10 + s % 15) + '|' + se].forEach((id) => w.push({ id, at })); }
    const big2 = { watched: w, removed: { watched: {} } };
    const st = SM.normalize(SM.parseState(big2)), out = JSON.stringify(SM.toJSON(big2, st));
    assert.ok(out.length <= 1024 * 1024, 'profile.<id> te groot: ' + out.length);
    assert.ok(Object.keys(st.sets.watched).some((k) => k.indexOf('w:m:tmdb:') === 0), 'tmdb-sleutels blijven');
    ok('tombstones > 90 dagen weg; profiel van ' + w.length + ' gezien-sleutels = ' + (out.length / 1024 | 0) + ' KB (≤ 1024 KB)');
  }

  console.log('storage_test: ' + pass + ' geslaagd');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
