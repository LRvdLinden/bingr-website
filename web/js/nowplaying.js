/*
 * Bingr web, build 152: rij "Nu in de bioscoop" op Home (sleutel in de Home-indeling: "nowplaying").
 *  - TMDB /movie/now_playing?region=NL&language=<app-taal>, via de TMDB-koppeling van de webspeler (B.ageRatings.tmdb,
 *    sleutel van de server). IMDb heeft geen openbare API; daarom TMDB.
 *  - Posters, max. 20, populairste eerst. Staat de film in je bibliotheek, dan opent die (afspeelbaar); anders de
 *    detailpagina van de TMDB-titel (#/title/movie/tmdb-movie-<id>, js/discover.js), zoals bij Binnenkort op Bingr.
 *  - Kinderprofiel: alleen animatie en familie. Profiel met een leeftijdsgrens: alleen titels uit de (gefilterde) bibliotheek.
 *  - Leeg of geen netwerk (en niets bewaard) = geen rij. 6 uur bewaard per taal en kinderprofiel.
 * Teksten staan onderaan (sleutel = Engels).
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, Lib = B.lib, S = B.screens, AR = B.ageRatings;
  var L = function () { return B.L.apply(null, arguments); };
  var N = B.nowPlaying = {};

  N.KEY = 'nowplaying';
  N.MAX = 20;
  N.REGION = 'NL';
  N.title = function () { return L('Now in cinemas'); };

  var TMDB_LANG = { en: 'en-US', nl: 'nl-NL', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', pl: 'pl-PL',
    tr: 'tr-TR', ar: 'ar-SA', 'zh-Hans': 'zh-CN' };
  function tmdbLang() {
    var l = B.lang || 'en';
    if (B.has(TMDB_LANG, l)) return TMDB_LANG[l];
    return l.length === 2 ? l + '-' + l.toUpperCase() : l;
  }
  function profile() { return B.app && B.app.profile; }
  function kidsProfile() { var p = profile(); return !!(p && p.kids); }
  function ageLimited() { var p = profile(); return !!(p && D.ageLimit(p) != null); }
  function idxReady() { return !!(B.details && B.details.indexReadyNow && B.details.indexReadyNow()); }

  /** Staat de rij aan in de Home-indeling van dit profiel? */
  N.enabled = function () {
    var p = profile();
    if (!p || !S.effectiveHomeLayout) return true;
    return S.effectiveHomeLayout(D.homeLayout(), D.collectionsFor(p.id)).some(function (r) { return r.key === N.KEY && r.visible; });
  };

  /** Ruwe TMDB-resultaten naar titels: met poster, geen adult, populairste eerst, max. 20 (kinderen: animatie/familie). */
  N.parse = function (r, kids) {
    var list = ((r && r.results) || []).filter(function (i) {
      if (!i || !i.id || !i.title || !i.poster_path || i.adult) return false;
      if (kids) return (i.genre_ids || []).some(function (g) { return g === 16 || g === 10751; });
      return true;
    });
    list.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    return list.slice(0, N.MAX).map(function (i) {
      return { id: i.id, isShow: false, title: i.title, original: i.original_title && i.original_title !== i.title ? i.original_title : null,
        date: i.release_date || null, poster: i.poster_path, backdrop: i.backdrop_path || null, overview: i.overview || null, kind: N.KEY };
    });
  };

  // MARK: ophalen (6 uur bewaard)

  var TTL = 6 * 3600000;
  function cacheKey(kids) { return 'nowplaying.' + (kids ? 'kids.' : '') + (B.lang || 'en') + '.' + N.REGION; }
  var mem = {};
  function saved(kids) {
    var k = cacheKey(kids);
    if (!B.has(mem, k)) mem[k] = B.store.get(k, null);
    return mem[k];
  }
  N.cached = function (kids) { var c = saved(kids); return c && c.items ? c.items : []; };
  var inFlight = {};
  N.load = function (kids) {
    var c = saved(kids);
    if (c && c.items && c.items.length && Date.now() - c.at < TTL) return Promise.resolve(c.items);
    if (!AR.hasKey()) return Promise.resolve(N.cached(kids));
    var k = cacheKey(kids);
    if (inFlight[k]) return inFlight[k];
    var q = [['language', tmdbLang()], ['region', N.REGION], ['page', '1']];
    var p = inFlight[k] = AR.tmdb('/movie/now_playing', q).then(function (r) {
      delete inFlight[k];
      var items = N.parse(r, kids);
      if (!items.length) return N.cached(kids);
      var v = { at: Date.now(), items: items };
      mem[k] = v;
      B.store.set(k, v);
      return items;
    }, function () { delete inFlight[k]; return N.cached(kids); });
    return p;
  };

  /** Ophalen en de titelindex (koppelen aan je bibliotheek); true als er iets nieuws is. */
  N.loadAll = function () {
    if (!N.enabled()) return Promise.resolve(false);
    var kids = kidsProfile();
    function sig() { var c = saved(kids); return (c ? c.at : 0) + ':' + idxReady(); }
    var before = sig();
    var idx = B.details && B.details.indexReady ? B.details.indexReady().catch(B.noop) : Promise.resolve();
    return Promise.all([N.load(kids), idx]).then(function () { return sig() !== before; }, function () { return false; });
  };

  // MARK: rij op Home

  /** Kaarten: [{type, item, external}]; film uit je bibliotheek als hij daar staat, anders de TMDB-titel. */
  N.entries = function () {
    var kids = kidsProfile(), only = ageLimited();
    var c = saved(kids), ready = idxReady();
    var key = 'nowplaying:' + (kids ? 'k' : '') + (only ? 'a' : '') + ':' + (c ? c.at : 0) + ':' + ready + ':' + (B.lang || '');
    return Lib.memo(key, function () {
      var out = [], seen = {};
      N.cached(kids).forEach(function (t) {
        var hit = ready && B.details && B.details.match ? B.details.match({ title: t.title, original: t.original, year: t.date ? B.int(t.date.slice(0, 4)) : null, isShow: false }) : null;
        if (only && !hit) return;
        var item = hit || (B.discover ? B.discover.asItem(t) : null);
        if (!item || seen[item.id]) return;
        seen[item.id] = true;
        out.push({ type: 'movie', item: item, external: !hit });
      });
      return out;
    });
  };
  /** Rij, of null als hij leeg is. */
  N.row = function () {
    var cards = N.entries().map(function (e) { return S.posterCard(e.item, e.type); });
    return U.row(N.title(), cards, 'discover-row');
  };

  // MARK: teksten (sleutel = Engels; niets overschrijven wat er al staat)

  var V = { nl: 'Nu in de bioscoop', de: 'Jetzt im Kino', fr: 'Actuellement au cinéma', es: 'Ahora en cines', it: 'Ora al cinema',
    pt: 'Agora nos cinemas', pl: 'Teraz w kinach', tr: 'Şimdi sinemalarda', ar: 'يُعرض الآن في السينما', 'zh-Hans': '正在热映' };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(V).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    if (!Object.prototype.hasOwnProperty.call(tab, 'Now in cinemas')) tab['Now in cinemas'] = V[lang];
  });
})();
