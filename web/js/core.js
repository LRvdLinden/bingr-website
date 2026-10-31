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
    build: '149',
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
  // build 148: free = true geeft de items van de invoer stap voor stap vrij (list[i] = null), zodat de ruwe lijst van de
  // provider en de nieuwe catalogus niet allebei helemaal in het geheugen staan (alleen voor een lijst die verder niemand gebruikt)
  B.chunkedMap = function (list, fn, budget, free) {
    var out = [];
    list = list || [];
    return B.chunked(list, function (x, i) { var v = fn(x, i); if (free) list[i] = null; if (v != null) out.push(v); }, budget).then(function () { if (free) list.length = 0; return out; });
  };
  /**
   * Sorteren zonder de hoofdthread lang vast te houden: kleine lijsten meteen, grote in stukjes.
   * Build 148: echte stapjes. Een merge sort van onderop (stabiel) die midden in een merge kan stoppen: per stap
   * hooguit ~budget ms (de tijd wordt elke 256 vergelijkingen gecontroleerd), dan terug naar de browser. Build 147 deed
   * per stap een hele merge (2 × 5k titels = 173 ms op CI). Geeft een nieuwe lijst; cancel() via de Promise.
   */
  B.sortChunked = function (list, cmp, budget) {
    list = list || [];
    budget = budget || 8;
    var n = list.length;
    if (n < 2000) { var q = Promise.resolve(list.slice().sort(cmp)); q.cancel = B.noop; return q; }
    var src = list.slice(), dst = new Array(n), RUN = 32;
    var runAt = 0;                                   // fase 1: blokjes van 32 met insertion sort
    var width = RUN, lo = 0, i = 0, j = 0, k = 0, mid = 0, hi = 0, inMerge = false; // fase 2: mergen
    var cancelled = false;
    var p = new Promise(function (resolve, reject) {
      function step() {
        if (cancelled) { reject(new Error('cancelled')); return; }
        var t0 = Date.now(), ops = 0;
        try {
          while (runAt < n) {
            var e = Math.min(n, runAt + RUN);
            for (var x = runAt + 1; x < e; x++) {
              var v = src[x], y = x - 1;
              while (y >= runAt && cmp(src[y], v) > 0) { src[y + 1] = src[y]; y--; }
              src[y + 1] = v;
            }
            ops += RUN * 4;
            runAt = e;
            if (ops >= 256) { ops = 0; if (Date.now() - t0 > budget) { setTimeout(step, B.lastKeyAt && Date.now() - B.lastKeyAt < 200 ? 16 : 0); return; } }
          }
          while (width < n) {
            if (!inMerge) {
              if (lo >= n) { var t = src; src = dst; dst = t; width *= 2; lo = 0; continue; }
              mid = Math.min(n, lo + width); hi = Math.min(n, lo + 2 * width);
              i = lo; j = mid; k = lo; inMerge = true;
            }
            while (k < hi) {
              if (i < mid && (j >= hi || cmp(src[j], src[i]) >= 0)) dst[k++] = src[i++];
              else dst[k++] = src[j++];
              if ((++ops & 255) === 0 && Date.now() - t0 > budget) { setTimeout(step, B.lastKeyAt && Date.now() - B.lastKeyAt < 200 ? 16 : 0); return; }
            }
            inMerge = false; lo = hi;
          }
        } catch (err) { reject(err); return; }
        resolve(src);
      }
      step();
    });
    p.cancel = function () { cancelled = true; };
    return p;
  };
  /**
   * Build 148: de eerste n van een lijst volgens cmp, zonder alles te sorteren (Top 10, Nieuwste 30): zelfde uitkomst als
   * list.slice().sort(cmp).slice(0, n) (stabiel), maar O(lengte × log n) in plaats van de hele lijst sorteren.
   */
  B.topN = function (list, n, cmp) {
    var out = [];
    if (!n || n < 1) return out;
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (out.length >= n && cmp(x, out[out.length - 1]) >= 0) continue;
      var lo = 0, hi = out.length;
      while (lo < hi) { var m = (lo + hi) >> 1; if (cmp(x, out[m]) < 0) hi = m; else lo = m + 1; }
      out.splice(lo, 0, x);
      if (out.length > n) out.pop();
    }
    return out;
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
  /**
   * ISO met 0–7 decimalen (Jellyfin/iOS) naar epoch-ms; null bij onzin.
   * Build 149: snelle eigen parser voor yyyy-MM-dd[T ]HH:mm[:ss[.f…]][Z|±hh[:]mm] (cijfers tellen + Date.UTC, geen
   * regex of Date.parse per item; sync, Mijn lijst, voortgang en de cache lezen er duizenden). Alleen wat daar niet in
   * past gaat nog langs Date.parse. Zonder zone = UTC (zoals de andere apps schrijven).
   */
  function dig(s, i, n) {
    var v = 0;
    for (var k = 0; k < n; k++) { var c = s.charCodeAt(i + k) - 48; if (!(c >= 0 && c <= 9)) return -1; v = v * 10 + c; }
    return v;
  }
  function fastISO(s) {
    var L = s.length;
    if (L < 10 || s.charCodeAt(4) !== 45 || s.charCodeAt(7) !== 45) return NaN;
    var y = dig(s, 0, 4), mo = dig(s, 5, 2), d = dig(s, 8, 2);
    if (y < 0 || mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
    if (L === 10) return Date.UTC(y, mo - 1, d);
    var sep = s.charCodeAt(10);
    if ((sep !== 84 && sep !== 32 && sep !== 116) || L < 16 || s.charCodeAt(13) !== 58) return NaN;
    var h = dig(s, 11, 2), mi = dig(s, 14, 2), se = 0, ms = 0, i = 16;
    if (h < 0 || h > 24 || mi < 0 || mi > 59) return NaN;
    if (i < L && s.charCodeAt(i) === 58) { se = dig(s, i + 1, 2); if (se < 0 || se > 60) return NaN; i += 3; }
    if (i < L && (s.charCodeAt(i) === 46 || s.charCodeAt(i) === 44)) {
      i++;
      var f = 0, n = 0;
      while (i < L) { var c = s.charCodeAt(i) - 48; if (!(c >= 0 && c <= 9)) break; if (n < 3) { f = f * 10 + c; n++; } else n += 0; i++; }
      if (!n) return NaN;
      while (n < 3) { f *= 10; n++; }
      ms = f;
    }
    var off = 0;
    if (i < L) {
      var z = s.charCodeAt(i);
      if (z === 90 || z === 122) { if (i + 1 !== L) return NaN; }
      else if (z === 43 || z === 45) {
        var oh = dig(s, i + 1, 2), om = 0, r = L - i - 3;
        if (oh < 0) return NaN;
        if (r === 3 && s.charCodeAt(i + 3) === 58) om = dig(s, i + 4, 2);
        else if (r === 2) om = dig(s, i + 3, 2);
        else if (r !== 0) return NaN;
        if (om < 0) return NaN;
        off = (z === 45 ? -1 : 1) * (oh * 60 + om) * 60000;
      } else return NaN;
    }
    return Date.UTC(y, mo - 1, d, h, mi, se, ms) - off;
  }
  B.fastISO = fastISO;
  B.parseISO = function (s) {
    if (s == null) return null;
    if (typeof s === 'number') return s > 1e12 ? s : s * 1000;
    s = String(s).trim();
    if (!s) return null;
    var t = fastISO(s);
    if (t === t) return t;
    // terugval (zeldzaam): fractie op 3 cijfers brengen
    s = s.replace(/\.(\d+)/, function (m, d) { return '.' + (d + '000').slice(0, 3); });
    t = Date.parse(s);
    if (isNaN(t)) t = Date.parse(s.replace(' ', 'T'));
    return isNaN(t) ? null : t;
  };
  /**
   * Build 149: één gedeelde Intl.DateTimeFormat per taal + opties (toLocaleDateString met opties maakt er elke keer een
   * nieuwe; in een lijst met een datum per rij was dat het dure deel). B.fmtDate(ms, opts) = toLocaleDateString(taal, opts).
   */
  var dtfCache = Object.create(null);
  B.locale = function () { return B.lang === 'zh-Hans' ? 'zh-CN' : (B.lang || 'en'); };
  B.dateFmt = function (opts, locale) {
    var loc = locale || B.locale(), key = loc + '|' + JSON.stringify(opts || {});
    var f = dtfCache[key];
    if (f) return f;
    try { f = new Intl.DateTimeFormat(loc, opts || {}); } catch (e) { f = { format: function (d) { return new Date(d).toDateString(); } }; }
    dtfCache[key] = f;
    return f;
  };
  B.fmtDate = function (ms, opts, locale) { return B.dateFmt(opts, locale).format(ms instanceof Date ? ms : new Date(ms)); };
  B.fmtTime = function (ms) { var d = new Date(ms); return B.pad2(d.getHours()) + ':' + B.pad2(d.getMinutes()); };
  B.fmtDur = function (s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h > 0 ? h + ':' + B.pad2(m) + ':' + B.pad2(x) : m + ':' + B.pad2(x);
  };

  // MARK: opslag (localStorage, vaste sleutels met versie; blijft staan bij een app-update)
  /*
   * Build 158: localStorage heeft ~5 MB per origin (ook in WebView2/Windows). Het model per profiel (`pstate.<id>`,
   * st + base) is met de inhoudssleutels van build 154 per profiel 1-2 MB; met een paar profielen raakte localStorage vol,
   * en dan mislukten ook kleine maar belangrijke schrijfacties (apparaat-id, sessie van supabase-js, Trakt-token).
   * Daarom: grote sleutels (BIG) staan in IndexedDB (store `cache`, sleutel `ls:<sleutel>`, als tekst) met een kopie in het
   * geheugen, zodat B.store.get synchroon blijft. B.store.init() (bij het starten, vóór het eerste profiel) leest ze in en
   * verhuist oude kopieën uit localStorage. Zonder IndexedDB blijft alles in localStorage zoals vóór 158.
   * Vol (QuotaExceededError): eerst caches die opnieuw op te halen zijn weg en nog één keer proberen; anders in het geheugen.
   */

  var PREFIX = 'bingr.web.';
  var memory = {};
  var BIG = /^pstate\./, IDB_LS = 'ls:';
  var EXPENDABLE = /^(discover\.|nowplaying\.|splashPosters$|diag\.updates$)/;
  var bigMem = {}, bigOn = false, bigSeq = {}, beforeInit = {}, initP = null, bigChan = null, clearGen = 0;
  function isBig(k) { return BIG.test(k); }
  function lsRemove(k) { try { window.localStorage.removeItem(PREFIX + k); } catch (e) { /* stil */ } }
  function isQuota(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  }
  /** Caches die opnieuw op te halen zijn uit localStorage halen (niet: account, apparaat, tokens, profielen). */
  function evictExpendable() {
    var n = 0;
    try {
      var ks = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i);
        if (key && key.indexOf(PREFIX) === 0 && EXPENDABLE.test(key.slice(PREFIX.length))) ks.push(key);
      }
      ks.forEach(function (key) { window.localStorage.removeItem(key); n++; });
    } catch (e) { /* stil */ }
    return n;
  }
  function lsSet(k, raw) {
    for (var attempt = 0; attempt < 2; attempt++) {
      try { window.localStorage.setItem(PREFIX + k, raw); delete memory[k]; return true; } catch (e) {
        if (attempt === 0 && isQuota(e) && !EXPENDABLE.test(k) && evictExpendable() > 0) continue;
        // vol of geblokkeerd: de waarde blijft in het geheugen voor deze sessie
        memory[k] = raw;
        B.log('opslag vol', k, raw.length, e && e.name);
        return false;
      }
    }
    return false;
  }
  /** Promise<boolean>: in IndexedDB gezet (true) of niet (vol, afgebroken, geen database). */
  function idbWrite(key, val, del) {
    return db().then(function (d) {
      if (!d) return false;
      return new Promise(function (resolve) {
        try {
          var t = d.transaction('cache', 'readwrite'), os = t.objectStore('cache');
          if (del) os.delete(key); else os.put(val, key);
          t.oncomplete = function () { resolve(true); };
          t.onerror = function () { resolve(false); };
          t.onabort = function () { B.log('idb vol of afgebroken', key, t.error && t.error.name); resolve(false); };
        } catch (e) { resolve(false); }
      });
    });
  }
  function bigWrite(k, raw) {
    var my = bigSeq[k] = (bigSeq[k] || 0) + 1;
    return idbWrite(IDB_LS + k, raw).then(function (ok) {
      if (bigSeq[k] !== my) return ok;   // intussen nieuwer geschreven: die beslist
      if (ok) { lsRemove(k); delete memory[k]; if (bigChan) try { bigChan.postMessage({ k: k }); } catch (e) { /* stil */ } return true; }
      // IndexedDB vol of kapot: terugval op localStorage; de (oudere) kopie in IndexedDB weg, zodat die nooit wint
      lsSet(k, raw);
      idbWrite(IDB_LS + k, null, true);
      return false;
    });
  }
  B.store = {
    get: function (k, def) {
      var raw = null;
      // niet opgeslagen (opslag vol of geblokkeerd): de waarde van deze sessie gaat voor
      if (B.has(memory, k)) raw = memory[k];
      else if (B.has(bigMem, k)) raw = bigMem[k];
      else { try { raw = window.localStorage.getItem(PREFIX + k); } catch (e) { raw = null; } }
      if (raw == null) return def === undefined ? null : def;
      try { return JSON.parse(raw); } catch (e) { return def === undefined ? null : def; }
    },
    /** De bewaarde tekst zonder JSON.parse (bv. alleen een vlag bekijken), of null. */
    raw: function (k) {
      if (B.has(memory, k)) return memory[k];
      if (B.has(bigMem, k)) return bigMem[k];
      try { return window.localStorage.getItem(PREFIX + k); } catch (e) { return null; }
    },
    set: function (k, v) {
      var raw;
      try { raw = JSON.stringify(v); } catch (e) { B.log('opslag', k, e); return false; }
      return B.store.setRaw(k, raw);
    },
    /** build 151: een al klare JSON-tekst bewaren (uit een Worker; geen JSON.stringify op de hoofdthread). */
    setRaw: function (k, raw) {
      if (raw === undefined) { B.store.del(k); return true; }
      if (isBig(k) && bigOn) { bigMem[k] = raw; delete memory[k]; bigWrite(k, raw); return true; }
      if (isBig(k)) beforeInit[k] = true;
      return lsSet(k, raw);
    },
    del: function (k) {
      delete memory[k];
      if (isBig(k)) {
        delete bigMem[k]; bigSeq[k] = (bigSeq[k] || 0) + 1; delete beforeInit[k];
        if (bigOn) idbWrite(IDB_LS + k, null, true).then(function () { if (bigChan) try { bigChan.postMessage({ k: k, del: true }); } catch (e) { /* stil */ } });
      }
      lsRemove(k);
    },
    keys: function (prefix) {
      var out = [], seen = {};
      function add(k) { if (!seen[k] && k.indexOf(prefix) === 0) { seen[k] = true; out.push(k); } }
      try {
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) add(k.slice(PREFIX.length));
        }
      } catch (e) { /* stil */ }
      Object.keys(bigMem).forEach(add);
      Object.keys(memory).forEach(add);
      return out;
    },
    /** Of grote sleutels in IndexedDB staan (diagnose/tests). */
    bigInIDB: function () { return bigOn; },
    /**
     * Build 158: grote sleutels uit IndexedDB inlezen en oude kopieën uit localStorage verhuizen. Eén keer; altijd een
     * Promise die slaagt. Vóór het eerste B.store.get van een grote sleutel afwachten (app.js, met een time-out).
     */
    init: function () {
      if (initP) return initP;
      var gen = clearGen;
      initP = db().then(function (d) {
        if (!d) return;
        return new Promise(function (resolve) {
          var rows = [];
          try {
            var t = d.transaction('cache', 'readonly');
            var req = t.objectStore('cache').openCursor(window.IDBKeyRange.bound(IDB_LS, IDB_LS + '￿'));
            req.onsuccess = function () {
              var c = req.result;
              if (c) { if (typeof c.value === 'string') rows.push([String(c.key).slice(IDB_LS.length), c.value]); c.continue(); }
            };
            t.oncomplete = function () { resolve(rows); };
            t.onerror = t.onabort = function () { resolve(null); };
          } catch (e) { resolve(null); }
        }).then(function (rows) {
          if (!rows) return;
          // intussen alles gewist (ander account, B.idb.clear): niets van vóór het wissen terugzetten
          if (gen !== clearGen) rows = [];
          rows.forEach(function (r) { if (!B.has(bigMem, r[0]) && !beforeInit[r[0]]) bigMem[r[0]] = r[1]; });
          bigOn = true;
          // migratie: grote sleutels uit localStorage (≤ 157, of deze sessie vóór init geschreven)
          var legacy = [];
          try {
            for (var i = 0; i < window.localStorage.length; i++) {
              var key = window.localStorage.key(i);
              if (key && key.indexOf(PREFIX) === 0 && isBig(key.slice(PREFIX.length))) legacy.push(key.slice(PREFIX.length));
            }
          } catch (e) { /* stil */ }
          Object.keys(memory).forEach(function (k) { if (isBig(k) && legacy.indexOf(k) < 0) legacy.push(k); });
          return Promise.all(legacy.map(function (k) {
            var raw = B.has(memory, k) ? memory[k] : null;
            if (raw == null) { try { raw = window.localStorage.getItem(PREFIX + k); } catch (e) { raw = null; } }
            if (raw == null) return null;
            // staat al in IndexedDB en niet in deze sessie geschreven: IndexedDB is de nieuwste (terugval wist die kopie)
            if (B.has(bigMem, k) && !beforeInit[k]) { lsRemove(k); return null; }
            bigMem[k] = raw;
            return bigWrite(k, raw);
          }));
        }).then(function () {
          beforeInit = {};
          if (bigOn && typeof window.BroadcastChannel === 'function') {
            try {
              // andere tabbladen: hun nieuwe tekst ophalen (localStorage was gedeeld; het geheugen niet)
              bigChan = new window.BroadcastChannel('bingr-web-store');
              bigChan.onmessage = function (e) {
                var m = e.data || {}, k = m.k;
                if (!k || !isBig(k)) return;
                var my = bigSeq[k] = (bigSeq[k] || 0) + 1;
                if (m.del) { delete bigMem[k]; return; }
                B.idb.get(IDB_LS + k).then(function (v) { if (bigSeq[k] === my && typeof v === 'string') bigMem[k] = v; });
              };
            } catch (e) { bigChan = null; }
          }
        });
      }).then(B.noop || function () {}, function (e) { B.log('opslag init', e); });
      return initP;
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
        req.onsuccess = function () {
          var d = req.result;
          // build 158: gewist of door een ander tabblad bijgewerkt: verbinding los, de volgende aanvraag opent opnieuw
          d.onversionchange = function () { try { d.close(); } catch (e) { /* stil */ } dbp = null; };
          d.onclose = function () { dbp = null; };
          resolve(d);
        };
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
          // build 149: het stuk pas maken als het bewaard wordt (geen tweede kopie van alle lijsten tegelijk)
          for (var i2 = 0; i2 < v.length || (i2 === 0 && head.arr[f] === 0); i2 += PART) {
            parts.push([k + '#a:' + f + ':' + head.arr[f]++, null, v, i2]);
            if (!v.length) break;
          }
        });
      }
      var oldHead = null;
      var tid = B.task.begin(field === 'epg' ? 'guide_save' : 'save');
      return B.idb.get(k).then(function (o) { oldHead = o && o._big ? o : null; }).then(function () {
        var i3 = 0;
        function next() {
          if (i3 >= parts.length) return Promise.resolve();
          var pr = parts[i3++];
          return B.yieldTask().then(function () { var val = pr[2] ? pr[2].slice(pr[3], pr[3] + PART) : pr[1]; parts[i3 - 1] = null; return B.idb.set(pr[0], val); }).then(next);
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
        var tid = B.task.begin(head.field === 'epg' ? 'guide_load' : 'catalog_load');
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
      // build 158: ook de grote sleutels van B.store (ls:…) staan in deze store
      clearGen++;
      Object.keys(bigMem).forEach(function (k) { bigSeq[k] = (bigSeq[k] || 0) + 1; });
      bigMem = {};
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
          if (r.text && !opt.noJSON) { try { r.json = JSON.parse(r.text); } catch (e) { r.json = null; } }
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
          else { r.text = data || ''; if (r.text && !opt.noJSON) { try { r.json = JSON.parse(r.text); } catch (e) { r.json = null; } } }
          noteProxyError(r, res, data);
          return r;
        }, function () {
          // build 151c: het antwoord brak halverwege af (bv. te groot of de tijdslimiet van de proxy)
          clearTimeout(timer);
          throw new NetError(ctl && ctl.signal.aborted ? 'timeout' : 'proxy_cut', true);
        });
      }, function () { clearTimeout(timer); throw new NetError(ctl && ctl.signal.aborted ? 'timeout' : 'network', true); });
    });
  };
  /**
   * build 151c: fout van de proxy zelf (JSON {error}, zonder X-Upstream-Status) of van de server van de gebruiker
   * (X-Upstream-Status, ongewijzigd doorgegeven)? r.proxyError = code van de proxy, r.upstreamStatus = status van de server.
   */
  function noteProxyError(r, res, data) {
    var up = res.headers && res.headers.get ? res.headers.get('x-upstream-status') : null;
    r.upstreamStatus = up ? Number(up) : null;
    if (r.status >= 200 && r.status < 300) return;
    if (up) return;
    var t = typeof data === 'string' ? data : '';
    if (!t && data && typeof data.byteLength === 'number' && data.byteLength < 512) { try { t = new TextDecoder().decode(data); } catch (e) { t = ''; } }
    if (!t || t.length > 512) return;
    try { var j = JSON.parse(t); if (j && typeof j.error === 'string' && /^[a-z_]{1,40}$/.test(j.error)) r.proxyError = j.error; } catch (e) { /* geen JSON */ }
  }
  /** build 151c: NetError voor een antwoord buiten 2xx: proxy_<code> (fout van de proxy) of http_<status> (van de server). */
  B.httpError = function (r) {
    var e = new NetError(r && r.proxyError ? 'proxy_' + r.proxyError : 'http_' + (r ? r.status : 0));
    e.status = r ? r.status : 0;
    e.upstream = r && r.upstreamStatus != null ? r.upstreamStatus : (r && r.proxied && !r.proxyError ? r.status : null);
    return e;
  };
  /**
   * build 151c: leesbare melding bij een foutcode (proxy_…, http_…, timeout, network, bad_json) in plaats van een kale code.
   * Onbekend: de code zelf (of null als er geen code is).
   */
  B.netMessage = function (e) {
    var m = String((e && e.message) || e || '');
    var c = /^proxy_([a-z_]+)$/.exec(m), k = c ? c[1] : m;
    var T = {
      timeout: 'The server is not responding (time-out).', connect_timeout: 'The server is not responding (time-out).', tls_timeout: 'The server is not responding (time-out).',
      dns_failed: 'The server address could not be found (DNS). Check the server address.',
      connect_refused: 'The server refused the connection from Bingr’s server. Your provider may block servers in data centres; the app connects directly and does work.',
      connect_reset: 'The server broke off the connection from Bingr’s server. Your provider may block servers in data centres; the app connects directly and does work.',
      connect_failed: 'Bingr’s server could not connect to your server.',
      no_response: 'The server closed the connection without an answer.',
      bad_response: 'The server sent an answer Bingr can’t read.',
      tls_failed: 'The secure connection (https) to the server failed: its certificate is not accepted. Try the server address with http://.',
      too_large: 'The answer from the server is too large (more than 200 MB).', proxy_cut: 'The answer from the server was cut off (too large or too slow). Try again.',
      quota_exceeded: 'You’ve reached the usage limit of Bingr’s server for now. Try again later.', rate_limited: 'Too many requests at once. Wait a moment and try again.',
      host_not_allowed: 'This address is not one of your own servers.', path_not_allowed: 'This address on your server can’t be used via Bingr’s server.',
      port_not_allowed: 'This port can’t be used via Bingr’s server.', unavailable: 'Bingr’s server is temporarily unavailable. Try again later.',
      upstream_failed: 'Bingr’s server could not reach your server.', range_not_supported: 'The server does not support this.',
      not_signed_in: 'Sign in again.', bad_json: 'The server sent an invalid answer.', network: 'No connection. Check your internet connection.'
    };
    if (T[k]) return B.L(T[k]);
    var h = /^http_(\d{3})$/.exec(m);
    if (h) {
      var st = Number(h[1]);
      if (st === 401 || st === 403) return B.L('Your server refused access (%d). Check the username and password, or whether your subscription is still active.').replace('%d', st);
      if (st === 404) return B.L('Your server doesn’t know this address (404). Check the server address.');
      if (st >= 500) return B.L('Your server gave an error (%d). Try again later.').replace('%d', st);
      return B.L('Your server gave an error (%d).').replace('%d', st);
    }
    return m || null;
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
          else { r.text = data || ''; if (r.text && !opt.noJSON) { try { r.json = JSON.parse(r.text); } catch (e) { r.json = null; } } }
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
      if (r.status < 200 || r.status >= 300) throw B.httpError(r);
      return r.text;
    });
  };
  B.getJSON = function (url, headers, timeout) {
    return B.http(url, { headers: headers, timeout: timeout || 60000 }).then(function (r) {
      if (r.status < 200 || r.status >= 300) throw B.httpError(r);
      if (r.json == null) throw new NetError('bad_json');
      return r.json;
    });
  };
  /**
   * Build 149: grote JSON-lijst (Xtream get_vod_streams e.d.) zonder volledige JSON-boom op de hoofdthread. De tekst komt
   * binnen zonder JSON.parse; een Web Worker (js/json-worker.js, zelfde code als B.jsonPick in jsonpick.js) leest hem,
   * houdt per item alleen spec.fields, laat items uit spec.skip (categorie-id's) weg (alleen geteld) en stuurt de lijst
   * in stukken terug (elk stuk een eigen macrotaak). Zonder Worker: B.jsonPick hier (één stap, wel zonder de rest van de boom).
   * → Promise<{list, skipped: {categorie-id: aantal}, total}>; fout zoals getJSON (http_…, bad_json, timeout, …).
   */
  var jw = null, jwBroken = false, jwSeq = 0, jwWait = {}, jwIdle = 0;
  function jsonWorker() {
    if (jwBroken || typeof window.Worker !== 'function' || B.noJSONWorker) return null;
    if (jw) return jw;
    try {
      jw = new window.Worker('js/json-worker.js?v=149');
      jw.onmessage = function (e) {
        var d = e.data || {}, w = jwWait[d.id];
        if (!w) return;
        if (d.part) { for (var i = 0; i < d.part.length; i++) w.list.push(d.part[i]); return; }
        if (d.hpart) { for (var i2 = 0; i2 < d.hpart.length; i2++) w.hidden.push(d.hpart[i2]); return; }
        delete jwWait[d.id];
        if (d.error) w.fail(d.error); else w.resolve({ list: w.list, skipped: d.skipped || {}, hidden: w.hidden, total: d.total || 0 });
        // klaar en niets meer te doen: de Worker na 20 s stoppen (zijn geheugen meteen terug)
        clearTimeout(jwIdle);
        jwIdle = setTimeout(function () { if (jw && !Object.keys(jwWait).length) { try { jw.terminate(); } catch (x) { /* stil */ } jw = null; } }, 20000);
      };
      jw.onerror = function () {
        jwBroken = true; jw = null;
        Object.keys(jwWait).forEach(function (k) { var w = jwWait[k]; delete jwWait[k]; w.fallback(); });
      };
    } catch (e) { jwBroken = true; jw = null; }
    return jw;
  }
  B.parsePicked = function (text, spec) {
    var w = jsonWorker();
    function local() {
      var r = B.jsonPick(text, spec);
      if (r.error) throw new NetError(r.error);
      return r;
    }
    if (!w) return Promise.resolve().then(local);
    return new Promise(function (resolve, reject) {
      var id = ++jwSeq;
      jwWait[id] = { list: [], hidden: [], resolve: resolve, fail: function (c) { reject(new NetError(c)); }, fallback: function () { try { resolve(local()); } catch (e) { reject(e); } } };
      try { w.postMessage({ id: id, text: text, spec: spec }); } catch (e) { var x = jwWait[id]; delete jwWait[id]; x.fallback(); }
    });
  };
  B.getJSONPicked = function (url, headers, timeout, spec) {
    return B.http(url, { headers: headers, timeout: timeout || 60000, noJSON: true }).then(function (r) {
      if (r.status < 200 || r.status >= 300) throw B.httpError(r);
      var t = r.text; r.text = '';
      return B.parsePicked(t, spec);
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

  // MARK: build 150: taal-, land- en kwaliteitsaanduidingen weg (categorieën, titels en zoeken; één plek)
  // "| NL | NETFLIX" → "Netflix", "| MULTI / LINGO | NETFLIX" → "Netflix", "NL: Bioscoop" → "Bioscoop", "[EN] Disney+ 4K" →
  // "Disney+", "BE ¦ VTM GO" → "VTM GO", "NETFLIX (NL)" → "Netflix", "TR - DIZI" → "Dizi", "4K | UHD | SPORT" → "Sport",
  // "Kids NL" → "Kids". Alleen weg als er daarna nog een naam over is ("NL" en "4K" blijven zoals ze zijn).
  // Voorin en achterin, in elke volgorde: scheidingstekens | ¦ │ : - – — / • · ★ » « en [ ] ( ) { }; taal- en landcodes
  // (ISO 639-1, ISO 3166-1 en gangbare drieletter-codes), talen/landen voluit (NL en EN), MULTI/LINGO/SUB/DUB/VOSTFR/…,
  // VOD/FILMS/MOVIES/SERIES (alleen voorin) en kwaliteit (4K, UHD, FHD, HD, SD, HEVC, H265, HDR, DV, …).
  // Zonder scheidingsteken alleen een code in HOOFDLETTERS ("NL Films", "Kids NL") of kwaliteit achteraan ("Videoland 4K").
  function tagSet(str) { var o = Object.create(null); str.split(/\s+/).forEach(function (w) { if (w) o[w] = 1; }); return o; }
  var T_ISO = tagSet(('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en ' +
    'eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ' +
    'ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps ' +
    'pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi ' +
    'vo wa wo xh yi yo za zh zu').toUpperCase() + ' AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR ' +
    'BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB ' +
    'GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW ' +
    'KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR ' +
    'NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD ' +
    'TF TG TH TJ TK TL TM TN TO TR TT TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW UK EU VL ' +
    'NLD DUT ENG GER DEU FRA FRE SPA ESP ITA POR POL TUR ARA HIN RUS SWE NOR DAN FIN GRE ELL RUM RON HUN CZE CES KOR JPN CHI ZHO THA PER FAS ' +
    'HEB ALB SQI BUL HRV SRB SRP UKR TAM USA GBR BEL AUT CHE CAN AUS BRA MEX ARG IND PAK IRN IRQ AFG KUR LAT LATAM EXYU EX-YU');
  // zonder scheidingsteken (in HOOFDLETTERS): alleen de gangbare, geen gewone woorden als IN, NO, IS, TO, ME, MY, AM, AT, AS, SO
  // (en geen US: "US Open")
  var T_BARE = tagSet('NL BE VL EN UK GB DE FR ES IT PT BR PL TR AR RU SE DK FI GR RO HU CZ KR JP CN TH IR EXYU ' +
    'NLD ENG GER DEU FRA ESP ITA POR POL TUR ARA RUS LAT LATAM MULTI MULTISUB MULTISUBS MULTILANG MULTIAUDIO VOSTFR');
  var T_MULTI = tagSet('MULTI MULTILANG MULTILANGUAGE LANG LINGO MULTILINGO MULTILINGUAL MULTISUB MULTISUBS MULTIAUDIO DUAL SUB SUBS SUBBED ' +
    'DUB DUBBED VOSTFR VOST VOSE VO VF OV OMU AUDIO');
  var T_MEDIA = tagSet('VOD SERIES SERIE FILMS FILM MOVIES MOVIE');
  var T_QUAL = tagSet('4K 8K UHD FHD HD SD HEVC H265 H264 X265 HDR HDR10 DV 1080P 720P 2160P 50FPS 60FPS');
  // kwaliteit achteraan zonder scheidingsteken, ook in kleine letters ("Videoland 4k")
  var T_QUAL_ANY = tagSet('4K 8K UHD FHD HD HEVC HDR HDR10 1080P 720P 2160P');
  // talen en landen voluit (opgevouwen) → taalcode (voor de chip)
  var T_NAMES = {
    nederlands: 'NL', nederlandse: 'NL', dutch: 'NL', vlaams: 'NL', vlaamse: 'NL', flemish: 'NL', nederland: 'NL', netherlands: 'NL', holland: 'NL',
    belgie: 'BE', belgium: 'BE', engels: 'EN', engelse: 'EN', english: 'EN', duits: 'DE', duitse: 'DE', german: 'DE', deutsch: 'DE', duitsland: 'DE', germany: 'DE',
    frans: 'FR', franse: 'FR', french: 'FR', francais: 'FR', frankrijk: 'FR', france: 'FR', spaans: 'ES', spaanse: 'ES', spanish: 'ES', espanol: 'ES', spanje: 'ES', spain: 'ES',
    italiaans: 'IT', italiaanse: 'IT', italian: 'IT', italiano: 'IT', italie: 'IT', italy: 'IT', portugees: 'PT', portugese: 'PT', portuguese: 'PT', portugal: 'PT',
    turks: 'TR', turkse: 'TR', turkish: 'TR', turkce: 'TR', turkije: 'TR', turkey: 'TR', pools: 'PL', poolse: 'PL', polish: 'PL', polen: 'PL', poland: 'PL',
    arabisch: 'AR', arabische: 'AR', arabic: 'AR', russisch: 'RU', russische: 'RU', russian: 'RU', zweeds: 'SV', swedish: 'SV', noors: 'NO', norwegian: 'NO',
    deens: 'DA', danish: 'DA', fins: 'FI', finnish: 'FI', grieks: 'EL', greek: 'EL', roemeens: 'RO', romanian: 'RO', hongaars: 'HU', hungarian: 'HU',
    tsjechisch: 'CS', czech: 'CS', koreaans: 'KO', korean: 'KO', japans: 'JA', japanese: 'JA', chinees: 'ZH', chinese: 'ZH', thai: 'TH', thais: 'TH',
    perzisch: 'FA', persian: 'FA', farsi: 'FA', hebreeuws: 'HE', hebrew: 'HE', albanees: 'SQ', albanian: 'SQ', bulgaars: 'BG', bulgarian: 'BG',
    kroatisch: 'HR', croatian: 'HR', servisch: 'SR', serbian: 'SR', oekraiens: 'UK', ukrainian: 'UK', hindi: 'HI', tamil: 'TA', latino: 'ES',
    engeland: 'EN', england: 'EN', amerika: 'EN', america: 'EN', american: 'EN', amerikaans: 'EN', amerikaanse: 'EN', british: 'EN', brits: 'EN', britse: 'EN'
  };
  // chip: drieletter- en landcode → taal (alleen de gangbare; de rest blijft de code zelf)
  var T_CHIP = { NLD: 'NL', DUT: 'NL', VL: 'NL', ENG: 'EN', UK: 'EN', GB: 'EN', US: 'EN', USA: 'EN', GBR: 'EN', GER: 'DE', DEU: 'DE', FRA: 'FR', FRE: 'FR',
    SPA: 'ES', ESP: 'ES', LAT: 'ES', LATAM: 'ES', ITA: 'IT', POR: 'PT', BR: 'PT', POL: 'PL', TUR: 'TR', ARA: 'AR', RUS: 'RU', SWE: 'SV', SE: 'SV', DK: 'DA',
    JP: 'JA', KR: 'KO', CN: 'ZH', GR: 'EL', BEL: 'BE', EXYU: 'EX-YU' };
  // build 153: alle pipe-achtige tekens (┃ ｜ ‖ ∣ 丨 ┆ ╎ ︱ ⏐ ▏ ǀ …) worden eerst één "|" (één lijst, B.pipes)
  var T_PIPES = '|¦│┃｜‖∣丨┆┇┊┋╎╏︱︳⏐⎮▏▕ǀ׀⼁❘❙❚║╽╿⎸⎹';
  var T_PIPE_RE = new RegExp('[' + T_PIPES + ']', 'g'), T_PIPE_ANY = new RegExp('[' + T_PIPES + ']');
  function pipes(s) { return T_PIPE_ANY.test(s) ? s.replace(T_PIPE_RE, '|') : s; }
  B.pipes = pipes;
  // build 153: een stuk tussen twee pipes voorin of achterin ("|NL|", "| MULTI / LINGO |", "|4K|") weg, wat er ook tussen
  // staat (≤ 25 tekens), herhaald en ook zonder spaties
  var T_BLOCK_FRONT = /^\s*\|([^|]{0,25})\|\s*/, T_BLOCK_BACK = /\s*\|([^|]{0,25})\|\s*$/;
  var T_SEPS = '|:\\-–—/•·★»«';
  var T_LEAD = new RegExp('^[\\s,' + T_SEPS + ']+'), T_TRAIL = new RegExp('[\\s,' + T_SEPS + ']+$');
  var T_BR_FRONT = /^[\[({]\s*([^\[\](){}]*?)\s*[\])}]/, T_BR_BACK = /[\[({]\s*([^\[\](){}]*?)\s*[\])}]\s*$/;
  var T_SEG_FRONT = new RegExp('^([^' + T_SEPS + '\\[\\](){}]+?)(\\s*)([' + T_SEPS + ']+)(\\s*)');
  var T_SEG_BACK = new RegExp('(\\s*)([' + T_SEPS + ']+)(\\s*)([^' + T_SEPS + '\\[\\](){}]+?)\\s*$');
  var T_TIGHT = /^[\-–\/]+$/;
  var T_ANY = new RegExp('[' + T_SEPS + '\\[\\](){}]');
  function tagWord(w) {
    var u = B.fold(w).toUpperCase().replace(/\./g, '');
    if (!u) return null;
    if (u === 'TV') return null; // Tuvalu, maar in een categorie bijna altijd "tv"
    if (T_ISO[u]) return { k: 'lang', c: T_CHIP[u] || (u.length === 2 ? u : null) };
    if (B.has(T_NAMES, u.toLowerCase())) return { k: 'lang', c: T_NAMES[u.toLowerCase()] };
    if (T_MULTI[u]) return { k: 'multi', c: 'Multi' };
    if (T_MEDIA[u]) return { k: 'media' };
    if (T_QUAL[u]) return { k: 'qual' };
    return null;
  }
  /** Alle woorden van een stuk tekst zijn aanduidingen? Dan [{k, c}], anders null. title = films/series-woorden niet. */
  function tagWords(seg, noMedia) {
    var ws = String(seg).split(/[\s\-–\/,+&]+/).filter(Boolean), out = [];
    if (!ws.length) return out;
    for (var i = 0; i < ws.length; i++) {
      var t = tagWord(ws[i]);
      if (!t || (noMedia && t.k === 'media')) return null;
      out.push(t);
    }
    return out;
  }
  function isMedia(t) { return t && t.k === 'media'; }
  /** build 153: blijft er alleen een mediawoord over ("FILMS")? Dan niets meer weghalen. */
  function onlyMedia(str) { var w = tagWords(String(str).replace(T_LEAD, '').replace(T_TRAIL, ''), false); return !!(w && w.length && w.some(isMedia)); }
  function hasName(s) { return /[0-9A-Za-zÀ-￿]/.test(s); }
  function isUpperWord(w) { return /^[A-Z0-9][A-Z0-9\-]*$/.test(w); }
  /**
   * Aanduidingen voor- en achteraan weg. mode 'cat' (categorieën) of 'title' (titels en zoeken: alleen met scheidingsteken of
   * tussen haakjes, plus kwaliteit achteraan; geen losse woorden als "US Marshals" of "The Italian").
   * Geeft {name, tags: [{k, c}]}.
   */
  function stripTags(raw, mode) {
    var s = pipes(String(raw == null ? '' : raw)).replace(/\s+/g, ' ').replace(/\bEX-YU\b/gi, 'EXYU').trim(), tags = [], cat = mode !== 'title', m, t, rest, guard;
    var orig = s;
    // build 153: eerst de stukken tussen twee pipes voorin en achterin; blijft er niets over, dan de oude opschoning
    var blk = s, btags = [];
    for (guard = 0; guard < 12 && (m = T_BLOCK_FRONT.exec(blk)); guard++) { blk = blk.slice(m[0].length); btags = btags.concat(tagWords(m[1], false) || []); }
    for (guard = 0; guard < 12 && (m = T_BLOCK_BACK.exec(blk)); guard++) { blk = blk.slice(0, m.index); btags = btags.concat(tagWords(m[1], false) || []); }
    if (blk !== s && hasName(blk.replace(T_LEAD, '').replace(T_TRAIL, ''))) { s = blk.trim(); tags = btags.filter(function (x) { return x.k !== 'media'; }); }
    for (guard = 0; guard < 12; guard++) {
      rest = s.replace(T_LEAD, '');
      if (rest !== s) { if (!hasName(rest)) break; s = rest; }
      if ((m = T_BR_FRONT.exec(s))) {
        rest = s.slice(m[0].length);
        t = m[1] ? tagWords(m[1], !cat) : [];
        if (t && hasName(rest)) { tags = tags.concat(t); s = rest; continue; }
        break;
      }
      if ((m = T_SEG_FRONT.exec(s))) {
        rest = s.slice(m[0].length);
        t = tagWords(m[1], !cat);
        // "AL-JAZEERA", "UK-Drama": een streepje zonder spaties telt alleen tussen twee aanduidingen ("MULTI-LINGO")
        if (t && !m[2] && !m[4] && T_TIGHT.test(m[3])) { var nx = rest.split(/[\s\-–\/|:•·★»«]/)[0]; if (!nx || !tagWord(nx)) t = null; }
        // build 153: "Film | 2024", "FILMS | NL": een mediawoord voorin alleen weg als er daarna een echte naam staat
        if (t && t.some(isMedia) && (!/[A-Za-zÀ-￿]/.test(rest) || tagWords(rest.replace(T_TRAIL, ''), false))) t = null;
        if (t && hasName(rest)) { tags = tags.concat(t); s = rest; continue; }
      }
      if (cat) {
        var sp = s.indexOf(' ');
        if (sp > 0) {
          var w0 = s.slice(0, sp);
          var r0 = s.slice(sp + 1);
          if (T_MEDIA[w0] && (!/[A-Za-zÀ-￿]/.test(r0) || tagWords(r0.replace(T_LEAD, '').replace(T_TRAIL, ''), false))) break;
          if (isUpperWord(w0) && (T_BARE[w0] || T_MEDIA[w0] || T_QUAL[w0]) && hasName(r0)) { tags.push(tagWord(w0)); s = s.slice(sp + 1); continue; }
        }
      }
      break;
    }
    for (guard = 0; guard < 12; guard++) {
      rest = s.replace(T_TRAIL, '');
      if (rest !== s) { if (!hasName(rest)) break; s = rest; }
      if ((m = T_BR_BACK.exec(s))) {
        rest = s.slice(0, m.index);
        t = m[1] ? tagWords(m[1], true) : [];
        if (t && hasName(rest)) { tags = tags.concat(t); s = rest.trim(); continue; }
        break;
      }
      if ((m = T_SEG_BACK.exec(s))) {
        rest = s.slice(0, m.index);
        t = tagWords(m[4], true);
        if (t && !m[1] && !m[3] && T_TIGHT.test(m[2])) { var pw = rest.split(/[\s\-–\/|:•·★»«]/).pop(); if (!pw || !tagWord(pw)) t = null; }
        // build 153: "FILMS | NL" blijft (er blijft dan alleen een mediawoord over)
        if (t && onlyMedia(rest)) t = null;
        if (t && hasName(rest)) { tags = tags.concat(t); s = rest.trim(); continue; }
      }
      var ls = s.lastIndexOf(' ');
      if (ls > 0) {
        var wl = s.slice(ls + 1), before = s.slice(0, ls), uw = wl.toUpperCase();
        var ok = T_QUAL_ANY[uw] || (cat && ((isUpperWord(wl) && (T_BARE[wl] || T_QUAL[wl])) || B.has(T_NAMES, B.fold(wl))));
        if (ok && onlyMedia(before)) ok = false;
        if (ok && hasName(before)) { tags.push(tagWord(wl) || { k: 'qual' }); s = before; continue; }
      }
      break;
    }
    s = s.replace(T_LEAD, '').replace(T_TRAIL, '').replace(/\s{2,}/g, ' ').trim();
    if (!hasName(s)) return { name: orig, tags: [] };
    return { name: s, tags: tags };
  }
  // nette hoofdletters voor een naam die HELEMAAL in hoofdletters staat ("NETFLIX" → "Netflix"); merken en afkortingen blijven
  var CASE_KEEP = tagSet('BBC NPO RTL SBS VTM GO HBO ESPN TV CNN MTV NOS KRO NCRV AVRO VPRO EO BNN VARA NTR TROS DAZN NBA NFL NHL MLB UFC WWE ' +
    'UEFA FIFA KPN XXL VIP USA UK NL BE EU DC FX AMC TNT TLC ABC CBS NBC FOX HGTV ID BET UHD HDR HD FHD SD ZDF ARD ORF SRF RAI RTP TVE BVN ' +
    'TMF JIM CN ITV RTBF VRT NHK KBS SBS TRT ATV RTS HRT MBC LBC CNBC BNR NPO3 IPTV PPV VOD DTM WRC PGA ATP WTA NOS VRT AVA OTT DJ MMA');
  var CASE_BRAND = { SKYSHOWTIME: 'SkyShowtime', YOUTUBE: 'YouTube', MOTOGP: 'MotoGP', ESPORTS: 'eSports', IMAX: 'IMAX', VIAPLAY: 'Viaplay',
    STREAMZ: 'Streamz', GOPLAY: 'GoPlay', NLZIET: 'NLZIET', 'DISNEY+': 'Disney+', 'TV+': 'TV+', 'APPLETV+': 'AppleTV+', MCDONALDS: 'McDonalds' };
  var CASE_SMALL = tagSet('and of the de het een van en in op met voor a an or at to for');
  function niceCase(s) {
    if (!/[A-Z]/.test(s) || /[a-z]/.test(s) || /[à-ÿ]/.test(s)) return s; // al gemengd (of kleine letters): laten zoals het is
    var i = 0;
    return s.split(' ').map(function (w) {
      var first = i++ === 0;
      if (!w) return w;
      if (B.has(CASE_BRAND, w)) return CASE_BRAND[w];
      var core = w.replace(/[^A-Za-z0-9À-Þ&]/g, '');
      if (/\d/.test(w) || CASE_KEEP[core] || /&/.test(core)) return w;
      if (!first && CASE_SMALL[w.toLowerCase()]) return w.toLowerCase();
      // "SCI-FI" → "Sci-Fi", "O'NEIL" → "O'Neil"
      return w.toLowerCase().replace(/(^|[\-'’\/.])([a-zà-þ])/g, function (x, p, c) { return p + c.toUpperCase(); });
    }).join(' ');
  }
  B.niceCase = niceCase;
  var catMemo = Object.create(null), catMemoN = 0;
  /** Categorienaam opgeschoond: {name, tags: ['NL', 'Multi']} (tags = taal/land als chip). Gecachet per naam. */
  B.catClean = function (raw) {
    var k = String(raw == null ? '' : raw);
    var hit = catMemo[k];
    if (hit) return hit;
    var r = stripTags(k, 'cat'), chips = [];
    r.tags.forEach(function (t) { if (t && t.c && chips.indexOf(t.c) < 0) chips.push(t.c); });
    hit = { name: niceCase(r.name), tags: chips };
    if (++catMemoN > 20000) { catMemo = Object.create(null); catMemoN = 0; }
    catMemo[k] = hit;
    return hit;
  };
  /** Alleen de opgeschoonde naam. */
  B.catName = function (raw) { return B.catClean(raw).name; };
  /** Titels en zoeken: aanduidingen met scheidingsteken of tussen haakjes weg (geen hoofdletters veranderen). */
  B.stripTags = function (raw) {
    var s = String(raw == null ? '' : raw);
    if (!T_ANY.test(s) && !T_PIPE_ANY.test(s) && !/\b(?:4k|8k|uhd|fhd|hd|hevc|hdr10?|1080p|720p|2160p)\s*$/i.test(s)) return s;
    return stripTags(s, 'title').name;
  };
  B._stripTags = stripTags;
  /** build 153: elke getoonde naam van de server (titels, afleveringen, gids, speler, documenttitel): aanduidingen weg.
   *  Alleen voor weergave; sleutels en id's blijven op de ruwe naam. */
  B.showName = function (n) { return n == null ? '' : B.stripTags(String(n)); };
  var chanMemo = Object.create(null), chanMemoN = 0;
  /** build 153: getoonde zendernaam (Live TV, rij Zenders, gids, nu afspelen, favorieten, zoeken): "┃NL┃ NPO 1 HD" → "NPO 1".
   *  Alleen voor weergave; de zender zelf (naam, id, stream) blijft ruw, zodat afspelen en matchen niet veranderen. */
  B.chanName = function (n) {
    var s = String(n == null ? '' : n);
    var hit = chanMemo[s];
    if (hit != null) return hit;
    var c = B.clang && B.clang.strip ? B.clang.strip(pipes(s)) : s;
    c = B.stripTags(c);
    hit = (c && c.trim()) || s.trim();
    if (++chanMemoN > 20000) { chanMemo = Object.create(null); chanMemoN = 0; }
    chanMemo[s] = hit;
    return hit;
  };

  // MARK: titels opschonen (= TitleCleaner.kt)

  // build 154 (contract "Titelopschoning"): een voorvoegsel met ":" of "-" ("NL: ", "4K - ") gaat alleen weg als het een
  // taal- of landcode, kwaliteitswoord of bekend IPTV-woord is (tagWord, de lijsten van build 150): "NCIS: Hawaii",
  // "FBI: Most Wanted" en "BBC - Planet Earth" blijven heel. Een jaartal gaat alleen weg tussen haakjes/blokhaken of
  // achteraan na "-"/"|", tussen 1900 en volgend jaar ("Blade Runner 2049" en "1917" blijven). Kwaliteitswoorden
  // alleen achteraan ("Sub Zero" blijft); technische woorden (1080p, x265, …) en stukken tussen haakjes overal.
  var tcPrefix = /^\s*(\|[^|]{1,12}\||\[[^\]]{1,12}\])/;
  var tcPrefixWord = /^\s*([A-Za-z0-9]{2,6})\s*[\-:|]\s+/;
  var tcEpisode = /[Ss](\d{1,2})\s*[Ee](\d{1,3})/;
  var tcYearBr = /[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]/g;
  var tcYearSep = /\s*[\-–|]\s*((?:19|20)\d{2})\s*$/;
  var tcJunk = /\b(hevc|h\.?26[45]|x26[45]|1080p|720p|2160p)\b|\[[^\]]*\]|\([^\)]*\)/gi;
  var tcJunkEnd = /(^|[\s\-|]+)(4k|8k|uhd|fhd|hd|sd|multi|subs?|nl ?sub|vost\w*|dolby|atmos|hdr10?\+?|dv)\s*$/i;
  function yearOk(y) { return y >= 1900 && y <= new Date().getFullYear() + 1; }
  B.parseTitle = function (raw) {
    var s = String(raw || ''), m, r;
    for (r = 0; r < 2; r++) {
      var before = s;
      s = s.replace(tcPrefix, '');
      if ((m = tcPrefixWord.exec(s)) && tagWord(m[1]) && /[0-9A-Za-zÀ-￿]/.test(s.slice(m[0].length))) s = s.slice(m[0].length);
      if (s === before) break;
    }
    // build 150: zelfde opschoning als categorieën ("| MULTI / LINGO | Titel", "Titel (NL)")
    s = B.stripTags(s);
    var season = null, ep = null;
    m = tcEpisode.exec(s);
    if (m) { season = parseInt(m[1], 10); ep = parseInt(m[2], 10); s = s.substring(0, m.index); }
    var y = null, last = null, mm;
    tcYearBr.lastIndex = 0;
    while ((mm = tcYearBr.exec(s)) !== null) { if (yearOk(parseInt(mm[1], 10))) last = mm; }
    if (!last && (mm = tcYearSep.exec(s)) && yearOk(parseInt(mm[1], 10)) && /[0-9A-Za-zÀ-￿]/.test(s.slice(0, mm.index))) last = mm;
    if (last) { y = parseInt(last[1], 10); s = s.substring(0, last.index) + ' ' + s.substring(last.index + last[0].length); }
    s = s.replace(tcJunk, ' ');
    for (r = 0; r < 6 && (m = tcJunkEnd.exec(s)) && m.index > 0; r++) s = s.slice(0, m.index);
    s = s.replace(/_/g, ' ').replace(/\./g, ' ').split(/[ \t ]+/).filter(function (x) { return x.length > 0; }).join(' ');
    s = s.replace(/^[ \-|:]+|[ \-|:]+$/g, '');
    return { title: s || String(raw || ''), year: y, season: season, episode: ep };
  };
  B._tagWord = tagWord;

  /** Tekst zonder accenten, in kleine letters (zoeken en vergelijken). */
  // build 149: alleen ASCII (de meeste titels) = alleen toLowerCase, zonder normalize (dat liep teken voor teken)
  var NON_ASCII = /[^\x00-\x7f]/;
  B.fold = function (s) {
    s = String(s || '').toLowerCase();
    if (!NON_ASCII.test(s)) return s;
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
