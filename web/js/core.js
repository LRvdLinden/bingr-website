/*
 * Bingr in de browser (bingr.online/web): basis (opslag, netwerk, tijd, hashes, titels opschonen, vertalingen).
 * Overgenomen van de Samsung TV-app (tizen/js/core.js) en aangepast voor de browser:
 * - een pagina op https mag niets van http laden (mixed content): http-servers gaan altijd via de Edge Function
 *   `web-proxy` van de backend (alleen GET, alleen hosts uit je eigen servers), ook video en afbeeldingen;
 * - https-servers sturen vaak geen CORS-headers: eerst direct, en bij een CORS-/netwerkfout via de proxy;
 * - lokale opslag met het voorvoegsel `bingr.web.` (de rest van bingr.online gebruikt `bingr.`).
 */
(function () {
  'use strict';
  var B = window.B = window.B || {};

  // MARK: config (zelfde publieke waarden als de Android-app; geheime sleutels komen van de server)

  var SB = window.BINGR_SUPABASE || {};
  /**
   * Build 146: draait de webspeler in de Windows-app (Tauri-schil, bingr-windows)? Die zet bij het begin van elke pagina
   * <html data-bingr-app="windows"> en window.__bingrMediaKey (src-tauri/src/inject.js). Dan heet het platform "windows"
   * (register_device, heartbeat, diagnose); in de browser "browser". Push blijft altijd platform "web" (Web Push).
   */
  B.isWindowsApp = (function () {
    try {
      var de = document.documentElement;
      return (de && de.getAttribute('data-bingr-app') === 'windows') || typeof window.__bingrMediaKey === 'function';
    } catch (e) { return false; }
  })();
  B.config = {
    supabaseUrl: SB.url || 'https://vjewsncmsxmhmhnoxwqx.supabase.co',
    supabaseKey: SB.anonKey || 'sb_publishable_lpIup6Omq5kW2k3oICGZ4g_HPGac5A3',
    platform: B.isWindowsApp ? 'windows' : 'browser',
    // build 146: de build van deze code; ../assets/changelog.json mag hem alleen ophogen (B.loadBuild in app.js)
    build: '147',
    version: '1.0.1'
  };

  // MARK: kleine hulpfuncties

  B.noop = function () {};
  B.has = function (o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); };
  B.str = function (v) { return v == null ? null : String(v); };
  B.nonEmpty = function (v) { return v != null && String(v).trim() !== '' ? String(v) : null; };
  B.num = function (v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  };
  B.int = function (v) { var n = B.num(v); return n == null ? null : Math.trunc(n); };
  B.bool = function (v) {
    if (v === true || v === false) return v;
    if (v == null) return null;
    var s = String(v).toLowerCase();
    return s === 'true' || s === '1';
  };
  B.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  B.pad2 = function (n) { n = String(n); return n.length < 2 ? '0' + n : n; };
  B.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  B.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  B.assign = function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (s) for (var k in s) if (B.has(s, k)) target[k] = s[k];
    }
    return target;
  };
  B.copy = function (o) { return o == null ? o : JSON.parse(JSON.stringify(o)); };
  B.uuid = function () {
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' +
      h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  };

  // MARK: planning (zware klussen in stukjes, zodat de toetsen nooit blijven hangen)

  /** Laatste toetsaanslag (ms); zwaar werk wacht tot de gebruiker even stil is. */
  B.lastKeyAt = 0;
  B.keyRepeating = false;
  B.debounce = function (fn, ms) {
    var t = null;
    var d = function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
    d.cancel = function () { clearTimeout(t); t = null; };
    return d;
  };
  /** fn uitvoeren als de browser niets te doen heeft (requestIdleCallback, anders setTimeout). */
  B.idle = function (fn, timeout) {
    if (window.requestIdleCallback) return window.requestIdleCallback(fn, { timeout: timeout || 1500 });
    return setTimeout(function () { fn({ timeRemaining: function () { return 8; }, didTimeout: true }); }, 30);
  };
  /** Pas uitvoeren als er ~ms geen toets is ingedrukt (scrollen gaat altijd voor). */
  B.whenQuiet = function (fn, ms) {
    ms = ms || 350;
    function check() {
      var since = Date.now() - B.lastKeyAt;
      if (since < ms || B.keyRepeating) setTimeout(check, Math.max(60, ms - since));
      else fn();
    }
    check();
  };
  /**
   * Lijst in stukjes verwerken: per stap hooguit ~budget ms, dan even terug naar de browser.
   * each(item, index) ; resolve als alles klaar is. cancel() via het teruggegeven object.
   */
  B.chunked = function (list, each, budget) {
    budget = budget || 12;
    var i = 0, cancelled = false;
    // build 147: korte lijsten met zware items (sorteren in stukjes) elke keer de tijd controleren, lange elke 64
    var mask = list.length < 1024 ? 0 : 63;
    var p = new Promise(function (resolve, reject) {
      function step() {
        if (cancelled) { reject(new Error('cancelled')); return; }
        var t0 = Date.now();
        try {
          while (i < list.length) {
            each(list[i], i);
            i++;
            if ((i & mask) === 0 && Date.now() - t0 > budget) break;
          }
        } catch (e) { reject(e); return; }
        if (i >= list.length) resolve();
        else setTimeout(step, Date.now() - B.lastKeyAt < 200 ? 16 : 0);
      }
      step();
    });
    p.cancel = function () { cancelled = true; };
    return p;
  };
  /**
   * Build 147: werk na "klaar" nooit lang op de hoofdthread. B.task houdt bij welke (zware) taak er loopt, zodat de
   * hang-detectie (diag.js) kan zeggen waar de app mee bezig was: begin(naam) → token, end(token). Namen zijn vaste
   * teksten zoals op de andere platforms ("catalogus sorteren", "sync toepassen", "pin migreren").
   */
  var taskStack = [], taskSeq = 0;
  B.task = {
    begin: function (name) {
      var t = { id: ++taskSeq, name: String(name || ''), at: Date.now() };
      taskStack.push(t);
      if (B.task.onChange) { try { B.task.onChange(); } catch (e) { /* stil */ } }
      return t.id;
    },
    end: function (id) {
      for (var i = taskStack.length - 1; i >= 0; i--) if (taskStack[i].id === id) { taskStack.splice(i, 1); break; }
      if (B.task.onChange) { try { B.task.onChange(); } catch (e) { /* stil */ } }
    },
    /** Naam van de taak die het laatst begon en nog loopt (of ''). */
    current: function () { return taskStack.length ? taskStack[taskStack.length - 1].name : ''; },
    /** Alle lopende taken, oudste eerst (de "stack" van de webspeler: de browser geeft geen echte stack van de hoofdthread). */
    names: function () { return taskStack.map(function (t) { return t.name; }); },
    /** Promise-werk als taak: run(naam, fn) → fn() (Promise of waarde), de taak eindigt als het klaar is. */
    run: function (name, fn) {
      var id = B.task.begin(name);
      var p;
      try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
      p.then(function () { B.task.end(id); }, function () { B.task.end(id); });
      return p;
    }
  };
  /** Terug naar de browser (één macrotaak): tussen zware stappen, zodat invoer en tekenen voorgaan. */
  // setTimeout (geen scheduler.postTask): eerlijk op volgorde met de andere timers van de app; invoer en tekenen gaan
  // in de browser toch voor
  B.yieldTask = function () {
    return new Promise(function (r) { setTimeout(r, Date.now() - B.lastKeyAt < 200 ? 16 : 0); });
  };
  /** Stappen na elkaar, elk in een eigen macrotaak: steps = [function () {…}, …]; een stap mag een Promise geven. */
  B.steps = function (steps) {
    var i = 0;
    function next() {
      if (i >= steps.length) return Promise.resolve();
      var f = steps[i++];
      return B.yieldTask().then(function () { return f(); }).then(next, function (e) { B.log('stap', e && e.message); return next(); });
    }
    return next();
  };
  /** Lijst in stukjes omzetten: map(item) → waarde of null/undefined (dan overgeslagen). Promise met de nieuwe lijst. */
  B.chunkedMap = function (list, fn, budget) {
    var out = [];
    return B.chunked(list || [], function (x, i) { var v = fn(x, i); if (v != null) out.push(v); }, budget).then(function () { return out; });
  };
  /** Sorteren zonder de hoofdthread lang vast te houden: kleine lijsten meteen, grote in stukjes (mergesort, stabiel). */
  B.sortChunked = function (list, cmp) {
    list = list || [];
    if (list.length < 3000) return Promise.resolve(list.slice().sort(cmp));
    var RUN = 1024, runs = [];
    for (var i = 0; i < list.length; i += RUN) runs.push(list.slice(i, i + RUN));
    return B.chunked(runs, function (r) { r.sort(cmp); }, 10).then(function () {
      function merge() {
        if (runs.length <= 1) return Promise.resolve(runs[0] || []);
        var next = [];
        var pairs = [];
        for (var j = 0; j < runs.length; j += 2) pairs.push([runs[j], runs[j + 1] || []]);
        return B.chunked(pairs, function (pr) {
          var a = pr[0], b = pr[1], o = new Array(a.length + b.length), x = 0, y = 0, k = 0;
          while (x < a.length && y < b.length) o[k++] = cmp(b[y], a[x]) < 0 ? b[y++] : a[x++];
          while (x < a.length) o[k++] = a[x++];
          while (y < b.length) o[k++] = b[y++];
          next.push(o);
        }, 10).then(function () { runs = next; return merge(); });
      }
      return merge();
    });
  };
  /** Binair zoeken in een op `start` gesorteerde lijst: index van het laatste item met start <= t (of -1). */
  B.bsearchStart = function (list, t) {
    var lo = 0, hi = list.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (list[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  };

  // MARK: tijd (ISO-8601 zoals de andere apps: 2026-10-12T18:00:00.000Z)

  B.now = function () { return Date.now(); };
  B.iso = function (ms) { return new Date(ms == null ? Date.now() : ms).toISOString(); };
  /** ISO met 0–7 decimalen (Jellyfin/iOS) naar epoch-ms; null bij onzin. */
  B.parseISO = function (s) {
    if (s == null) return null;
    if (typeof s === 'number') return s > 1e12 ? s : s * 1000;
    s = String(s).trim();
    if (!s) return null;
    // fractie op 3 cijfers brengen
    s = s.replace(/\.(\d+)/, function (m, d) { return '.' + (d + '000').slice(0, 3); });
    if (s.length === 10) s += 'T00:00:00Z';
    var t = Date.parse(s);
    if (isNaN(t)) t = Date.parse(s.replace(' ', 'T'));
    return isNaN(t) ? null : t;
  };
  B.fmtTime = function (ms) { var d = new Date(ms); return B.pad2(d.getHours()) + ':' + B.pad2(d.getMinutes()); };
  B.fmtDur = function (s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h > 0 ? h + ':' + B.pad2(m) + ':' + B.pad2(x) : m + ':' + B.pad2(x);
  };

  // MARK: opslag (localStorage, vaste sleutels met versie; blijft staan bij een app-update)

  var PREFIX = 'bingr.web.';
  var memory = {};
  B.store = {
    get: function (k, def) {
      var raw = null;
      // niet opgeslagen (opslag vol of geblokkeerd): de waarde van deze sessie gaat voor
      if (B.has(memory, k)) raw = memory[k];
      else { try { raw = window.localStorage.getItem(PREFIX + k); } catch (e) { raw = null; } }
      if (raw == null) return def === undefined ? null : def;
      try { return JSON.parse(raw); } catch (e) { return def === undefined ? null : def; }
    },
    set: function (k, v) {
      var raw = JSON.stringify(v);
      try { window.localStorage.setItem(PREFIX + k, raw); delete memory[k]; return true; } catch (e) {
        memory[k] = raw;
        // vol (QuotaExceededError): de waarde blijft in het geheugen voor deze sessie; grote caches horen in IndexedDB
        B.log('opslag vol', k, raw.length);
        return false;
      }
    },
    del: function (k) {
      delete memory[k];
      try { window.localStorage.removeItem(PREFIX + k); } catch (e) { /* stil */ }
    },
    keys: function (prefix) {
      var out = [];
      try {
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf(PREFIX + prefix) === 0) out.push(k.slice(PREFIX.length));
        }
      } catch (e) { /* stil */ }
      return out;
    }
  };

  /**
   * Schema-versie van de lokale opslag. Een nieuwe versie voegt hier een migratiestap toe;
   * sleutels worden nooit stilletjes hernoemd, zodat een update over een oude versie heen alles houdt.
   */
  var SCHEMA = 1;
  B.migrate = function () {
    var v = B.store.get('schema', 0);
    if (v >= SCHEMA) return;
    // v0 → v1: eerste versie, niets om te migreren
    B.store.set('schema', SCHEMA);
  };

  // MARK: IndexedDB voor grote caches (bibliotheek en tv-gids); valt terug op geheugen

  var dbp = null;
  var memDB = {};
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        var req = window.indexedDB.open('bingr-web', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('cache'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  B.idb = {
    get: function (k) {
      return db().then(function (d) {
        if (!d) return B.has(memDB, k) ? memDB[k] : null;
        return new Promise(function (resolve) {
          try {
            var r = d.transaction('cache', 'readonly').objectStore('cache').get(k);
            r.onsuccess = function () { resolve(r.result == null ? null : r.result); };
            r.onerror = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
      });
    },
    set: function (k, v) {
      memDB[k] = v;
      return db().then(function (d) {
        if (!d) return;
        delete memDB[k];
        return new Promise(function (resolve) {
          try {
            var t = d.transaction('cache', 'readwrite');
            t.objectStore('cache').put(v, k);
            t.oncomplete = function () { resolve(); };
            t.onerror = function () { resolve(); };
            // vol (QuotaExceededError) breekt de transactie af: de gegevens staan dan alleen in het geheugen
            t.onabort = function () { B.log('idb vol of afgebroken', k, t.error && t.error.name); memDB[k] = v; resolve(); };
          } catch (e) { memDB[k] = v; resolve(); }
        });
      });
    },
    del: function (k) {
      delete memDB[k];
      return db().then(function (d) {
        if (!d) return;
        return new Promise(function (resolve) {
          try {
            var t = d.transaction('cache', 'readwrite');
            t.objectStore('cache').delete(k);
            t.oncomplete = function () { resolve(); };
            t.onerror = function () { resolve(); };
          } catch (e) { resolve(); }
        });
      });
    },
    /**
     * Build 147: grote records (bibliotheek, tv-gids) in stukken. IndexedDB kopieert een waarde bij put() en bij het
     * lezen op de hoofdthread (structured clone); een bibliotheek van 10k+ titels in één record hield de webspeler
     * zo honderden ms vast. Nu: kop onder `k` ({_big: 2, base, arr: {veld: stukken}, keys: stukken}) en de stukken
     * onder `k#a:<veld>:<n>` (lijsten, PART items) of `k#k:<n>` (een object met veel sleutels, zoals de gids), elk in
     * een eigen transactie en macrotaak. field = het veld van het record dat gesplitst wordt ('lib' of 'epg');
     * mode 'arrays' = de lijsten van dat object splitsen, 'keys' = het object zelf per groep sleutels.
     * Een oud record (één stuk) blijft leesbaar.
     */
    setBig: function (k, rec, field, mode) {
      var PART = 1500, KEYS = 150;
      var obj = rec && rec[field];
      if (!obj || typeof obj !== 'object') return B.idb.set(k, rec);
      var head = { _big: 2, field: field, mode: mode, base: {}, arr: {}, keys: 0 };
      Object.keys(rec).forEach(function (f) { if (f !== field) head.base[f] = rec[f]; });
      var parts = [];
      if (mode === 'keys') {
        var ks = Object.keys(obj);
        for (var i = 0; i < ks.length; i += KEYS) {
          var part = {};
          for (var j = i; j < Math.min(ks.length, i + KEYS); j++) part[ks[j]] = obj[ks[j]];
          parts.push([k + '#k:' + head.keys++, part]);
        }
      } else {
        head.rest = {};
        Object.keys(obj).forEach(function (f) {
          var v = obj[f];
          if (!Array.isArray(v)) { head.rest[f] = v; return; }
          head.arr[f] = 0;
          for (var i2 = 0; i2 < v.length || (i2 === 0 && head.arr[f] === 0); i2 += PART) {
            parts.push([k + '#a:' + f + ':' + head.arr[f]++, v.slice(i2, i2 + PART)]);
            if (!v.length) break;
          }
        });
      }
      var oldHead = null;
      var tid = B.task.begin(field === 'epg' ? 'gids bewaren' : 'catalogus bewaren');
      return B.idb.get(k).then(function (o) { oldHead = o && o._big ? o : null; }).then(function () {
        var i3 = 0;
        function next() {
          if (i3 >= parts.length) return Promise.resolve();
          var pr = parts[i3++];
          return B.yieldTask().then(function () { return B.idb.set(pr[0], pr[1]); }).then(next);
        }
        return next();
      }).then(function () { return B.idb.set(k, head); }).then(function () {
        // stukken van de vorige versie die er nu niet meer zijn
        if (!oldHead) return;
        var dels = [];
        if (oldHead.mode === 'keys') for (var a = head.mode === 'keys' ? head.keys : 0; a < (oldHead.keys || 0); a++) dels.push(k + '#k:' + a);
        else Object.keys(oldHead.arr || {}).forEach(function (f) {
          for (var b = head.arr && head.arr[f] ? head.arr[f] : 0; b < oldHead.arr[f]; b++) dels.push(k + '#a:' + f + ':' + b);
        });
        return Promise.all(dels.map(function (x) { return B.idb.del(x); }));
      }).then(function () { B.task.end(tid); }, function () { B.task.end(tid); });
    },
    /** Grote records lezen (zie setBig): stuk voor stuk, elk in een eigen macrotaak; oud formaat = zoals het is. */
    getBig: function (k) {
      return B.idb.get(k).then(function (head) {
        if (!head || !head._big) return head;
        var tid = B.task.begin(head.field === 'epg' ? 'gids laden' : 'catalogus laden');
        var rec = B.assign({}, head.base), obj = {}, ok = true;
        var names = [];
        if (head.mode === 'keys') for (var i = 0; i < head.keys; i++) names.push([k + '#k:' + i, null]);
        else {
          B.assign(obj, head.rest || {});
          Object.keys(head.arr || {}).forEach(function (f) { obj[f] = []; for (var j = 0; j < head.arr[f]; j++) names.push([k + '#a:' + f + ':' + j, f]); });
        }
        var n = 0;
        function next() {
          if (n >= names.length || !ok) return Promise.resolve();
          var nm = names[n++];
          return B.yieldTask().then(function () { return B.idb.get(nm[0]); }).then(function (part) {
            if (part == null) { ok = false; return; }
            if (nm[1] == null) B.assign(obj, part);
            else { var a = obj[nm[1]]; for (var x = 0; x < part.length; x++) a.push(part[x]); }
            return next();
          });
        }
        return next().then(function () {
          B.task.end(tid);
          if (!ok) return null; // een stuk ontbreekt: als niet bewaard behandelen
          rec[head.field] = obj;
          return rec;
        }, function () { B.task.end(tid); return null; });
      });
    },
    /** Alleen de kop (bv. `at`) zonder de stukken; oud formaat = het hele record. */
    getMeta: function (k) {
      return B.idb.get(k).then(function (head) { return head && head._big ? B.assign({}, head.base) : head; });
    },
    /** Groot record met zijn stukken verwijderen. */
    delBig: function (k) {
      return B.idb.get(k).then(function (head) {
        var dels = [k];
        if (head && head._big) {
          if (head.mode === 'keys') for (var i = 0; i < head.keys; i++) dels.push(k + '#k:' + i);
          else Object.keys(head.arr || {}).forEach(function (f) { for (var j = 0; j < head.arr[f]; j++) dels.push(k + '#a:' + f + ':' + j); });
        }
        return Promise.all(dels.map(function (x) { return B.idb.del(x); }));
      });
    },
    clear: function () {
      memDB = {};
      return db().then(function (d) {
        if (!d) return;
        return new Promise(function (resolve) {
          try {
            var t = d.transaction('cache', 'readwrite');
            t.objectStore('cache').clear();
            t.oncomplete = function () { resolve(); };
            t.onerror = function () { resolve(); };
          } catch (e) { resolve(); }
        });
      });
    }
  };

  // MARK: netwerk (http altijd via de backend-proxy; https direct, en bij een CORS-/netwerkfout via de proxy)

  function NetError(msg, offline) { this.message = msg; this.offline = !!offline; }
  NetError.prototype = Object.create(Error.prototype);
  B.NetError = NetError;

  /** Melding als iets op http niet via de proxy kan (alleen GET gaat via de proxy; de browser blokkeert http). */
  B.insecureMessage = function () {
    return B.L('This server doesn’t use a secure connection (https), so it doesn’t work in the browser. Watch in the app.');
  };
  B.isInsecure = function (url) { return /^http:\/\//i.test(String(url || '').trim()); };
  B.insecureError = function () { var e = new NetError(B.insecureMessage()); e.insecure = true; return e; };

  /** Hosts waarvoor de proxy nodig bleek (geen CORS): daarna meteen via de proxy. */
  var proxyHosts = B.store.get('proxyHosts', {}) || {};
  B.proxyHosts = proxyHosts;
  function rememberProxy(host) {
    if (!host || proxyHosts[host]) return;
    proxyHosts[host] = true;
    B.store.set('proxyHosts', proxyHosts);
  }
  function hostOf(url) { var m = /^https?:\/\/([^\/?#]+)/i.exec(url); return m ? m[1].toLowerCase() : ''; }
  function isBackend(url) { return url.indexOf(B.config.supabaseUrl) === 0; }

  function xhr(url, opt) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      try { x.open(opt.method || 'GET', url, true); } catch (e) { reject(new NetError('bad_url')); return; }
      x.timeout = opt.timeout || 30000;
      if (opt.binary) x.responseType = 'arraybuffer';
      var h = opt.headers || {};
      for (var k in h) if (B.has(h, k)) { try { x.setRequestHeader(k, h[k]); } catch (e) { /* verboden header */ } }
      if (opt.onProgress) x.onprogress = function (ev) { try { opt.onProgress(ev.loaded, ev.lengthComputable ? ev.total : 0); } catch (e) { /* stil */ } };
      x.onload = function () {
        var r = { status: x.status, text: '', json: null, buffer: null, headers: x };
        if (opt.binary) r.buffer = x.response;
        else {
          r.text = x.responseText || '';
          if (r.text) { try { r.json = JSON.parse(r.text); } catch (e) { r.json = null; } }
        }
        resolve(r);
      };
      // status 0 zonder time-out: CORS geweigerd of geen verbinding
      x.onerror = function () { var e = new NetError('network', true); e.cors = true; reject(e); };
      x.ontimeout = function () { reject(new NetError('timeout', true)); };
      var body = opt.body;
      if (body != null && typeof body !== 'string' && !(body instanceof ArrayBuffer) && !(window.Blob && body instanceof Blob)) {
        body = JSON.stringify(body);
      }
      x.send(body == null ? null : body);
    });
  }

  /**
   * Via de Edge Function `web-proxy`: POST {url, range?} met de sessie van de gebruiker; het antwoord van de
   * server komt er ongewijzigd doorheen. Alleen GET en alleen hosts uit de eigen servers (controleert de backend).
   */
  B.proxyFetch = function (url, opt) {
    opt = opt || {};
    var A = B.account;
    if (!A || !A.validAccessToken) return Promise.reject(new NetError('network', true));
    return A.validAccessToken().then(function (token) {
      var body = { url: url };
      var range = opt.range || (opt.headers && (opt.headers.Range || opt.headers.range));
      if (range) body.range = range;
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, opt.timeout || 60000);
      return fetch(B.config.supabaseUrl + '/functions/v1/web-proxy', {
        method: 'POST', signal: ctl ? ctl.signal : undefined,
        headers: { 'Authorization': 'Bearer ' + token, 'apikey': B.config.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        var get = opt.binary ? res.arrayBuffer() : res.text();
        return get.then(function (data) {
          clearTimeout(timer);
          var r = { status: res.status, text: '', json: null, buffer: null, headers: res.headers, proxied: true };
          if (opt.binary) r.buffer = data;
          else { r.text = data || ''; if (r.text) { try { r.json = JSON.parse(r.text); } catch (e) { r.json = null; } } }
          return r;
        });
      }, function () { clearTimeout(timer); throw new NetError('network', true); });
    });
  };
  /** POST naar de proxy met een eigen actie (build 91: OpenSubtitles): {status, json, text, buffer, proxied}. */
  B.proxyPost = function (body, opt) {
    opt = opt || {};
    var A = B.account;
    if (!A || !A.validAccessToken) return Promise.reject(new NetError('network', true));
    return A.validAccessToken().then(function (token) {
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, opt.timeout || 30000);
      return fetch(B.config.supabaseUrl + '/functions/v1/web-proxy', {
        method: 'POST', signal: ctl ? ctl.signal : undefined,
        headers: { 'Authorization': 'Bearer ' + token, 'apikey': B.config.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        return (opt.binary ? res.arrayBuffer() : res.text()).then(function (data) {
          clearTimeout(timer);
          var r = { status: res.status, text: '', json: null, buffer: null, proxied: true };
          if (opt.binary) r.buffer = data;
          else { r.text = data || ''; if (r.text) { try { r.json = JSON.parse(r.text); } catch (e) { r.json = null; } } }
          return r;
        });
      }, function () { clearTimeout(timer); throw new NetError('network', true); });
    });
  };
  B.proxyURL = function () { return B.config.supabaseUrl + '/functions/v1/web-proxy'; };
  B.needsProxy = function (url) { return !!proxyHosts[hostOf(url)]; };
  B.markProxy = function (url) { rememberProxy(hostOf(url)); };

  // MARK: proxy-token en GET-URL's (voor <video>, hls.js, Safari's eigen HLS-speler en afbeeldingen)

  /** Kort geldig token van de proxy (6 uur); na het inloggen opgehaald en ruim voor het verloopt ververst. */
  // build 97: ptokenGen telt op bij clearProxyToken; een verzoek van vóór het wissen (ander account) zet niets meer
  var ptoken = null, ptokenP = null, ptokenTimer = null, ptokenGen = 0;
  B.ensureProxyToken = function () {
    if (ptoken && ptoken.exp - Date.now() > 30 * 60000) return Promise.resolve(ptoken.token);
    if (ptokenP) return ptokenP;
    var A = B.account;
    if (!A || !A.validAccessToken) return Promise.resolve(null);
    var gen = ptokenGen;
    var my = ptokenP = A.validAccessToken().then(function (jwt) {
      if (gen !== ptokenGen) return null;
      return fetch(B.config.supabaseUrl + '/functions/v1/web-proxy', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + jwt, 'apikey': B.config.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'token' })
      }).then(function (r) { return r.json(); });
    }).then(function (j) {
      if (gen !== ptokenGen) return null; // build 97: intussen gewist
      if (ptokenP === my) ptokenP = null;
      var exp = j && j.token ? Date.parse(j.expires_at) : NaN;
      if (!j || !j.token || !isFinite(exp)) return ptoken ? ptoken.token : null;
      ptoken = { token: j.token, exp: exp };
      clearTimeout(ptokenTimer);
      ptokenTimer = setTimeout(function () { B.ensureProxyToken(); }, Math.max(60000, exp - Date.now() - 45 * 60000));
      return ptoken.token;
    }, function () {
      if (gen !== ptokenGen) return null;
      if (ptokenP === my) ptokenP = null;
      return ptoken ? ptoken.token : null;
    });
    return my;
  };
  B.clearProxyToken = function () { ptokenGen++; ptoken = null; ptokenP = null; clearTimeout(ptokenTimer); };
  function b64url(s) {
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  /** GET-URL van de proxy voor url (null zolang er geen token is). */
  B.proxyGetURL = function (url) {
    if (!ptoken || ptoken.exp < Date.now()) return null;
    return B.config.supabaseUrl + '/functions/v1/web-proxy?u=' + b64url(String(url)) + '&t=' + encodeURIComponent(ptoken.token);
  };
  /** Host van een van je eigen servers (serverURL, m3uURL, epgURL)? */
  B.isSourceHost = function (url) {
    var hst = hostOf(String(url || '')), list = (B.data && B.data.sources) || [];
    if (!hst) return false;
    for (var i = 0; i < list.length; i++) {
      var s = list[i] || {};
      var f = [s.serverURL, s.m3uURL, s.epgURL];
      for (var j = 0; j < f.length; j++) if (f[j] && hostOf(B.normalizedServer(f[j])) === hst) return true;
    }
    return false;
  };
  B.isProxied = function (url) { return String(url || '').indexOf(B.config.supabaseUrl + '/functions/v1/web-proxy') === 0; };
  /**
   * Moet deze media-URL via de GET-vorm van de proxy? Alleen http (mixed content). https gaat direct: <video> en
   * Safari's eigen HLS-speler hebben geen CORS nodig, en hls.js valt zelf terug op de proxy (makeLoader).
   */
  B.mustProxy = function (url) {
    url = String(url || '');
    return !B.isProxied(url) && !isBackend(url) && B.isInsecure(url);
  };

  /**
   * http(url, {method, headers, body, timeout, binary, noProxy}) → Promise<{status, text, json, buffer}>.
   * http:// gaat altijd via de proxy (alleen GET; anders een fout met e.insecure). Netwerkfout of time-out → NetError.
   */
  B.http = function (url, opt) {
    opt = opt || {};
    url = String(url || '');
    var method = (opt.method || 'GET').toUpperCase();
    if (B.isInsecure(url)) {
      if (method !== 'GET' || opt.noProxy) return Promise.reject(B.insecureError());
      return B.proxyFetch(url, opt);
    }
    var canProxy = method === 'GET' && !opt.noProxy && !isBackend(url) && /^https:/i.test(url);
    if (canProxy && proxyHosts[hostOf(url)]) return B.proxyFetch(url, opt);
    return xhr(url, opt).catch(function (e) {
      if (!canProxy || !e || !e.cors) throw e;
      B.log('CORS/netwerk: via proxy', hostOf(url));
      return B.proxyFetch(url, opt).then(function (r) {
        // de proxy zelf ontbreekt of weigert de host: de oorspronkelijke fout geldt
        if (r.status === 404 && r.json && r.json.error) throw e;
        if (r.status === 403 && r.json && /host|not_allowed|forbidden/i.test(String(r.json.error || ''))) throw e;
        rememberProxy(hostOf(url));
        return r;
      });
    });
  };

  /** Script één keer laden (hls.js, mpegts.js van de CDN, alleen als het nodig is). */
  var scripts = {};
  B.loadScript = function (src) {
    if (scripts[src]) return scripts[src];
    scripts[src] = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src; el.async = true; el.crossOrigin = 'anonymous';
      el.onload = function () { resolve(); };
      el.onerror = function () { delete scripts[src]; reject(new Error('script')); };
      document.head.appendChild(el);
    });
    return scripts[src];
  };

  B.getText = function (url, headers, timeout) {
    return B.http(url, { headers: headers, timeout: timeout || 60000 }).then(function (r) {
      if (r.status < 200 || r.status >= 300) throw new NetError('http_' + r.status);
      return r.text;
    });
  };
  B.getJSON = function (url, headers, timeout) {
    return B.http(url, { headers: headers, timeout: timeout || 60000 }).then(function (r) {
      if (r.status < 200 || r.status >= 300) throw new NetError('http_' + r.status);
      if (r.json == null) throw new NetError('bad_json');
      return r.json;
    });
  };
  B.query = function (base, params) {
    var q = [];
    for (var i = 0; i < params.length; i++) q.push(encodeURIComponent(params[i][0]) + '=' + encodeURIComponent(params[i][1]));
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
  };
  B.normalizedServer = function (s) {
    var v = String(s || '').trim().replace(/\/+$/, '');
    if (!/^https?:/i.test(v)) v = 'https://' + v;
    return v;
  };

  // MARK: stabiele hash (FNV-1a 64, als tekst in basis 36), gelijk aan M3UParser.stableHash op Android

  function utf8Bytes(s) {
    var b = unescape(encodeURIComponent(s));
    var out = new Array(b.length);
    for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  var TWO32 = 4294967296;
  B.stableHash = function (s) {
    // h = 0xcbf29ce484222325 als twee 32-bits helften
    var hi = 0xcbf29ce4, lo = 0x84222325;
    var bytes = utf8Bytes(s);
    for (var i = 0; i < bytes.length; i++) {
      lo = (lo ^ bytes[i]) >>> 0;
      // h *= 0x100000001b3 = h * 0x1b3 + (h << 40)
      var l2 = lo * 0x1b3;
      var carry = Math.floor(l2 / TWO32);
      var nlo = l2 % TWO32;
      var nhi = (hi * 0x1b3 + carry) % TWO32;
      nhi = (nhi + (lo * 256) % TWO32) % TWO32;
      hi = nhi; lo = nlo;
    }
    return u64ToString36(hi, lo);
  };
  function u64ToString36(hi, lo) {
    if (hi === 0 && lo === 0) return '0';
    // vier 16-bits limbs, groot naar klein
    var limbs = [Math.floor(hi / 65536), hi % 65536, Math.floor(lo / 65536), lo % 65536];
    var digits = '0123456789abcdefghijklmnopqrstuvwxyz';
    var out = '';
    while (limbs[0] || limbs[1] || limbs[2] || limbs[3]) {
      var rem = 0;
      for (var i = 0; i < 4; i++) {
        var cur = rem * 65536 + limbs[i];
        limbs[i] = Math.floor(cur / 36);
        rem = cur % 36;
      }
      out = digits.charAt(rem) + out;
    }
    return out;
  }

  // MARK: titels opschonen (= TitleCleaner.kt)

  var tcPrefix = /^\s*(\|[^|]{1,12}\||\[[^\]]{1,12}\]|[A-Z]{2,4}\s*[-:|]\s+)/;
  var tcEpisode = /[Ss](\d{1,2})\s*[Ee](\d{1,3})/;
  var tcYear = /[\(\[\s-](19\d{2}|20\d{2})[\)\]]?/g;
  var tcJunk = /\b(4k|uhd|fhd|hd|sd|hevc|h\.?265|x265|x264|1080p|720p|2160p|multi|subs?|nl ?sub|vost\w*|dolby|atmos|hdr10?\+?|dv)\b|\[[^\]]*\]|\([^\)]*\)/gi;
  B.parseTitle = function (raw) {
    var s = String(raw || '');
    for (var r = 0; r < 2; r++) s = s.replace(tcPrefix, '');
    var season = null, ep = null;
    var m = tcEpisode.exec(s);
    if (m) { season = parseInt(m[1], 10); ep = parseInt(m[2], 10); s = s.substring(0, m.index); }
    var y = null, last = null, mm;
    tcYear.lastIndex = 0;
    while ((mm = tcYear.exec(s)) !== null) { last = mm; if (mm[0].length === 0) tcYear.lastIndex++; }
    if (last) { y = parseInt(last[1], 10); s = s.substring(0, last.index) + s.substring(last.index + last[0].length); }
    s = s.replace(tcJunk, ' ');
    s = s.replace(/_/g, ' ').replace(/\./g, ' ').split(/[ \t ]+/).filter(function (x) { return x.length > 0; }).join(' ');
    s = s.replace(/^[ \-|:]+|[ \-|:]+$/g, '');
    return { title: s || String(raw || ''), year: y, season: season, episode: ep };
  };

  /** Tekst zonder accenten, in kleine letters (zoeken en vergelijken). */
  B.fold = function (s) {
    s = String(s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* oude engine */ }
    return s;
  };

  // MARK: vertalingen (sleutels = Engelse tekst, zoals Translations.json van de andere apps)

  B.lang = 'en';
  B.L = function (key) {
    var tab = (window.BINGR_STRINGS || {})[B.lang] || {};
    var s = B.has(tab, key) ? tab[key] : key;
    var args = Array.prototype.slice.call(arguments, 1);
    var i = 0;
    return s.replace(/%(%|@|d|\.?\d*f|lld|ld|s)/g, function (m) {
      if (m === '%%') return '%';
      var v = args[i++];
      return v == null ? m : String(v);
    });
  };
  /** Taal kiezen: "" = systeemtaal van de tv. */
  B.setLanguage = function (code) {
    var all = window.BINGR_STRINGS || {};
    var pick = code;
    if (!pick) {
      // taal van bingr.online (bingr.lang), anders die van de browser
      var site = null;
      try { site = window.localStorage.getItem('bingr.lang'); } catch (e) { site = null; }
      var sys = (site || navigator.language || 'en').toLowerCase();
      pick = sys.indexOf('zh') === 0 ? 'zh-Hans' : sys.split(/[-_]/)[0];
    }
    B.lang = (pick === 'en' || B.has(all, pick)) ? pick : 'en';
    try { document.documentElement.lang = B.lang; } catch (e) { /* stil */ }
    // build 97: Arabisch van rechts naar links
    try { document.documentElement.dir = B.lang === 'ar' ? 'rtl' : 'ltr'; } catch (e) { /* stil */ }
  };
  B.languages = [
    ['', 'Automatic'], ['nl', 'Nederlands'], ['en', 'English'], ['de', 'Deutsch'], ['fr', 'Français'],
    ['es', 'Español'], ['it', 'Italiano'], ['pt', 'Português'], ['pl', 'Polski'], ['tr', 'Türkçe'],
    ['ar', 'العربية'], ['zh-Hans', '简体中文']
  ];

  // MARK: kleine event-bus

  var listeners = {};
  /** Luisteren; geeft een functie terug om weer te stoppen (schermen die verdwijnen moeten dat doen, anders blijven ze in het geheugen). */
  B.on = function (ev, fn) {
    (listeners[ev] = listeners[ev] || []).push(fn);
    return function () { B.off(ev, fn); };
  };
  /** Aantal luisteraars (voor de tests: na profiel wisselen mag dit niet groeien). */
  B.listenerCount = function (ev) { return (listeners[ev] || []).length; };
  B.off = function (ev, fn) {
    var l = listeners[ev];
    if (!l) return;
    var i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  };
  B.emit = function (ev, data) {
    // kopie: een luisteraar mag zichzelf tijdens het uitsturen afmelden
    var l = (listeners[ev] || []).slice();
    for (var i = 0; i < l.length; i++) { try { l[i](data); } catch (e) { B.log('event ' + ev, e); } }
  };
  B.log = function () {
    try { console.log.apply(console, ['[Bingr]'].concat(Array.prototype.slice.call(arguments))); } catch (e) { /* stil */ }
  };
})();
