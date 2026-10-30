/*
 * Bingr web, build 154: inhoudssleutels voor "gezien" over alle servers (contract docs/ACCOUNT.md van iptv-ios-appletv,
 * sectie "Build 154", testgevallen docs/watched_keys_cases.json). Puur: alleen B.parseTitle uit core.js; geen DOM,
 * geen opslag, geen netwerk. Gebruikt door sync.js/watched.js (account) en connections.js (Trakt-gezien in het geheugen).
 *
 *   Film       w:m:tmdb:<id>  w:m:imdb:<tt…>  w:m:t:<norm>|<jaar>
 *   Serie      w:s:<show>                               (alle uitgezonden afleveringen gezien)
 *   Aflevering w:e:<show>|<seizoen>-<aflevering>
 *   <show> = tmdb:<id> | imdb:<tt…> | t:<norm>|<jaar>   (één per bekende id); <jaar> = vier cijfers of 0
 */
(function (root) {
  'use strict';
  var B = root.B;
  var WK = B.wk = {};

  var NOT_LN = (function () { try { return new RegExp('[^\\p{L}\\p{N}]+', 'gu'); } catch (e) { return /[^a-z0-9À-￿]+/g; } })();
  var MARKS = (function () { try { return new RegExp('\\p{M}+', 'gu'); } catch (e) { return /[̀-ͯ]+/g; } })();
  var memo = Object.create(null), memoN = 0;

  /** Opgeschoonde titel + jaar uit de titel (weergave-opschoning van build 150/153/154). */
  function cleaned(t) {
    var p = B.parseTitle(String(t == null ? '' : t));
    return { title: p.title, year: p.year };
  }
  /** Titel-normalisatie (alle platforms gelijk): opgeschoond, NFKD zonder diakritische tekens, kleine letters, & → and,
   *  + → plus, alleen letters en cijfers (elk schrift). */
  WK.norm = function (t) {
    var k = String(t == null ? '' : t), hit = memo[k];
    if (hit != null) return hit;
    var s = cleaned(k).title;
    try { s = s.normalize('NFKD'); } catch (e) { /* oude engine */ }
    s = s.replace(MARKS, '').toLowerCase().replace(/&/g, 'and').replace(/\+/g, 'plus').replace(NOT_LN, '');
    if (++memoN > 20000) { memo = Object.create(null); memoN = 0; }
    memo[k] = s;
    return s;
  };
  function int(v) { if (v == null || v === '') return null; var n = parseInt(String(v).trim(), 10); return isFinite(n) ? n : null; }
  function tmdbOf(x) {
    var v = x && (x.tmdb != null ? x.tmdb : (x.tmdbID != null ? x.tmdbID : (x.tmdbId != null ? x.tmdbId : x.tmdb_id)));
    var n = int(v);
    return n && n > 0 ? String(n) : null;
  }
  function imdbOf(x) {
    var v = x && (x.imdb != null ? x.imdb : (x.imdbID != null ? x.imdbID : (x.imdbId != null ? x.imdbId : x.imdb_id)));
    v = String(v == null ? '' : v).trim().toLowerCase();
    return /^tt\d+$/.test(v) ? v : null;
  }
  WK.tmdbOf = tmdbOf;
  WK.imdbOf = imdbOf;
  /** Jaar: eigen jaar van het item, anders uit de titel, anders 0. */
  function yearOf(x) {
    var y = int(x && x.year);
    if (!(y >= 1000 && y <= 9999)) y = cleaned(x && (x.rawTitle || x.title)).year;
    return y >= 1000 && y <= 9999 ? y : 0;
  }
  WK.yearOf = yearOf;
  function titleOf(x) { return x ? (x.rawTitle || x.title || '') : ''; }

  /** Show-vormen van een serie (of {title, year, tmdb, imdb}): ['tmdb:1', 'imdb:tt…', 't:<norm>|<jaar>']. */
  WK.showForms = function (s) {
    var out = [], t = tmdbOf(s), i = imdbOf(s), n = WK.norm(titleOf(s));
    if (t) out.push('tmdb:' + t);
    if (i) out.push('imdb:' + i);
    if (n) out.push('t:' + n + '|' + yearOf(s));
    return out;
  };
  WK.movieKeys = function (m) {
    var out = [], t = tmdbOf(m), i = imdbOf(m), n = WK.norm(titleOf(m));
    if (t) out.push('w:m:tmdb:' + t);
    if (i) out.push('w:m:imdb:' + i);
    if (n) out.push('w:m:t:' + n + '|' + yearOf(m));
    return out;
  };
  function epNum(v) { var n = int(v); return n != null && n >= 0 ? n : null; }
  WK.episodeKeys = function (show, season, episode) {
    var s = epNum(season), e = epNum(episode);
    if (s == null || e == null) return [];
    return WK.showForms(show).map(function (f) { return 'w:e:' + f + '|' + s + '-' + e; });
  };
  WK.showKeys = function (show) { return WK.showForms(show).map(function (f) { return 'w:s:' + f; }); };
  WK.isContentKey = function (k) { return typeof k === 'string' && k.indexOf('w:') === 0 && /^w:[mse]:/.test(k); };

  /** Sleutels om op te zoeken: de eigen sleutels, bij een titelsleutel met jaar ook jaar −1 en +1 (jaar 0 alleen 0). */
  function widen(keys) {
    var out = [];
    keys.forEach(function (k) {
      out.push(k);
      var m = /^(w:[mse]:t:[^|]*\|)(\d+)(\|.*)?$/.exec(k);
      if (!m) return;
      var y = parseInt(m[2], 10);
      if (!y) return;
      out.push(m[1] + (y - 1) + (m[3] || ''), m[1] + (y + 1) + (m[3] || ''));
    });
    return out;
  }
  WK.lookupKeys = function (keys) { return widen(keys); };
  /** has(k) → bool. Eerste sleutel die erin staat (tmdb/imdb eerst, de titel als laatste), of null. */
  function first(has, keys) {
    var l = widen(keys);
    for (var i = 0; i < l.length; i++) if (has(l[i])) return l[i];
    return null;
  }
  WK.movieHit = function (has, m) { return first(has, WK.movieKeys(m)); };
  WK.episodeHit = function (has, show, season, episode) { return first(has, WK.episodeKeys(show, season, episode)); };
  WK.showHit = function (has, show) { return first(has, WK.showKeys(show)); };
  /** Alle sleutels in de set die bij deze sleutels horen (eigen sleutels plus jaar ±1): voor uitvinken. */
  WK.matching = function (has, keys) { return widen(keys).filter(has); };
})(typeof window !== 'undefined' ? window : self);
