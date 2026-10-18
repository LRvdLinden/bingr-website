/*
 * Bingr web: link naar een titel uit de nieuwsbrief (bingr.online/titel/ → #/titel?type=movie|tv&id=<tmdb-id>&q=<titel>&y=<jaar>).
 * Bij het starten wordt de route onthouden (ook als je eerst moet inloggen of een profiel kiest; 30 minuten, ook na een
 * nieuwe pagina na het inloggen) en uit de adresbalk gehaald. Zodra er een profiel en een bibliotheek is: zoeken op titel
 * (+ jaar, ook op de originele titel van TMDB als die bekend is). Precies één goede match → de detailpagina, anders het
 * zoekscherm met de titel ingevuld. De webspeler kent geen TMDB-id's van de bronnen, dus koppelen gaat op titel.
 *
 * Build 132: staat de titel niet op de actieve server, dan zoeken op je andere servers (TMDB-id, anders titel + jaar,
 * zoals B.xs.matchTitle) en de detailpagina via die server openen (?s=). Ook #/titel in een al geopende webspeler werkt
 * (pagina 'titel'). Delen (B.titleLink.share): altijd de eigen link https://bingr.online/titel/?type=movie|tv&id=<tmdb>
 * &q=<titel>&y=<jaar> (zonder TMDB-id: type + q + y), met navigator.share of anders kopiëren met een melding.
 */
