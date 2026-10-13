/*
 * Bingr in de browser (bingr.online/web): basis (opslag, netwerk, tijd, hashes, titels opschonen, vertalingen).
 * Overgenomen van de Samsung TV-app (tizen/js/core.js) en aangepast voor de browser:
 * - alleen https (een pagina op https mag geen http laden; zie B.http);
 * - IPTV-servers sturen meestal geen CORS-headers: eerst direct, en bij een CORS-/netwerkfout via de
 *   Edge Function `web-proxy` van de backend (alleen GET, alleen hosts uit je eigen servers);
 * - lokale opslag met het voorvoegsel `bingr.web.` (de rest van bingr.online gebruikt `bingr.`).
 */
(function () {
  'use strict';
  var B = window.B = window.B || {};

  // MARK: config (zelfde publieke waarden als de Android-app; geheime sleutels komen van de server)

  var SB = window.BINGR_SUPABASE || {};
  B.config = {
    supabaseUrl: SB.url || 'https://vjewsncmsxmhmhnoxwqx.supabase.co',
    supabaseKey: SB.anonKey || 'sb_publishable_lpIup6Omq5kW2k3oICGZ4g_HPGac5A3',
    platform: 'browser',
    // buildnummer komt uit ../assets/changelog.json (zelfde bron als de rest van de site), zie B.loadBuild
    build: '',
    version: '1.0.0'
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
    var p = new Promise(function (resolve, reject) {
      function step() {
        if (cancelled) { reject(new Error('cancelled')); return; }
        var t0 = Date.now();
        try {
          while (i < list.length) {
            each(list[i], i);
            i++;
            if ((i & 63) === 0 && Date.now() - t0 > budget) break;
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

  // MARK: netwerk (alleen https; direct, en bij een CORS-/netwerkfout via de backend-proxy)

  function NetError(msg, offline) { this.message = msg; this.offline = !!offline; }
  NetError.prototype = Object.create(Error.prototype);
  B.NetError = NetError;

  /** Melding als een server of stream geen https gebruikt (de pagina staat op https, de browser blokkeert http). */
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
  B.proxyURL = function () { return B.config.supabaseUrl + '/functions/v1/web-proxy'; };
  B.needsProxy = function (url) { return !!proxyHosts[hostOf(url)]; };
  B.markProxy = function (url) { rememberProxy(hostOf(url)); };

  /**
   * http(url, {method, headers, body, timeout, binary, noProxy}) → Promise<{status, text, json, buffer}>.
   * http:// → fout met e.insecure (en de https-melding). Netwerkfout of time-out → NetError (offline = true).
   */
  B.http = function (url, opt) {
    opt = opt || {};
    url = String(url || '');
    if (B.isInsecure(url)) return Promise.reject(B.insecureError());
    var method = (opt.method || 'GET').toUpperCase();
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
    return s.replace(/%(@|d|\.?\d*f|lld|ld|s)/g, function (m) {
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
