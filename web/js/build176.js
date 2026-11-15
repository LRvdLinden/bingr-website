/*
 * Build 176 (versie 1.0.8): pure logica van de webspeler, zonder DOM, opslag of netwerk (getest in
 * tools/test/build176_test.js met de gedeelde gevallen uit docs/build176_cases.json van iptv-ios-appletv).
 * Contract: docs/ACCOUNT.md van iptv-ios-appletv, sectie "Build 176". Dezelfde regels als Shared/Build176.swift (Apple)
 * en Build176Logic.kt (Android):
 * - autoplayNext per profiel (automatisch volgende aflevering);
 * - vergrendelen met pincode (lockedChannels / lockedTitles, 4 uur open op dit apparaat);
 * - Binnenkort: herinnering met kind "release" (id, start = releasedatum 09:00 lokale tijd);
 * - zoeken in programmabeschrijvingen (normaliseren per teken, markeren);
 * - data besparen op mobiel netwerk (keuze en HLS-variant);
 * - voorvertoning op een titel, helpcentrum en TMDB-afbeeldingen in de kleinste passende maat.
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var P = B.b176 = {};

  function time(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
    var t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  P.time = time;

  // MARK: 1. automatisch volgende aflevering

  /** Waarde van autoplayNext uit het profiel ({value, at} of los true/false), null = niet ingesteld. */
  P.autoplayValue = function (field) {
    if (field === true || field === false) return field;
    if (field && typeof field === 'object' && (field.value === true || field.value === false)) return field.value;
    return null;
  };
  /** start = (value ?? !kids) && !stillWatchingDue */
  P.autoplayStarts = function (value, kids, stillWatchingDue) {
    var on = value === true || value === false ? value : !kids;
    return on && !stillWatchingDue;
  };
  /** Nieuwste wint (geen samenvoegen per veld). */
  P.mergeAutoplay = function (a, b) {
    if (!a || typeof a !== 'object') return b && typeof b === 'object' ? b : null;
    if (!b || typeof b !== 'object') return a;
    return time(b.at) > time(a.at) ? b : a;
  };

  // MARK: 2. vergrendelen met pincode

  P.UNLOCK_SECONDS = 14400;
  /** ask = locked && hasMainPin && !(unlockedAt != null && now - unlockedAt < 14400); tijden in seconden. */
  P.lockAsks = function (locked, hasMainPin, unlockedAt, now) {
    if (!locked || !hasMainPin) return false;
    if (unlockedAt != null) {
      var d = now - unlockedAt;
      if (d < P.UNLOCK_SECONDS) return false;
    }
    return true;
  };
  /** Ontgrendelingen die al verlopen zijn opruimen: {sleutel: ms} → nieuw object. */
  P.pruneUnlocked = function (map, nowMs) {
    var out = {};
    Object.keys(map || {}).forEach(function (k) { var t = +map[k]; if (t && nowMs - t < P.UNLOCK_SECONDS * 1000 && t <= nowMs + 60000) out[k] = t; });
    return out;
  };

  // MARK: 4. Binnenkort: herinnering op de releasedatum

  P.NO_SERVER = '00000000-0000-0000-0000-000000000000';
  /** Sleutel zonder profiel: release:<movie|tv>:<tmdb>(:s<seizoen>) */
  P.releaseKey = function (mediaType, tmdb, season) {
    var t = mediaType === 'tv' ? 'tv' : 'movie';
    return 'release:' + t + ':' + tmdb + (t === 'tv' && season != null && season !== '' ? ':s' + season : '');
  };
  /** id met het profiel ervoor als het niet het hoofdprofiel is (profileID null = hoofdprofiel). */
  P.releaseID = function (mediaType, tmdb, season, profileID) {
    var k = P.releaseKey(mediaType, tmdb, season);
    return profileID ? 'p:' + String(profileID).toLowerCase() + ':' + k : k;
  };
  /** Verschil (minuten) tussen tijdzone tz en UTC op moment ms (via Intl); zonder tz de tijdzone van het apparaat. */
  function tzOffsetMin(ms, tz) {
    if (!tz) return -new Date(ms).getTimezoneOffset();
    var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - ms) / 60000);
  }
  /** Start van de herinnering: releasedatum (JJJJ-MM-DD) om 09:00 lokale tijd → UTC ISO zonder milliseconden. */
  P.releaseStart = function (date, tz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
    if (!m) return null;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], 9, 0, 0);
    var off = tzOffsetMin(guess, tz);
    var ms = guess - off * 60000;
    var off2 = tzOffsetMin(ms, tz);
    if (off2 !== off) ms = guess - off2 * 60000;
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  };
  /** Het reminders-item voor een titel uit Binnenkort (zie contract). */
  P.releaseReminder = function (o) {
    var key = P.releaseKey(o.mediaType, o.tmdb, o.season);
    var r = { id: P.releaseID(o.mediaType, o.tmdb, o.season, o.profileID), kind: 'release', tmdb: +o.tmdb, mediaType: o.mediaType === 'tv' ? 'tv' : 'movie',
      season: o.mediaType === 'tv' && o.season != null ? +o.season : null, playlistID: o.playlistID || P.NO_SERVER, channelID: key, channelName: 'Bingr',
      title: String(o.title || ''), start: P.releaseStart(o.date, o.tz), at: o.at };
    return r;
  };
  /** Komt de release nog (start in de toekomst)? */
  P.releaseUpcoming = function (date, nowMs, tz) { var s = P.releaseStart(date, tz); return !!s && Date.parse(s) > nowMs; };
  P.NEW_SEASON_DAYS = 60;

  // MARK: 5. zoeken in programmabeschrijvingen

  var LN = null;
  try { LN = new RegExp('[\\p{L}\\p{N}]', 'u'); } catch (e) { LN = /[a-z0-9À-ɏͰ-ϿЀ-ӿ֐-ۿ぀-ヿ㐀-鿿가-힯]/; }
  var MARKS = /[̀-ͯ]/g;
  /** Eén teken genormaliseerd (één teken per origineel teken): kleine letter zonder accent, anders een spatie. */
  function normChar(c) {
    var l = c.toLowerCase();
    if (l.length === 1 && l.charCodeAt(0) < 128) return LN.test(l) ? l : ' ';
    try { l = l.normalize('NFD').replace(MARKS, ''); } catch (e) { /* oude engine */ }
    if (l.length !== 1) l = l.charAt(0) || ' ';
    return LN.test(l) ? l : ' ';
  }
  /** Genormaliseerde tekst, even lang als het origineel (zelfde posities). */
  P.norm = function (s) {
    s = s == null ? '' : String(s);
    var out = '';
    for (var i = 0; i < s.length; i++) out += normChar(s.charAt(i));
    return out;
  };
  /** Zoekwoorden in volgorde van de zoekterm (≥ 2 tekens, uniek); minder dan 3 tekens in totaal = []. */
  P.words = function (q) {
    var n = P.norm(q).trim();
    if (n.replace(/\s+/g, ' ').length < 3) return [];
    var seen = {}, out = [];
    n.split(/\s+/).forEach(function (w) { if (w.length >= 2 && !seen[w]) { seen[w] = 1; out.push(w); } });
    return out;
  };
  /**
   * Treffer met genormaliseerde titel/beschrijving: null of {field: 'title'|'description', word, at} (word = het te
   * markeren zoekwoord, at = de plek in titel of beschrijving).
   */
  P.matchNorm = function (nt, nd, words) {
    if (!words || !words.length) return null;
    var allTitle = true;
    for (var i = 0; i < words.length; i++) {
      var inT = nt.indexOf(words[i]) >= 0;
      if (!inT) { allTitle = false; if (nd.indexOf(words[i]) < 0) return null; }
    }
    var hay = allTitle ? nt : nd;
    for (var j = 0; j < words.length; j++) {
      var at = hay.indexOf(words[j]);
      if (at >= 0) return { field: allTitle ? 'title' : 'description', word: words[j], at: at };
    }
    return null;
  };
  /** Zelfde met de originele teksten: null of {field, highlight (origineel stuk), at}. */
  P.matchProgram = function (title, desc, q) {
    var words = Array.isArray(q) ? q : P.words(q);
    var m = P.matchNorm(P.norm(title), P.norm(desc), words);
    if (!m) return null;
    var src = String((m.field === 'title' ? title : desc) || '');
    return { field: m.field, highlight: src.substr(m.at, m.word.length), at: m.at, len: m.word.length };
  };
  /** Tekst in stukken met de gevonden zoekwoorden gemarkeerd: [{t, hit}]. */
  P.highlight = function (text, words) {
    text = text == null ? '' : String(text);
    if (!text) return [];
    words = Array.isArray(words) ? words : P.words(words);
    var n = P.norm(text), marks = [];
    words.forEach(function (w) { var at = 0; while ((at = n.indexOf(w, at)) >= 0) { marks.push([at, at + w.length]); at += w.length; } });
    if (!marks.length) return [{ t: text, hit: false }];
    marks.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
    var merged = [];
    marks.forEach(function (m) { var l = merged[merged.length - 1]; if (l && m[0] <= l[1]) l[1] = Math.max(l[1], m[1]); else merged.push(m.slice()); });
    var out = [], pos = 0;
    merged.forEach(function (m) {
      if (m[0] > pos) out.push({ t: text.slice(pos, m[0]), hit: false });
      out.push({ t: text.slice(m[0], m[1]), hit: true });
      pos = m[1];
    });
    if (pos < text.length) out.push({ t: text.slice(pos), hit: false });
    return out;
  };
  /** Stukje van een lange beschrijving rond plek at (hooguit max tekens, … waar afgeknipt). */
  P.snippet = function (text, at, max) {
    text = text == null ? '' : String(text);
    max = max || 150;
    if (text.length <= max) return { text: text, offset: 0 };
    at = Math.max(0, at || 0);
    var start = Math.max(0, at - Math.floor(max / 3));
    var end = Math.min(text.length, start + max);
    return { text: (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''), offset: start };
  };
  P.GUIDE_DAYS = 7;
  P.GUIDE_MAX = 100;
  P.SEARCH_DELAY = 250;
  /** Programma's die nog niet voorbij zijn, tot 7 dagen vooruit. */
  P.guideWindow = function (now) { return { from: now, to: now + P.GUIDE_DAYS * 86400000 }; };
  /**
   * Treffers sorteren en ontdubbelen: title vóór description, dan starttijd; één per (zender, start); max. 100.
   * hits: [{chKey, p: {start}, m: {field}}]
   */
  P.finishHits = function (hits, max) {
    var seen = {};
    return hits.slice().sort(function (a, b) {
      var fa = a.m.field === 'title' ? 0 : 1, fb = b.m.field === 'title' ? 0 : 1;
      return fa - fb || a.p.start - b.p.start;
    }).filter(function (x) {
      var k = x.chKey + '@' + x.p.start;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).slice(0, max || P.GUIDE_MAX);
  };

  // MARK: 6. data besparen op mobiel netwerk

  P.DATA_MODES = ['auto', 'saver', 'max'];
  P.normalizeDataMode = function (v) { return P.DATA_MODES.indexOf(v) >= 0 ? v : 'auto'; };
  P.MAX_BITRATE = 1500000;
  P.MAX_HEIGHT = 576;
  /** Netwerk van de browser: {net: 'wifi'|'cellular'|'unknown', constrained}. */
  P.network = function (nav) {
    var c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
    if (!c) return { net: 'unknown', constrained: false };
    var t = String(c.type || ''), eff = String(c.effectiveType || '');
    var net = t === 'cellular' || /^(slow-2g|2g|3g)$/.test(eff) ? 'cellular' : (t === 'wifi' || t === 'ethernet' ? 'wifi' : 'unknown');
    return { net: net, constrained: !!c.saveData };
  };
  /** saver = net == "cellular" && (mode == "saver" || (mode == "auto" && constrained)) */
  P.isSaver = function (mode, net, constrained) {
    var m = P.normalizeDataMode(mode);
    return net === 'cellular' && (m === 'saver' || (m === 'auto' && !!constrained));
  };
  /** Variant bij saver: hoogste bandwidth met bandwidth ≤ 1,5 Mbit/s en (geen height of ≤ 576), anders de laagste; zonder saver null. */
  P.pickVariant = function (variants, saver) {
    if (!saver || !variants || !variants.length) return null;
    var best = null, bestBw = -1, low = 0;
    variants.forEach(function (v, i) {
      var bw = +(v && (v.bandwidth != null ? v.bandwidth : v.bitrate)) || 0, ht = v && v.height;
      if (bw < (+(variants[low].bandwidth != null ? variants[low].bandwidth : variants[low].bitrate) || 0)) low = i;
      if (bw <= P.MAX_BITRATE && (ht == null || ht === 0 || ht <= P.MAX_HEIGHT) && bw > bestBw) { best = i; bestBw = bw; }
    });
    return best != null ? best : low;
  };

  // MARK: 7. voorvertoning op een titel

  P.PREVIEW_DELAY = 2000;
  /** o = {setting, saver, locked, kidsBlocked, reducedMotion, hidden, playing} */
  P.previewAllowed = function (o) {
    o = o || {};
    return !(o.setting === false || o.saver || o.locked || o.kidsBlocked || o.reducedMotion || o.hidden || o.playing);
  };

  // MARK: 8. helpcentrum

  P.HELP_URL = 'https://support.bingr.online/hulp/';
  P.helpURL = function (lang) { return P.HELP_URL + (String(lang || '').slice(0, 2) === 'nl' ? '' : '?lang=en'); };

  // MARK: 14. afbeeldingen

  var TMDB = /^https?:\/\/image\.tmdb\.org\/t\/p\/([a-z0-9_]+)(\/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp))$/i;
  P.POSTER_SIZES = [92, 154, 185, 342, 500, 780];
  P.BACKDROP_SIZES = [300, 780, 1280];
  /** Kleinste TMDB-maat die minstens px breed is (anders de grootste). */
  P.tmdbSize = function (px, kind) {
    var list = kind === 'backdrop' ? P.BACKDROP_SIZES : P.POSTER_SIZES;
    for (var i = 0; i < list.length; i++) if (list[i] >= px) return list[i];
    return list[list.length - 1];
  };
  P.tmdbPath = function (url) { var m = TMDB.exec(String(url || '').trim()); return m ? m[2] : null; };
  /** {src, srcset, sizes} in de kleinste passende maat voor 1x en 2x; geen TMDB-link: null. */
  P.tmdbSrcset = function (url, cssWidth, kind) {
    var path = P.tmdbPath(url);
    if (!path) return null;
    var w = Math.max(1, Math.round(cssWidth || 160));
    var base = 'https://image.tmdb.org/t/p/w';
    var s1 = P.tmdbSize(w, kind), s2 = P.tmdbSize(Math.round(w * 1.9), kind);
    var set = [base + s1 + path + ' ' + s1 + 'w'];
    if (s2 !== s1) set.push(base + s2 + path + ' ' + s2 + 'w');
    return { src: base + s1 + path, srcset: set.join(', '), sizes: w + 'px' };
  };
})(typeof window !== 'undefined' ? window : globalThis);
