/*
 * Bingr web, build 146: diagnose (contract docs/ACCOUNT.md van iptv-ios-appletv, "Build 146" → "Diagnose-bijlage").
 * - Startdiagnose: mijlpalen met tijd (ms sinds het laden) en geheugen, "vorige start niet klaar" en de laatste fout die
 *   de webspeler niet opving (window.onerror / unhandledrejection, alleen uit /web/js/), met een opgeschoonde stack.
 * - App-diagnose (op verzoek): servers (aantal, soort, laatst bijgewerkt per server zonder naam of adres), laatste
 *   account-sync, netwerkcheck (device-auth ping en de eigen server), opslag, geheugen, profielen en de stand van
 *   "Servers laden bij openen".
 * - Altijd: apparaattype, model, systeem en versie, app-versie en build, taal. In de Windows-app: platform "windows",
 *   type desktop, model "Windows-pc", Windows 10/11 via userAgentData.
 * Nooit: URL's, servernamen, gebruikersnamen, e-mailadressen, titels. De server schoont het ook nog op.
 * Wordt direct na core.js geladen (zo vroeg mogelijk, voor de fouten van de rest).
 */
(function () {
  'use strict';
  var B = window.B;
  var G = B.diag = {};
  var L = function () { return B.L.apply(null, arguments); };
  var T0 = Date.now();

  function now() { try { return Math.round(performance.now()); } catch (e) { return Date.now() - T0; } }
  function heapMB() {
    try { var m = performance.memory; return m && m.usedJSHeapSize ? Math.round(m.usedJSHeapSize / 1048576) : null; } catch (e) { return null; }
  }

  // MARK: opschonen (nooit een adres, e-mailadres of IP-adres; eigen scripts als bestandsnaam)

  G.scrub = function (s, n) {
    s = String(s == null ? '' : s);
    s = s.replace(/(?:https?|blob|file|chrome-extension|moz-extension):\/\/[^\s)'"]+/gi, function (u) {
      var m = /\/web\/js\/(?:lib\/)?([A-Za-z0-9_.-]+\.js)(?:\?[^:)\s]*)?((?::\d+){0,2})/.exec(u);
      return m ? m[1] + (m[2] || '') : '[url]';
    });
    s = s.replace(/\bwww\.[^\s)]+/gi, '[url]')
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[e-mail]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
      .replace(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/gi, '[mac]')
      .replace(/([?&](?:username|password|token|key|mac)=)[^&\s]*/gi, '$1…')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return n ? s.slice(0, n) : s;
  };

  // MARK: startdiagnose

  var prev = B.store.get('diag.boot', null);
  G.previous = prev && typeof prev === 'object' ? prev : null;
  G.prevIncomplete = !!(G.previous && G.previous.done === false);
  var boot = { at: new Date(T0).toISOString(), build: null, done: false, ms: [] };
  function saveBoot() { boot.build = B.int(B.config.build) || null; B.store.set('diag.boot', boot); }
  /** Mijlpaal: name = ^[a-z][a-z0-9_.-]{0,39}$, ok optioneel. Eén keer per naam. */
  G.mark = function (name, ok) {
    if (!/^[a-z][a-z0-9_.-]{0,39}$/.test(name) || boot.ms.length >= 40) return;
    for (var i = 0; i < boot.ms.length; i++) if (boot.ms[i].name === name) return;
    var e = { name: name, ms: Math.min(600000, now()) };
    if (ok === true || ok === false) e.ok = ok;
    var mb = heapMB();
    if (mb != null) e.mb = mb;
    boot.ms.push(e);
    saveBoot();
  };
  /** Start is klaar ("Wie kijkt er?" of het hoofdscherm staat er). */
  G.ready = function () { if (!boot.done) { boot.done = true; saveBoot(); } };
  G.milestones = function () { return boot.ms.slice(); };
  saveBoot();
  G.mark('start');
  if (document.readyState !== 'loading') G.mark('dom'); else document.addEventListener('DOMContentLoaded', function () { G.mark('dom'); });
  B.on('library', function () { G.mark('library'); });
  B.on('epg', function () { G.mark('epg'); });
  B.on('playerOpened', function () { G.mark('player'); });

  // MARK: fouten die niemand opving (alleen van de webspeler zelf)

  function ours(stack, file) {
    return /\/web\/js\//.test(String(file || '')) || /\/web\/js\//.test(String(stack || ''));
  }
  function frames(stack) {
    return String(stack || '').split('\n').map(function (l) { return G.scrub(l, 200); }).filter(function (l) { return l && l !== '[url]'; }).slice(0, 50);
  }
  function record(type, reason, stack) {
    var c = { at: new Date().toISOString(), type: G.scrub(type || 'Error', 80), reason: G.scrub(reason || '', 300), stack: frames(stack), build: B.int(B.config.build) || null };
    B.store.set('diag.crash', c);
    G.mark('crash', false);
  }
  window.addEventListener('error', function (e) {
    try {
      if (!e || !e.message || /^Script error\.?$/i.test(e.message) || /ResizeObserver loop/i.test(e.message)) return;
      var err = e.error;
      if (!ours(err && err.stack, e.filename)) return;
      record(err && err.name, e.message, err && err.stack ? err.stack : (e.filename ? e.filename + ':' + e.lineno + ':' + e.colno : ''));
    } catch (x) { /* stil */ }
  });
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var r = e && e.reason;
      if (!r || !r.stack || !ours(r.stack)) return;
      record(r.name || 'UnhandledRejection', r.message || String(r), r.stack);
    } catch (x) { /* stil */ }
  });
  G.crash = function () { var c = B.store.get('diag.crash', null); return c && c.at ? c : null; };
  /** Crash die nog niet als startdiagnose is aangeboden of verstuurd (Support-tab). */
  G.crashToOffer = function () {
    var c = G.crash();
    if (!c) return null;
    return B.store.get('diag.crashSeen', '') === c.at ? null : c;
  };
  G.crashOffered = function () { var c = G.crash(); if (c) B.store.set('diag.crashSeen', c.at); };

  // MARK: apparaat

  function uaBrowser() {
    var ua = navigator.userAgent || '', m;
    if ((m = /Edg(?:e|A|iOS)?\/(\d+)/.exec(ua))) return (B.isWindowsApp ? 'WebView2 ' : 'Edge ') + m[1];
    if ((m = /OPR\/(\d+)/.exec(ua))) return 'Opera ' + m[1];
    if ((m = /SamsungBrowser\/(\d+)/.exec(ua))) return 'Samsung Internet ' + m[1];
    if ((m = /(?:Firefox|FxiOS)\/(\d+)/.exec(ua))) return 'Firefox ' + m[1];
    if ((m = /(?:Chrome|CriOS)\/(\d+)/.exec(ua))) return 'Chrome ' + m[1];
    if ((m = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua))) return 'Safari ' + m[1];
    return 'Browser';
  }
  var hev = null;
  function loadHE() {
    var A = B.account;
    var p = A && A.loadOsInfo ? A.loadOsInfo() : Promise.resolve(null);
    return p.then(function (v) { hev = v || null; return v; }, function () { return null; });
  }
  /** Systeem en versie: {os, osVersion}. */
  function osInfo() {
    var ua = navigator.userAgent || '', m;
    var pv = hev && hev.platformVersion ? String(hev.platformVersion) : '';
    var iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
    if (/iPad/.test(ua) || iPadOS) { m = /OS (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua); return { os: 'iPadOS', osVersion: m ? m[1].replace(/_/g, '.') : (/Version\/(\d+(?:\.\d+)?)/.exec(ua) || [])[1] || '' }; }
    if (/iPhone|iPod/.test(ua)) { m = /OS (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua); return { os: 'iOS', osVersion: m ? m[1].replace(/_/g, '.') : '' }; }
    if (/Android/.test(ua)) { m = /Android (\d+(?:\.\d+)*)/.exec(ua); return { os: 'Android', osVersion: pv || (m ? m[1] : '') }; }
    if (/CrOS/.test(ua)) return { os: 'ChromeOS', osVersion: pv };
    if (/Windows/.test(ua)) {
      var w = B.account && B.account.windowsVersion ? B.account.windowsVersion() : null;
      return { os: 'Windows', osVersion: w || (/Windows NT 10\.0/.test(ua) ? '10/11' : ((/Windows NT (\d+\.\d+)/.exec(ua) || [])[1] || '')) };
    }
    if (/Macintosh|Mac OS X/.test(ua)) { m = /Mac OS X (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua); return { os: 'macOS', osVersion: pv || (m ? m[1].replace(/_/g, '.') : '') }; }
    if (/Linux/.test(ua)) return { os: 'Linux', osVersion: '' };
    return { os: '', osVersion: '' };
  }
  /** Apparaat zoals in de bijlage (device.*) plus wat alleen in beeld staat (modelLabel). */
  G.device = function () {
    var o = osInfo(), dpr = window.devicePixelRatio || 1;
    var d = {
      type: B.isWindowsApp ? 'desktop' : 'browser',
      os: o.os || undefined, osVersion: o.osVersion || undefined,
      language: navigator.language || B.lang,
      browser: uaBrowser(),
      screen: Math.round((screen.width || 0) * dpr) + 'x' + Math.round((screen.height || 0) * dpr)
    };
    if (B.isWindowsApp) { d.model = 'Windows-pc'; d.manufacturer = undefined; }
    return d;
  };
  G.app = function () {
    var a = { platform: B.isWindowsApp ? 'windows' : 'web', version: B.config.version, build: B.int(B.config.build) || undefined };
    try { if (B.player && B.player.engineName) a.engine = B.player.engineName(); } catch (e) { /* stil */ }
    if (!a.engine) a.engine = window.Hls ? 'hls.js' : 'html5';
    return a;
  };
  G.memory = function () {
    var out = {};
    try {
      var m = performance.memory;
      if (m && m.usedJSHeapSize) { out.appMB = Math.round(m.usedJSHeapSize / 1048576); out.usedMB = Math.round(m.totalJSHeapSize / 1048576); }
    } catch (e) { /* stil */ }
    if (navigator.deviceMemory) out.totalMB = Math.round(navigator.deviceMemory * 1024);
    return out;
  };
  /** Regels "Bij elke diagnose zichtbaar": [[label, waarde]]. */
  G.deviceRows = function () {
    var d = G.device(), a = G.app();
    var types = { desktop: L('Desktop'), browser: L('Browser') };
    return [
      [L('Device type'), types[d.type] || d.type],
      [L('Model'), B.isWindowsApp ? L('Windows PC') : d.browser],
      [L('System'), [d.os, d.osVersion].filter(Boolean).join(' ') || '—'],
      [L('App version'), 'Bingr ' + a.version + (a.build ? ' (build ' + a.build + ')' : '') + (B.isWindowsApp ? ' · Windows' : '')],
      [L('Language'), d.language + ' · ' + B.lang]
    ];
  };

  // MARK: app-diagnose

  function timed(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })]); }
  function grade(okMs, slowMs, t) { return t <= okMs ? 'ok' : (t <= slowMs ? 'slow' : 'fail'); }
  G.pingBackend = function () {
    var t0 = Date.now();
    return timed(fetch(B.config.supabaseUrl + '/functions/v1/device-auth', {
      method: 'POST', headers: { 'apikey': B.config.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ping' }), cache: 'no-store'
    }), 10000).then(function (r) {
      var ms = Date.now() - t0;
      return { check: r.ok ? (ms > 1500 ? 'slow' : 'ok') : 'fail', ms: ms };
    }, function () { return { check: 'fail', ms: Date.now() - t0 }; });
  };
  /** Bereikbaarheid van de eigen (actieve) server: alleen de hoofdpagina van de host, niets loggen of meesturen. */
  G.pingProvider = function () {
    var src = B.lib && B.lib.source;
    var u = src && (src.serverURL || src.m3uURL || '');
    var origin = null;
    try { var x = new URL(String(u)); if (x.protocol === 'https:') origin = x.origin + '/'; } catch (e) { origin = null; }
    if (!origin) return Promise.resolve({ check: 'skipped' });
    var t0 = Date.now();
    return timed(fetch(origin, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }), 10000).then(function () {
      var ms = Date.now() - t0; return { check: grade(1500, 6000, ms), ms: ms };
    }, function () { return { check: 'fail', ms: Date.now() - t0 }; });
  };
  function netType() {
    var c = navigator.connection;
    var t = c && c.type;
    if (!navigator.onLine) return 'none';
    if (t === 'wifi' || t === 'ethernet' || t === 'cellular' || t === 'none') return t;
    return t ? 'other' : 'unknown';
  }
  function storage() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve({});
    return navigator.storage.estimate().then(function (e) {
      var used = (e.usage || 0) / 1048576, quota = (e.quota || 0) / 1048576;
      var o = { usedMB: Math.round(used), dbMB: Math.round(e.usageDetails && e.usageDetails.indexedDB ? e.usageDetails.indexedDB / 1048576 : used) };
      if (e.usageDetails && e.usageDetails.caches != null) o.cacheMB = Math.round(e.usageDetails.caches / 1048576); else o.cacheMB = o.dbMB;
      if (quota) o.freeMB = Math.round(Math.max(0, quota - used));
      return o;
    }, function () { return {}; });
  }
  /** Per server (zonder naam of adres) wanneer de lijst in deze browser is bijgewerkt: [{n, kind, at, active}]. */
  function serverUpdates() {
    var D = B.data, Lib = B.lib;
    var list = (D && D.sources) || [];
    return Promise.all(list.map(function (s, i) {
      return B.idb.get('lib:' + s.id).then(function (c) {
        return { n: i + 1, kind: s.kind || '', at: c && c.at ? c.at : null, active: !!(Lib && Lib.source && String(Lib.source.id).toLowerCase() === String(s.id).toLowerCase()) };
      }, function () { return { n: i + 1, kind: s.kind || '', at: null }; });
    }));
  }
  /**
   * Diagnose maken. kind = 'app' (alles, met netwerkcheck) of 'start' (startdiagnose). Geeft {payload, extra}: payload =
   * de bijlage volgens schema 1; extra = wat alleen in beeld staat (per server bijgewerkt, Servers laden bij openen).
   */
  G.collect = function (kind) {
    kind = kind === 'start' ? 'start' : 'app';
    var D = B.data, Lib = B.lib, A = B.account;
    return loadHE().then(function () {
      var jobs = kind === 'app' ? [G.pingBackend(), G.pingProvider(), storage(), serverUpdates()] : [null, null, storage(), serverUpdates()];
      return Promise.all(jobs);
    }).then(function (r) {
      var backend = r[0], provider = r[1], sto = r[2] || {}, ups = r[3] || [];
      var srcs = (D && D.sources) || [];
      var kinds = [];
      srcs.forEach(function (s) { if (s.kind && kinds.indexOf(s.kind) < 0) kinds.push(s.kind); });
      var raw = (Lib && Lib.raw) || {};
      var plan = B.plan && B.plan.isKnown() ? (B.plan.isFree() ? 'free' : 'lifetime') : undefined;
      var ls = D && D.lastSync;
      var state = {
        signedIn: !!(A && A.isSignedIn()), profiles: (D && D.profiles.length) || 0, servers: srcs.length, serverKinds: kinds.slice(0, 10),
        lastSync: ls && ls.at ? ls.at : undefined, lastSyncOk: ls ? !!ls.ok : undefined, plan: plan,
        pushEnabled: !!(B.push && B.push.isOn && B.push.isOn()),
        channels: (raw.channels || []).length, movies: (raw.movies || []).length, series: (raw.series || []).length,
        uptimeS: Math.round((Date.now() - T0) / 1000),
        network: { online: navigator.onLine !== false, type: netType() },
        storage: sto
      };
      if (backend) { state.network.backend = backend.check; if (backend.ms != null) state.network.backendMs = backend.ms; }
      if (provider) { state.network.provider = provider.check; if (provider.ms != null) state.network.providerMs = provider.ms; }
      var payload = {
        schema: 1, kind: kind, createdAt: new Date().toISOString(), app: G.app(), device: G.device(),
        milestones: boot.ms.map(function (m) { var o = { name: m.name, ms: m.ms }; if (m.ok != null) o.ok = m.ok; return o; }),
        memory: G.memory(), state: state
      };
      var c = G.crash();
      if (c) payload.crash = { at: c.at, type: c.type, reason: c.reason, stack: c.stack, build: c.build || undefined };
      payload = JSON.parse(JSON.stringify(payload)); // undefined weg
      var LO = B.xs && B.xs.loadOnOpen;
      return { payload: payload, extra: { servers: ups, loadOnOpen: LO ? LO.mode() : null, prevIncomplete: G.prevIncomplete, previous: G.previous } };
    });
  };
})();
