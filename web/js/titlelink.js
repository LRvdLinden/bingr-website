/*
 * Bingr web: link naar een titel uit de nieuwsbrief (bingr.online/titel/ → #/titel?type=movie|tv&id=<tmdb-id>&q=<titel>&y=<jaar>).
 * Bij het starten wordt de route onthouden (ook als je eerst moet inloggen of een profiel kiest; 30 minuten, ook na een
 * nieuwe pagina na het inloggen) en uit de adresbalk gehaald. Zodra er een profiel en een bibliotheek is: zoeken op titel
 * (+ jaar, ook op de originele titel van TMDB als die bekend is). Precies één goede match → de detailpagina, anders het
 * zoekscherm met de titel ingevuld. De webspeler kent geen TMDB-id's van de bronnen, dus koppelen gaat op titel.
 */
(function () {
  'use strict';
  var B = window.B;
  var KEY = 'titleLink', TTL = 30 * 60000;
  var T = B.titleLink = {};
  var pending = null, busy = false;

  function clean(s, max) { return String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
  /** Route-query → {type: 'movie'|'series', tmdb, q, y} of null. */
  T.parse = function (query) {
    var type = query.type === 'tv' ? 'series' : query.type === 'movie' ? 'movie' : null;
    var tmdb = /^[1-9]\d{0,9}$/.test(query.id || '') ? Number(query.id) : null;
    var q = clean(query.q, 200);
    var y = /^(18|19|20|21)\d{2}$/.test(query.y || '') ? Number(query.y) : null;
    if (!type || (!q && !tmdb)) return null;
    return { type: type, tmdb: tmdb, q: q, y: y };
  };
  function save(v) { if (v) B.store.set(KEY, { v: v, at: Date.now() }); else B.store.del(KEY); }

  /** Bij het starten (vóór het inloggen): route onthouden en uit de adresbalk halen. */
  T.init = function () {
    try {
      var r = B.ui.router.parse();
      if (r.parts[0] === 'titel') {
        pending = T.parse(r.query);
        save(pending);
        history.replaceState(null, '', location.pathname + location.search + '#/');
        return;
      }
      var s = B.store.get(KEY, null);
      if (s && s.v && Date.now() - (s.at || 0) < TTL) pending = s.v; else if (s) save(null);
    } catch (e) { pending = null; }
  };
  T.hasPending = function () { return !!pending; };

  function libReady() {
    var l = B.lib && B.lib.lib;
    return !!(l && ((l.movies && l.movies.length) || (l.series && l.series.length)));
  }
  function waitLibrary(ms) {
    if (libReady()) return Promise.resolve();
    return new Promise(function (res) {
      var off = null, t = setTimeout(function () { if (off) off(); res(); }, ms);
      off = B.on('library', function () { if (libReady()) { clearTimeout(t); if (off) off(); res(); } });
    });
  }
  // originele titel (en de titel in de app-taal) van TMDB, als de webspeler een TMDB-sleutel heeft
  function tmdbTitles(want) {
    var AR = B.ageRatings;
    if (!want.tmdb || !AR || !AR.hasKey || !AR.hasKey()) return Promise.resolve([]);
    var path = (want.type === 'series' ? '/tv/' : '/movie/') + want.tmdb;
    return Promise.resolve(AR.tmdb(path, [['language', 'en-US']])).then(function (f) {
      return f ? [f.title, f.name, f.original_title, f.original_name].filter(Boolean) : [];
    }).catch(function () { return []; });
  }
  function find(want, extra) {
    var DT = B.details, all = [], seen = {};
    [want.q].concat(extra).filter(Boolean).forEach(function (t) {
      (DT.matchAll({ title: t, year: want.y, isShow: want.type === 'series' }) || []).forEach(function (x) {
        if (!seen[x.id]) { seen[x.id] = true; all.push(x); }
      });
    });
    return all;
  }

  /** Openen zodra er een profiel en een bibliotheek is (na het kiezen van een profiel). */
  T.tryPending = function () {
    var app = B.app;
    if (!pending || busy || !app || !app.profile || !B.details || !B.details.matchAll) return false;
    var want = pending, prof = app.profile, R = B.ui.router;
    busy = true;
    pending = null;
    save(null);
    waitLibrary(15000).then(function () { return B.details.indexReady(); }).then(function () {
      var hits = find(want, []);
      return hits.length ? hits : tmdbTitles(want).then(function (t) { return find(want, t); });
    }).catch(function () { return []; }).then(function (hits) {
      busy = false;
      if (B.app.profile !== prof) return;
      if (hits.length === 1) R.go(B.screens.titleLink(want.type, hits[0]).replace(/^#/, ''));
      else R.go('/search' + (want.q ? '?q=' + encodeURIComponent(want.q) : ''));
    });
    return true;
  };
})();