(function () {
  'use strict';
  var B = window.B;
  var L = function () { return B.L.apply(null, arguments); };
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
    var extra = null;
    function titles() { return extra ? Promise.resolve(extra) : tmdbTitles(want).then(function (t) { extra = t; return t; }); }
    waitLibrary(15000).then(function () { return B.details.indexReady(); }).then(function () {
      var byID = activeByTmdb(want);
      if (byID) return [byID];
      var hits = find(want, []);
      return hits.length ? hits : titles().then(function (t) { return find(want, t); });
    }).then(function (hits) {
      if (hits.length) return hits;
      // build 132: niet op de actieve server → je andere servers (zonder te wisselen)
      return titles().then(function (t) { return findOthers(want, [want.q].concat(t)); });
    }).catch(function () { return []; }).then(function (hits) {
      busy = false;
      if (B.app.profile !== prof) return;
      var rep = !!(R.current && R.current.parts[0] === 'titel');
      if (hits.length === 1) R.go(B.screens.titleLink(want.type, hits[0]).replace(/^#/, ''), rep);
      else R.go('/search' + (want.q ? '?q=' + encodeURIComponent(want.q) : ''), rep);
    });
    return true;
  };

  /** Op de actieve server met hetzelfde TMDB-id (als de bron dat geeft), en zichtbaar voor dit profiel. */
  function activeByTmdb(want) {
    var XS = B.xs, src = B.lib && B.lib.source;
    if (!want.tmdb || !XS || !XS.catalog || !src) return null;
    var cat = XS.catalog(src.id), x = cat && cat.idx.tmdb[want.type][want.tmdb];
    var hit = x && B.lib.lib && B.lib.lib.byId && B.lib.lib.byId[x.id];
    return hit && hit.type === want.type ? hit.item : null;
  }
  /**
   * Build 132: de andere servers van het account (B.xs, op volgorde), catalogus uit de cache of rustig geladen. Per server
   * TMDB-id, anders titel + jaar (±1); alleen wat dit profiel op die server mag zien (gefilterde weergave, item met _src).
   */
  function findOthers(want, names) {
    var XS = B.xs;
    if (!XS || !XS.orderedSources || !XS.loadCatalog) return Promise.resolve([]);
    var srcs = XS.orderedSources().filter(function (s) { return !XS.isActive(s.id); });
    var kind = want.type, i = 0;
    names = names.filter(Boolean);
    if (!names.length && !want.tmdb) return Promise.resolve([]);
    if (srcs.length && B.ui) B.ui.toast(L('Loading…'), 20000);
    function done(v) { if (srcs.length && B.ui) B.ui.toast(L('Loading…'), 1); return v; }
    function next() {
      if (i >= srcs.length) return Promise.resolve(done([]));
      var src = srcs[i++];
      return XS.loadCatalog(src, true).then(function (cat) {
        var v = cat && XS.view(src.id);
        if (!v || !v.byId) return next();
        var out = [];
        var tries = (names.length ? names : ['']).map(function (t) { return { t: t, y: want.y, tmdb: want.tmdb, k: kind }; });
        // series: ook zonder jaar (het jaar van de link is het eerste uitzendjaar)
        if (kind === 'series' && want.y) tries = tries.concat(names.map(function (t) { return { t: t, y: null, k: kind }; }));
        for (var j = 0; j < tries.length && !out.length; j++) {
          var x = XS.matchTitle(tries[j], cat.idx, kind), hit = x && v.byId[x.id];
          if (hit && hit.type === kind) out.push(hit.item);
        }
        return out.length ? done(out) : next();
      }, function () { return next(); });
    }
    return next();
  }

  // MARK: pagina #/titel in een al geopende webspeler (bijv. link in dezelfde tab)

  if (B.screens && B.screens.pages) {
    B.screens.pages.titel = function (r) {
      var U = B.ui;
      var pg = { el: U.h('div.page.detail', [U.h('div.state', [U.spinner()])]), title: L('Loading…') };
      var v = T.parse(r.query || {});
      setTimeout(function () {
        if (!v) { B.ui.router.go('/home', true); return; }
        pending = v;
        save(null);
        if (!T.tryPending()) { pending = v; save(v); }
      }, 0);
      return pg;
    };
  }

  // MARK: delen (build 132)

  var PAGE = 'https://bingr.online/titel/';
  var notes = Object.create(null);
  function noteKey(x, isShow) { return (isShow ? 's|' : 'm|') + B.fold(String((x && (x.rawTitle || x.title)) || '')) + '|' + (x && x.year != null ? x.year : ''); }
  /** TMDB-id dat de detailpagina vond (details.js), voor de deelknoppen. */
  T.note = function (x, isShow, id) { id = B.int(id); if (x && id) notes[noteKey(x, isShow)] = id; };
  function shownTitle(x) {
    var t = String((x && (x.title || x.name)) || '');
    var p = B.parseTitle(t);
    return clean((p && p.title) || t, 200);
  }
  function yearOf(x) {
    var y = B.int(x && x.year);
    if (!y && x && x.date) y = B.int(String(x.date).slice(0, 4));
    if (!y && x && x._meta) y = B.int(x._meta.y);
    if (!y && B.xs && B.xs.yearOf) y = B.xs.yearOf(x);
    if (!y && x) { var pt = B.parseTitle(String(x.title || '')); y = pt && B.int(pt.year); }
    return y && y >= 1800 && y <= 2199 ? y : null;
  }
  function tmdbOf(x, isShow, hint) {
    var id = B.int(hint) || B.int(x.tmdb) || B.int(x.tmdbID) || B.int(x.tmdbId) || (x._meta && B.int(x._meta.tmdb)) || notes[noteKey(x, isShow)] || null;
    if (!id && B.ageRatings && B.ageRatings.cached) {
      var r = B.ageRatings.cached(x.rawTitle || x.title, x.year, isShow);
      id = r && B.int(r.id);
    }
    return id || null;
  }
  /** Eigen Bingr-link: https://bingr.online/titel/?type=movie|tv&id=<tmdb-id>&q=<titel>&y=<jaar>. */
  T.url = function (type, tmdb, title, year) {
    var q = ['type=' + (type === 'series' || type === 'tv' ? 'tv' : 'movie')];
    if (B.int(tmdb)) q.push('id=' + B.int(tmdb));
    if (title) q.push('q=' + encodeURIComponent(title));
    if (year) q.push('y=' + year);
    return PAGE + '?' + q.join('&');
  };
  /** {title, text, url} om een film of serie te delen, of null (geen titel). tmdbHint = bekend TMDB-id. */
  T.shareData = function (x, type, tmdbHint) {
    if (!x || (type !== 'movie' && type !== 'series')) return null;
    var isShow = type === 'series', title = shownTitle(x), year = yearOf(x), tmdb = tmdbOf(x, isShow, tmdbHint);
    if (!title || (x._key && !x._meta && !tmdb)) return null;
    var name = title + (year ? ' (' + year + ')' : '');
    return { title: name, text: L(isShow ? 'Series tip: %@' : 'Movie tip: %@', name), url: T.url(type, tmdb, title, year) };
  };
  T.canShare = function (x, type) { return !!T.shareData(x, type); };
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy'));
    });
  }
  function copyLink(url) {
    copyText(url).then(function () { B.ui.toast(L('Link copied')); }, function () { B.ui.toast(L('Couldn’t copy the link.')); });
  }
  /** Delen met het deelmenu van het apparaat (navigator.share), anders de link kopiëren. Meteen bij de klik (gebruikersactie). */
  T.share = function (x, type, tmdbHint) {
    var d = T.shareData(x, type, tmdbHint);
    if (!d) return;
    var can = typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(d));
    if (can) {
      try {
        navigator.share(d).catch(function (e) { if (!e || e.name !== 'AbortError') copyLink(d.url); });
        return;
      } catch (e) { /* valt terug op kopiëren */ }
    }
    copyLink(d.url);
  };
})();
