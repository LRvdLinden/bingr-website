/*
 * Build 171 (versie 1.0.7): pure logica van de webspeler, zonder DOM of netwerk (getest in tools/test/b171_test.js).
 * Dezelfde regels als Shared/Account/Build171.swift (Apple) en Build171Logic.kt (Android):
 * - "Kijk je nog?" (#1): wanneer vragen en hoe lang er op een antwoord gewacht wordt;
 * - zenders verbergen (#15) en titels blokkeren (#20) per profiel: sleutels en filteren;
 * - overzicht van categorieën (#17): land/regio uit het voorvoegsel, filterchips, vastgepinde eerst;
 * - "Te veel apparaten/streams" (#31): volgorde, voorstel om af te melden, "2 uur geleden";
 * - crashrapporten (#37): URL's, IP's, e-mailadressen en tokens eruit, handtekening, ontdubbelen (max. 10 per sessie).
 */
(function () {
  'use strict';
  var B = window.B = window.B || {};
  var X = B.b171 = {};

  // MARK: 1. "Kijk je nog?"

  X.ASK_AFTER_EPISODES = 3;
  X.ANSWER_SECONDS = 60;
  X.HOUR_CHOICES = [2, 3, 4];
  X.DEFAULT_HOURS = 3;
  X.QUIET_MS = 3000;
  X.hours = function (h) { h = Number(h); return X.HOUR_CHOICES.indexOf(h) >= 0 ? h : X.DEFAULT_HOURS; };

  /** Teller per speler. Tijden in ms. */
  X.StillWatching = function (now) {
    this.autoEpisodes = 0;
    this.lastInteraction = now;
    this.quietUntil = 0;
  };
  var SW = X.StillWatching.prototype;
  /** Bediening (toets, klik, tik, volume, zenderwissel): opnieuw beginnen. Vlak na een automatische start telt het niet. */
  SW.interaction = function (now) {
    if (now < this.quietUntil) return;
    this.autoEpisodes = 0;
    this.lastInteraction = now;
  };
  /** Een aflevering startte automatisch of met de knop Volgende aflevering. */
  SW.autoEpisode = function (now) { this.autoEpisodes++; this.quietUntil = now + X.QUIET_MS; };
  /** De app startte zelf iets (geen bediening, geen aflevering). */
  SW.programmatic = function (now) { this.quietUntil = Math.max(this.quietUntil, now + X.QUIET_MS); };
  /** Verder kijken (of opnieuw gestart na Gepauzeerd). */
  SW.answered = function (now) { this.autoEpisodes = 0; this.lastInteraction = now; this.quietUntil = 0; };
  /** Nu vragen? Na 3 automatische afleveringen, of na `hours` uur zonder bediening. */
  SW.shouldAsk = function (now, hours, enabled) {
    if (!enabled || !isFinite(now)) return false;
    if (this.autoEpisodes >= X.ASK_AFTER_EPISODES) return true;
    return now - this.lastInteraction >= X.hours(hours) * 3600000;
  };
  X.secondsLeft = function (askedAt, now) { return Math.max(0, Math.ceil(X.ANSWER_SECONDS - (now - askedAt) / 1000)); };
  X.timedOut = function (askedAt, now) { return !(isFinite(askedAt) && isFinite(now)) || now - askedAt >= X.ANSWER_SECONDS * 1000; };

  // MARK: 15 en 20. Verbergen en blokkeren per profiel

  var lower = function (s) { return String(s == null ? '' : s).toLowerCase(); };
  X.channelKey = function (sid, item) { return lower(sid) + '|' + item; };
  X.titleKey = function (sid, kind, item) { return lower(sid) + '|' + (kind === 'series' ? 'series' : 'movie') + ':' + item; };
  /** {sid (kleine letters), kind: null|'movie'|'series', item} of null. */
  X.parseKey = function (k) {
    k = String(k || '');
    var bar = k.indexOf('|');
    if (bar <= 0 || bar === k.length - 1) return null;
    var rest = k.slice(bar + 1), kind = null;
    if (rest.indexOf('movie:') === 0) { kind = 'movie'; rest = rest.slice(6); } else if (rest.indexOf('series:') === 0) { kind = 'series'; rest = rest.slice(7); }
    if (!rest) return null;
    return { sid: lower(k.slice(0, bar)), kind: kind, item: rest };
  };
  /** Item-id's op deze server: kind = null (zenders), 'movie' of 'series'. Object als set (zonder prototype). */
  X.idsFor = function (keys, sid, kind) {
    var out = Object.create(null), s = lower(sid);
    (keys || []).forEach(function (k) { var p = X.parseKey(k); if (p && p.sid === s && p.kind === (kind || null)) out[p.item] = true; });
    return out;
  };
  X.filterOut = function (list, ids, idOf) {
    if (!ids || !Object.keys(ids).length) return list;
    return (list || []).filter(function (x) { return !ids[idOf ? idOf(x) : x.id]; });
  };

  // MARK: 17. Land of regio uit het voorvoegsel

  var NOT_REGION = { MULTI: 1, SUB: 1, SUBS: 1, DUB: 1, DUBBED: 1, VOSTFR: 1, VO: 1, VF: 1, VOST: 1, ORIG: 1, HD: 1, FHD: 1, UHD: 1, SD: 1, HEVC: 1, VIP: 1, PPV: 1, TV: 1, VOD: 1, NEW: 1, ALL: 1, TOP: 1, LIVE: 1 };
  var ALIAS = { GB: 'UK', ENG: 'UK', NLD: 'NL', HOL: 'NL', BEL: 'BE', DEU: 'DE', GER: 'DE', FRA: 'FR', ESP: 'ES', ITA: 'IT', TUR: 'TR', POL: 'PL', POR: 'PT', USA: 'US' };
  /** Labels vóór de eigenlijke naam: "| NL | Sport", "NL: Sport", "NL - Sport", "[NL] Sport", "NL| Sport", "NL ▎Sport". */
  X.prefixLabels = function (name) {
    var s = String(name || '').trim(), out = [], m, guard = 0;
    var re = /^(?:[|│▎┃\[(]\s*)?([A-Za-z]{2,4}(?:\s*\/\s*[A-Za-z]{2,6})*)\s*(?:[|│▎┃\])]|:|\s[-–]\s|-\s)\s*/;
    while (guard++ < 4 && (m = re.exec(s))) {
      m[1].split('/').forEach(function (l) { out.push(l.trim()); });
      s = s.slice(m[0].length);
    }
    return out;
  };
  /** Eerste label dat een land/regio is (NL, BE, UK, DE, EXYU, …), of null. */
  X.region = function (name) {
    var labels = X.prefixLabels(name);
    for (var i = 0; i < labels.length; i++) {
      var u = labels[i].toUpperCase();
      if (u.length < 2 || u.length > 4 || NOT_REGION[u]) continue;
      return ALIAS[u] || u;
    }
    return null;
  };
  /** Filterchips: regio's op aantal (meeste eerst, dan alfabetisch); alleen bij minstens 2 regio's. Hooguit `limit`. */
  X.chips = function (regions, limit) {
    var count = Object.create(null);
    (regions || []).forEach(function (r) { if (r) count[r] = (count[r] || 0) + 1; });
    var keys = Object.keys(count);
    if (keys.length < 2) return [];
    return keys.sort(function (a, b) { return (count[b] - count[a]) || (a < b ? -1 : a > b ? 1 : 0); }).slice(0, limit || 16);
  };
  /** Vastgepinde eerst (volgorde blijft), dan de rest. */
  X.pinnedFirst = function (items, isPinned) {
    var a = [], b = [];
    (items || []).forEach(function (x) { (isPinned(x) ? a : b).push(x); });
    return a.concat(b);
  };

  // MARK: 31. Apparaten en streams

  /** Langst niet gebruikt bovenaan, dit apparaat onderaan (stabiel). Velden: lastUsed (ms of null), current. */
  X.sortDevices = function (list) {
    return (list || []).map(function (d, i) { return { d: d, i: i }; }).sort(function (a, b) {
      if (!!a.d.current !== !!b.d.current) return a.d.current ? 1 : -1;
      var x = a.d.lastUsed == null ? -Infinity : a.d.lastUsed, y = b.d.lastUsed == null ? -Infinity : b.d.lastUsed;
      if (x !== y) return x < y ? -1 : 1;
      return a.i - b.i;
    }).map(function (o) { return o.d; });
  };
  /** Voorstel "Afmelden: niet gebruikt sinds …": het langst niet gebruikte andere apparaat, minstens minIdle ms (1 dag). */
  X.suggestion = function (list, now, minIdle) {
    var s = X.sortDevices(list)[0];
    if (!s || s.current || s.watching) return null;
    if (s.lastUsed == null) return s;
    return now - s.lastUsed >= (minIdle == null ? 86400000 : minIdle) ? s : null;
  };
  /** "zojuist", "5 minuten geleden", "2 uur geleden", "3 dagen geleden" (L = vertaalfunctie). */
  X.relTime = function (t, now, L) {
    L = L || function (s) { var a = arguments, i = 1; return s.replace(/%d/g, function () { return a[i++]; }); };
    if (t == null || !isFinite(t)) return L('unknown');
    var s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return L('just now');
    var m = Math.floor(s / 60);
    if (m < 60) return m === 1 ? L('1 minute ago') : L('%d minutes ago', m);
    var h = Math.floor(m / 60);
    if (h < 24) return h === 1 ? L('1 hour ago') : L('%d hours ago', h);
    var d = Math.floor(h / 24);
    if (d < 60) return d === 1 ? L('1 day ago') : L('%d days ago', d);
    var mo = Math.floor(d / 30);
    return L('%d months ago', mo);
  };

  // MARK: 37. Crashrapporten

  X.MAX_MESSAGE = 500;
  X.MAX_STACK = 16 * 1024;
  X.MAX_PER_SESSION = 10;
  X.KEEP_MS = 7 * 86400000;
  X.MAX_QUEUED = 30;
  var LINE_MAX = 1000;
  function scrubLine(s) {
    return s
      .replace(/[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>`)\]}]*/gi, '<url>')
      .replace(/\bwww\.[^\s"'<>`)\]}]+/gi, '<url>')
      .replace(/[^\s/@"'<>:]+:[^\s/@"'<>]+@[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>]*/gi, '<url>')
      .replace(/\/(?:live|movie|series|timeshift)\/[^\s/"'<>]+\/[^\s/"'<>]+\/[^\s"'<>]*/gi, '<url>')
      .replace(/\b(?:get|player_api|xmltv|panel_api|portal|load)\.php\?[^\s"'<>]*/gi, '<url>')
      .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{2,5})?\/[^\s"'<>]*\?[^\s"'<>]*/gi, '<url>')
      .replace(/[^\s@"'<>()[\]{},;:]+@[^\s@"'<>()[\]{},;:]+\.[a-z]{2,}/gi, '<email>')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '<ip>')
      .replace(/((?:username|user|password|passwd|pass|pwd|token|access_token|refresh_token|apikey|api_key|key|secret|mac|auth|sig|signature|session)\s*[=:]\s*)[^\s&"',;)]+/gi, '$1<redacted>')
      .replace(/\?[a-z0-9_.-]+=[^\s"'<>]*/gi, '<query>')
      .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '<token>')
      .replace(/(^|[^\w$])[0-9a-f]{32,}(?![\w])/gi, '$1<token>')
      .replace(/(^|[^\w$])((?:sb_(?:publishable|secret)_)?[A-Za-z0-9+/_-]{40,}={0,2})(?![\w])/g, function (m, pre, t) {
        var digits = (t.match(/\d/g) || []).length;
        return digits >= 6 && /[A-Z]/.test(t) && /[a-z]/.test(t) ? pre + '<token>' : m;
      });
  }
  /** Tekst opschonen (zelfde regels als de server, supabase/functions/device-auth/crash.ts). */
  X.scrub = function (v) {
    if (v == null) return '';
    return String(v).split(/\r?\n/).map(function (l) { return scrubLine(l.length > LINE_MAX ? l.slice(0, LINE_MAX) + '…' : l); }).join('\n');
  };
  /** Hooguit max UTF-8-bytes. */
  X.clipBytes = function (s, max) {
    s = String(s || '');
    var n = 0, i = 0;
    for (; i < s.length; i++) {
      var c = s.charCodeAt(i), w = c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? 4 : 3;
      if (n + w > max) break;
      n += w;
      if (w === 4) i++;
    }
    return s.slice(0, i);
  };
  /** Bestandsnaam en regel van de eerste bruikbare stackregel ("player.js:120"), zonder map of query. */
  X.topFrame = function (stack) {
    var lines = String(stack || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = /([A-Za-z0-9_.-]+\.(?:js|mjs))(?:\?[^:\s)]*)?:(\d+)(?::\d+)?/.exec(lines[i]);
      if (m) return m[1] + ':' + m[2];
    }
    return '';
  };
  /** Handtekening: "<Type>: <tekst zonder getallen en aanhalingen> @ <bestand>:<regel>", max. 200 tekens. */
  X.signature = function (name, message, stack) {
    var msg = X.scrub(message).replace(/(["'`]).*?\1/g, '…').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 120);
    var at = X.topFrame(stack);
    return ((name || 'Error') + ': ' + msg + (at ? ' @ ' + at : '')).slice(0, 200);
  };
  /**
   * Rapport maken uit een fout. info: {platform, app_version, build, os_version, device_model, at}.
   * Geeft het body-object voor device-auth (zonder action).
   */
  /** Eigen scripts in de stack leesbaar houden: "https://bingr.online/web/js/player.js?v=171:120:9" -> "web/js/player.js:120:9". */
  X.ownFrames = function (stack) {
    return String(stack || '').replace(/[a-z][a-z0-9+.-]{1,15}:\/\/[^\s()"'<>]*?\/((?:web|assets)\/js\/[A-Za-z0-9_.-]+\.js)(?:\?[^\s:()"'<>]*)?(:\d+(?::\d+)?)/gi, '$1$2');
  };
  X.report = function (kind, name, message, stack, info) {
    info = info || {};
    stack = X.ownFrames(stack);
    var r = {
      platform: info.platform || 'web', kind: kind || 'error', signature: X.signature(name, message, stack),
      message: X.scrub(message).slice(0, X.MAX_MESSAGE), stack: X.clipBytes(X.scrub(stack), X.MAX_STACK),
      at: new Date(info.at || Date.now()).toISOString(), count: 1
    };
    ['app_version', 'build', 'os_version', 'device_model'].forEach(function (k) { if (info[k] != null && info[k] !== '') r[k] = info[k]; });
    return r;
  };
  /** Wachtrij: dezelfde handtekening + build = count erbij; ouder dan 7 dagen weg; hooguit MAX_QUEUED. */
  X.enqueue = function (queue, r, now) {
    var q = X.prune(queue, now), hit = null;
    for (var i = 0; i < q.length; i++) if (q[i].signature === r.signature && String(q[i].build) === String(r.build)) { hit = q[i]; break; }
    if (hit) { hit.count = Math.min(1000, (hit.count || 1) + (r.count || 1)); if (r.at > hit.at) hit.at = r.at; }
    else q.push(r);
    return q.length > X.MAX_QUEUED ? q.slice(q.length - X.MAX_QUEUED) : q;
  };
  X.prune = function (queue, now) {
    return (queue || []).filter(function (r) { var t = Date.parse(r && r.at); return isFinite(t) && now - t <= X.KEEP_MS && t <= now + 3600000; });
  };
  /** Per sessie: ontdubbelen op handtekening en hooguit MAX_PER_SESSION verschillende fouten. true = vastleggen. */
  X.Session = function () { this.seen = Object.create(null); this.n = 0; };
  X.Session.prototype.accept = function (sig) {
    if (this.seen[sig]) { this.seen[sig]++; return false; }
    if (this.n >= X.MAX_PER_SESSION) return false;
    this.seen[sig] = 1; this.n++;
    return true;
  };
})();
