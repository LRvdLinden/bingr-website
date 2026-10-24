/*
 * Build 147: diagnose-schema 2 (docs/ACCOUNT.md van iptv-ios-appletv, "Build 147"; server: _shared/diagnostics.ts):
 * - Hang-detectie: PerformanceObserver 'longtask' (als de browser dat kent) en een detector voor gaten in een interval
 *   van 500 ms (ook Safari/Firefox). Alleen op de voorgrond (tabblad zichtbaar) telt het als hang. Per hang: duur, taak
 *   (B.task, bv. "catalogus filteren"), mijlpaal en de lopende taken als "stack" (de browser geeft geen stack van de
 *   hoofdthread). Elke 2 s een teken van leven in de opslag; geen pagehide terwijl het tabblad zichtbaar was en er een
 *   taak liep = de vorige start liep vast.
 * - Eerlijke starttijden: app-tijd los van wachten op de gebruiker ("Wie kijkt er?" → profiel gekozen, pincodescherm →
 *   pincode goed); samenvatting good / slow (app-tijd > 5 s of een hang > 2 s) / hung (hang > 10 s of een fout).
 * - Ophalen per server en soort (fetch: ok / empty / failed / hidden), verbinding (navigator.connection: wifi, mobiel,
 *   ethernet, anders onbekend; vanaf het begin gevolgd) en opslag (één totaal = cache + catalogus + downloads, en vrij).
 * - Elke diagnose (ook de app-diagnose) bevat de startdiagnose: deze start en de vorige met zijn probleem.
 *
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
/*
 * Build 148: diagnose-schema 3 (bovenop schema 2):
 * - Mijlpalen en taken zijn codes (snake_case Engels, vaste set; zie CODES); de bijlage bevat alleen codes en getallen,
 *   in beeld staat de vertaling in de app-taal (G.codeLabel). Oude namen uit een bewaarde start worden omgezet (OLD).
 * - start.longestHang: de langste hang van deze start (duur, taak, mijlpaal, voorgrond, stack).
 * - updates: de laatste 5 keer bijwerken van een server: fasen fetch → parse → index → apply → save met duur en geheugen.
 * - fetch[]: delivered / visible / hidden {categories, kids, duplicates, other} per server en soort.
 * - playback.stalls: haperingen tijdens het afspelen (code playback_stall, tijd na het eerste beeld en duur).
 * - app.lang: de app-taal.
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

  // MARK: build 148: codes (mijlpalen en taken) met een tekst per taal

  /** Vaste set (diagnose-schema 3) plus de codes die alleen de webspeler heeft; waarde = Engelse tekst (sleutel voor B.L). */
  var CODES = {
    started: 'Started', storage: 'Storage', account: 'Account', first_frame: 'First frame', intro_done: 'Intro done',
    profile_picker: 'Profile picker', profile_picked: 'Profile chosen', pin_screen: 'PIN screen', pin_ok: 'PIN correct',
    profile: 'Profiles', servers: 'Servers', home: 'Home', catalog: 'Catalogue', ready: 'Ready', fetch: 'Fetching',
    parse: 'Reading in', index: 'Indexing', apply: 'Applying', save: 'Saving', sync_apply: 'Applying sync',
    catalog_filter: 'Filtering catalogue', catalog_sort: 'Sorting catalogue', catalog_meta: 'Catalogue info', pin_migrate: 'Migrating PIN',
    rows_build: 'Building rows', guide_parse: 'Processing TV guide',
    // nieuw in build 148 (webspeler)
    state_sync: 'Account settings', servers_loaded: 'Servers loaded', guide: 'TV guide', player: 'Player', crash: 'Error',
    catalog_load: 'Loading catalogue', category_index: 'Indexing categories', guide_load: 'Loading TV guide', guide_save: 'Saving TV guide',
    pin_check: 'Checking PIN', playback_stall: 'Playback stall'
  };
  /** Namen van build 146/147 (mijlpalen en Nederlandse taaknamen) → code. */
  var OLD = {
    start: 'started', dom: 'first_frame', session: 'account', splash: 'intro_done', profiles_synced: 'profile', sources: 'servers',
    state: 'state_sync', profiles: 'profile_picker', pin_shown: 'pin_screen', main: 'home', library: 'apply', epg: 'guide',
    'catalogus laden': 'catalog_load', 'catalogus verwerken': 'parse', 'catalogus filteren': 'catalog_filter', 'catalogus indexeren': 'index',
    'catalogus bewaren': 'save', 'catalogus sorteren': 'catalog_sort', 'categorieën indexeren': 'category_index', 'gids laden': 'guide_load',
    'gids verwerken': 'guide_parse', 'gids bewaren': 'guide_save', 'rijen opbouwen': 'rows_build', 'sync toepassen': 'sync_apply',
    'pin migreren': 'pin_migrate', 'pin controleren': 'pin_check'
  };
  G.CODES = CODES;
  /** Code (of een oude naam) → code. */
  G.code = function (x) { x = String(x == null ? '' : x); return B.has(CODES, x) ? x : (B.has(OLD, x) ? OLD[x] : x); };
  /** Code → tekst in de app-taal (onbekend: de code zelf). */
  G.codeLabel = function (x) { var c = G.code(x); return B.has(CODES, c) ? L(CODES[c]) : c; };

  // MARK: startdiagnose

  var prev = B.store.get('diag.boot', null);
  G.previous = prev && typeof prev === 'object' ? prev : null;
  G.prevIncomplete = !!(G.previous && G.previous.done === false);
  var boot = { at: new Date(T0).toISOString(), build: null, done: false, ms: [], closed: false, vis: true };
  function saveBoot() { boot.build = B.int(B.config.build) || null; B.store.set('diag.boot', boot); }
  /** Mijlpaal: code (snake_case, build 148), ok optioneel. Eén keer per code. */
  G.mark = function (name, ok) {
    name = G.code(name);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || boot.ms.length >= 40) return;
    for (var i = 0; i < boot.ms.length; i++) if (boot.ms[i].name === name) return;
    var e = { name: name, ms: Math.min(3600000, now()) };
    if (ok === true || ok === false) e.ok = ok;
    var mb = heapMB();
    if (mb != null) e.mb = mb;
    boot.ms.push(e);
    saveBoot();
  };
  /** Start is klaar ("Wie kijkt er?" of het hoofdscherm staat er). */
  G.ready = function () { if (!boot.done) { boot.done = true; boot.readyAt = now(); G.mark('ready'); saveBoot(); } };
  G.milestones = function () { return boot.ms.slice(); };
  saveBoot();
  G.mark('started');
  if (document.readyState !== 'loading') G.mark('first_frame'); else document.addEventListener('DOMContentLoaded', function () { G.mark('first_frame'); });
  B.on('library', function () { G.mark('apply'); });
  B.on('epg', function () { G.mark('guide'); });
  B.on('playerOpened', function () { G.mark('player'); });
  G.boot = boot;
  /** Wachten op de gebruiker: begin (profielkeuze, pincodescherm) en einde (gekozen, pincode goed). */
  // build 147: na elkaar, nooit dubbel geteld (een nieuwe wachttijd sluit de open wachttijd); '*' sluit alles
  G.waitStart = function (what) {
    if (boot.done && boot.ms.some(function (m) { return G.code(m.name) === 'servers_loaded'; })) return; // start al helemaal klaar
    G.waitEnd('*');
    if (!boot.wait) boot.wait = [];
    if (boot.wait.length < 20) boot.wait.push({ k: what, from: now(), to: null });
    saveBoot();
  };
  G.waitEnd = function (what) {
    var w = boot.wait || [], t = now(), any = false;
    for (var i = 0; i < w.length; i++) if (w[i].to == null && (what === '*' || w[i].k === what)) { w[i].to = t; any = true; }
    if (any) saveBoot();
  };

  // MARK: build 147: hang-detectie

  var HANG_MIN = 250;               // vanaf hier vastleggen (na "klaar" mag de hoofdthread nooit langer vastzitten)
  boot.hangs = [];                  // max. 8, langste eerst: {ms, at, task, milestone, afterReady, stack}
  boot.maxHang = 0;
  function visible() { try { return document.visibilityState !== 'hidden'; } catch (e) { return true; } }
  var hiddenAt = visible() ? 0 : now();
  document.addEventListener('visibilitychange', function () { if (!visible()) hiddenAt = now(); });
  function lastMilestone() { return boot.ms.length ? boot.ms[boot.ms.length - 1].name : 'started'; }
  function noteHang(ms, at, how) {
    ms = Math.round(ms); at = Math.round(at);
    if (ms < HANG_MIN) return;
    var names = B.task ? B.task.names() : [];
    var task = names.length ? names[names.length - 1] : (lastTask && lastTask.t > at - 50 ? lastTask.name : '');
    // dezelfde blokkade via longtask én het interval: één keer (de langste)
    for (var i = 0; i < boot.hangs.length; i++) {
      var hh = boot.hangs[i];
      if (at >= hh.at - 50 && at <= hh.at + hh.ms + 50) {
        if (ms > hh.ms) { hh.ms = ms; hh.how = how; }
        if (!hh.task && task) hh.task = task;
        finish();
        return;
      }
    }
    boot.hangs.push({ ms: ms, at: at, task: task, milestone: lastMilestone(), afterReady: boot.readyAt != null && at >= boot.readyAt, how: how, stack: names.slice(-10) });
    finish();
    function finish() {
      boot.hangs.sort(function (a, b) { return b.ms - a.ms; });
      boot.hangs = boot.hangs.slice(0, 8);
      boot.maxHang = boot.hangs.length ? boot.hangs[0].ms : 0;
      saveBoot();
    }
  }
  G.hangs = function () { return boot.hangs.slice(); };
  // laatst afgelopen taak (een longtask wordt pas gemeld als hij voorbij is; dan is de taak vaak al klaar)
  var lastTask = null;
  if (B.task) B.task.onChange = function () { var c = B.task.current(); if (c) lastTask = { name: c, t: now() }; else if (lastTask) lastTask.t = now(); };
  try {
    if (window.PerformanceObserver && (PerformanceObserver.supportedEntryTypes || []).indexOf('longtask') >= 0) {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          // alleen op de voorgrond (de hele taak lang zichtbaar)
          if (!visible() || hiddenAt > e.startTime) return;
          noteHang(e.duration, e.startTime, 'longtask');
        });
      }).observe({ type: 'longtask', buffered: true });
      G.longtasks = true;
    }
  } catch (e) { /* niet beschikbaar */ }
  // gaten in een interval: werkt overal; op de achtergrond remt de browser timers af, dat telt niet
  var TICK = 500, lastTick = now(), lastAliveSave = 0;
  setInterval(function () {
    var t = now(), gap = t - lastTick - TICK;
    var fg = visible() && hiddenAt < lastTick;
    // met longtask (Chrome, Edge, WebView2) telt alleen die: een vol wachtrijtje met korte taken geeft ook een gat in
    // het interval, maar is geen hang. Zonder longtask (Safari, Firefox) is het gat de beste maat.
    if (gap >= HANG_MIN && fg && !G.longtasks) noteHang(gap, lastTick + TICK, 'interval');
    lastTick = t;
    if (t - lastAliveSave >= 2000) {
      lastAliveSave = t;
      boot.alive = t; boot.vis = visible(); boot.cur = B.task ? B.task.names().slice(-5) : [];
      saveBoot();
    }
  }, TICK);
  window.addEventListener('pagehide', function () { boot.closed = true; boot.alive = now(); saveBoot(); });
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) { boot.closed = false; saveBoot(); } });

  // MARK: build 147: verbinding (vanaf het begin gevolgd)

  /** wifi | cellular | ethernet | unknown (wat navigator.connection weet; anders onbekend). */
  function netNow() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var t = c && c.type, et = c && c.effectiveType;
    var type = t === 'wifi' || t === 'ethernet' || t === 'cellular' ? t : (t === 'wimax' ? 'cellular' : 'unknown');
    return { type: type, effectiveType: et || null, online: navigator.onLine !== false, downlink: c && c.downlink != null ? c.downlink : null };
  }
  G.net = netNow;
  boot.net = netNow();
  try {
    var conn = navigator.connection;
    if (conn && conn.addEventListener) conn.addEventListener('change', function () { boot.net = netNow(); saveBoot(); });
  } catch (e) { /* stil */ }
  window.addEventListener('online', function () { boot.net = netNow(); saveBoot(); });
  window.addEventListener('offline', function () { boot.net = netNow(); saveBoot(); });

  // MARK: build 147: starttijden en samenvatting

  /** Wachten op de gebruiker tot `end` ms (alleen afgesloten wachttijden, en de lopende tot nu). */
  function userWait(b, end) {
    var sum = 0;
    (b.wait || []).forEach(function (w) {
      var to = w.to == null ? end : Math.min(w.to, end);
      if (to > w.from) sum += to - w.from;
    });
    return Math.round(sum);
  }
  function msOf(b, name) { for (var i = 0; i < b.ms.length; i++) if (G.code(b.ms[i].name) === name) return b.ms[i].ms; return null; }
  /** Einde van de start: catalogus er (build 147), anders servers geladen, anders het hoofdscherm, anders "Wie kijkt er?". */
  function startEnd(b) {
    var e = msOf(b, 'catalog');
    if (e == null) e = msOf(b, 'servers_loaded');
    if (e == null) e = msOf(b, 'home');
    if (e == null) e = msOf(b, 'profile_picker');
    return e;
  }
  /** {summary, appMs, userWaitMs, maxHangMs} van een start (deze of een bewaarde). */
  G.startSummary = function (b) {
    b = b || boot;
    var end = startEnd(b);
    var wait = userWait(b, end == null ? (b.alive || now()) : end);
    var app = end == null ? null : Math.max(0, Math.round(end - wait));
    var hang = (b.hangs || []).reduce(function (m, x) { return Math.max(m, x.ms || 0); }, 0);
    var crashed = !!b.crashed;
    var summary = crashed || hang > 10000 ? 'hung' : ((app != null && app > 5000) || hang > 2000 ? 'slow' : 'good');
    return { summary: summary, appMs: app == null ? undefined : app, userWaitMs: wait, maxHangMs: hang };
  };
  /**
   * De vorige start: {problem: none|hang|crash|not_finished, milestone, seconds, foreground, task, at, build, stack}.
   * crash = fout in die start; hang = een hang > 2 s, of het tabblad stond zichtbaar met een lopende taak en de pagina
   * sloot niet netjes (vastgelopen en weggeklikt); not_finished = de start kwam niet tot "klaar".
   */
  G.previousStart = function () {
    var pb = G.previous;
    if (!pb || !pb.at) return null;
    var hs = pb.hangs || [], big = hs[0] || null;
    var o = { problem: 'none', milestone: pb.ms && pb.ms.length ? G.code(pb.ms[pb.ms.length - 1].name) : undefined, at: pb.at, build: pb.build || undefined };
    var c = G.crash();
    var crashIn = c && c.at && pb.at && c.at >= pb.at && (!boot.at || c.at < boot.at);
    if (crashIn || pb.crashed) { o.problem = 'crash'; o.foreground = pb.vis !== false; if (c) o.stack = (c.stack || []).slice(0, 30); }
    else if (big && big.ms > 2000) {
      o.problem = 'hang'; o.seconds = Math.round(big.ms / 100) / 10; o.foreground = true; o.task = big.task ? G.code(big.task) : undefined;
      o.milestone = big.milestone ? G.code(big.milestone) : o.milestone; o.stack = (big.stack || []).map(G.code);
    } else if (pb.closed === false && pb.vis !== false && pb.cur && pb.cur.length) {
      o.problem = 'hang'; o.foreground = true; o.task = G.code(pb.cur[pb.cur.length - 1]); o.stack = pb.cur.map(G.code);
      if (pb.alive != null) o.seconds = undefined;
    } else if (pb.done === false) {
      o.problem = 'not_finished'; o.foreground = pb.vis !== false; o.task = pb.cur && pb.cur.length ? G.code(pb.cur[pb.cur.length - 1]) : undefined;
      if (pb.alive != null) o.seconds = Math.round(pb.alive / 100) / 10;
    }
    return JSON.parse(JSON.stringify(o));
  };

  /** build 148: langste hang van deze start: {ms, task, milestone, foreground, stack} (of null). */
  G.longestHang = function () {
    var x = boot.hangs[0];
    if (!x) return null;
    return { ms: x.ms, task: x.task ? G.code(x.task) : '', milestone: G.code(x.milestone || ''), foreground: true, stack: (x.stack || []).map(G.code).slice(0, 30), afterReady: !!x.afterReady };
  };

  // MARK: build 148: haperingen tijdens het afspelen (playback_stall)

  boot.stalls = [];
  /** ms = duur van de hapering, after = ms na het eerste beeld van deze stream, how = hls / ts / native. */
  G.stall = function (ms, after, how) {
    ms = Math.round(ms);
    if (!(ms >= 200)) return;
    var names = B.task ? B.task.names() : [];
    var e = { code: 'playback_stall', at: Math.min(3600000, now() - ms), ms: Math.min(3600000, ms), afterMs: Math.max(0, Math.round(after || 0)) };
    if (names.length) e.task = G.code(names[names.length - 1]);
    if (how) e.engine = String(how).slice(0, 12);
    boot.stalls.push(e);
    if (boot.stalls.length > 20) boot.stalls.shift();
    saveBoot();
  };
  G.stalls = function () { return (boot.stalls || []).slice(); };

  // MARK: build 148: bijwerken per server (fetch → parse → index → apply → save)

  var PHASES = ['fetch', 'parse', 'index', 'apply', 'save'];
  G.updates = function () { var u = B.store.get('diag.updates', []); return Array.isArray(u) ? u.slice(0, 5) : []; };
  /**
   * Begin van het bijwerken van een server: tracker met phase(code) (vorige fase dicht, nieuwe open), close(),
   * time(code, promise) (duur van een fase die naast een andere loopt) en end(ok|failed|cancelled). Server = s1, s2, …
   * op volgorde in het account; nooit een naam of adres.
   */
  G.update = function (src) {
    var list = (B.data && B.data.sources) || [], n = 0;
    for (var i = 0; i < list.length; i++) if (src && String(list[i].id).toLowerCase() === String(src.id).toLowerCase()) { n = i + 1; break; }
    var t0 = now(), ph = {}, cur = { code: 'fetch', from: t0 }, peak = heapMB(), ended = false;
    function rec(code, ms) {
      var mb = heapMB();
      if (mb != null && (peak == null || mb > peak)) peak = mb;
      var o = ph[code] || (ph[code] = { code: code, ms: 0 });
      o.ms += Math.max(0, Math.round(ms));
      if (mb != null) o.memMB = mb;
    }
    var api = {
      phase: function (code) { if (ended) return; if (cur) rec(cur.code, now() - cur.from); cur = code ? { code: code, from: now() } : null; },
      close: function () { api.phase(null); },
      time: function (code, p) {
        var f = now();
        return Promise.resolve(p).then(function (v) { rec(code, now() - f); return v; }, function (e) { rec(code, now() - f); throw e; });
      },
      add: function (code, ms) { rec(code, ms); },
      end: function (result) {
        if (ended) return;
        api.close(); ended = true;
        var u = { server: n ? 's' + n : 's0', at: new Date(Date.now() - (now() - t0)).toISOString(),
          phases: PHASES.filter(function (c) { return ph[c]; }).map(function (c) { return ph[c]; }),
          totalMs: Math.round(now() - t0), result: result === 'failed' || result === 'cancelled' ? result : 'ok' };
        if (peak != null) u.peakMB = peak;
        var all = G.updates();
        all.unshift(u);
        B.store.set('diag.updates', all.slice(0, 5));
      }
    };
    return api;
  };

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
    boot.crashed = true;
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
  // build 147: ook na een vorige start die vastliep (hang > 2 s) de startdiagnose aanbieden
  function toOffer() {
    var seen = B.store.get('diag.crashSeen', '');
    var c = G.crash();
    if (c && seen !== c.at) return c;
    var p = G.previousStart ? G.previousStart() : null;
    if (p && p.problem === 'hang' && p.at && seen !== p.at && B.store.get('diag.hangSeen', '') !== p.at) return { at: p.at, hang: true };
    return null;
  }
  G.crashToOffer = toOffer;
  G.crashOffered = function () {
    var o = toOffer();
    if (!o) return;
    if (o.hang) B.store.set('diag.hangSeen', o.at); else B.store.set('diag.crashSeen', o.at);
  };

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
    var a = { platform: B.isWindowsApp ? 'windows' : 'web', version: B.config.version, build: B.int(B.config.build) || undefined, lang: B.lang };
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
    var n = netNow();
    if (!n.online) return 'none';
    return n.type;
  }
  /**
   * build 147: opslag als één totaal met de delen die samen dat totaal zijn: catalogus (IndexedDB: bibliotheek, gids,
   * covers-index), cache (de rest: service worker, lokale opslag) en downloads (de webspeler downloadt niets: 0), plus wat
   * de browser nog vrij geeft. Zonder usageDetails (Safari, Firefox) telt alles als catalogus.
   * Geeft {v2: {totalMB, cacheMB, catalogMB, downloadsMB, freeMB}, v1: {usedMB, freeMB, cacheMB, dbMB}}.
   */
  function storage() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve({ v2: {}, v1: {} });
    return navigator.storage.estimate().then(function (e) {
      var MB = 1048576, used = e.usage || 0, quota = e.quota || 0, det = e.usageDetails || null;
      var total = Math.round(used / MB);
      var catalog = det && det.indexedDB != null ? Math.min(total, Math.round(det.indexedDB / MB)) : total;
      var downloads = 0, cache = Math.max(0, total - catalog - downloads);
      var v2 = { totalMB: total, cacheMB: cache, catalogMB: catalog, downloadsMB: downloads };
      if (quota) v2.freeMB = Math.round(Math.max(0, quota - used) / MB);
      var v1 = { usedMB: total, dbMB: catalog, cacheMB: cache };
      if (v2.freeMB != null) v1.freeMB = v2.freeMB;
      return { v2: v2, v1: v1, detailed: !!det };
    }, function () { return { v2: {}, v1: {} }; });
  }
  G.storage = storage;
  /**
   * build 147: ophalen per server (s1, s2, … in de volgorde van het account) en soort: ok / empty / failed / hidden.
   * hidden = de server leverde wel, maar na verborgen categorieën, kinderslot of het kinderprofiel blijft er niets over.
   */
  G.fetchRows = function () {
    var D = B.data, Lib = B.lib, X = B.xs, out = [];
    var srcs = (D && D.sources) || [];
    var st = (Lib && Lib.fetchStatus) || {};
    srcs.forEach(function (s, i) {
      var lid = String(s.id).toLowerCase(), rec = st[lid];
      var active = Lib && Lib.source && String(Lib.source.id).toLowerCase() === lid;
      var view = null;
      try { view = active ? Lib.lib : (X && X.catalog && X.catalog(s.id) && X.view ? X.view(s.id) : null); } catch (e) { view = null; }
      var raw = active ? Lib.raw : (X && X.catalog && X.catalog(s.id) ? X.catalog(s.id).raw : null);
      [['live', 'channels'], ['movie', 'movies'], ['series', 'series']].forEach(function (k) {
        var f = rec && rec.kinds && rec.kinds[k[0]];
        var have = raw ? (raw[k[1]] || []).length : null;
        var row = { server: 's' + (i + 1), kind: k[0] };
        if (f) { row.status = f.status; row.count = f.count || 0; if (f.error) row.error = G.scrub(f.error, 60); }
        else if (have != null) { row.status = have ? 'ok' : 'empty'; row.count = have; }
        else return;
        // uit de cache gestart: de aantallen van nu
        if (row.status === 'ok' && have != null && have > 0) row.count = have;
        if (row.status === 'ok' && view && (view[k[1]] || []).length === 0 && row.count > 0) row.status = 'hidden';
        // build 148 (schema 3): geleverd naast zichtbaar, met de reden van het verschil
        var stv = view && view.stats && view.stats[k[0]];
        if (stv) {
          row.delivered = stv.delivered; row.visible = stv.visible;
          var hd = stv.hidden || {};
          row.hidden = { categories: hd.categories || 0, kids: hd.kids || 0, duplicates: hd.duplicates || 0, other: hd.other || 0 };
        } else if (have != null) { row.delivered = have; }
        out.push(row);
      });
    });
    return out.slice(0, 30);
  };
  /** Per server (zonder naam of adres) wanneer de lijst in deze browser is bijgewerkt: [{n, kind, at, active}]. */
  function serverUpdates() {
    var D = B.data, Lib = B.lib;
    var list = (D && D.sources) || [];
    return Promise.all(list.map(function (s, i) {
      return B.idb.getMeta('lib:' + s.id).then(function (c) {
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
      var backend = r[0], provider = r[1], sto2 = r[2] || { v2: {}, v1: {} }, sto = sto2.v1 || {}, ups = r[3] || [];
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
      // build 147 (schema 2): altijd de startdiagnose erbij (deze start en de vorige met zijn probleem)
      var sum = G.startSummary(boot), prevS = G.previousStart();
      var start = { summary: sum.summary, appMs: sum.appMs, userWaitMs: sum.userWaitMs, maxHangMs: sum.maxHangMs };
      if (prevS) start.previous = prevS;
      var lh = G.longestHang();
      if (lh) start.longestHang = { ms: lh.ms, task: lh.task || undefined, milestone: lh.milestone || undefined, foreground: lh.foreground, stack: lh.stack };
      var net2 = { type: state.network.type === 'none' ? 'unknown' : state.network.type, online: state.network.online };
      if (backend) { net2.backend = backend.check; if (backend.ms != null) net2.backendMs = backend.ms; }
      if (provider) { net2.provider = provider.check; if (provider.ms != null) net2.providerMs = provider.ms; }
      var payload = {
        schema: 3, kind: kind, createdAt: new Date().toISOString(), app: G.app(), device: G.device(), start: start,
        // build 148: code (schema 3); name = dezelfde code voor een server die nog schema 2 leest
        milestones: boot.ms.map(function (m) { var c = G.code(m.name), o = { code: c, name: c, ms: m.ms }; if (m.ok != null) o.ok = m.ok; return o; }),
        fetch: G.fetchRows(), updates: G.updates(), network: net2, storage: sto2.v2 || {},
        memory: G.memory(), state: state
      };
      if (boot.stalls && boot.stalls.length) payload.playback = { stalls: boot.stalls.slice(-20) };
      var c = G.crash();
      if (c) payload.crash = { at: c.at, type: c.type, reason: c.reason, stack: c.stack, build: c.build || undefined };
      payload = JSON.parse(JSON.stringify(payload)); // undefined weg
      var LO = B.xs && B.xs.loadOnOpen;
      return { payload: payload, extra: { servers: ups, loadOnOpen: LO ? LO.mode() : null, prevIncomplete: G.prevIncomplete, previous: G.previous,
        hangs: boot.hangs.slice(), effectiveType: netNow().effectiveType, storageDetailed: !!sto2.detailed, longtasks: !!G.longtasks } };
    });
  };
})();
