/*
 * Build 174 (versie 1.0.7): pure logica van de webspeler, zonder DOM of netwerk (getest in tools/test/build174_test.js).
 * Dezelfde regels als Shared/Player/Build174.swift (Apple) en features/Build174Logic.kt (Android):
 * - 1: de knoppen onder Afspelen op een smal scherm: Mijn lijst · Trailer · Bronnen · Gezien · Meer (wat niet van
 *      toepassing is valt weg, de rest schuift op);
 * - 2: de beste trailer uit alle bronnen (TMDB, de IPTV-server, Trakt): Trailer, dan onbekend, dan Teaser; app-taal,
 *      Engels, zonder taal; officieel eerst; alleen echte YouTube-id's.
 */
(function () {
  'use strict';
  var B = window.B = window.B || {};
  var P = B.b174 = {};

  // MARK: 1. detailpagina

  P.COMPACT_MAX = 600;
  P.isCompact = function (width) { return width > 0 && width < P.COMPACT_MAX; };

  /** ['myList', 'trailer', 'sources', 'watched', 'more'] zonder wat niet van toepassing is. */
  P.compactActions = function (o) {
    var out = [];
    if (o.hasListID) out.push('myList');
    if (o.hasTrailer) out.push('trailer');
    if ((o.otherSources || 0) + (o.languageVersions || 0) > 0) out.push('sources');
    if (o.isMovie) out.push('watched');
    out.push('more');
    return out;
  };

  /** Bronnen: één soort → meteen die keuze, twee soorten → eerst kiezen. 'none' | 'otherSources' | 'languages' | 'choose' */
  P.sourcesTarget = function (otherSources, languageVersions) {
    var a = otherSources > 0, b = languageVersions > 0;
    if (a && b) return 'choose';
    if (a) return 'otherSources';
    if (b) return 'languages';
    return 'none';
  };

  // MARK: 2. trailers

  var SOURCE = { tmdb: 0, server: 1, trakt: 2 };
  P.isValidID = function (s) { return typeof s === 'string' && /^[A-Za-z0-9_-]{11}$/.test(s); };

  /** YouTube-id uit een id of een link (watch?v=, embed/, youtu.be/), anders null. */
  P.youtubeID = function (raw) {
    var s = raw == null ? '' : String(raw).trim();
    if (!s) return null;
    if (P.isValidID(s)) return s;
    var m = /[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)/.exec(s) || /youtu(?:\.be|be(?:-nocookie)?\.com)\/(?:embed\/|shorts\/)?([A-Za-z0-9_-]{11})(?:[?&#/]|$)/.exec(s);
    return m ? m[1] : null;
  };

  P.rank = function (c, appLanguage) {
    var base = String(appLanguage || 'en').toLowerCase().slice(0, 2);
    var t = c.type == null ? null : String(c.type).toLowerCase();
    var typeRank = t === 'trailer' ? 0 : t == null ? 1 : t === 'teaser' ? 2 : 9;
    var lang = c.language == null ? null : String(c.language).toLowerCase();
    var langRank;
    if (lang == null) langRank = c.source === 'tmdb' ? 2 : 1;
    else if (lang === base) langRank = 0;
    else if (lang === 'en') langRank = base === 'en' ? 0 : 1;
    else langRank = 3;
    return [typeRank, langRank, c.official === false ? 1 : 0, SOURCE[c.source] != null ? SOURCE[c.source] : 3];
  };

  /** candidates: [{key, source: 'tmdb'|'server'|'trakt', type?, language?, official?, site?}] → beste key of null. */
  P.bestTrailer = function (candidates, appLanguage) {
    var best = null, bestRank = null;
    (candidates || []).forEach(function (c) {
      if (!c || !P.isValidID(c.key) || String(c.site || 'YouTube').toLowerCase() !== 'youtube') return;
      var r = P.rank(c, appLanguage);
      if (r[0] >= 9) return;
      if (!bestRank || lexLess(r, bestRank)) { best = c.key; bestRank = r; }
    });
    return best;
  };
  function lexLess(a, b) { for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; }

  /** TMDB-video's (results van /videos) als kandidaten */
  P.tmdbCandidates = function (results) {
    return (results || []).filter(Boolean).map(function (v) {
      return { key: v.key, source: 'tmdb', type: v.type, language: v.iso_639_1 || null, official: v.official, site: v.site };
    });
  };

  /** Hoe de trailer opent: 'inApp' | 'youtubeApp' | 'browser' | 'notInstalled' */
  P.opening = function (canEmbed, hasYouTubeApp, hasBrowser) {
    if (canEmbed) return 'inApp';
    if (hasYouTubeApp) return 'youtubeApp';
    return hasBrowser ? 'browser' : 'notInstalled';
  };
})();
