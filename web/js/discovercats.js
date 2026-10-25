/*
 * Build 149: rij "Ontdek categorieën" op Home (zoals "Ontdek kanalen en apps" op de Apple TV).
 * Grote tegels per categorie van de server (films en series): bovenin een collage van 3–4 posters uit die categorie,
 * onderin een gekleurde balk met de naam (groot en vet). De kleur komt uit een vaste palet (klassen .dc-c0 … .dc-c9,
 * gekozen op de naam; geen inline stijl). Hoort de categorie bij een streamingdienst (Netflix, Disney+, HBO Max, Prime
 * Video, SkyShowtime, Viaplay, Videoland, Apple TV+, …), dan staat het logo van die dienst in de balk: opgehaald via
 * TMDB (/watch/providers/movie en /tv, regio van de app), bewaard in IndexedDB (een week). Geen logo-bestanden in de repo;
 * zonder TMDB-sleutel of zonder match gewoon de naam als tekst.
 * De grootste zichtbare categorieën (Lib.lib = na verborgen categorieën, kinderslot en leeftijd), hooguit 10. Kinderprofiel:
 * alleen kindercategorieën. Klikken opent de categorie (#/movies/<naam> of #/series/<naam>).
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, Lib = B.lib;
  var h = U.h, R = U.router;
  var L = function () { return B.L.apply(null, arguments); };
  var DC = B.discoverCats = {};
  var MAX = 10, PALETTE = 10;

  // MARK: naam opschonen ("| NL | NETFLIX", "| MULTI / LINGO | NETFLIX", "4K - Disney+", "[EN] Prime Video" → "Netflix", …)
  // build 150: één opschoning voor de hele webspeler (B.catName in core.js; ook de rijen, Categorieën en zoeken)
  DC.cleanName = function (g) { return B.catName(g); };
  /** Vaste kleur per naam (zelfde naam = zelfde kleur op elk apparaat). */
  DC.colorIndex = function (name) {
    var s = B.fold(DC.cleanName(name)), x = 0;
    for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
    return x % PALETTE;
  };

  // MARK: streamingdiensten (logo's van TMDB)

  // woorden die niets zeggen over de dienst ("Netflix Series", "Disney+ Movies 4K")
  var GENERIC = { movies: 1, movie: 1, films: 1, film: 1, series: 1, serie: 1, shows: 1, show: 1, '4k': 1, uhd: 1, hd: 1, fhd: 1, sd: 1,
    vod: 1, originals: 1, original: 1, collection: 1, collectie: 1, nl: 1, en: 1, multi: 1, new: 1, nieuw: 1, kids: 1, all: 1 };
  function words(s) { return B.fold(s).replace(/\+/g, ' plus ').split(/[^a-z0-9]+/).filter(Boolean); }
  /** Sleutel van een dienstnaam: "Disney+" en "Disney Plus" → "disneyplus". */
  DC.providerKey = function (s) { return words(s).join(''); };
  /** Sleutel van een categorie: zonder voorvoegsel en zonder algemene woorden aan het eind. */
  DC.categoryKey = function (g) {
    var w = words(DC.cleanName(g));
    while (w.length > 1 && GENERIC[w[w.length - 1]]) w.pop();
    while (w.length > 1 && GENERIC[w[0]]) w.shift();
    return w.join('');
  };
  // kleine aliastabel: categorienaam → mogelijke sleutels bij TMDB (eerste die bestaat)
  var ALIAS = {
    hbo: ['hbomax', 'max'], max: ['hbomax', 'max'], hbomax: ['hbomax', 'max'],
    prime: ['amazonprimevideo', 'primevideo'], primevideo: ['amazonprimevideo', 'primevideo'], amazon: ['amazonprimevideo', 'primevideo'],
    amazonprime: ['amazonprimevideo', 'primevideo'], amazonvideo: ['amazonprimevideo', 'amazonvideo'],
    disney: ['disneyplus'], disneyplus: ['disneyplus'],
    apple: ['appletvplus', 'appletv'], appletv: ['appletvplus', 'appletv'], appletvplus: ['appletvplus', 'appletv'],
    sky: ['skyshowtime'], showtime: ['skyshowtime', 'showtime'], paramount: ['paramountplus'], paramountplus: ['paramountplus'],
    npo: ['npoplus', 'npostart'], npoplus: ['npoplus', 'npostart'], npostart: ['npostart', 'npoplus'], ziggo: ['ziggogo', 'ziggotv'], pathe: ['patheathome', 'pathethuis'],
    // build 150: meer vormen die servers gebruiken
    netflixkids: ['netflix', 'netflixkids'], netflixoriginals: ['netflix'], hbomaxoriginals: ['hbomax', 'max'], maxoriginals: ['hbomax', 'max'],
    amazonprimevideo: ['amazonprimevideo', 'primevideo'], primevideoamazon: ['amazonprimevideo', 'primevideo'], amazonprimevid: ['amazonprimevideo'],
    disneypluskids: ['disneyplus'], disneyplusoriginals: ['disneyplus'], skyshowtimeoriginals: ['skyshowtime'],
    appletvoriginals: ['appletvplus', 'appletv'], appletvplusoriginals: ['appletvplus', 'appletv'], appleoriginals: ['appletvplus', 'appletv'],
    videolandplus: ['videoland'], videolandoriginals: ['videoland'], viaplayoriginals: ['viaplay'], nlziet: ['nlziet'],
    discovery: ['discoveryplus'], discoveryplus: ['discoveryplus'], canal: ['canalplus'], canalplus: ['canalplus'], vtmgo: ['vtmgo'],
    goplay: ['goplay'], streamz: ['streamz'], dazn: ['dazn'], pathethuis: ['pathethuis', 'patheathome'], patheathome: ['patheathome', 'pathethuis'],
    npo1: ['npostart', 'npoplus'], npostartplus: ['npoplus', 'npostart']
  };
  /** Logo-URL voor een categorie uit een index {sleutel: url}; null als hij niet bij een dienst hoort. */
  DC.logoFor = function (g, index) {
    if (!index) return null;
    var k = DC.categoryKey(g);
    if (!k || k.length < 2) return null;
    if (B.has(index, k)) return index[k];
    var al = B.has(ALIAS, k) ? ALIAS[k] : null;
    if (al) for (var i = 0; i < al.length; i++) if (B.has(index, al[i])) return index[al[i]];
    return null;
  };
  /** TMDB-lijsten → index {sleutel: logo-URL}; de dienst met de hoogste voorrang (display_priority) wint. */
  DC.buildIndex = function (lists) {
    var idx = {}, prio = {};
    (lists || []).forEach(function (r) {
      ((r && r.results) || []).forEach(function (p) {
        if (!p || !p.logo_path || !p.provider_name) return;
        var k = DC.providerKey(p.provider_name);
        if (!k) return;
        var pr = p.display_priority != null ? +p.display_priority : 999;
        if (B.has(prio, k) && prio[k] <= pr) return;
        prio[k] = pr;
        idx[k] = 'https://image.tmdb.org/t/p/w300' + p.logo_path;
      });
    });
    return idx;
  };
  var WEEK = 7 * 86400000, logoIndex = null, logoAsk = null;
  function region() { return B.discover && B.discover.region ? B.discover.region() : 'NL'; }
  /** Index van de logo's (cache in IndexedDB `tmdbProviders:<regio>`, een week). Promise; nooit een fout. */
  DC.logos = function () {
    if (logoIndex) return Promise.resolve(logoIndex);
    if (logoAsk) return logoAsk;
    var AR = B.ageRatings, reg = region(), key = 'tmdbProviders:' + reg;
    logoAsk = B.idb.get(key).then(function (c) {
      if (c && c.idx && Date.now() - (c.at || 0) < WEEK) return c.idx;
      if (!AR || !AR.tmdb) return c && c.idx ? c.idx : null;
      var q = [['watch_region', reg]];
      return Promise.all([AR.tmdb('/watch/providers/movie', q), AR.tmdb('/watch/providers/tv', q)]).then(function (r) {
        if (!r[0] && !r[1]) return c && c.idx ? c.idx : null;
        var idx = DC.buildIndex(r);
        B.idb.set(key, { at: Date.now(), idx: idx });
        return idx;
      }, function () { return c && c.idx ? c.idx : null; });
    }).then(function (idx) { logoIndex = idx || null; logoAsk = null; return logoIndex; }, function () { logoAsk = null; return null; });
    return logoAsk;
  };
  B.on('wipe', function () { logoIndex = null; });

  // MARK: welke categorieën

  /** [{type, group, name, n, posters: [url]}] — de grootste zichtbare categorieën, films en series samen, hooguit 10. */
  DC.pick = function (lib, kids) {
    lib = lib || Lib.lib;
    var PC = B.parental, out = [];
    [['movie', lib.movieGroups || []], ['series', lib.seriesGroups || []]].forEach(function (t) {
      if (!t[1].length) return;
      var by = Lib.byGroup(t[0]);
      t[1].forEach(function (g) {
        var list = by[g] || [];
        if (!list.length) return;
        if (kids && PC && PC.isKidsCategory && !PC.isKidsCategory(list[0].rawGroup || g)) return;
        out.push({ type: t[0], group: g, n: list.length, list: list });
      });
    });
    out.sort(function (a, b) { return b.n - a.n; });
    // dezelfde (opgeschoonde) naam bij films en series: alleen de grootste
    var seen = Object.create(null), res = [];
    for (var i = 0; i < out.length && res.length < MAX; i++) {
      var c = out[i], name = DC.cleanName(c.group) || c.group, k = B.fold(name);
      if (seen[k]) continue;
      seen[k] = true;
      var posters = [];
      for (var j = 0; j < c.list.length && posters.length < 4; j++) if (c.list[j].poster) posters.push(c.list[j].poster);
      if (posters.length < 3) continue; // collage van 3–4 posters, anders past de tegel niet
      // build 150: samengevoegd uit meer categorieën (talen, kwaliteit) = taalchips op de tegel ("NL · Multi")
      var tags = Lib.groupSources && Lib.groupSources(c.type, c.group).length > 1 ? Lib.groupTags(c.type, c.group) : [];
      res.push({ type: c.type, group: c.group, name: name, n: c.n, posters: posters, tags: tags });
    }
    return res;
  };

  // MARK: rij

  function tile(c) {
    var art = h('div.dc-art.n' + c.posters.length, c.posters.map(function (p) { return h('div.dc-p', [U.img(p, 'poster', '')]); }));
    var bar = h('div.dc-bar', [h('div.dc-name', c.name), c.tags && c.tags.length ? h('div.dc-tags', c.tags.join(' · ')) : null]);
    var a = h('a.dc-tile.dc-c' + DC.colorIndex(c.name), {
      href: R.link([c.type === 'series' ? 'series' : 'movies', c.group]),
      'aria-label': c.name + ', ' + (c.n === 1 ? L('1 title') : L('%d titles', c.n))
    }, [art, bar]);
    a._dc = c;
    a._bar = bar;
    return a;
  }
  function setLogo(a, url) {
    if (!url || a._logo) return;
    a._logo = true;
    var img = document.createElement('img');
    img.className = 'dc-logo';
    img.alt = a._dc.name;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onload = function () { a.classList.add('has-logo'); };
    img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); a.classList.remove('has-logo'); };
    img.src = url;
    a._bar.insertBefore(img, a._bar.firstChild);
  }
  function arrowNav(root) {
    root.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.documentElement.dir === 'rtl') d = -d;
      var cur = e.target && e.target.closest ? e.target.closest('.dc-tile') : null;
      if (!cur) return;
      var all = Array.prototype.slice.call(root.querySelectorAll('.dc-tile'));
      var next = all[all.indexOf(cur) + d];
      if (!next) return;
      e.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }
  /** De rij voor Home (of null): niet bij een kinderprofiel, behalve met alleen kindercategorieën. */
  DC.homeRow = function () {
    var p = B.app && B.app.profile, kids = !!(p && p.kids);
    var cats = Lib.memo('discoverCats:' + (kids ? 'k' : 'a'), function () { return DC.pick(Lib.lib, kids); });
    if (!cats.length) return null;
    var tiles = cats.map(tile);
    var row = U.row(L('Discover categories'), tiles, 'dc-row');
    if (!row) return null;
    arrowNav(row);
    function apply(idx) { if (idx) tiles.forEach(function (a) { setLogo(a, DC.logoFor(a._dc.group, idx)); }); }
    if (logoIndex) apply(logoIndex); else DC.logos().then(apply);
    return row;
  };
})();
