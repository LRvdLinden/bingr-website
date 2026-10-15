/*
 * Bingr web: Categorieën (build 85). Overzicht met tegels per genre (TMDB-genres van je bibliotheek, met de genres van
 * de server als terugval) en per categorie van je server ("Van je server"), en per categorie een rooster met
 * Alles / Films / Series en sorteren (Populair, Nieuwste, A–Z, Beoordeling).
 *
 * Build 86: het overzicht opent vanuit Mijn Bingr (Bibliotheek) en vanuit de rij "Categorieën" op Home (C.homeRow);
 * niet meer bovenin de navigatie of als chip bij Films en Series. De routes blijven gelijk (deeplinks werken).
 *
 * Routes: #/categorie (overzicht) en #/categorie/<id>, met ?type=movie|series en ?sort=popular|newest|az|rating.
 * <id> = genresleutel (action, comedy, …) of "server:<naam van de categorie>".
 *
 * Bron van de genres per titel, in deze volgorde:
 *  1. TMDB-genre-id's uit de cache van B.ageRatings (zelfde opzoeking als leeftijden en trailers);
 *  2. de genres van de server (Xtream-series, Plex, Jellyfin/Emby, Stremio: veld `genres`, of `genre`);
 *  3. de naam van de categorie op de server ("NL | Actie", "Horror Movies").
 * Alles werkt op Lib.lib, dus verborgen en vergrendelde categorieën en de leeftijdsgrens van het profiel tellen mee.
 * De indeling wordt per bibliotheekversie en per TMDB-bijwerking één keer berekend. Zonder TMDB-gegevens vult
 * B.ageRatings.warm ze op de achtergrond aan zolang Categorieën open is ("Bezig met aanvullen…").
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, Lib = B.lib, S = B.screens, AR = B.ageRatings;
  var h = U.h, R = U.router;
  var L = function () { return B.L.apply(null, arguments); };
  var C = B.categories = {};

  // MARK: genres

  // [sleutel, naam (Engels = vertaalsleutel), TMDB-film-id's, TMDB-tv-id's, kleuren [licht, donker], trefwoorden (opgevouwen; * = stam)]
  var GENRES = [
    ['action', 'Action', [28], [10759], ['#E50914', '#4A0004'], ['action', 'actie*', 'aksiyon', 'accion', 'azione', 'acao', 'akcja', 'actionfilm*']],
    ['comedy', 'Comedy', [35], [35], ['#F5B700', '#6B3A00'], ['comed*', 'komedi*', 'komodie*', 'commedia', 'humor', 'sitcom*']],
    ['drama', 'Drama', [18], [18], ['#9B5DE5', '#2A0B4D'], ['drama*', 'dramat*', 'dram', 'drame', 'dramma', 'drammatico']],
    ['thriller', 'Thriller', [53], [], ['#FF6B1A', '#3D1100'], ['thriller*', 'suspense', 'spannung', 'gerilim']],
    ['horror', 'Horror', [27], [], ['#B3001B', '#0B0B0B'], ['horror*', 'horreur', 'terror', 'korku', 'griezel*']],
    ['scifi', 'Sci-Fi', [878], [10765], ['#00B4D8', '#03264A'], ['sci-fi', 'scifi', 'science fiction', 'science-fiction', 'sciencefiction', 'ciencia ficcion', 'ficcao cientifica', 'fantascienza', 'bilim kurgu']],
    ['animation', 'Animation', [16], [16], ['#FF5DA2', '#3A0A5E'], ['animat*', 'animacion', 'animazione', 'animacao', 'animacja', 'animasyon', 'animowan*', 'anime', 'cartoon*', 'tekenfilm*']],
    ['documentary', 'Documentary', [99], [99], ['#2BB673', '#06301C'], ['docu*', 'documentair*', 'documentar*', 'dokument*', 'belgesel']],
    ['family', 'Family', [10751], [10751, 10762], ['#4CC9F0', '#123C7A'], ['family', 'familie*', 'famille', 'familia', 'famiglia', 'familijn*', 'kids', 'kinder*', 'children', 'jeugd', 'enfant*']],
    ['romance', 'Romance', [10749], [], ['#FF4D6D', '#5A0A24'], ['romance', 'romanti*', 'romans', 'romantyczn*']],
    ['crime', 'Crime', [80], [80], ['#7A8CA5', '#121A26'], ['crime', 'criminal*', 'misdaad*', 'krimi*', 'kryminal*', 'policier', 'polar', 'crimen', 'crimine', 'suc']],
    ['adventure', 'Adventure', [12], [10759], ['#F59E0B', '#4A2000'], ['adventure*', 'avontuur*', 'abenteuer*', 'aventur*', 'avventura', 'macera', 'przygod*']],
    ['fantasy', 'Fantasy', [14], [10765], ['#7B61FF', '#1C1050'], ['fantasy', 'fantasie', 'fantastique', 'fantasia', 'fantastik', 'fantastyk*']],
    ['war', 'War', [10752], [10768], ['#8A9A5B', '#1B2210'], ['war', 'oorlog*', 'krieg*', 'guerre', 'guerra', 'belica', 'wojenn*', 'savas']],
    ['western', 'Western', [37], [37], ['#D98E4A', '#3A1A05'], ['western*', 'wildwest', 'faroeste']],
    ['music', 'Music', [10402], [], ['#E040FB', '#2E0645'], ['music*', 'muziek*', 'musik*', 'musique', 'musica', 'muzyk*', 'muzik', 'concert*']],
    ['mystery', 'Mystery', [9648], [9648], ['#5468FF', '#0E1238'], ['myster*', 'misterio', 'mistero', 'gizem', 'tajemnic*']],
    ['history', 'History', [36], [], ['#C49A6C', '#33200C'], ['histor*', 'geschiedenis', 'storia', 'storico', 'tarih*']],
    ['reality', 'Reality', [], [10764], ['#14B8A6', '#062E2B'], ['reality*', 'realite', 'tele-realite', 'telerealite']]
  ];
  var BY_KEY = {}, TM = { movie: {}, series: {} };
  function rx(words) {
    var parts = words.map(function (w) {
      var stem = w.charAt(w.length - 1) === '*';
      var t = (stem ? w.slice(0, -1) : w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ -]/g, '[ -]?');
      return stem ? t + '[a-z]*' : t;
    });
    return new RegExp('(?:^|[^a-z0-9])(?:' + parts.join('|') + ')(?![a-z0-9])');
  }
  GENRES.forEach(function (g, i) {
    var o = { key: g[0], name: g[1], colors: g[4], re: rx(g[5]), order: i };
    BY_KEY[o.key] = o;
    g[2].forEach(function (id) { (TM.movie[id] = TM.movie[id] || []).push(o.key); });
    g[3].forEach(function (id) { (TM.series[id] = TM.series[id] || []).push(o.key); });
  });
  C.genres = GENRES.map(function (g) { return BY_KEY[g[0]]; });

  function matchText(t) {
    var f = B.fold(t);
    if (!f) return [];
    var out = [];
    for (var i = 0; i < C.genres.length; i++) if (C.genres[i].re.test(f)) out.push(C.genres[i].key);
    return out;
  }
  /** Genres volgens de server (veld genres/genre, anders de naam van de categorie); één keer per item. */
  function providerKeys(x) {
    if (x._gk) return x._gk;
    var txt = [x.genres, x.genre].filter(Boolean).join(', ');
    var keys = txt ? matchText(txt) : [];
    if (!keys.length) keys = matchText(x.rawGroup || x.group);
    x._gk = keys;
    return keys;
  }
  /** Genres volgens TMDB (uit de cache van B.ageRatings), of null als die er (nog) niet is. */
  function tmdbKeys(x, isShow) {
    var info = AR && AR.cached(x.rawTitle || x.title, x.year, isShow);
    if (!info || !info.genres) return null;
    var map = isShow ? TM.series : TM.movie, out = [];
    for (var i = 0; i < info.genres.length; i++) {
      var ks = map[info.genres[i]];
      if (ks) for (var j = 0; j < ks.length; j++) if (out.indexOf(ks[j]) < 0) out.push(ks[j]);
    }
    return out;
  }
  C.genresOf = function (x, isShow) {
    var t = tmdbKeys(x, isShow);
    return t && t.length ? t : providerKeys(x);
  };

  // MARK: indeling (per bibliotheekversie en TMDB-bijwerking)

  var arVer = 0;
  B.on('ageRatings', function () { arVer++; });
  /** Films en/of series, zoals de tabbladen (een verborgen tabblad Films of Series telt hier ook niet mee). */
  function kinds() {
    var hid = D.shared('hiddenTabs', []) || [];
    return { movie: hid.indexOf('movies') < 0, series: hid.indexOf('series') < 0 };
  }
  C.available = function () { var k = kinds(); return k.movie || k.series; };
  var idx = null;
  function index() {
    var k = kinds();
    var key = Lib.version + '|' + arVer + '|' + k.movie + k.series + '|' + (Lib.source ? Lib.source.id : '');
    if (idx && idx.key === key) return idx;
    var by = {}, known = 0, total = 0;
    C.genres.forEach(function (g) { by[g.key] = { movie: [], series: [] }; });
    function run(list, type) {
      var isShow = type === 'series';
      for (var i = 0; i < list.length; i++) {
        var x = list[i], t = tmdbKeys(x, isShow), ks = t && t.length ? t : providerKeys(x);
        total++; if (t) known++;
        for (var j = 0; j < ks.length; j++) by[ks[j]][type].push(x);
      }
    }
    if (k.movie) run(Lib.lib.movies, 'movie');
    if (k.series) run(Lib.lib.series, 'series');
    idx = { key: key, by: by, known: known, total: total, sorted: {} };
    return idx;
  }
  /** Categorieën van de server (zelfde naam bij films en series = één tegel), in de volgorde van de server. */
  function serverCats() {
    var k = kinds();
    return Lib.memo('cat:server:' + k.movie + k.series, function () {
      var out = [], at = Object.create(null); // build 97: groep "constructor"/"__proto__" mag geen prototype raken
      var mg = Lib.byGroup('movie'), sg = Lib.byGroup('series');
      function add(groups, map, type) {
        groups.forEach(function (g) {
          var c = at[g];
          if (!c) { c = at[g] = { id: 'server:' + g, name: g, server: true, movie: [], series: [] }; out.push(c); }
          c[type] = map[g] || [];
        });
      }
      if (k.movie) add(Lib.lib.movieGroups || [], mg, 'movie');
      if (k.series) add(Lib.lib.seriesGroups || [], sg, 'series');
      return out;
    });
  }
  var SRV_PAL = [['#E50914', '#3A0003'], ['#2563EB', '#0B1440'], ['#10B981', '#04281C'], ['#F59E0B', '#3D1C02'], ['#A855F7', '#22063D'],
    ['#EC4899', '#3F0A26'], ['#14B8A6', '#062B33'], ['#64748B', '#0F172A'], ['#F97316', '#3A1203'], ['#06B6D4', '#062635']];
  function hash(s) { var x = 0; s = String(s); for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return Math.abs(x); }
  /** Categorie op id: {id, name, colors, movie: [...], series: [...]} of null. */
  C.byId = function (id) {
    if (!id) return null;
    if (id.indexOf('server:') === 0) {
      var name = id.slice(7), list = serverCats();
      for (var i = 0; i < list.length; i++) if (list[i].name === name) return B.assign({ colors: SRV_PAL[hash(name) % SRV_PAL.length] }, list[i]);
      return null;
    }
    var g = BY_KEY[id];
    if (!g) return null;
    var b = index().by[id];
    return { id: id, name: L(g.name), colors: g.colors, movie: b.movie, series: b.series };
  };
  function count(c, type) { return type === 'movie' ? c.movie.length : type === 'series' ? c.series.length : c.movie.length + c.series.length; }

  // MARK: sorteren

  var DAY = 86400000;
  /** Populair: beoordeling (0–10) + bonus voor nieuw (≤ 30 dagen +1, ≤ 180 dagen +0,5); zonder cover achteraan. */
  function popScore(x, now) {
    var s = x.rating || 0;
    if (s > 10) s = s / 10;
    if (x.addedAt) { var age = now - x.addedAt; if (age < 30 * DAY) s += 1; else if (age < 180 * DAY) s += 0.5; }
    if (!x.poster) s -= 20;
    return s;
  }
  C.SORTS = [['popular', 'Popular'], ['newest', 'Newest'], ['az', 'A–Z'], ['rating', 'Rating']];
  function hits(c, type) {
    var out = [];
    if (type !== 'series') c.movie.forEach(function (x) { out.push({ type: 'movie', item: x }); });
    if (type !== 'movie') c.series.forEach(function (x) { out.push({ type: 'series', item: x }); });
    return out;
  }
  function sortHits(list, sort) {
    if (sort === 'az') return S.sortByTitle(list);
    var now = Date.now();
    var dec = list.map(function (hh, i) {
      var x = hh.item, k1, k2;
      if (sort === 'newest') { k1 = x.addedAt || 0; k2 = x.year || 0; }
      else if (sort === 'rating') { k1 = x.rating || 0; k2 = x.poster ? 1 : 0; }
      else { k1 = popScore(x, now); k2 = x.year || 0; }
      return { hh: hh, k1: k1, k2: k2, i: i };
    });
    dec.sort(function (a, b) { return b.k1 - a.k1 || b.k2 - a.k2 || a.i - b.i; });
    return dec.map(function (d) { return d.hh; });
  }
  /** Gesorteerde titels van een categorie, per versie gecachet (wisselen tussen Films/Series/sorteren gaat meteen). */
  C.items = function (c, type, sort) {
    var ix = index(), k = c.id + '|' + type + '|' + sort + '|' + Lib.version;
    if (ix.sorted[k]) return ix.sorted[k];
    return (ix.sorted[k] = sortHits(hits(c, type), sort));
  };
  /** Tot 4 covers voor de tegel: de populairste titels met een cover (zonder alles te sorteren). */
  function collage(c, type) {
    var now = Date.now(), best = [];
    function consider(x) {
      if (!x.poster) return;
      var s = popScore(x, now);
      if (best.length < 4) { best.push({ x: x, s: s }); best.sort(function (a, b) { return b.s - a.s; }); return; }
      if (s > best[3].s) { best[3] = { x: x, s: s }; best.sort(function (a, b) { return b.s - a.s; }); }
    }
    if (type !== 'series') c.movie.forEach(consider);
    if (type !== 'movie') c.series.forEach(consider);
    return best.map(function (b) { return b.x; });
  }

  // MARK: TMDB aanvullen

  /** Genres van TMDB op de achtergrond aanvullen (dezelfde cache als leeftijden en trailers); hooguit 3 rondes per bezoek. */
  function warmer() {
    var runs = 0, alive = true;
    function go() {
      if (!alive || !AR || !AR.hasKey || !AR.hasKey() || AR.isWarming() || runs >= 3) return;
      var ix = index();
      if (ix.total && ix.known >= ix.total) return;
      runs++;
      AR.warm(Lib.raw).then(function () { if (alive) setTimeout(go, 1500); });
    }
    return { start: go, stop: function () { alive = false; } };
  }
  C.filling = function () {
    if (!AR || !AR.isWarming || !AR.isWarming()) return false;
    var ix = index();
    return ix.total > 0 && ix.known < ix.total;
  };
  function fillNote() {
    return h('div.cat-fill' + (C.filling() ? '' : '.hidden'), { role: 'status' }, [h('span.cat-fill-dot'), h('span', L('Filling in genres…'))]);
  }

  // MARK: pijltjestoetsen (toetsenbord en afstandsbediening): naar de dichtstbijzijnde tegel of poster in die richting

  function arrowNav(root, sel) {
    root.addEventListener('keydown', function (e) {
      var dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
      var cur = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (!cur || !root.contains(cur)) return;
      var a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
      var best = null, bestD = Infinity;
      Array.prototype.forEach.call(root.querySelectorAll(sel), function (el) {
        if (el === cur) return;
        var b = el.getBoundingClientRect();
        if (!b.width) return;
        var dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
        var main = dir[0] ? dx * dir[0] : dy * dir[1];
        if (main < 4) return;
        var side = dir[0] ? Math.abs(dy) : Math.abs(dx);
        var d = main + side * 2.5;
        if (d < bestD) { bestD = d; best = el; }
      });
      if (!best) return;
      e.preventDefault();
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }

  // MARK: onderdelen

  function typeFrom(q) { var t = q && q.type; return t === 'movie' || t === 'series' ? t : 'all'; }
  function sortFrom(q) { var s = q && q.sort; return C.SORTS.some(function (x) { return x[0] === s; }) ? s : 'popular'; }
  function query(type, sort) {
    var p = [];
    if (type !== 'all') p.push('type=' + type);
    if (sort && sort !== 'popular') p.push('sort=' + sort);
    return p.length ? '?' + p.join('&') : '';
  }
  C.link = function (id, type) { return R.link(['categorie', id]) + query(type || 'all'); };
  C.overviewLink = function (type) { return '#/categorie' + query(type || 'all'); };

  /** Alles / Films / Series (alleen de soorten die er zijn); onPick(type). */
  function segmented(type, counts, onPick) {
    var k = kinds();
    var opts = [['all', L('All')]];
    if (k.movie) opts.push(['movie', L('Movies')]);
    if (k.series) opts.push(['series', L('Series')]);
    if (opts.length < 3) return null;
    // categorie met alleen films of alleen series: geen keuze nodig
    if (counts && (!counts.movie || !counts.series)) return null;
    var box = h('div.seg', { role: 'tablist', 'aria-label': L('Categories') });
    opts.forEach(function (o) {
      var on = o[0] === type;
      var b = h('button.seg-it' + (on ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false' },
        [h('span', o[1]), counts ? h('span.seg-n', String(counts[o[0]])) : null]);
      b.addEventListener('click', function () { if (o[0] !== type) onPick(o[0]); });
      box.appendChild(b);
    });
    // pijltjes binnen de knoppenbalk
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var all = Array.prototype.slice.call(box.children), i = all.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault(); e.stopPropagation();
      var n = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      n.focus(); n.click();
    });
    return box;
  }
  function countText(n) { return n === 1 ? L('1 title') : L('%d titles', n); }

  /** Tegel: naam, aantal, covers in een waaier op een verloop in de kleur van het genre. */
  function tile(c, type, small) {
    var n = count(c, type);
    var col = c.colors;
    var posters = collage(c, type);
    var art = h('div.cat-art', posters.map(function (x, i) { return h('div.cat-p.cat-p' + (i + 1) + '.n' + posters.length, [U.img(x.poster, 'poster', '')]); }));
    var a = h('a.cat-tile' + (small ? '.srv' : '') + (posters.length ? '' : '.noart'), {
      href: C.link(c.id, type), 'aria-label': c.name + ', ' + countText(n),
      style: '--c1:' + col[0] + ';--c2:' + col[1]
    }, [h('div.cat-glow'), art, h('div.cat-shade'), h('div.cat-txt', [h('div.cat-name', c.name), h('div.cat-count', countText(n))])]);
    a._cat = c.id;
    return a;
  }

  // MARK: overzicht (#/categorie)

  function overview(r) {
    var el = h('div.page.cats');
    var pg = { el: el, title: L('Categories') };
    var type = typeFrom(r.query);
    var grid = null, warm = warmer(), note = null, genreBox = null, shown = '';
    function genreList() { return genresByCount(type); }
    function drawGenres() {
      U.clear(genreBox);
      var list = genreList();
      shown = list.map(function (c) { return c.id + ':' + count(c, type); }).join(',');
      if (!list.length) { genreBox.appendChild(h('p.muted.cat-empty', L('Genres appear here as soon as the details of your movies and series are loaded.'))); return; }
      var g = h('div.cat-grid', list.map(function (c) { return tile(c, type, false); }));
      genreBox.appendChild(g);
    }
    function render() {
      if (grid && grid.destroy) grid.destroy();
      grid = null;
      U.clear(el);
      note = fillNote();
      el.appendChild(h('div.page-head.cat-head', [h('div.cat-h', [h('h1', L('Categories')), h('p.muted.cat-sub', L('Explore your movies and series by genre.'))]), note]));
      var st = S.stateBox ? S.stateBox() : null;
      if (st) { el.appendChild(st); return; }
      var seg = segmented(type, null, function (t) {
        type = t;
        history.replaceState(history.state, '', '#/categorie' + query(type));
        render();
      });
      if (seg) el.appendChild(h('div.cat-bar', [seg]));
      genreBox = h('div.cat-genres');
      el.appendChild(h('section.cat-sec', [h('h2.row-title.cat-sec-title', L('Genres')), genreBox]));
      drawGenres();
      var srv = serverCats().filter(function (c) { return count(c, type) > 0; }).map(function (c) {
        return B.assign({ colors: SRV_PAL[hash(c.name) % SRV_PAL.length] }, c);
      });
      if (srv.length) {
        grid = U.grid(srv, function (c) { return tile(c, type, true); }, 'cat-grid.srv-grid', 24);
        el.appendChild(h('section.cat-sec', [h('h2.row-title.cat-sec-title', [L('From your server'), Lib.source ? h('span.cat-src', Lib.source.name) : null]), grid]));
      }
      warm.start();
    }
    /** Nieuwe genres uit TMDB: alleen opnieuw tekenen als er iets verandert (geen geflikker van covers). */
    function onGenres() {
      if (!genreBox) return;
      if (note) note.classList.toggle('hidden', !C.filling());
      var now = genreList().map(function (c) { return c.id + ':' + count(c, type); }).join(',');
      if (now === shown) return;
      var tiles = genreBox.querySelectorAll('.cat-tile');
      var sameSet = now.replace(/:\d+/g, '') === shown.replace(/:\d+/g, '');
      if (sameSet && tiles.length) {
        Array.prototype.forEach.call(tiles, function (t) {
          var c = C.byId(t._cat); if (!c) return;
          var cn = t.querySelector('.cat-count'); if (cn) cn.textContent = countText(count(c, type));
          t.setAttribute('aria-label', c.name + ', ' + countText(count(c, type)));
        });
        shown = now;
        return;
      }
      var f = document.activeElement && document.activeElement._cat;
      drawGenres();
      if (f) { var t2 = genreBox.querySelector('.cat-tile[href^="' + C.link(f, type).split('?')[0] + '"]'); if (t2) t2.focus({ preventScroll: true }); }
    }
    var offs = [B.on('ageRatings', function () { setTimeout(onGenres, 50); })];
    var tick = setInterval(function () { if (note) note.classList.toggle('hidden', !C.filling()); }, 2000);
    arrowNav(el, '.cat-tile');
    pg.refresh = render;
    pg.onLoading = function () { if (el.querySelector('.state')) render(); };
    pg.destroy = function () { warm.stop(); clearInterval(tick); offs.forEach(function (f) { f(); }); if (grid && grid.destroy) grid.destroy(); };
    render();
    return pg;
  }

  // MARK: categoriepagina (#/categorie/<id>)

  // vorige route: kwam je van het overzicht, dan gaat Terug in de geschiedenis terug (scrollpositie blijft).
  // De router (ui.js) luistert eerder naar hashchange dan wij: tijdens het opbouwen is lastHash nog de vorige route.
  var lastHash = location.hash;
  window.addEventListener('hashchange', function () { lastHash = location.hash; });
  function categoryPage(r) {
    var id = r.parts[1];
    var el = h('div.page.cat-page');
    var pg = { el: el, title: L('Categories') };
    var type = typeFrom(r.query), sort = sortFrom(r.query);
    var grid = null, gridBox = null, head = null, warm = warmer(), note = null, shownLen = -1, c = null;
    var cameFrom = /^#\/categorie\/?(\?|$)/.test(lastHash);
    function back() {
      if (cameFrom && history.length > 1) history.back(); else R.go('/categorie' + query(type));
    }
    function sync() { history.replaceState(history.state, '', R.link(['categorie', id]) + query(type, sort)); }
    function sortLabel() { var s = C.SORTS.filter(function (x) { return x[0] === sort; })[0]; return L(s[1]); }
    function drawGrid() {
      if (grid && grid.destroy) grid.destroy();
      U.clear(gridBox);
      var items = C.items(c, type, sort);
      shownLen = items.length;
      if (!items.length) { gridBox.appendChild(h('div.state.cat-none', [U.icon('grid', 'state-ic'), h('p.muted', L('No titles in this category yet.'))])); grid = null; return; }
      var opts = type === 'all' && c.movie.length && c.series.length ? { kindBadge: true } : {};
      grid = U.grid(items, function (hh) { return S.posterCard(hh.item, hh.type, opts); }, 'posters', 60);
      gridBox.appendChild(grid);
    }
    function drawHead() {
      var counts = { all: count(c, 'all'), movie: c.movie.length, series: c.series.length };
      U.clear(head);
      head.appendChild(h('div.cat-ph-row', [
        U.button('', back, { icon: 'back', cls: 'icon-only cat-back', title: L('All categories') }),
        h('div.cat-ph-t', [h('div.cat-ph-kind', (c.server ? L('From your server') : L('Genre')) + '  ·  ' + countText(counts[type])), h('h1', c.name)]),
        note = fillNote()
      ]));
      var seg = segmented(type, counts, function (t) { type = t; sync(); drawHead(); drawGrid(); focusSeg(); });
      var sortBtn = U.button(sortLabel(), function () {
        U.menu(sortBtn, C.SORTS.map(function (s) {
          return { icon: s[0] === sort ? 'check' : 'blank', label: L(s[1]), fn: function () { if (s[0] === sort) return; sort = s[0]; sync(); drawHead(); drawGrid(); var b = head.querySelector('.cat-sort'); if (b) b.focus(); } };
        }), L('Sort'));
      }, { icon: 'sort', cls: 'cat-sort', title: L('Sort') + ': ' + sortLabel() });
      sortBtn.setAttribute('aria-haspopup', 'menu');
      sortBtn.querySelector('span').after(U.icon('down', 'cat-caret'));
      head.appendChild(h('div.cat-ctl', [seg, sortBtn]));
    }
    function focusSeg() { var b = head.querySelector('.seg-it.on'); if (b) b.focus(); }
    function render() {
      if (grid && grid.destroy) grid.destroy();
      grid = null;
      U.clear(el);
      var st = S.stateBox ? S.stateBox() : null;
      c = C.byId(id);
      if (st) { el.appendChild(st); return; }
      if (!c) {
        el.appendChild(h('div.state', [U.icon('grid', 'state-ic'), h('h2', L('Category not found')),
          h('a.btn.primary', { href: '#/categorie' }, L('All categories'))]));
        return;
      }
      if (!c.movie.length || !c.series.length) type = 'all';
      pg.title = c.name;
      document.title = c.name + ' · Bingr';
      el.style.setProperty('--c1', c.colors[0]);
      el.style.setProperty('--c2', c.colors[1]);
      el.appendChild(h('div.cat-band'));
      head = h('div.cat-ph');
      gridBox = h('div.cat-items');
      el.appendChild(head);
      el.appendChild(gridBox);
      drawHead();
      drawGrid();
      if (!c.server) warm.start();
    }
    function onGenres() {
      if (!c || c.server || !head) return;
      var fresh = C.byId(id);
      if (!fresh) return;
      c = fresh;
      if (note) note.classList.toggle('hidden', !C.filling());
      var n = C.items(c, type, sort).length;
      if (n === shownLen) return;
      // bovenaan: meteen bijwerken; verder naar beneden alleen de aantallen (de lijst springt niet onder je vinger)
      var f = document.activeElement && head.contains(document.activeElement);
      drawHead();
      if (window.scrollY < 300) drawGrid();
      if (f) focusSeg();
    }
    var offs = [B.on('ageRatings', function () { setTimeout(onGenres, 50); })];
    var tick = setInterval(function () { if (note) note.classList.toggle('hidden', !C.filling()); }, 2000);
    var onKey = function (e) {
      if (e.key !== 'Backspace' || U.dialogOpen() || B.player.current) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault(); back();
    };
    document.addEventListener('keydown', onKey);
    arrowNav(el, 'a.card');
    pg.refresh = render;
    pg.onLoading = function () { if (el.querySelector('.state')) render(); };
    pg.destroy = function () {
      warm.stop(); clearInterval(tick); offs.forEach(function (f) { f(); });
      document.removeEventListener('keydown', onKey);
      if (grid && grid.destroy) grid.destroy();
    };
    render();
    return pg;
  }

  // MARK: Home-rij "Categorieën" en de regel in Mijn Bingr (build 86)

  /** Genres met titels, de grootste eerst (zelfde volgorde als het overzicht bij "Alles"). */
  function genresByCount(type) {
    return C.genres.map(function (g) { return C.byId(g.key); }).filter(function (c) { return count(c, type) > 0; })
      .sort(function (a, b) { return count(b, type) - count(a, type) || BY_KEY[a.id].order - BY_KEY[b.id].order; });
  }
  /** Aantal categorieën in het overzicht (genres met titels + categorieën van je server), voor Mijn Bingr. */
  C.total = function () {
    if (!C.available() || !Lib.source) return 0;
    return genresByCount('all').length + serverCats().filter(function (c) { return count(c, 'all') > 0; }).length;
  };
  /**
   * Rij "Categorieën" op Home: de 10 genres met de meeste titels als kleine tegels (verloop, waaier van covers,
   * naam, aantal) en als laatste "Alle categorieën" (naar het overzicht). Geen genres = geen rij.
   */
  C.homeRow = function () {
    if (!C.available()) return null;
    var list = genresByCount('all').slice(0, 10);
    if (!list.length) return null;
    var cards = list.map(function (c) { var t = tile(c, 'all', false); t.classList.add('cat-mini'); return t; });
    cards.push(h('a.cat-tile.cat-mini.cat-all.noart', { href: '#/categorie', 'aria-label': L('All categories'), style: '--c1:#3b3d4a;--c2:#121318' }, [
      h('div.cat-glow'), h('div.cat-all-ic', [U.icon('grid')]), h('div.cat-shade'),
      h('div.cat-txt', [h('div.cat-name', L('All categories')), h('div.cat-count', L('%d categories', C.total()))])
    ]));
    var row = U.row(L('Categories'), cards, 'cat-row', '#/categorie');
    // links/rechts (toetsenbord en afstandsbediening) van tegel naar tegel; omhoog/omlaag blijft de pagina scrollen
    arrowNav(row, '.cat-tile');
    return row;
  };

  S.pages.categorie = function (r) {
    return r.parts[1] ? categoryPage(r) : overview(r);
  };
})();
