/*
 * Bingr web, build 111: rijen op Home (= Discover.swift / Discover.kt in de apps)
 *  - "Nieuw toegevoegd": films én series uit je eigen bron, de laatste 30 dagen (Xtream `added` / `last_modified`),
 *    nieuwste eerst, max. 30; zonder datum (M3U) blijft de rij weg.
 *  - "Binnenkort op Bingr" en "Nieuw op Bingr" (namen sinds build 112): titels uit TMDB (sleutel van de server), regio van de app-taal.
 *    Nooit namen of logo's van streamingdiensten (we vragen alleen "flatrate" op, zonder aanbieders te tonen).
 *    Staat een titel in je bibliotheek, dan opent die; anders een detailpagina (#/title/<soort>/tmdb-<movie|tv>-<id>)
 *    met Mijn lijst. Build 112: "Nieuw op Bingr" alleen met titels uit je bibliotheek (meteen afspeelbaar; niets = geen
 *    rij). De bronvermelding (TMDB, JustWatch) staat niet meer onder de rijen en op de detailpagina, maar één keer in
 *    Instellingen → Over. 12 uur bewaard; koppelen aan je bibliotheek via de titelindex (in stukjes).
 * Sleutels in de Home-indeling: "upcoming" en "streaming" (zelfde als de apps).
 *
 * Build 140: "Nieuw op Bingr" (sleutel "streaming") was tot nu toe gebaseerd op TMDB: populaire titels die de laatste
 * 90 (films) / 120 (series) dagen bij een streamingdienst in je regio verschenen (discover met watch_region + flatrate),
 * alleen getoond als ze ook in je bibliotheek stonden. Nu: de titels die het laatst aan je bibliotheek (alle servers) zijn
 * toegevoegd, nieuwste eerst: de toevoegdatum van de provider (Xtream `added`, Plex `addedAt`, Jellyfin `DateCreated`),
 * anders het moment waarop deze browser de titel voor het eerst zag (library.js, Lib.firstSeen). Kinder- en
 * leeftijdsfilter via de gefilterde bibliotheken. TMDB wordt alleen nog voor Binnenkort op Bingr gebruikt.
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, Lib = B.lib, S = B.screens, AR = B.ageRatings;
  var h = U.h, R = U.router;
  var L = function () { return B.L.apply(null, arguments); };
  var X = B.discover = {};

  X.KINDS = ['upcoming', 'streaming'];
  /** Getoonde naam (build 112: "Binnenkort op Bingr" / "Nieuw op Bingr"); de sleutels blijven upcoming/streaming. */
  X.title = function (kind) { return kind === 'upcoming' ? L('Coming soon to Bingr') : L('New on Bingr'); };
  /** Build 112: "Nieuw op Bingr" alleen met titels uit de eigen bibliotheek (meteen afspeelbaar). */
  X.onlyLibrary = function (kind) { return kind === 'streaming'; };
  /** Build 140: rijen die nog uit TMDB komen (Nieuw op Bingr komt uit je bibliotheek). */
  X.TMDB_KINDS = ['upcoming'];
  /** Build 112: bronvermelding van TMDB en JustWatch, één keer in Instellingen → Over (niet meer onder de rijen). */
  X.attribution = function () {
    return L('Movie and series data: TMDB. This app uses the TMDB API but is not endorsed or certified by TMDB. Availability data: JustWatch.');
  };

  // MARK: id's ("tmdb-movie-123" / "tmdb-tv-123", zelfde als de apps; ook in Mijn lijst)

  var PREFIX = 'tmdb-';
  X.isExternal = function (id) { return String(id || '').indexOf(PREFIX) === 0; };
  X.externalID = function (tmdbID, isShow) { return PREFIX + (isShow ? 'tv' : 'movie') + '-' + tmdbID; };
  X.parse = function (id) {
    var m = /^tmdb-(movie|tv)-(\d+)$/.exec(String(id || ''));
    return m && +m[2] > 0 ? { id: +m[2], isShow: m[1] === 'tv' } : null;
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function day(offsetDays) {
    var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function img(path, size) { return path ? 'https://image.tmdb.org/t/p/' + size + path : null; }

  // build 97: geldige TMDB-locales (zoals details.js)
  var TMDB_LANG = { en: 'en-US', nl: 'nl-NL', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', pl: 'pl-PL',
    tr: 'tr-TR', ar: 'ar-SA', 'zh-Hans': 'zh-CN' };
  function tmdbLang() {
    var l = B.lang || 'en';
    if (B.has(TMDB_LANG, l)) return TMDB_LANG[l];
    return l.length === 2 ? l + '-' + l.toUpperCase() : l;
  }
  /** Regio: die van de app-taal (nl → NL, …); bij Engels of een andere taal de regio van de browser, anders NL. */
  X.region = function () {
    var byLang = { nl: 'NL', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT', pl: 'PL', tr: 'TR' };
    if (B.has(byLang, B.lang)) return byLang[B.lang];
    var m = /[-_]([A-Za-z]{2})\b/.exec((navigator.languages && navigator.languages[0]) || navigator.language || '');
    return m ? m[1].toUpperCase() : 'NL';
  };

  function profile() { return B.app && B.app.profile; }
  function kidsProfile() { var p = profile(); return !!(p && p.kids); }
  function ageLimited() { var p = profile(); return !!(p && D.ageLimit(p) != null); }

  /** Titel uit TMDB als kaart-item (zoals een film/serie uit de bibliotheek, maar zonder stream). */
  X.asItem = function (t) {
    return { id: X.externalID(t.id, t.isShow), title: t.title, year: t.date ? B.int(t.date.slice(0, 4)) : null, poster: img(t.poster, 'w342'),
      plot: t.overview || null, tmdb: t.id, external: true, date: t.date || null, kind: t.kind, backdrop: img(t.backdrop, 'w1280') };
  };

  // MARK: bekende TMDB-titels (voor Mijn lijst; alleen in deze browser, max. 400)

  var KNOWN_KEY = 'discover.known';
  var known = null;
  function knownMap() { if (!known) known = B.store.get(KNOWN_KEY, {}) || {}; return known; }
  X.known = function (id) { var k = knownMap()[id]; return k ? k.t : null; };
  function remember(list) {
    if (!list || !list.length) return;
    var m = knownMap(), now = Date.now();
    list.forEach(function (t) { m[X.externalID(t.id, t.isShow)] = { t: t, at: now }; });
    var keys = Object.keys(m);
    if (keys.length > 400) {
      keys.sort(function (a, b) { return m[b].at - m[a].at; }).slice(400).forEach(function (k) { delete m[k]; });
    }
    B.store.set(KNOWN_KEY, m);
  }

  // MARK: ophalen (12 uur bewaard per soort, taal, regio en kinderprofiel)

  function cacheKey(kind, kids) { return 'discover.' + kind + '.' + (kids ? 'kids.' : '') + (B.lang || 'en') + '.' + X.region(); }
  var mem = {};
  function saved(kind, kids) {
    var k = cacheKey(kind, kids);
    if (!B.has(mem, k)) mem[k] = B.store.get(k, null);
    return mem[k];
  }
  /** Uit de cache (ook verlopen), zonder netwerk; Binnenkort zonder wat intussen uit is. */
  X.cached = function (kind, kids) {
    var c = saved(kind, kids);
    var items = c && c.items ? c.items : [];
    if (kind !== 'upcoming') return items;
    var today = day(0);
    return items.filter(function (t) { return (t.date || '') > today; });
  };
  function page(path, q, isShow, kind) {
    return AR.tmdb(path, q).then(function (r) {
      return ((r && r.results) || []).map(function (i) {
        var t = (isShow ? i.name : i.title) || i.title || i.name;
        if (!t || !i.poster_path || i.adult) return null;
        var o = isShow ? i.original_name : i.original_title;
        var date = (isShow ? i.first_air_date : i.release_date) || null;
        return { id: i.id, isShow: isShow, title: t, original: o && o !== t ? o : null, date: date, poster: i.poster_path,
          backdrop: i.backdrop_path || null, overview: i.overview || null, kind: kind };
      }).filter(Boolean);
    }, function () { return []; });
  }
  function fetchKind(kind, kids) {
    if (!AR.hasKey()) return Promise.resolve([]);
    var lang = tmdbLang(), region = X.region(), today = day(0);
    var mq = [['language', lang], ['region', region], ['include_adult', 'false'], ['sort_by', 'popularity.desc'], ['page', '1']];
    var tq = [['language', lang], ['include_adult', 'false'], ['sort_by', 'popularity.desc'], ['page', '1']];
    if (kids) {
      mq.push(['with_genres', '16|10751'], ['certification_country', 'US'], ['certification.lte', 'PG']);
      tq.push(['with_genres', '10762|16|10751']);
    }
    var moviePath = '/discover/movie';
    if (kind === 'upcoming') {
      if (kids) mq.push(['with_release_type', '2|3'], ['release_date.gte', day(1)], ['release_date.lte', day(120)]);
      else moviePath = '/movie/upcoming';
      tq.push(['first_air_date.gte', day(1)], ['first_air_date.lte', day(120)]);
    } else {
      mq.push(['watch_region', region], ['with_watch_monetization_types', 'flatrate'], ['release_date.gte', day(-90)], ['release_date.lte', today]);
      tq.push(['watch_region', region], ['with_watch_monetization_types', 'flatrate'], ['first_air_date.gte', day(-120)], ['first_air_date.lte', today]);
    }
    return Promise.all([page(moviePath, mq, false, kind), page('/discover/tv', tq, true, kind)]).then(function (r) {
      var up = kind === 'upcoming';
      function ok(t) { return up ? (t.date || '') > today : (t.date || '') <= today; }
      var mv = r[0].filter(ok), tv = r[1].filter(ok), out = [], seen = {};
      for (var i = 0; i < Math.max(mv.length, tv.length); i++) {
        [mv[i], tv[i]].forEach(function (t) {
          if (!t) return;
          var k = X.externalID(t.id, t.isShow);
          if (!seen[k]) { seen[k] = true; out.push(t); }
        });
      }
      out = out.slice(0, 40);
      // Binnenkort: de 40 populairste, op datum (eerst wat het eerst uitkomt)
      if (up) out.sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : (a.title < b.title ? -1 : 1); });
      return out;
    });
  }
  var inFlight = {};
  X.load = function (kind, kids) {
    var c = saved(kind, kids);
    if (c && c.items && c.items.length && Date.now() - c.at < 12 * 3600000) return Promise.resolve(X.cached(kind, kids));
    var k = cacheKey(kind, kids);
    if (inFlight[k]) return inFlight[k];
    var p = inFlight[k] = fetchKind(kind, kids).then(function (items) {
      delete inFlight[k];
      if (!items.length) return X.cached(kind, kids);
      var v = { at: Date.now(), items: items };
      mem[k] = v;
      B.store.set(k, v);
      remember(items);
      return items;
    }, function () { delete inFlight[k]; return X.cached(kind, kids); });
    return p;
  };

  // MARK: koppelen aan je bibliotheek

  /** Rijen die in de Home-indeling aan staan. */
  X.enabledKinds = function () {
    var p = profile();
    if (!p || !S.effectiveHomeLayout) return X.TMDB_KINDS.slice();
    var rows = S.effectiveHomeLayout(D.homeLayout(), D.collectionsFor(p.id));
    return X.TMDB_KINDS.filter(function (k) { return rows.some(function (r) { return r.key === k && r.visible; }); });
  };

  // MARK: build 140: Nieuw op Bingr = laatst toegevoegd aan je bibliotheek (alle servers)

  /**
   * [{type, item}] nieuwste eerst, max. n (30): datum van de provider, anders eerste keer gezien (lokaal); titels zonder
   * één van beide (stonden er al bij de eerste catalogus) daarna, laatst in de lijst van de server eerst. Over alle
   * servers (actieve eerst bij gelijke tijd), dezelfde titel op twee servers = één.
   */
  /** De k grootste op key (en alles wat gelijk is aan de k-de), ongesorteerd; snel ook bij 10k+ items. */
  function topBy(list, k, key) {
    if (list.length <= k * 2) return list;
    var v = new Float64Array(list.length);
    for (var i = 0; i < list.length; i++) v[i] = key(list[i]) || 0;
    v.sort();
    var thr = v[v.length - k];
    return list.filter(function (e) { return (key(e) || 0) >= thr; });
  }
  X.topBy = topBy;
  // build 147: vooraf (vóór het event 'library'): Nieuw op Bingr voor de rij (30) en voor Uitgelicht (16)
  if (Lib.warmers) Lib.warmers.push(function () { if (B.app && B.app.profile) { X.newOnBingr(30); X.newOnBingr(16); } });
  X.newOnBingr = function (n) {
    n = n || 30;
    var libs = B.xs ? B.xs.libs(null) : [Lib.lib];
    var key = 'newOnBingr:' + n + ':' + Lib.version + ':' + (B.xs ? B.xs.version : 0) + ':' + Lib.seenVersion + ':' + libs.length;
    return Lib.memo(key, function () {
      var dated = [], rest = [];
      libs.forEach(function (lib, li) {
        var sid = lib === Lib.lib ? (Lib.source ? Lib.source.id : '') : null;
        [['movie', lib.movies || []], ['series', lib.series || []]].forEach(function (pl) {
          var list = pl[1];
          for (var i = 0; i < list.length; i++) {
            var x = list[i];
            var s2 = sid != null ? sid : (x._src ? x._src.id : '');
            var t = x.addedAt || Lib.firstSeen(s2, x.id);
            var e = { type: pl[0], item: x, t: t, li: li, i: i };
            if (t) dated.push(e); else rest.push(e);
          }
        });
      });
      // build 147: alleen de nieuwste ~n×3 sorteren (drempel via een getallenlijst), niet alle 10k+ titels
      dated = topBy(dated, n * 3, function (e) { return e.t; });
      dated.sort(function (a, b) { return (b.t - a.t) || (a.li - b.li) || (b.i - a.i); });
      var out = B.xs ? B.xs.dedupe(dated.slice(0, n * 3)) : dated;
      if (out.length < n) {
        rest.sort(function (a, b) { return (a.li - b.li) || (b.i - a.i); });
        out = B.xs ? B.xs.dedupe(out.concat(rest.slice(0, n * 3))) : out.concat(rest);
      }
      return out.slice(0, n).map(function (e) { return { type: e.type, item: e.item }; });
    });
  };
  var stamp = 0;
  /**
   * Kaarten van een rij: [{type, item, external}] — item uit je bibliotheek als hij daar staat, anders de TMDB-titel.
   * Profielen met een leeftijdsgrens zien alleen titels uit hun (gefilterde) bibliotheek, en Nieuw op Bingr (build 112)
   * altijd. Max. 30, geen dubbele.
   */
  X.entries = function (kind) {
    // build 140: Nieuw op Bingr uit je bibliotheek
    if (kind === 'streaming') return X.newOnBingr(30).map(function (e) { return { type: e.type, item: e.item, external: false, t: null }; });
    var kids = kidsProfile(), only = ageLimited() || X.onlyLibrary(kind);
    var c = saved(kind, kids);
    var ready = idxReady();
    var key = 'disc:' + kind + ':' + (kids ? 'k' : '') + (only ? 'a' : '') + ':' + (c ? c.at : 0) + ':' + ready + ':' + stamp;
    return Lib.memo(key, function () {
      var out = [], seen = {};
      X.cached(kind, kids).forEach(function (t) {
        if (out.length >= 30) return;
        var hit = ready ? B.details.match({ title: t.title, original: t.original, year: t.date ? B.int(t.date.slice(0, 4)) : null, isShow: t.isShow }) : null;
        if (only && !hit) return;
        var type = t.isShow ? 'series' : 'movie';
        var item = hit || X.asItem(t);
        var k = type + ':' + item.id;
        if (seen[k]) return;
        seen[k] = true;
        out.push({ type: type, item: item, external: !hit, t: t });
      });
      return out;
    });
  };
  function idxReady() { return !!(B.details && B.details.indexReadyNow && B.details.indexReadyNow()); }

  /** Ophalen (alleen de rijen die aan staan) en de titelindex; true als er iets nieuws is. */
  X.loadAll = function () {
    var kids = kidsProfile();
    var kinds = X.enabledKinds();
    if (!kinds.length) return Promise.resolve(false);
    var before = kinds.map(function (k) { var c = saved(k, kids); return c ? c.at : 0; }).join() + idxReady();
    var idx = B.details && B.details.indexReady ? B.details.indexReady().catch(B.noop) : Promise.resolve();
    return Promise.all(kinds.map(function (k) { return X.load(k, kids); }).concat([idx])).then(function () {
      var after = kinds.map(function (k) { var c = saved(k, kids); return c ? c.at : 0; }).join() + idxReady();
      return after !== before;
    }, function () { return false; });
  };

  // MARK: Nieuw toegevoegd (films én series, laatste 30 dagen)

  X.recentTitles = function () {
    return Lib.memo('recentTitles30', function () {
      var lib = Lib.lib, cutoff = Date.now() - 30 * 86400000, out = [], seen = {};
      function add(list, type) {
        (list || []).forEach(function (x) {
          if (!x.addedAt || x.addedAt < cutoff || seen[type + x.id]) return;
          seen[type + x.id] = true;
          out.push({ type: type, item: x });
        });
      }
      add(lib.movies, 'movie');
      add(lib.series, 'series');
      return out.sort(function (a, b) { return b.item.addedAt - a.item.addedAt; }).slice(0, 30);
    });
  };

  // MARK: Mijn lijst

  /** TMDB-titels uit Mijn lijst van deze bron ([{type, item}]); niet bij een leeftijdsgrens. */
  X.myListHits = function () {
    if (ageLimited()) return [];
    // build 128: Mijn lijst over alle servers (een TMDB-titel hoort bij geen server; één keer per titel)
    var out = [], seen = {};
    D.setList('myList').forEach(function (k) {
      var bar = k.indexOf('|');
      if (bar < 0) return;
      var id = k.slice(bar + 1);
      if (!X.isExternal(id) || seen[id]) return;
      seen[id] = true;
      var t = X.known(id);
      if (t) out.push({ type: t.isShow ? 'series' : 'movie', item: X.asItem(t) });
    });
    return out;
  };
  var resolving = false;
  /** TMDB-titels in Mijn lijst die deze browser nog niet kent (op een ander apparaat toegevoegd) opzoeken. */
  X.resolveMissing = function () {
    if (resolving || !AR.hasKey()) return;
    var ids = D.setList('myList').filter(function (k) { return k.indexOf('|') > 0; }).map(function (k) { return k.slice(k.indexOf('|') + 1); })
      .filter(function (id, i, all) { return X.isExternal(id) && !X.known(id) && all.indexOf(id) === i; }).slice(0, 20);
    if (!ids.length) return;
    resolving = true;
    Promise.all(ids.map(function (id) {
      var p = X.parse(id);
      if (!p) return null;
      return AR.tmdb((p.isShow ? '/tv/' : '/movie/') + p.id, [['language', tmdbLang()]]).then(function (f) {
        if (!f) return null;
        var t = (p.isShow ? f.name : f.title) || f.title || f.name;
        if (!t) return null;
        var o = p.isShow ? f.original_name : f.original_title;
        return { id: p.id, isShow: p.isShow, title: t, original: o && o !== t ? o : null, date: (p.isShow ? f.first_air_date : f.release_date) || null,
          poster: f.poster_path || null, backdrop: f.backdrop_path || null, overview: f.overview || null, kind: 'streaming' };
      }, function () { return null; });
    })).then(function (list) {
      resolving = false;
      list = list.filter(Boolean);
      if (!list.length) return;
      remember(list);
      stamp++;
      B.emit('discover');
    }, function () { resolving = false; });
  };

  // MARK: rijen op Home

  /** Korte datum ("17 okt", "Oct 17"; in de app-taal), alleen bij Binnenkort op Bingr; zonder punt achter de maand. */
  function dateLabel(t) {
    if (t.kind !== 'upcoming' || !t.date) return null;
    try {
      return B.fmtDate(new Date(t.date + 'T12:00:00'), { day: 'numeric', month: 'short' }).replace(/\.$/, '');
    } catch (e) { return t.date; }
  }
  /** Rij, of null als hij leeg is (build 112: zonder bronvermelding eronder; die staat in Instellingen → Over). */
  X.row = function (kind) {
    var list = X.entries(kind);
    var cards = list.map(function (e) {
      // build 112: datum als rood label linksboven, zelfde .card-badge als Serie/Film en "N BEKEKEN"
      // build 141: Nieuw op Bingr met het label Film/Serie linksboven, zoals Voor jou
      if (kind === 'streaming') return S.posterCard(e.item, e.type, { kindBadge: true });
      return S.posterCard(e.item, e.type, { badge: e.external ? dateLabel(e.t) : null });
    });
    return U.row(X.title(kind), cards, 'discover-row');
  };

  /** Regels op de detailpagina van een TMDB-titel: niet in je afspeellijst en de datum (build 112: zonder bronvermelding). */
  X.note = function (id) {
    var t = X.known(id);
    var first = L('Not in your playlists');
    if (t && t.date) {
      var d = t.date;
      try { d = B.fmtDate(new Date(t.date + 'T12:00:00'), { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { /* stil */ }
      first += ' · ' + L('Release date: %@', d).replace('%@', d);
    }
    return [first];
  };

  // MARK: detailpagina van een TMDB-titel (#/title/<movie|series>/tmdb-…)

  function trailerKey(p) {
    var base = tmdbLang().slice(0, 2);
    return AR.tmdb((p.isShow ? '/tv/' : '/movie/') + p.id + '/videos', [['language', tmdbLang()], ['include_video_language', base + ',en,null']]).then(function (r) {
      var v = ((r && r.results) || []).filter(function (x) { return x.site === 'YouTube' && (x.type === 'Trailer' || x.type === 'Teaser'); });
      v.sort(function (a, b) { return (a.type === 'Trailer' ? 0 : 1) - (b.type === 'Trailer' ? 0 : 1); });
      return v[0] ? v[0].key : null;
    }, function () { return null; });
  }
  X.page = function (type, id) {
    var isShow = type === 'series';
    var p = X.parse(id);
    var el = h('div.page.detail.discover-detail');
    var pg = { el: el };
    var alive = true;
    pg.destroy = function () { alive = false; };
    function draw(t) {
      U.clear(el);
      var x = X.asItem(t);
      pg.title = x.title;
      document.title = x.title + ' · Bingr';
      var meta = h('div.dt-meta', [x.year ? String(x.year) : '', isShow ? L('Series') : L('Movie')].filter(Boolean).join('  ·  '));
      var plot = h('p.dt-plot', x.plot || '');
      var creditsSlot = h('div.dt-credits-slot'), extraSlot = h('div.dt-extra-slot'), buttons = h('div.dt-btns');
      var note = h('div.dt-note.muted.small', X.note(x.id).map(function (line) { return h('div', line); }));
      var trailerSlot = h('span.dt-trailer');
      function drawButtons() {
        U.clear(buttons);
        if (Lib.source) {
          // plus / vinkje met animatie; de knop blijft staan
          buttons.appendChild(U.plusCheckButton('mylist', L('My List'), S.inMyList(x),
            function () { S.toggleMyList(x, type); return S.inMyList(x); }));
        }
        buttons.appendChild(trailerSlot);
        buttons.appendChild(h('a.btn', { href: '#/search?q=' + encodeURIComponent(x.title) }, [U.icon('search'), h('span', L('Search'))]));
        // build 132: eigen Bingr-link delen
        if (B.titleLink) buttons.appendChild(U.button(L('Share'), function () { B.titleLink.share(x, type, p.id); }, { icon: 'share' }));
      }
      var back = h('button.icon-btn.dt-back', { type: 'button', 'aria-label': L('Back'), title: L('Back') }, [U.icon('back')]);
      back.addEventListener('click', function () { if (history.length > 1) history.back(); else R.go('/home'); });
      el.appendChild(h('div.dt-bg', [U.img(x.backdrop || x.poster, 'hero-img')]));
      el.appendChild(h('div.dt-shade'));
      el.appendChild(h('div.dt-top', [back, h('div.dt-poster', [U.img(x.poster, 'poster', x.title)]),
        h('div.dt-info', [h('div.hero-kind', isShow ? L('SERIES') : L('FILM')), h('h1.dt-title', x.title), meta, plot, creditsSlot, buttons, note])]));
      el.appendChild(extraSlot);
      drawButtons();
      pg.onData = drawButtons;
      trailerKey(p).then(function (key) {
        if (!alive || !key) return;
        trailerSlot.appendChild(U.button(L('Trailer'), function () {
          var frame = h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(key) + '?autoplay=1&rel=0&modestbranding=1&hl=' + B.lang,
            title: L('Trailer'), allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
          U.modal({ title: L('Trailer'), body: h('div.trailer', [frame]), cls: 'trailer-dlg', buttons: [{ label: L('Close') }] });
        }, { icon: 'trailer' }));
      });
      // cast, genres en aanbevelingen (details.js, met het TMDB-id als hint)
      if (B.details) B.details.load(x, isShow, { tmdb: p.id, tmdb_id: p.id }).then(function (d) {
        if (!alive || !d) return;
        if (d.overview) plot.textContent = d.overview;
        if (d.runtime) meta.textContent += '  ·  ' + d.runtime;
        U.clear(creditsSlot); var cr = B.details.credits(d); if (cr) creditsSlot.appendChild(cr);
        U.clear(extraSlot); var ex = B.details.sections(d); if (ex) extraSlot.appendChild(ex);
      }, B.noop);
    }
    if (!p) {
      el.appendChild(h('div.state', [h('h2', L('Not found')), h('a.btn', { href: '#/home' }, L('Home'))]));
      return pg;
    }
    var t = X.known(id);
    if (t) draw(t);
    else {
      el.appendChild(h('div.state', [U.spinner()]));
      AR.tmdb((p.isShow ? '/tv/' : '/movie/') + p.id, [['language', tmdbLang()]]).then(function (f) {
        if (!alive) return;
        var title = f && ((p.isShow ? f.name : f.title) || f.title || f.name);
        if (!title) { U.clear(el); el.appendChild(h('div.state', [h('h2', L('Not found')), h('a.btn', { href: '#/home' }, L('Home'))])); return; }
        var tt = { id: p.id, isShow: p.isShow, title: title, date: (p.isShow ? f.first_air_date : f.release_date) || null, poster: f.poster_path || null,
          backdrop: f.backdrop_path || null, overview: f.overview || null, kind: 'streaming' };
        remember([tt]);
        draw(tt);
      }, function () { if (alive) { U.clear(el); el.appendChild(h('div.state', [h('p.muted', L('Something went wrong. Please try again.'))])); } });
    }
    return pg;
  };
})();
