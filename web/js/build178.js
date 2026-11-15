/*
 * Build 178 (versie 1.0.8): terugkijken in de tv-gids (zoals NLZIET). Pure logica zonder DOM (getest in
 * tools/test/build178_test.js met de gedeelde gevallen uit docs/build178_cases.json van iptv-ios-appletv). Dezelfde
 * regels als Shared/Account/Build178.swift (Apple) en Build178Logic.kt (Android). Tijden hier in milliseconden.
 * - herkennen per zender: Xtream/Stalker tv_archive + tv_archive_duration (dagen, of uren boven de 31), M3U catchup,
 *   catchup-type, catchup-days, catchup-source, tvg-rec, timeshift, tv_archive(_duration), ook als standaard op #EXTM3U;
 * - de terugkijk-URL: Xtream in de tijdzone van de server (server_info.timezone), M3U volgens het catchup-type;
 * - de gids van vroeger: Xtream get_simple_data_table (has_archive), samengevoegd met de gewone gids.
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var P = B.b178 = {};

  P.MAX_BACK = 14;
  P.MAX_AHEAD = 7;
  var DAY = 86400000;

  function str(v) {
    if (v === null || v === undefined) return null;
    if (v === true) return '1';
    if (v === false) return '0';
    return String(v);
  }

  /** Dagen uit een duurveld: boven de 31 uren (72 = 3), "72h"/"3d" mag ook; naar boven afgerond. */
  P.days = function (raw) {
    var s = str(raw);
    if (s == null) return 0;
    s = s.trim().toLowerCase();
    if (!s) return 0;
    var hours = false, days = false;
    if (s.slice(-1) === 'h') { hours = true; s = s.slice(0, -1); } else if (s.slice(-1) === 'd') { days = true; s = s.slice(0, -1); }
    s = s.trim();
    if (!/^[+]?\d*\.?\d+(e[+-]?\d+)?$/.test(s)) return 0;
    var v = parseFloat(s);
    if (!isFinite(v) || v <= 0) return 0;
    if (hours || (!days && v > 31)) return Math.ceil(v / 24);
    return Math.ceil(v);
  };

  /** Aan/uit: null = ontbreekt, anders true/false. */
  P.flag = function (raw) {
    var s = str(raw);
    if (s == null) return null;
    s = s.trim().toLowerCase();
    if (!s) return null;
    if (['0', 'false', 'no', 'off', 'none', 'disabled', 'null'].indexOf(s) >= 0) return false;
    if (['1', 'true', 'yes', 'on'].indexOf(s) >= 0) return true;
    var d = Number(s);
    if (s !== '' && !isNaN(d)) return d !== 0;
    return true;
  };

  /** Xtream get_live_streams en Stalker: aan zonder duur = 1 dag; zonder tv_archive-veld telt de duur. */
  P.xtreamDays = function (archive, duration) {
    var d = P.days(duration), f = P.flag(archive);
    if (f === false) return 0;
    if (f === true) return Math.max(d, 1);
    return d;
  };

  /** Stalker-portal: tv_archive (of archive) en tv_archive_duration, die altijd in uren is */
  P.stalkerDays = function (archive, duration) {
    var d = str(duration);
    d = d == null ? '' : d.trim();
    return P.xtreamDays(archive, d ? d + 'h' : null);
  };

  /** M3U: {days, type, source} uit de attributen van #EXTINF en (standaard) van #EXTM3U. */
  P.m3u = function (attrs, header) {
    function low(o) { var r = {}; Object.keys(o || {}).forEach(function (k) { r[k.toLowerCase()] = o[k]; }); return r; }
    var a = low(attrs), h = low(header);
    function val(k, d) { var v = str(d[k]); if (v == null) return null; v = v.trim(); return v ? v : null; }
    var off = { days: 0, type: null, source: null };
    var chType = val('catchup', a) || val('catchup-type', a);
    if (chType != null && P.flag(chType) === false) return off;
    if (P.flag(val('tv_archive', a)) === false) return off;
    var keys = ['catchup-days', 'tv_archive_duration', 'tvg-rec', 'timeshift'];
    function firstDays(d) { for (var i = 0; i < keys.length; i++) { var x = P.days(val(keys[i], d)); if (x > 0) return x; } return 0; }
    var days = firstDays(a), type = chType, source = val('catchup-source', a);
    var chOn = chType != null || source != null || P.flag(val('tv_archive', a)) === true;
    var hType = val('catchup', h) || val('catchup-type', h);
    var headerOff = (hType != null && P.flag(hType) === false) || P.flag(val('tv_archive', h)) === false;
    if (!headerOff) {
      if (type == null) type = hType;
      if (source == null) source = val('catchup-source', h);
      if (days === 0) days = firstDays(h);
    }
    var hOn = !headerOff && (hType != null || val('catchup-source', h) != null || P.flag(val('tv_archive', h)) === true);
    if (days === 0 && (chOn || hOn)) days = 1;
    if (days <= 0) return off;
    return { days: days, type: type == null ? null : type.toLowerCase(), source: source };
  };

  /** [jaar, maand, dag, uur, minuut, seconde] van een tijd (ms) in een tijdzone */
  function parts(ms, tz) {
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      var o = {};
      f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
      return [+o.year, +o.month, +o.day, +o.hour % 24, +o.minute, +o.second];
    } catch (e) {
      var d = new Date(ms);
      return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
    }
  }
  function two(v) { return v < 10 ? '0' + v : '' + v; }

  /** Xtream: /timeshift/{user}/{pass}/{minuten}/{YYYY-MM-DD:HH-MM}/{id}.ts in de tijdzone van de server */
  P.xtreamURL = function (server, user, pass, id, start, end, tz) {
    var base = String(server || '').replace(/\/+$/, '');
    var minutes = Math.max(1, Math.ceil((end - start) / 60000));
    var p = parts(start, tz);
    return base + '/timeshift/' + user + '/' + pass + '/' + minutes + '/' + p[0] + '-' + two(p[1]) + '-' + two(p[2]) + ':' +
      two(p[3]) + '-' + two(p[4]) + '/' + id + '.ts';
  };

  /** Xtream-achtige stream-URL → {server, user, pass, id} of null */
  P.xtreamParts = function (url) {
    var m = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)(\/[^?#]*)/i.exec(String(url || ''));
    if (!m) return null;
    var segs = m[2].split('/').filter(Boolean);
    if (segs.length === 4 && segs[0].toLowerCase() === 'live') segs.shift();
    if (segs.length !== 3) return null;
    var id = segs[2].replace(/\.[^.]*$/, '');
    if (!/^\d+$/.test(id)) return null;
    return { server: m[1], user: segs[0], pass: segs[1], id: id };
  };

  function format(fmt, ms) {
    var p = parts(ms, 'UTC');
    return String(fmt).replace(/[YmdHMS]/g, function (c) {
      switch (c) {
        case 'Y': return '' + p[0];
        case 'm': return two(p[1]);
        case 'd': return two(p[2]);
        case 'H': return two(p[3]);
        case 'M': return two(p[4]);
        default: return two(p[5]);
      }
    });
  }

  /** Sjabloon invullen (zie Build178.swift `fill`) */
  P.fill = function (template, start, end, now) {
    var s = Math.floor(start / 1000), e = Math.floor(end / 1000), n = Math.floor(now / 1000), dur = Math.max(0, e - s);
    return String(template).replace(/\$?\{([^}:]*)(?::([^}]*))?\}/g, function (all, name, arg) {
      var hasArg = arg !== undefined;
      switch (name.toLowerCase()) {
        case 'utc': case 'start': return hasArg ? format(arg, start) : '' + s;
        case 'utcend': case 'end': return hasArg ? format(arg, end) : '' + e;
        case 'lutc': case 'now': case 'timestamp': return hasArg ? format(arg, now) : '' + n;
        case 'duration': { var dv = hasArg ? parseInt(arg, 10) : 1; return '' + (dv > 0 ? Math.floor(dur / dv) : dur); }
        case 'offset': { var ov = hasArg ? parseInt(arg, 10) : 1, off = Math.max(0, n - s); return '' + (ov > 0 ? Math.floor(off / ov) : off); }
        default:
          if (!hasArg && name.length === 1 && 'YmdHMS'.indexOf(name) >= 0) return format(name, start);
          return all;
      }
    });
  };

  function append(url, part) {
    if (!part) return url;
    if (part.charAt(0) === '?' && url.indexOf('?') >= 0) return url + '&' + part.slice(1);
    if (part.charAt(0) === '&' && url.indexOf('?') < 0) return url + '?' + part.slice(1);
    return url + part;
  }

  /** De terugkijk-URL van een M3U-zender (null = kan niet) */
  P.m3uURL = function (stream, type, source, start, end, now, tz) {
    var t = (type || '').toLowerCase(), src = source == null ? null : String(source).trim() || null;
    stream = stream || '';
    function xc() {
      var x = P.xtreamParts(stream);
      return x ? P.xtreamURL(x.server, x.user, x.pass, x.id, start, end, tz) : null;
    }
    switch (t) {
      case 'xc': return xc();
      case '': case 'default': case 'append':
        if (src) {
          var filled = P.fill(src, start, end, now);
          if (t !== 'append' && filled.indexOf('://') >= 0) return filled;
          if (!stream) return null;
          return append(stream, filled);
        }
        return xc();
      case 'shift': case 'timeshift':
        if (!stream) return null;
        return append(stream, '?utc=' + Math.floor(start / 1000) + '&lutc=' + Math.floor(now / 1000));
      case 'flussonic': case 'flussonic-hls': case 'flussonic-ts': case 'fs': {
        if (!stream) return null;
        var q = stream.indexOf('?'), path = q >= 0 ? stream.slice(0, q) : stream, query = q >= 0 ? stream.slice(q) : '';
        var sl = path.lastIndexOf('/');
        if (sl < 0) return null;
        var dir = path.slice(0, sl + 1), last = path.slice(sl + 1), ss = Math.floor(start / 1000);
        var d = Math.max(0, Math.floor(end / 1000) - ss);
        if (last.toLowerCase() === 'mpegts' || /\.ts$/i.test(last)) return dir + 'timeshift_abs-' + ss + '.ts' + query;
        var name = /\.m3u8$/i.test(last) ? last.slice(0, -5) : (last || 'index');
        return dir + name + '-' + ss + '-' + d + '.m3u8' + query;
      }
      default: return null;
    }
  };

  /** Base64-tekst van Xtream uitpakken (anders de tekst zelf) */
  P.text = function (raw) {
    var s = str(raw);
    if (s == null) return '';
    s = s.trim();
    if (!s) return '';
    if (s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
      try {
        var bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var out = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(out)) return out.trim();
      } catch (e) { /* geen base64 of geen UTF-8 */ }
    }
    return s;
  };

  /** get_simple_data_table (of get_short_epg): [{title, description, start, end, archive}] (ms), op begintijd */
  P.simpleTable = function (json) {
    var obj = json;
    if (typeof json === 'string') { try { obj = JSON.parse(json); } catch (e) { return []; } }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
    var list = obj.epg_listings;
    if (list && !Array.isArray(list) && typeof list === 'object') list = Object.keys(list).map(function (k) { return list[k]; });
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var s = parseFloat(str(it.start_timestamp)), e = parseFloat(str(it.stop_timestamp != null ? it.stop_timestamp : it.end_timestamp));
      if (!isFinite(s) || !isFinite(e) || e <= s) return;
      var d = P.text(it.description);
      out.push({ title: P.text(it.title), description: d || null, start: s * 1000, end: e * 1000, archive: P.flag(it.has_archive) });
    });
    return out.sort(function (a, b) { return a.start - b.start; });
  };

  /** Gids en archief samen (zie Build178.swift `merge`): [{...programma, archive}] op begintijd */
  P.merge = function (guide, archive) {
    var out = (guide || []).map(function (p) { var q = {}; for (var k in p) q[k] = p[k]; if (q.archive === undefined) q.archive = null; return q; });
    out.sort(function (a, b) { return a.start - b.start; });
    var extra = [];
    (archive || []).forEach(function (a) {
      var lo = 0, hi = out.length;
      while (lo < hi) { var m = (lo + hi) >> 1; if (out[m].start < a.start - 120000) lo = m + 1; else hi = m; }
      if (lo < out.length && Math.abs(out[lo].start - a.start) <= 120000) {
        if (a.archive != null) out[lo].archive = a.archive;
      } else {
        var q = {}; for (var k in a) q[k] = a[k]; if (q.archive === undefined) q.archive = null; extra.push(q);
      }
    });
    if (!extra.length) return out;
    return out.concat(extra).sort(function (a, b) { return a.start - b.start; });
  };

  /** Terug te kijken: voorbij, en volgens de server (has_archive) of binnen de termijn van de zender */
  P.replayable = function (start, end, now, days, archive) {
    if (end > now) return false;
    if (archive === true || archive === false) return archive;
    return days > 0 && start > now - days * DAY;
  };

  /** Dagbalk als offsets (0 = vandaag): terug tot de termijn (hooguit 14), vooruit alleen met gids (hooguit 7) */
  P.dayOffsets = function (maxDays, future) {
    var back = Math.min(Math.max(0, maxDays | 0), P.MAX_BACK), out = [], i;
    for (i = -back; i <= 0; i++) out.push(i === 0 ? 0 : i);
    var seen = {};
    (future || []).filter(function (x) { return x > 0 && x <= P.MAX_AHEAD; }).sort(function (a, b) { return a - b; })
      .forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  };

  /** Venster van de gids */
  P.keep = function (start, end, now, back, ahead) { return end > now - back * DAY && start < now + ahead * DAY; };

  /** Diagnose: [zenders met terugkijken, grootste aantal dagen] */
  P.summary = function (days) {
    var n = 0, m = 0;
    (days || []).forEach(function (d) { if (d > 0) { n++; m = Math.max(m, d); } });
    return [n, m];
  };
})(typeof window !== 'undefined' ? window : globalThis);
