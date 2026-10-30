/*
 * Bingr web: Mijn Bingr en alles wat daarbij hoort, zoals in de apps. Kijkgeschiedenis, collecties (maken, wijzigen,
 * verwijderen, volgorde, "Aan collectie toevoegen…"), bekeken (vinkjes, handmatig afvinken), Trakt en OpenSubtitles
 * koppelen (alleen het hoofdprofiel), profielen beheren (alleen het hoofdprofiel), de indeling van het startscherm
 * en "Voor jou". Zelfde gegevens en formaten als de apps (zie sync.js en connections.js).
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, A = B.account, Lib = B.lib, S = B.screens;
  var h = U.h, R = U.router;
  var L = function () { return B.L.apply(null, arguments); };

  ['history', 'collections', 'collection', 'profiles', 'homelayout', 'catprefs', 'settings', 'support', 'stats', 'categorie'].forEach(function (k) { S.navOwner[k] = 'mybingr'; });

  function prof() { return B.app.profile; }
  function srcId() { return Lib.source ? Lib.source.id : ''; }
  function isMain() { return D.isMain(prof()); }

  // MARK: Mijn lijst, bekeken en het contextmenu (zoals de contextMenu's in de apps)

  /** Mijn lijst aan/uit; bij het hoofdprofiel volgt de Trakt-watchlist mee (zoals toggleMyList op iOS). */
  /** build 128: sleutel van een item (andere server: x._src; tegel uit catalogmeta: x._key). */
  function keyOf(x) { return B.xs ? B.xs.keyOf(x) : D.key(srcId(), x.id); }
  S.keyOf = keyOf;
  /** Sleutels in Mijn lijst voor dit item: de eigen sleutel, en bij een TMDB-titel die op elke server (hoort bij geen server). */
  function listKeys(x) {
    if (x.external) return D.setList('myList').filter(function (k) { var i = k.indexOf('|'); return i > 0 && k.slice(i + 1) === String(x.id); });
    // build 151: tegel uit Mijn lijst die voor meer servers staat (samengevoegd): alle sleutels die er nog in staan
    return [keyOf(x)].concat(x._listAlso || []).filter(function (k, i, all) { return all.indexOf(k) === i && D.inSet('myList', k); });
  }
  S.inMyList = function (x) { return listKeys(x).length > 0; };
  S.toggleMyList = function (x, type) {
    var keys = listKeys(x);
    var on = !keys.length;
    if (on) D.toggleSet('myList', keyOf(x), true);
    else keys.forEach(function (k) { D.toggleSet('myList', k, false); });
    if (isMain() && B.trakt.isLoggedIn()) B.trakt.setWatchlist(x, type === 'series', on);
    U.toast(on ? L('Added to My List') : L('Removed from My List'));
  };
  /** Film (on)bekeken: lokaal per profiel en, als Trakt gekoppeld is, ook daar (zoals toggleWatchedMovie op iOS). */
  S.setMovieWatched = function (m, on) {
    D.setWatched(m.id, on);
    if (on) D.clearProgress(m.id);
    if (B.trakt.isLoggedIn()) B.trakt.setWatched(B.player.movieItem(m), on);
  };

  /** build 132: Delen (eigen Bingr-link, bingr.online/titel/…) voor een film of serie, als er een titel is. */
  function shareItem(x, type) {
    return B.titleLink && B.titleLink.canShare(x, type) ? [{ icon: 'share', label: L('Share'), fn: function () { B.titleLink.share(x, type); } }] : [];
  }
  /** Acties voor een kaart: film, serie of zender. opts: {continueKeys, collection}. */
  S.cardMenu = function (x, type, opts) {
    opts = opts || {};
    var items = [];
    if (type === 'movie' || type === 'series') {
      var inList = S.inMyList(x);
      items.push({ icon: U.plusCheckIcon(inList), label: inList ? L('Remove from My List') : L('Add to My List'), fn: function () { S.toggleMyList(x, type); } });
      // build 111: titel uit TMDB (niet in je bibliotheek): alleen Mijn lijst en Meer info
      if (x.external) return items.concat([{ icon: 'info', label: L('More info'), fn: function () { R.go(S.titleLink(type, x).slice(1)); } }], shareItem(x, type));
      // build 128: tegel uit catalogmeta (server verwijderd of titel weg): Mijn lijst, Meer info (= zoeken) en uit de rij halen
      if (x._key || x._noKey) return items.concat(phMenu(x, type, opts), shareItem(x, type));
      if (type === 'movie') {
        var w = S.movieWatched(x);
        items.push({ icon: w ? 'eyeOff' : 'checkCircle', label: w ? L('Mark as unwatched') : L('Mark as watched'), fn: function () { S.setMovieWatched(x, !w); } });
      }
      items.push({ icon: 'info', label: L('More info'), fn: function () { R.go(S.titleLink(type, x).slice(1)); } });
      items = items.concat(shareItem(x, type));
    } else if (type === 'channel') {
      if (x._key || x._noKey) return phMenu(x, type, opts);
      var fk = keyOf(x), fav = D.inSet('favorites', fk);
      items.push({ icon: 'play', label: L('Watch live'), fn: function () { B.player.playChannel(x, [x]); } });
      items.push({ icon: U.plusCheckIcon(fav), label: fav ? L('Remove from favorites') : L('Add to favorites'), fn: function () { D.toggleSet('favorites', fk); } });
    }
    var ci = S.collItem(x, type);
    items.push({ icon: 'stackAdd', label: L('Add to collection…'), fn: function () { S.addToCollection(ci, x.title || x.name); } });
    var c = opts.collection;
    if (c && c.kind !== 'smart' && D.collectionHas(c, x._collItem || ci)) {
      items.push({ icon: 'minus', label: L('Remove from collection'), danger: true, fn: function () { D.toggleInCollection(prof().id, c.id, x._collItem || ci); } });
    }
    if (opts.continueKeys && opts.continueKeys.length) {
      items.push({ icon: 'close', label: L('Remove from Continue watching'), danger: true, fn: function () { opts.continueKeys.forEach(function (k) { D.clearProgress(k); }); } });
    }
    return items;
  };

  /** build 128: collectie-item {type, id, sid} (sid = server van het item). */
  S.collItem = function (x, type) {
    var src = B.xs ? B.xs.srcOf(x) : Lib.source;
    var o = { type: type, id: String(x.id) };
    if (src) o.sid = src.id;
    return o;
  };
  /** Menu van een tegel uit catalogmeta. */
  function phMenu(x, type, opts) {
    var items = [];
    var tile = { type: type, item: x };
    items.push({ icon: type === 'channel' ? 'play' : 'info', label: type === 'channel' ? L('Watch live') : L('More info'), fn: function () { B.xs.open(tile); } });
    var f = x._field;
    if (type === 'channel' && x._key && D.inSet('favorites', x._key)) items.push({ icon: U.plusCheckIcon(true), label: L('Remove from favorites'), fn: function () { D.toggleSet('favorites', x._key, false); } });
    var c = opts && opts.collection;
    if (c && x._collItem) items.push({ icon: 'minus', label: L('Remove from collection'), danger: true, fn: function () { D.toggleInCollection(prof().id, c.id, x._collItem); } });
    if (f === 'continue' && x._progressKeys) items.push({ icon: 'close', label: L('Remove from Continue watching'), danger: true, fn: function () { x._progressKeys.forEach(function (k) { D.clearProgress(k); }); } });
    if (f === 'recentChannels' && x._key) items.push({ icon: 'close', label: L('Remove'), danger: true, fn: function () { D.toggleSet('recentChannels', x._key, false); } });
    return items;
  }

  // MARK: rijen (Verder kijken, collecties, Voor jou)

  /** Verder kijken: films met voortgang en per serie één kaart (alle sleutels van die serie, om te verwijderen). */
  /**
   * build 141: Verder kijken toont de cover van de film of serie, geen still van de scène. Een M3U-serie neemt de afbeelding
   * van een aflevering als poster; zo'n afbeelding (of geen, of alleen de opgeslagen afbeelding van de voortgang) wordt op
   * de achtergrond vervangen door de poster uit TMDB.
   */
  function stillGuess(c) {
    var x = c.x;
    if (x._posterGuess) return true;
    if (!x.poster) return true;
    if (c.type === 'series') return (x.episodes || []).some(function (e) { return e && e.still && e.still === x.poster; });
    return false;
  }
  function contCard(c) {
    var card = S.posterCard(c.x, c.type, { progress: c.p, continueKeys: c.keys });
    if (B.details && B.details.poster && stillGuess(c)) {
      B.details.poster(c.x, c.type === 'series').then(function (url) {
        if (!url) return;
        var box = card.querySelector('.card-img .imgbox');
        if (!box) return;
        var fresh = U.img(url, 'poster', c.x.title);
        box.parentNode.replaceChild(fresh, box);
      });
    }
    return card;
  }
  S.continueCards = function (max) {
    // build 128: over alle servers
    if (B.xs) return B.xs.continueEntries(max || 20).map(function (c) { return contCard(c); });
    var lib = Lib.lib, out = [];
    var byTitle = Lib.memo('seriesByTitle', function () { var m = {}; lib.series.forEach(function (s) { if (!m[s.title]) m[s.title] = s; }); return m; });
    var seen = {}, seriesKeys = {};
    D.progressList().forEach(function (pe) {
      var hit = lib.byId[pe.key];
      if (hit && hit.type === 'movie') { if (out.length < (max || 20)) out.push({ x: hit.item, type: 'movie', p: pe.e.fraction, keys: [pe.key] }); }
      else if (!hit || hit.type !== 'channel') {
        var s = byTitle[pe.e.title];
        if (!s) return;
        (seriesKeys[s.id] = seriesKeys[s.id] || []).push(pe.key);
        if (!seen[s.id] && out.length < (max || 20)) { seen[s.id] = true; out.push({ x: s, type: 'series', p: pe.e.fraction, keys: seriesKeys[s.id] }); }
      }
    });
    return out.map(contCard);
  };

  S.collectionChannels = function (c) {
    return Lib.collectionItems(c, 200).filter(function (x) { return x.type === 'channel'; }).map(function (x) { return x.item; });
  };
  /** Rij van een eigen collectie; only = 'movie' of 'series' (op Films/Series alleen die soort). */
  S.collectionRow = function (c, only) {
    var items = Lib.collectionItems(c, 200);
    if (only) items = items.filter(function (x) { return x.type === only; });
    if (!items.length) return null;
    var chans = items.filter(function (x) { return x.type === 'channel'; }).map(function (x) { return x.item; });
    var cards = items.slice(0, 60).map(function (x) {
      return x.type === 'channel' ? S.channelCard(x.item, chans, { collection: c }) : S.posterCard(x.item, x.type, { collection: c });
    });
    return U.row(c.name, cards, chans.length === items.length ? 'live' : null, items.length > 6 ? R.link(['collection', c.id]) : null);
  };

  /** Startscherm-indeling (HomeLayout op iOS): vaste rijen en collecties, onbekende sleutels genegeerd. */
  // 'browse' (build 86) = rij "Categorieën" met genretegels; standaard direct na 'live' (= op Home 5 rijen tussen "Nu live" en
  // "Categorieën", zie screens.js). Zelfde sleutel als iOS/tvOS/macOS en Android/Samsung TV; oudere sleutels 'genres' (web)
  // en 'categorytiles' (Android) worden bij het lezen 'browse' (plek en aan/uit blijven, dubbele vervallen).
  // build 111: 'upcoming' (Binnenkort op Bingr) en 'streaming' (Nieuw op Bingr; namen build 112), TMDB; standaard aan, na 'recent'
  // build 141: de rij "Nieuw toegevoegd" ('recent') is weg; "Nieuw op Bingr" ('streaming') staat op zijn plek (een opgeslagen
  // 'recent' telt als 'streaming' met dezelfde plek en aan/uit; de sleutel blijft in de opgeslagen indeling voor andere apps)
  // build 149: 'discovercats' = Ontdek categorieën, standaard aan, na Top 10
  // build 151: 'channels' = Zenders (zenderlogo's), standaard aan, direct na Ontdek categorieën
  // build 152: 'nowplaying' = Nu in de bioscoop (TMDB), standaard aan, direct na Binnenkort op Bingr
  var KNOWN = ['continue', 'mylist', 'streaming', 'upcoming', 'nowplaying', 'foryou', 'top10', 'discovercats', 'channels', 'live', 'browse', 'categories', 'movies', 'series'];
  var ALIAS = { genres: 'browse', categorytiles: 'browse' };
  var REPLACED = { recent: 'streaming' };
  var DEFAULT_HIDDEN = { movies: true, series: true };
  S.homeKnownKeys = KNOWN;
  S.effectiveHomeLayout = function (rows, colls) {
    var collKeys = (colls || []).map(function (c) { return 'collection:' + c.id; });
    var valid = {};
    KNOWN.concat(collKeys).forEach(function (k) { valid[k] = true; });
    var out = [], seen = {};
    // build 141: staat 'recent' in de opgeslagen indeling, dan komt de (enige) rij Nieuw op Bingr op díe plek; een eigen
    // 'streaming'-regel elders telt dan niet (ook niet als hij ervóór staat)
    var hasRecent = (rows || []).some(function (r) { return r && r.key === 'recent'; });
    (rows || []).forEach(function (r) {
      if (!r) return;
      if (hasRecent && r.key === 'streaming') return;
      var key = ALIAS[r.key] || REPLACED[r.key] || r.key;
      if (!valid[key] || seen[key]) return;
      seen[key] = true;
      out.push({ key: key, visible: r.visible !== false });
    });
    KNOWN.forEach(function (k, i) {
      if (seen[k]) return;
      seen[k] = true;
      var row = { key: k, visible: !DEFAULT_HIDDEN[k] };
      // op zijn standaardplek: na de laatste vaste rij die ervoor hoort
      var prev = -1;
      for (var j = 0; j < out.length; j++) if (KNOWN.indexOf(out[j].key) >= 0 && KNOWN.indexOf(out[j].key) < i) prev = j;
      if (i > 0 && prev >= 0) out.splice(prev + 1, 0, row);
      else if (i === 0) out.unshift(row);
      else out.push(row);
    });
    collKeys.forEach(function (k) { if (!seen[k]) { seen[k] = true; out.push({ key: k, visible: true }); } });
    return out;
  };
  /** Bewerkte rijen terug in de opgeslagen lijst; onbekende sleutels van andere apps blijven bewaard (applying op iOS). */
  S.applyHomeLayout = function (stored, edited) {
    var ed = {};
    edited.forEach(function (r) { ed[r.key] = true; });
    var keep = (stored || []).filter(function (r) { return r && !ed[r.key] && !ALIAS[r.key] && KNOWN.indexOf(r.key) < 0 && String(r.key).indexOf('collection:') !== 0; });
    return edited.concat(keep);
  };
  S.homeRowTitle = function (key, colls) {
    var t = { 'continue': L('Continue watching'), mylist: L('My List'), recent: L('Recently added'), upcoming: L('Coming soon to Bingr'), nowplaying: L('Now in cinemas'),
      streaming: L('New on Bingr'), foryou: L('For you'), top10: L('Top 10'), discovercats: L('Discover categories'), channels: L('Channels'),
      live: L('Favorite channels'), browse: L('Categories'), categories: L('Rows per category'), movies: L('Movies'), series: L('Series') }[key];
    if (t) return t;
    if (String(key).indexOf('collection:') === 0) {
      var id = key.slice(11);
      for (var i = 0; i < (colls || []).length; i++) if (colls[i].id === id) return colls[i].name;
      return L('Collection');
    }
    return key;
  };

  function normTitle(t) { return B.fold(B.parseTitle(t || '').title).replace(/[^a-z0-9]+/g, ' ').trim(); }
  function titleIndex(type) {
    return Lib.memo('titleIndex:' + type, function () {
      var m = {};
      (type === 'movie' ? Lib.lib.movies : Lib.lib.series).forEach(function (x) {
        var k = normTitle(x.rawTitle || x.title);
        if (k && !m[k]) m[k] = x;
      });
      return m;
    });
  }
  /**
   * build 140: "Voor jou" van HET actieve profiel (zoals de apps): de laatst en meest bekeken titels uit de geschiedenis en
   * Verder kijken van dit profiel zijn de "zaadjes". Hun genres (TMDB, anders de server), hun categorie op de server en (met
   * TMDB) hun "recommendations" bepalen de score van titels uit je bibliotheek (alle servers, gefilterd: kinder- en
   * leeftijdsfilter). Nooit wat al bekeken, bezig of uitgekeken is. Zonder geschiedenis: {popular: true} met populaire
   * titels (kop "Populair"). Geeft {items: [{type, item}], popular}.
   */
  var recs = {}, recsAsked = {}, recsVer = 0;
  function workOf(type, x) { return (B.xs && B.xs.workKey(type, x)) || (type + '|' + x.id); }
  /** Zaadjes: [{type, item, w}] uit geschiedenis en voortgang van dit profiel, recent zwaarder, vaker = zwaarder. */
  function seeds() {
    var out = [], byWork = Object.create(null);
    function viewFor(sid) { return B.xs ? (sid ? B.xs.view(sid) : Lib.lib) : Lib.lib; }
    function seriesByTitle(v, title) {
      if (!v || !v.series) return null;
      var memo = v._fyByTitle;
      if (!memo) { memo = v._fyByTitle = Object.create(null); v.series.forEach(function (x) { var k = normTitle(x.rawTitle || x.title); if (k && !memo[k]) memo[k] = x; }); }
      return memo[normTitle(title)] || null;
    }
    function add(type, x, w) {
      if (!x) return;
      var k = workOf(type, x);
      if (byWork[k]) { byWork[k].w += w * 0.6; return; }
      byWork[k] = { type: type, item: x, w: w };
      out.push(byWork[k]);
    }
    var hist = D.history().slice(0, 60);
    hist.forEach(function (e, i) {
      if (e.type === 'live') return;
      var w = 1 / (1 + i * 0.2);
      var v = viewFor(e.playlistID || (Lib.source && Lib.source.id));
      if (!v || !v.byId) return;
      var hit = v.byId[e.itemID];
      if (hit && (hit.type === 'movie' || hit.type === 'series')) { add(hit.type, hit.item, w); return; }
      if (e.type === 'episode' || e.type === 'series') add('series', seriesByTitle(v, e.title), w);
    });
    D.progressList().slice(0, 30).forEach(function (pe, i) {
      var v = viewFor(pe.e.playlistID || (Lib.source && Lib.source.id));
      if (!v || !v.byId) return;
      var hit = v.byId[pe.key];
      var w = 0.8 / (1 + i * 0.25);
      if (hit && hit.type === 'movie') add('movie', hit.item, w);
      else if (!hit) add('series', seriesByTitle(v, pe.e.title), w);
    });
    return out.sort(function (a, b) { return b.w - a.w; }).slice(0, 15);
  }
  /** Al gezien/bezig/uitgekeken door dit profiel? */
  function done(type, x) {
    if (D.progress(x.id)) return true;
    if (type === 'movie') return S.movieWatched(x);
    return S.seriesWatchedCount(x) > 0;
  }
  /** TMDB-aanbevelingen van de belangrijkste zaadjes (op de achtergrond, één keer per titel per sessie). */
  function askRecs(list) {
    if (!B.details || !B.ageRatings || !B.ageRatings.hasKey()) return;
    list.slice(0, 3).forEach(function (sd) {
      var k = workOf(sd.type, sd.item);
      if (recsAsked[k]) return;
      recsAsked[k] = true;
      B.details.load(sd.item, sd.type === 'series', {}).then(function (d) {
        var r = (d && d.recommendations) || [];
        if (!r.length) return;
        recs[k] = r;
        recsVer++;
        B.emit('forYou');
      }, B.noop);
    });
  }
  function titleIndexAll(libs) {
    var key = 'fyTitleIdx:' + Lib.version + ':' + (B.xs ? B.xs.version : 0) + ':' + libs.length;
    return Lib.memo(key, function () {
      var m = Object.create(null);
      libs.forEach(function (lib) {
        [['movie', lib.movies || []], ['series', lib.series || []]].forEach(function (pl) {
          pl[1].forEach(function (x) { var k = pl[0] + '|' + normTitle(x.rawTitle || x.title); if (!m[k]) m[k] = x; });
        });
      });
      return m;
    });
  }
  /** build 151: rij zonder dubbele titels (zelfde titel op meer servers = één, bron in de audio-/app-taal, dan de actieve). */
  function dedupeRow(list) { return B.xs && B.xs.dedupeHome ? B.xs.dedupeHome(list) : list; }
  S.dedupeRow = dedupeRow;
  function popular(libs) {
    var out = [], seen = Object.create(null), MAXP = 90;
    // build 151: per item (server + id) één keer; dezelfde titel op meer servers ontdubbelt dedupeRow aan het eind
    function add(type, x) { if (!x || done(type, x)) return; var k = type + '|' + (x._src ? x._src.id : '') + '|' + x.id; if (seen[k]) return; seen[k] = true; out.push({ type: type, item: x }); }
    var tm = Lib.top10(Lib.lib.movies), ts = Lib.top10(Lib.lib.series);
    for (var t = 0; t < 10; t++) { add('movie', tm[t]); add('series', ts[t]); }
    // aanvullen met de best beoordeelde en nieuwste van alle servers
    var pool = [];
    libs.forEach(function (lib) {
      (lib.movies || []).slice(0, 3000).forEach(function (x) { pool.push({ type: 'movie', item: x }); });
      (lib.series || []).slice(0, 3000).forEach(function (x) { pool.push({ type: 'series', item: x }); });
    });
    function sc(x) { var r = x.rating || 0; if (r > 10) r = r / 10; return r + (x.addedAt && Date.now() - x.addedAt < 30 * 86400000 ? 1 : 0); }
    // build 147: eerst alleen de beste ~300 sorteren; is dat niet genoeg (veel al bekeken), dan de rest erachter
    var top = B.discover && B.discover.topBy && pool.length > 2000 ? B.discover.topBy(pool, 300, function (e) { return sc(e.item); }) : pool;
    top.sort(function (a, b) { return sc(b.item) - sc(a.item); });
    for (var i = 0; i < top.length && out.length < MAXP; i++) add(top[i].type, top[i].item);
    if (out.length < MAXP && top !== pool) {
      pool.sort(function (a, b) { return sc(b.item) - sc(a.item); });
      for (var i2 = 0; i2 < pool.length && out.length < MAXP; i2++) add(pool[i2].type, pool[i2].item);
    }
    return dedupeRow(out).slice(0, 30);
  }
  // build 147: Voor jou vooraf (vóór het event 'library'), zodat Home en Uitgelicht hem uit Lib.memo halen
  if (Lib && Lib.warmers) Lib.warmers.push(function () { if (B.app && B.app.profile && S.forYou) S.forYou(); });
  S.forYou = function () {
    var p = prof();
    var libs = B.xs ? B.xs.libs(null) : [Lib.lib];
    var hist = D.history(), prog = D.progressList();
    var sig = (p ? p.id : '') + ':' + hist.length + ':' + (hist[0] ? hist[0].date : 0) + ':' + prog.length + ':' + (prog[0] ? prog[0].e.updated : 0) +
      ':' + D.setList('watched').length + ':' + recsVer + ':' + (B.xs ? B.xs.version : 0) + ':' + libs.length;
    return Lib.memo('forYou140:' + sig, function () {
      var sd = seeds();
      if (!sd.length) return { popular: true, items: popular(libs) };
      askRecs(sd);
      var gw = Object.create(null), grp = Object.create(null), seedWork = Object.create(null), total = 0;
      sd.forEach(function (x) {
        total += x.w;
        seedWork[workOf(x.type, x.item)] = true;
        var ks = B.categories ? B.categories.genresOf(x.item, x.type === 'series') : [];
        ks.forEach(function (g) { gw[g] = (gw[g] || 0) + x.w; });
        var g0 = x.item.rawGroup || x.item.group;
        if (g0) grp[x.type + '|' + g0] = (grp[x.type + '|' + g0] || 0) + x.w;
      });
      // aanbevelingen (TMDB) van de zaadjes → titels uit je bibliotheek
      var recScore = Object.create(null);
      var tix = null;
      sd.forEach(function (x) {
        var list = recs[workOf(x.type, x.item)];
        if (!list) return;
        tix = tix || titleIndexAll(libs);
        list.forEach(function (r, i) {
          var hit = tix[(r.isShow ? 'series' : 'movie') + '|' + normTitle(r.title)] || (r.original ? tix[(r.isShow ? 'series' : 'movie') + '|' + normTitle(r.original)] : null);
          if (!hit) return;
          var k = workOf(r.isShow ? 'series' : 'movie', hit);
          recScore[k] = (recScore[k] || 0) + 3 * x.w / (1 + i * 0.1);
        });
      });
      var cands = [], seen = Object.create(null);
      libs.forEach(function (lib) {
        [['movie', lib.movies || []], ['series', lib.series || []]].forEach(function (pl) {
          var list = pl[1], type = pl[0];
          for (var i = 0; i < list.length && i < 20000; i++) {
            var x = list[i];
            var ks = B.categories ? B.categories.genresOf(x, type === 'series') : [];
            var s1 = 0;
            for (var j = 0; j < ks.length; j++) if (gw[ks[j]]) s1 += gw[ks[j]];
            var gk = type + '|' + (x.rawGroup || x.group);
            var s2 = grp[gk] ? grp[gk] * 0.5 : 0;
            var wk = workOf(type, x);
            var s3 = recScore[wk] || 0;
            var score = (s1 / (ks.length || 1)) + s2 + s3;
            // build 151: dezelfde titel op meer servers mag hier nog dubbel staan; dedupeHome kiest hieronder de bron
            if (score <= 0 || seedWork[wk]) continue;
            if (done(type, x)) continue;
            var r = x.rating || 0; if (r > 10) r = r / 10;
            cands.push({ type: type, item: x, s: score / (total || 1) + r * 0.01 });
          }
        });
      });
      cands.sort(function (a, b) { return b.s - a.s; });
      var out = dedupeRow(cands.slice(0, 150).map(function (c) { return { type: c.type, item: c.item }; })).slice(0, 30);
      if (out.length < 8) {
        var have = Object.create(null);
        out.forEach(function (o) { have[workOf(o.type, o.item)] = true; });
        popular(libs).forEach(function (o) { if (out.length < 20 && !have[workOf(o.type, o.item)] && !seedWork[workOf(o.type, o.item)]) out.push(o); });
        out = dedupeRow(out);
      }
      return { popular: false, items: out };
    });
  };

  // MARK: collecties: afbeelding, "Aan collectie toevoegen…" en het formulier

  /** Afbeelding van een collectie: eigen plaatje (poster) of symbool op een kleurverloop. */
  S.collectionArt = function (image, cls) {
    image = image || {};
    var pal = D.palettes[((B.int(image.colorIndex) || 0) % D.palettes.length + D.palettes.length) % D.palettes.length];
    var box = h('div.coll-art' + (cls ? '.' + cls : ''), { style: { background: 'linear-gradient(135deg,' + pal[0] + ',' + pal[1] + ')' } });
    if (image.url) box.appendChild(U.img(image.url, 'coll-art-img'));
    else {
      var sym = image.symbol || 'star';
      if (/^kid\d\d$/.test(sym)) box.appendChild(h('img', { src: '../assets/img/' + sym + '.png', alt: '' }));
      else box.appendChild(h('span.emoji', D.symbolEmoji[sym] || '⭐'));
    }
    return box;
  };
  function collSubtitle(c) {
    if (c.kind === 'smart') return L('Smart: %@', c.query || '');
    var n = (c.items || []).length;
    return n === 1 ? L('1 item') : L('%d items', n);
  }

  /** "Aan collectie toevoegen…": handmatige collecties met een vinkje, en een nieuwe maken met dit item erin. */
  S.addToCollection = function (item, title) {
    var list = h('div.opts');
    var dlg;
    function draw() {
      U.clear(list);
      var manual = D.collectionsFor(prof().id).filter(function (c) { return c.kind !== 'smart'; });
      if (!manual.length) list.appendChild(h('p.muted.coll-empty', L('No collections yet.')));
      manual.forEach(function (c) {
        var on = D.collectionHas(c, item);
        var b = h('button.opt.coll-opt' + (on ? '.sel' : ''), { type: 'button', role: 'menuitemcheckbox', 'aria-checked': on ? 'true' : 'false' }, [
          S.collectionArt(c.image, 'small'), h('span.opt-l', [h('span', c.name), h('span.opt-sub', collSubtitle(c))]), on ? U.icon('checkCircleFill') : U.icon('checkCircle', 'off')]);
        b.addEventListener('click', function () { D.toggleInCollection(prof().id, c.id, item).then(draw); draw(); });
        list.appendChild(b);
      });
      var nb = h('button.opt.coll-opt.new', { type: 'button' }, [h('span.coll-plus', [U.icon('plus')]), h('span.opt-l', [h('span', L('New collection'))])]);
      nb.addEventListener('click', function () { dlg.close(); S.collectionEditor(null, item); });
      list.appendChild(nb);
    }
    draw();
    var off = B.on('collections', draw);
    dlg = U.modal({ title: L('Add to collection'), body: h('div', [title ? h('p.muted.small.coll-for', title) : null, list]), cls: 'choose.coll-dlg',
      buttons: [{ label: L('Done'), primary: true }], onClose: function () { off(); } });
    return dlg;
  };

  function symbolPicker(state, onChange, opts) {
    opts = opts || {};
    var box = h('div.sym-picker');
    function draw() {
      U.clear(box);
      var row1 = h('div.sym-row');
      D.symbols.forEach(function (sym) {
        var on = state.symbol === sym && !state.url && !state.photo;
        var pal = D.palettes[state.colorIndex] || D.palettes[0];
        var b = h('button.sym' + (on ? '.on' : ''), { type: 'button', 'aria-label': sym, 'aria-pressed': on ? 'true' : 'false',
          style: on ? { background: 'linear-gradient(135deg,' + pal[0] + ',' + pal[1] + ')' } : null }, D.symbolEmoji[sym] || '•');
        b.addEventListener('click', function () { state.symbol = sym; state.url = null; if (opts.clearPhoto) opts.clearPhoto(); draw(); onChange(); });
        row1.appendChild(b);
      });
      var row2 = h('div.color-row');
      D.palettes.forEach(function (pal, i) {
        var b = h('button.color' + (state.colorIndex === i ? '.on' : ''), { type: 'button', 'aria-label': L('Color') + ' ' + (i + 1), 'aria-pressed': state.colorIndex === i ? 'true' : 'false',
          style: { background: 'linear-gradient(135deg,' + pal[0] + ',' + pal[1] + ')' } });
        b.addEventListener('click', function () { state.colorIndex = i; draw(); onChange(); });
        row2.appendChild(b);
      });
      box.appendChild(row1); box.appendChild(row2);
    }
    draw();
    box.redraw = draw;
    return box;
  }

  function seg(options, value, onPick) {
    var box = h('div.seg', { role: 'radiogroup' });
    function draw() {
      U.clear(box);
      options.forEach(function (o) {
        var b = h('button.seg-it' + (o[0] === value ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': o[0] === value ? 'true' : 'false' }, o[1]);
        b.addEventListener('click', function () { value = o[0]; draw(); onPick(value); });
        box.appendChild(b);
      });
    }
    draw();
    return box;
  }
  function check(label, on, onChange) {
    var inp = h('input', { type: 'checkbox' });
    inp.checked = !!on;
    inp.addEventListener('change', function () { onChange(inp.checked); });
    return h('label.chk', [inp, h('span', label)]);
  }
  function fieldLabel(t) { return h('div.form-label', t); }

  /** Collectie maken of bewerken (CollectionEditor op iOS). initialItem: nieuw vanuit "Aan collectie toevoegen…". */
  S.collectionEditor = function (existing, initialItem) {
    var pid = prof().id;
    var rnd = Math.floor(Math.random() * D.symbols.length);
    var st = existing ? {
      name: existing.name || '', kind: existing.kind === 'smart' ? 'smart' : 'manual', items: (existing.items || []).slice(), query: existing.query || '',
      types: Array.isArray(existing.types) ? existing.types.slice() : ['channel', 'movie', 'series'], group: existing.group || '', sourceID: existing.sourceID || '',
      symbol: (existing.image && existing.image.symbol) || 'star', colorIndex: B.int(existing.image && existing.image.colorIndex) || 0, url: (existing.image && existing.image.url) || null
    } : { name: '', kind: 'manual', items: initialItem ? [initialItem] : [], query: '', types: ['channel', 'movie', 'series'], group: '', sourceID: '',
      symbol: D.symbols[rnd], colorIndex: Math.floor(Math.random() * D.palettes.length), url: null };

    var name = h('input', { type: 'text', value: st.name, placeholder: L('Name'), 'aria-label': L('Name'), maxlength: '60' });
    name.addEventListener('input', function () { st.name = name.value; validate(); });
    var artBox = h('div.coll-edit-art');
    var kindHelp = h('p.muted.small');
    var kindBox = h('div');
    var countLine = h('p.muted.small.coll-count');
    var posters = h('div.poster-pick');
    var msg = h('div.login-err');

    function draft() {
      var types = st.types.slice();
      return { id: existing ? existing.id : '__draft', kind: st.kind, items: st.kind === 'manual' ? st.items : [], query: st.kind === 'smart' ? st.query : '',
        types: types, group: st.group || null, sourceID: st.sourceID || null };
    }
    function drawArt() {
      U.clear(artBox);
      artBox.appendChild(S.collectionArt({ symbol: st.symbol, colorIndex: st.colorIndex, url: st.url }, 'big'));
    }
    var content = [];
    var recalc = B.debounce(function () {
      content = Lib.resolveCollection(draft(), 200);
      var n = { channel: 0, movie: 0, series: 0 };
      content.forEach(function (x) { n[x.type]++; });
      countLine.textContent = st.kind === 'smart' ? L('%d channels · %d movies · %d series', n.channel, n.movie, n.series) : '';
      drawPosters();
      if (st.kind === 'manual') drawKind();
    }, 250);
    // build 129: catalogus van een andere server binnen → aantallen en posters bijwerken
    var offCat = B.on('xsCatalog', function () { if (!document.body.contains(kindBox)) { offCat(); return; } if (st.kind === 'smart') recalc(); });
    function drawPosters() {
      U.clear(posters);
      var urls = [];
      content.forEach(function (x) { if (x.type !== 'channel' && x.item.poster && urls.indexOf(x.item.poster) < 0 && urls.length < 24) urls.push(x.item.poster); });
      if (!urls.length) return;
      posters.appendChild(fieldLabel(L('Or use a poster')));
      var row = h('div.poster-row');
      urls.forEach(function (u) {
        var b = h('button.poster-opt' + (st.url === u ? '.on' : ''), { type: 'button', 'aria-label': L('Image') }, [U.img(u, 'poster')]);
        b.addEventListener('click', function () { st.url = u; drawArt(); drawPosters(); symbols.redraw(); });
        row.appendChild(b);
      });
      posters.appendChild(row);
    }
    function itemTitle(it) {
      var hit = Lib.lib.byId && Lib.lib.byId[it.id];
      if (!hit && B.xs) { var t = B.xs.tileFor((it.sid || (Lib.source && Lib.source.id) || '') + '|' + it.id, it.type); if (t) return t.item.title || t.item.name; }
      return hit ? (hit.item.title || hit.item.name) : it.id;
    }
    function drawKind() {
      U.clear(kindBox);
      kindHelp.textContent = st.kind === 'manual' ? L('Add channels, movies and series yourself: hold an item and choose “Add to collection…”.')
        : L('Fills itself with everything whose title or category contains one of the keywords.');
      if (st.kind === 'smart') {
        var q = h('input', { type: 'text', value: st.query, placeholder: L('Keywords, e.g. sport, football, F1'), 'aria-label': L('Keywords'), autocapitalize: 'off', spellcheck: 'false' });
        q.addEventListener('input', function () { st.query = q.value; validate(); recalc(); });
        var types = h('div.chk-row', [['channel', L('Channels')], ['movie', L('Movies')], ['series', L('Series')]].map(function (t) {
          return check(t[1], st.types.indexOf(t[0]) >= 0, function (on) {
            st.types = st.types.filter(function (x) { return x !== t[0]; });
            if (on) st.types.push(t[0]);
            st.types.sort(function (a, b) { return ['channel', 'movie', 'series'].indexOf(a) - ['channel', 'movie', 'series'].indexOf(b); });
            validate(); recalc();
          });
        }));
        var lib = Lib.lib, groups = [];
        // build 129: categorieën van alle servers (of van de gekozen server), zoals de collectie zelf zoekt
        if (B.xs) groups = B.xs.groups(st.sourceID || null);
        else lib.channelGroups.concat(lib.movieGroups, lib.seriesGroups).forEach(function (g) { if (groups.indexOf(g) < 0) groups.push(g); });
        if (st.group && groups.indexOf(st.group) < 0) groups.unshift(st.group);
        var gs = h('select.form-select', { 'aria-label': L('Category') }, [h('option', { value: '' }, L('All categories'))].concat(groups.map(function (g) {
          var o = h('option', { value: g }, g); if (g === st.group) o.selected = true; return o;
        })));
        gs.addEventListener('change', function () { st.group = gs.value; recalc(); });
        kindBox.appendChild(h('div.form-row', [fieldLabel(L('Keywords')), q]));
        kindBox.appendChild(types);
        kindBox.appendChild(h('div.form-row', [fieldLabel(L('Category')), gs]));
        if (D.sources.length > 1 || st.sourceID) {
          var ss = h('select.form-select', { 'aria-label': L('Server') }, [h('option', { value: '' }, L('All servers'))].concat(D.sources.map(function (s) {
            var o = h('option', { value: s.id }, s.name); if (String(s.id).toLowerCase() === String(st.sourceID).toLowerCase()) o.selected = true; return o;
          })));
          ss.addEventListener('change', function () { st.sourceID = ss.value; drawKind(); recalc(); });
          kindBox.appendChild(h('div.form-row', [fieldLabel(L('Server')), ss]));
        }
        kindBox.appendChild(countLine);
        setTimeout(function () { if (!existing) q.focus(); }, 0);
      } else {
        kindBox.appendChild(fieldLabel(L('Items')));
        if (!st.items.length) kindBox.appendChild(h('p.muted.small', L('Nothing in this collection yet.')));
        var list = h('div.coll-items');
        st.items.forEach(function (it, i) {
          var icon = it.type === 'channel' ? 'tv' : it.type === 'movie' ? 'film' : 'series';
          var up = U.button('', function () { var t = st.items[i - 1]; st.items[i - 1] = it; st.items[i] = t; drawKind(); }, { icon: 'up', cls: 'icon-only small', title: L('Move up') });
          var down = U.button('', function () { var t = st.items[i + 1]; st.items[i + 1] = it; st.items[i] = t; drawKind(); }, { icon: 'down', cls: 'icon-only small', title: L('Move down') });
          if (i === 0) up.disabled = true;
          if (i === st.items.length - 1) down.disabled = true;
          var rm = U.button('', function () { st.items.splice(i, 1); drawKind(); recalc(); }, { icon: 'minus', cls: 'icon-only small danger-ic', title: L('Remove') });
          list.appendChild(h('div.coll-item', [U.icon(icon, 'coll-item-ic'), h('span.coll-item-t', itemTitle(it)), up, down, rm]));
        });
        kindBox.appendChild(list);
      }
    }
    var symbols = symbolPicker(st, function () { drawArt(); drawPosters(); });
    var kindSeg = seg([['manual', L('Manual')], ['smart', L('Smart')]], st.kind, function (v) { st.kind = v; drawKind(); validate(); recalc(); });
    var body = h('div.form-dlg.coll-form', [
      artBox,
      h('div.form-row', [fieldLabel(L('Name')), name]),
      h('div.form-row', [fieldLabel(L('Type')), kindSeg, kindHelp]),
      kindBox,
      h('div.form-row', [fieldLabel(L('Image')), symbols, posters]),
      msg
    ]);
    var dlg = U.modal({ title: existing ? L('Edit collection') : L('New collection'), body: body, cls: 'wide-dlg', buttons: [] });
    var save = U.button(L('Save'), function () {
      if (save.disabled) return;
      save.disabled = true;
      var c = {
        name: st.name.trim(), kind: st.kind, items: st.kind === 'manual' ? st.items : [], query: st.kind === 'smart' ? st.query.trim() : '',
        types: st.types.length ? st.types : ['channel', 'movie', 'series'], group: st.group || null, sourceID: st.sourceID || null,
        image: st.url ? { url: st.url } : { symbol: st.symbol, colorIndex: st.colorIndex }
      };
      if (existing) c.id = existing.id;
      D.upsertCollection(pid, c).then(function (ok) {
        U.toast(L('Saved'));
      });
      dlg.close();
    }, { primary: true });
    var btns = [save, U.button(L('Cancel'), function () { dlg.close(); })];
    if (existing) btns.push(U.button(L('Delete collection'), function () {
      U.confirm(L('Delete collection'), existing.name, L('Delete'), function () { D.deleteCollection(pid, existing.id); dlg.close(); }, { danger: true });
    }, { cls: 'danger', icon: 'trash' }));
    dlg.el.appendChild(h('div.dlg-buttons', btns));
    function validate() {
      var ok = st.name.trim().length > 0 && (st.kind !== 'smart' || (st.query.trim().length > 0 && st.types.length > 0));
      save.disabled = !ok;
    }
    drawArt(); drawKind(); validate(); recalc();
    setTimeout(function () { if (!existing) name.focus(); }, 40);
    return dlg;
  };

  // MARK: pagina Mijn Bingr

  S.pages.mybingr = function () {
    var el = h('div.page.mybingr');
    var pg = { el: el, title: L('My Bingr') };
    var rowsBox = h('div.mb-rows');
    var list = h('div.st-list');
    function head() {
      var p = prof();
      var sub = [];
      if (isMain()) sub.push(L('Main account'));
      if (p.kids) sub.push(L('Kids profile'));
      return h('div.mb-head', [
        S.avatar(p, 'mb-av'),
        h('div.mb-who', [h('h1', p.name), sub.length ? h('div.muted.small', sub.join(' · ')) : null]),
        h('div.mb-actions', [
          U.button(L('Switch profile'), function () { B.app.switchProfile(); }, { icon: 'users', cls: 'small' }),
          isMain() ? h('a.btn.small', { href: '#/profiles' }, [U.icon('edit'), h('span', L('Manage profiles'))]) : null
        ])
      ]);
    }
    function drawRows() {
      U.clear(rowsBox);
      var lib = Lib.lib;
      var src = srcId();
      var cont = S.continueCards(20);
      if (cont.length) rowsBox.appendChild(U.row(L('Continue watching'), cont));
      var my = S.myListItems();
      var myRow = U.row(L('My List'), my.slice(0, 40).map(function (x) { return S.posterCard(x.item, x.type); }), null, '#/mylist');
      rowsBox.appendChild(myRow || h('section.mb-empty', [h('h2.row-title', L('My List')), h('p.muted.small', L("Add titles with + My List and they'll appear here."))]));
      var chans = B.xs.listTiles('favorites', 'channel').map(function (x) { return x.item; });
      if (chans.length) rowsBox.appendChild(U.row(L('Favorite channels'), chans.slice(0, 30).map(function (c) { return S.channelCard(c, chans); }), 'live'));
    }
    function drawList() {
      U.clear(list);
      var row = S.stRow;
      var sec = S.stSection(list, L('Library'));
      var hist = D.history(); // build 128: over alle servers
      row(sec, L('Watch history'), hist.length ? String(hist.length) : null, function () { location.hash = '#/history'; }, { icon: 'history' });
      row(sec, L('Collections'), String(D.collectionsFor(prof().id).length), function () { location.hash = '#/collections'; }, { icon: 'stack' });
      // Categorieën (build 86): het overzicht met genres en de categorieën van je server (stond eerst bovenin de navigatie)
      if (B.categories && B.categories.available()) row(sec, L('Categories'), String(B.categories.total()), function () { location.hash = '#/categorie'; }, { icon: 'grid' });
      row(sec, L('Statistics'), B.plan.has('stats') ? null : B.plan.badge(), function () { location.hash = '#/stats'; }, { icon: 'chart' });
      S.traktStatusRow(sec);
      if (B.plan.isKnown()) { sec = S.stSection(list, L('Account')); S.planRow(sec); S.watchingNowRow(sec); }
      sec = S.stSection(list, L('Profile'));
      if (isMain()) row(sec, L('Manage profiles'), String(D.profiles.length), function () { location.hash = '#/profiles'; }, { icon: 'users' });
      row(sec, L('Home screen'), null, function () { location.hash = '#/homelayout'; }, { icon: 'rows' });
      // build 140: verborgen categorieën gelden voor het hele account; een kinderprofiel ziet dit scherm niet
      if (!prof().kids) row(sec, L('Show categories'), null, function () { location.hash = '#/catprefs'; }, { icon: 'grid' });
      row(sec, L('Settings'), null, function () { location.hash = '#/settings'; }, { icon: 'gear' });
      row(sec, L('Account and devices'), null, function () { location.href = '../account/'; }, { icon: 'account' });
      S.supportRow(sec);
    }
    function render() {
      U.clear(el);
      el.appendChild(head());
      el.appendChild(rowsBox);
      el.appendChild(list);
      drawRows(); drawList();
    }
    pg.refresh = render;
    pg.onData = function () { drawRows(); drawList(); };
    pg.onCollections = drawList;
    var offs = [B.on('traktStatus', drawList), B.on('connections', drawList), B.on('profiles', function () { if (el.parentNode) render(); }),
      B.on('plan', drawList)];
    pg.destroy = function () { offs.forEach(function (f) { f(); }); };
    render();
    return pg;
  };

  // MARK: abonnement (Gratis / Lifetime) en "Nu aan het kijken"

  /** Rij "Abonnement: Gratis / Lifetime" met de limieten; klikken = vergelijking (en upgraden bij Gratis). Alleen als de server het abonnement gaf. */
  S.planRow = function (sec) {
    var P = B.plan;
    if (!P.isKnown()) return null;
    var free = P.isFree();
    var val = h('span.st-value.plan-val', [h('span.plan-pill' + (free ? '' : '.life'), P.name())]);
    return S.stRow(sec, L('Subscription'), val, function () { P.sheet(free ? 'plan' : null); }, { icon: 'lifetime', sub: P.summary() });
  };
  /** Rij "Nu aan het kijken" (list_streams): met Gratis op slot. */
  S.watchingNowRow = function (sec) {
    var P = B.plan;
    var on = P.has('now_watching');
    return S.stRow(sec, L('Watching now'), on ? null : P.badge(), function () { if (P.has('now_watching')) S.watchingNowSheet(); else P.sheet('now_watching'); }, { icon: 'tv' });
  };
  S.watchingNowSheet = function () {
    var body = h('div.wn-sheet', [h('div.trakt-wait', [U.spinner()])]);
    var dlg = U.modal({ title: L('Watching now'), body: body, cls: 'wn-dlg', buttons: [{ label: L('Close') }] });
    function load() {
      A.listStreams().then(function (r) {
        if (!document.body.contains(dlg.el)) return;
        U.clear(body);
        if (r && r.locked) { dlg.close(); B.plan.markLocked('now_watching'); B.plan.sheet('now_watching'); return; }
        if (!r) {
          body.appendChild(h('p.muted', L('Something went wrong. Please try again.')));
          body.appendChild(U.button(L('Try again'), function () { U.clear(body); body.appendChild(h('div.trakt-wait', [U.spinner()])); load(); }, { cls: 'small', icon: 'refresh' }));
          return;
        }
        body.appendChild(h('p.muted.small', L('%d of %d watching now', r.streams.length, r.limit)));
        if (!r.streams.length) { body.appendChild(h('p.muted', L('Nobody is watching right now.'))); return; }
        var list = h('div.limit-list');
        r.streams.forEach(function (st) {
          var who = st.deviceName + (st.profileName ? ' · ' + st.profileName : '');
          list.appendChild(h('div.limit-row', [S.platformIcon(st.platform), h('div', [h('div', who), h('div.muted.small', [A.platformLabel(st.platform), st.title || '', st.startedAt ? B.fmtTime(st.startedAt) : ''].filter(Boolean).join(' · '))])]));
        });
        body.appendChild(list);
      });
    }
    load();
    return dlg;
  };

  function backLink(href, label) { return h('a.st-back', { href: href }, [U.icon('chevron', 'st-back-ic'), label]); }
  function subHead(title, back) {
    return h('div.page-head.sub-head', [backLink(back || '#/mybingr', L('My Bingr')), h('h1', title)]);
  }

  // MARK: kijkgeschiedenis (HistoryView op iOS): per dag, verwijderen en alles wissen

  S.pages.history = function () {
    var box = h('div.hist');
    var el = h('div.page.settings.history-page', [subHead(L('Watch history')), box]);
    var pg = { el: el, title: L('Watch history') };
    function dayTitle(ms) {
      var d = new Date(ms); d.setHours(0, 0, 0, 0);
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var diff = Math.round((today - d) / 86400000);
      if (diff === 0) return L('Today');
      if (diff === 1) return L('Yesterday');
      try { return B.fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return d.toDateString(); }
    }
    function open(e) {
      // build 128: item van elke server (ook niet-actief of verwijderd)
      if (e.playlistID && !B.xs.isActive(e.playlistID)) {
        var live0 = e.type === 'live';
        var key = e.playlistID + '|' + (live0 ? (e.channelID || e.itemID) : e.itemID);
        var hit0 = B.xs.tileFor(key, live0 ? 'channel' : null, 'history', { title: e.title, artwork: e.artwork, type: live0 ? 'channel' : (e.type === 'episode' ? 'series' : e.type) });
        if (hit0 && !hit0.item._key) {
          if (hit0.type === 'channel') B.player.playChannel(hit0.item, [hit0.item]); else R.go(S.titleLink(hit0.type, hit0.item).slice(1));
          return;
        }
        if (hit0 && e.type === 'episode' && hit0.item._xs !== 'orphan') {
          var v = B.xs.view(e.playlistID);
          var s0 = v && v.series.filter(function (s) { return s.title === e.title; })[0];
          if (s0) { R.go(S.titleLink('series', s0).slice(1)); return; }
        }
        if (hit0) { hit0.item._hist = e; B.xs.open(hit0); return; }
        U.toast(L('This title is not in the library of this server.'));
        return;
      }
      var lib = Lib.lib;
      if (e.type === 'live') {
        var ch = lib.byId[e.channelID || e.itemID];
        if (ch && ch.type === 'channel') { B.player.playChannel(ch.item, [ch.item]); return; }
      }
      var hit = lib.byId[e.itemID];
      if (hit && hit.type === 'movie') { R.go(S.titleLink('movie', hit.item).slice(1)); return; }
      if (hit && hit.type === 'series') { R.go(S.titleLink('series', hit.item).slice(1)); return; }
      var s = null;
      for (var i = 0; i < lib.series.length; i++) if (lib.series[i].title === e.title) { s = lib.series[i]; break; }
      if (s) { R.go(S.titleLink('series', s).slice(1)); return; }
      U.toast(L('This title is not in the library of this server.'));
    }
    function render() {
      U.clear(box);
      var src = null; // build 128: geschiedenis van alle servers; wissen = alles
      var entries = D.history();
      // build 140: kinderprofiel: alleen wat in de (kinder)bibliotheek staat (de rest blijft bewaard)
      if (prof().kids && B.xs) entries = entries.filter(B.xs.historyVisible);
      if (!entries.length) { box.appendChild(h('div.state', [U.icon('history', 'state-ic'), h('p.muted', L('Nothing watched yet on this profile.'))])); return; }
      var days = [], byDay = {};
      entries.forEach(function (e) {
        var d = new Date(typeof e.date === 'string' ? (B.parseISO(e.date) || 0) : e.date); d.setHours(0, 0, 0, 0); // build 149: snelle ISO
        var k = d.getTime();
        if (!byDay[k]) { byDay[k] = []; days.push(k); }
        byDay[k].push(e);
      });
      days.sort(function (a, b) { return b - a; });
      days.forEach(function (k) {
        var sec = h('section.st-sec', [h('h2.st-head', dayTitle(k))]);
        byDay[k].sort(function (a, b) { return b.date - a.date; }).forEach(function (e) {
          var live = e.type === 'live';
          var r = h('div.hist-row');
          var main = h('button.hist-main', { type: 'button' }, [
            h('div.hist-art' + (live ? '.live' : ''), [U.img(e.artwork, live ? 'logo' : 'poster', e.title)]),
            h('div.hist-txt', [h('div.hist-title', e.title), e.subtitle ? h('div.muted.small.hist-sub', e.subtitle) : null]),
            h('div.hist-meta', [U.icon(live ? 'tv' : e.type === 'movie' ? 'film' : 'series', 'hist-ic'), h('span.muted.small', B.fmtTime(e.date))])
          ]);
          main.addEventListener('click', function () { open(e); });
          U.onMenu(main, function () { return [{ icon: 'trash', label: L('Remove from history'), danger: true, fn: function () { D.removeHistory(e); } }]; }, e.title);
          var rm = U.button('', function () { D.removeHistory(e); }, { icon: 'trash', cls: 'icon-only small hist-rm', title: L('Remove from history') });
          r.appendChild(main); r.appendChild(rm);
          sec.appendChild(r);
        });
        box.appendChild(sec);
      });
      box.appendChild(h('div.hist-clear', [U.button(L('Clear watch history'), function () {
        U.confirm(L('Clear watch history'), null, L('Clear watch history'), function () { D.clearHistory(src); }, { danger: true });
      }, { cls: 'danger', icon: 'trash' })]));
    }
    pg.refresh = render;
    pg.onData = render;
    render();
    return pg;
  };

  // MARK: collecties beheren

  S.pages.collections = function () {
    var box = h('div.st-list');
    var el = h('div.page.settings.collections-page', [subHead(L('Collections')), box]);
    var pg = { el: el, title: L('Collections') };
    function render() {
      U.clear(box);
      var pid = prof().id;
      var list = D.collectionsFor(pid);
      var sec = S.stSection(box, null, L('Every profile has its own collections, on all your devices. They appear as rows on Home, and in Live TV, Movies and Series. Hold a channel, movie or series to add it.'));
      if (!list.length) sec.appendChild(h('div.st-row.info', [h('span.st-label.muted', L('No collections yet. Make your own rows with your favorite channels, movies and series.'))]));
      list.forEach(function (c, i) {
        var r = h('div.st-row.coll-row');
        var main = h('button.coll-main', { type: 'button' }, [S.collectionArt(c.image, 'small'), h('span.st-label', [h('span', c.name), h('span.st-sub', collSubtitle(c))])]);
        main.addEventListener('click', function () { S.collectionEditor(c); });
        U.onMenu(main, function () {
          return [{ icon: 'edit', label: L('Edit'), fn: function () { S.collectionEditor(c); } },
            { icon: 'stack', label: L('Show all'), fn: function () { R.go('/collection/' + encodeURIComponent(c.id)); } },
            { icon: 'trash', label: L('Delete'), danger: true, fn: function () { del(c); } }];
        }, c.name);
        var ids = list.map(function (x) { return x.id; });
        var up = U.button('', function () { var t = ids[i - 1]; ids[i - 1] = ids[i]; ids[i] = t; D.reorderCollections(pid, ids); }, { icon: 'up', cls: 'icon-only small', title: L('Move up') });
        var down = U.button('', function () { var t = ids[i + 1]; ids[i + 1] = ids[i]; ids[i] = t; D.reorderCollections(pid, ids); }, { icon: 'down', cls: 'icon-only small', title: L('Move down') });
        if (i === 0) up.disabled = true;
        if (i === list.length - 1) down.disabled = true;
        var rm = U.button('', function () { del(c); }, { icon: 'trash', cls: 'icon-only small', title: L('Delete') });
        r.appendChild(main); r.appendChild(up); r.appendChild(down); r.appendChild(rm);
        sec.appendChild(r);
      });
      S.stRow(sec, L('New collection'), null, function () { S.collectionEditor(null); }, { icon: 'plus' });
    }
    function del(c) { U.confirm(L('Delete collection'), c.name, L('Delete %@', c.name), function () { D.deleteCollection(prof().id, c.id); }, { danger: true }); }
    pg.refresh = render;
    pg.onCollections = render;
    render();
    return pg;
  };

  /** Alles uit één collectie (Alles bekijken). */
  S.pages.collection = function (r) {
    var id = r.parts[1] || '';
    var el = h('div.page.catalog.collection-page');
    var pg = { el: el, title: L('Collection') };
    var grid = null;
    function render() {
      if (grid && grid.destroy) grid.destroy();
      U.clear(el);
      var c = D.collectionById(prof().id, id);
      if (!c) { el.appendChild(subHead(L('Collection'), '#/collections')); el.appendChild(h('div.state', [h('p.muted', L('Not found'))])); return; }
      pg.title = c.name;
      var editBtn = U.button(L('Edit'), function () { S.collectionEditor(c); }, { icon: 'edit', cls: 'small' });
      el.appendChild(h('div.page-head.coll-head', [S.collectionArt(c.image, 'small'), h('h1', c.name), editBtn]));
      shown = B.xs ? B.xs.version : 0;
      var items = Lib.collectionItems(c, 400);
      if (!items.length) { el.appendChild(h('div.state', [h('p.muted', L('Nothing in this collection yet.'))])); return; }
      var chans = items.filter(function (x) { return x.type === 'channel'; }).map(function (x) { return x.item; });
      if (chans.length) el.appendChild(U.row(L('Channels'), chans.map(function (ch) { return S.channelCard(ch, chans, { collection: c }); }), 'live'));
      var titles = items.filter(function (x) { return x.type !== 'channel'; });
      if (titles.length) grid = U.grid(titles, function (x) { return S.posterCard(x.item, x.type, { collection: c }); }, 'posters');
      if (grid) el.appendChild(grid);
    }
    var shown = -1;
    pg.refresh = render;
    pg.onCollections = render;
    // build 129: catalogus van een andere server binnen (slimme collectie over alle servers): opnieuw tekenen
    pg.onData = function () { if (B.xs && B.xs.version !== shown && !el.querySelector(':focus')) render(); };
    pg.destroy = function () { if (grid && grid.destroy) grid.destroy(); };
    render();
    return pg;
  };

  // MARK: startscherm (HomeLayoutView op iOS): rijen aan/uit en in je eigen volgorde, per profiel

  /**
   * build 128: categorieën aan/uit over alle servers. Dezelfde naam op twee servers = één regel die voor beide geldt; met
   * meer servers staat eronder op welke server(s) hij staat.
   * build 140: voor het hele account (alle profielen behalve kinderprofielen; sync.js, section `account`) en snel: de lijst
   * wordt één keer per catalogusversie berekend, een tik zet alleen die schakelaar om (geen nieuwe pagina), opnieuw
   * filteren gebeurt één keer na het tikken (xs.js, uitgesteld), de rijen groeien in stukjes en er is een zoekveld.
   */
  S.pages.catprefs = function () {
    var box = h('div.st-list');
    var el = h('div.page.settings.catprefs-page', [subHead(L('Show categories')), box]);
    var pg = { el: el, title: L('Show categories') };
    if (prof().kids) {
      box.appendChild(h('div.state', [U.icon('grid', 'state-ic'), h('p.muted', L('A kids profile only sees categories for kids.'))]));
      return pg;
    }
    var kind = B.store.get('catprefsKind', 'channel') || 'channel';
    var alive = true, grid = null, listBox = null, query = '';
    var memo = { key: null, g: null };
    // sleutel: soort + per server de (ongefilterde) catalogus zelf; opnieuw filteren verandert de lijst niet
    function catKey() {
      return [kind].concat(B.xs.orderedSources().map(function (s) { var c = B.xs.catalog(s.id); return [s.id, c ? c.raw : null]; }));
    }
    function sameKey(a, b) {
      if (!a || !b || a.length !== b.length || a[0] !== b[0]) return false;
      for (var i = 1; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
      return true;
    }
    function stale() { return !sameKey(memo.key, catKey()); }
    function groups() {
      var key = catKey();
      if (sameKey(memo.key, key)) return memo.g;
      var out = [], byName = Object.create(null), loadingAny = false;
      B.xs.orderedSources().forEach(function (src) {
        var cat = B.xs.catalog(src.id);
        if (!cat) { loadingAny = true; return; }
        var list = kind === 'movie' ? cat.raw.movies : kind === 'series' ? cat.raw.series : cat.raw.channels;
        var seen = Object.create(null);
        for (var i = 0; i < list.length; i++) {
          var g = list[i].group;
          if (g == null || seen[g]) continue;
          seen[g] = true;
          // build 150: dezelfde opgeschoonde naam (zonder "NL |", "4K", "(MULTI)", hoofdletterongevoelig) = één regel;
          // de schakelaar zet alle onderliggende categorieën (per server, exacte naam) tegelijk aan of uit
          var cc = B.catClean(g), fk = B.fold(cc.name);
          var e = byName[fk];
          if (!e) { e = byName[fk] = { name: cc.name, srcs: [], pairs: [], tags: [], f: fk }; out.push(e); }
          if (e.srcs.indexOf(src) < 0) e.srcs.push(src);
          e.pairs.push({ src: src, name: g });
          cc.tags.forEach(function (t) { if (e.tags.indexOf(t) < 0) e.tags.push(t); });
        }
      });
      memo = { key: key, g: { list: out, loading: loadingAny } };
      return memo.g;
    }
    function isHidden(e) { return e.pairs.every(function (p) { return !!D.hiddenCategoryNames(p.src.id)[p.name]; }); }
    var many = D.sources.length > 1;
    function setSwitch(tg, on) {
      tg.setAttribute('aria-checked', on ? 'true' : 'false');
      var sw = tg.querySelector('.switch');
      if (sw) sw.classList.toggle('on', on);
    }
    function rowFor(e) {
      var on = !isHidden(e);
      var nm = e.tags.length ? h('span', [e.name, ' ', h('span.cat-chips', e.tags.map(function (t) { return h('span.cat-chip', t); }))]) : h('span', e.name);
      var label = many ? h('span.st-label', [nm, h('span.st-sub', e.srcs.map(function (x) { return x.name; }).join(', '))]) : h('span.st-label', [nm]);
      var tg = h('button.hl-main', { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false' }, [label, h('span.switch' + (on ? '.on' : ''), [h('i')])]);
      tg._e = e;
      tg.addEventListener('click', function () {
        var nowOn = tg.getAttribute('aria-checked') === 'true';
        // alleen deze schakelaar; opslaan en (uitgesteld) opnieuw filteren doen sync.js en xs.js
        setSwitch(tg, !nowOn);
        D.setCategoriesHidden(e.pairs.map(function (p) { return { sid: p.src.id, name: p.name, hidden: nowOn }; }));
      });
      return h('div.st-row.hl-row', [tg]);
    }
    function drawList() {
      if (grid && grid.destroy) grid.destroy();
      grid = null;
      U.clear(listBox);
      var g = groups();
      if (g.loading) listBox.appendChild(h('div.st-row.info', [U.spinner()]));
      var q = B.fold(query).trim();
      var list = q ? g.list.filter(function (e) { return e.f.indexOf(q) >= 0; }) : g.list;
      if (!list.length && !g.loading) { listBox.appendChild(h('div.st-row.info', [h('span.st-label.muted', L('Nothing here yet'))])); return; }
      grid = U.grid(list, rowFor, 'catprefs-rows', 80);
      listBox.appendChild(grid);
    }
    /** Schakelaars bijwerken zonder de lijst opnieuw op te bouwen (wijziging van een ander apparaat). */
    function refreshSwitches() {
      if (!listBox) return;
      Array.prototype.forEach.call(listBox.querySelectorAll('.hl-main'), function (tg) { if (tg._e) setSwitch(tg, !isHidden(tg._e)); });
    }
    function render() {
      U.clear(box);
      var sec = S.stSection(box, null, L('Turn categories on or off for all profiles of your account (not for kids profiles). Applies to all your servers.'));
      sec.appendChild(h('div.st-row.catprefs-seg', [seg([['channel', L('Live TV')], ['movie', L('Movies')], ['series', L('Series')]], kind, function (v) {
        kind = v; B.store.set('catprefsKind', v); drawList();
      })]));
      var search = h('input.catprefs-q', { type: 'search', placeholder: L('Search'), 'aria-label': L('Search'), value: query, autocomplete: 'off' });
      search.addEventListener('input', B.debounce(function () { query = search.value; drawList(); }, 150));
      sec.appendChild(h('div.st-row.catprefs-search', [U.icon('search'), search]));
      listBox = h('div.catprefs-list');
      sec.appendChild(listBox);
      drawList();
    }
    // catalogi van alle servers (actieve: geladen; andere: cache of op de achtergrond)
    B.xs.orderedSources().forEach(function (src) {
      if (!B.xs.catalog(src.id) && !B.xs.isActive(src.id)) B.xs.loadCatalog(src, true).then(function () { if (alive && stale()) drawList(); });
    });
    var offs = [B.on('xsCatalog', function () { if (alive && stale()) drawList(); }),
      B.on('library', function () { if (alive && stale()) drawList(); }),
      B.on('accountCats', function () { if (alive) refreshSwitches(); })];
    // nieuwe gefilterde bibliotheek (na het tikken): niet de hele pagina opnieuw, alleen als de catalogi veranderden
    pg.refresh = function () { if (stale()) drawList(); else refreshSwitches(); };
    pg.destroy = function () { alive = false; offs.forEach(function (f) { f(); }); if (grid && grid.destroy) grid.destroy(); };
    render();
    return pg;
  };

  S.pages.homelayout = function () {
    var box = h('div.st-list');
    var el = h('div.page.settings', [subHead(L('Home screen')), box]);
    var pg = { el: el, title: L('Home screen') };
    function render() {
      U.clear(box);
      var colls = D.collectionsFor(prof().id);
      var rows = S.effectiveHomeLayout(D.homeLayout(), colls);
      var sec = S.stSection(box, null, L('Turn rows on or off and move them up or down. Applies to this profile.'));
      function store(next) { D.setHomeLayout(S.applyHomeLayout(D.homeLayout(), next)); render(); }
      rows.forEach(function (r, i) {
        var line = h('div.st-row.hl-row');
        // Categorieën op de standaardplek (direct na Favoriete zenders): op Home 5 rijen tussen "Nu live" en "Categorieën"
        var auto = r.key === 'browse' && i > 0 && rows[i - 1].key === 'live';
        var label = auto ? h('span.st-label', [h('span', S.homeRowTitle(r.key, colls)), h('span.st-sub', L('5 rows below Live now'))]) : h('span.st-label', S.homeRowTitle(r.key, colls));
        var tg = h('button.hl-main', { type: 'button', role: 'switch', 'aria-checked': r.visible ? 'true' : 'false' }, [
          label, h('span.switch' + (r.visible ? '.on' : ''), [h('i')])]);
        tg.addEventListener('click', function () { var n = rows.map(function (x) { return { key: x.key, visible: x.visible }; }); n[i].visible = !n[i].visible; store(n); });
        var up = U.button('', function () { var n = rows.slice(); var t = n[i - 1]; n[i - 1] = n[i]; n[i] = t; store(n); }, { icon: 'up', cls: 'icon-only small', title: L('Move up') });
        var down = U.button('', function () { var n = rows.slice(); var t = n[i + 1]; n[i + 1] = n[i]; n[i] = t; store(n); }, { icon: 'down', cls: 'icon-only small', title: L('Move down') });
        if (i === 0) up.disabled = true;
        if (i === rows.length - 1) down.disabled = true;
        line.appendChild(tg); line.appendChild(up); line.appendChild(down);
        sec.appendChild(line);
      });
      var sec2 = S.stSection(box, null);
      S.stRow(sec2, L('Restore default'), null, function () { store(S.effectiveHomeLayout([], colls)); }, { icon: 'refresh' });
    }
    pg.refresh = render;
    pg.onData = function () { if (!el.querySelector(':focus')) render(); };
    pg.onCollections = render;
    render();
    return pg;
  };

  // MARK: Trakt en OpenSubtitles (horen bij het hoofdprofiel; tokens gedeeld via de state-section `connections`)

  /** "Trakt bijgewerkt om 22:15", of "Bijgewerkt" als het minder dan een minuut geleden is (niet "… om Bijgewerkt"). */
  function syncedText(ms) {
    if (!ms) return '';
    var min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return L('Up to date');
    return L('Trakt synced %@', B.fmtTime(ms));
  }
  /** Rij met de Trakt-status (Mijn Bingr): gekoppeld + laatst bijgewerkt; klikken = nu synchroniseren of koppelen. */
  S.traktStatusRow = function (sec) {
    var T = B.trakt;
    if (!T.ready()) return null;
    // Trakt hoort bij Lifetime
    if (!B.plan.has('trakt')) return S.stRow(sec, 'Trakt', B.plan.badge(), function () { B.plan.sheet('trakt'); }, { lead: traktLogo() });
    if (!T.allowed()) {
      return S.stRow(sec, 'Trakt', B.connections.trakt() ? L('Main account') : L('Not linked'), null, { lead: traktLogo() });
    }
    if (!T.isLoggedIn()) return S.stRow(sec, 'Trakt', L('Not linked'), function () { S.traktSheet(); }, { lead: traktLogo() });
    var v = T.isSyncing() ? L('Syncing…') : (T.lastSync() ? syncedText(T.lastSync()) : T.username());
    return S.stRow(sec, 'Trakt', v, function () { S.traktSheet(); }, { lead: traktLogo(), sub: T.username() });
  };
  function traktLogo() { return h('img.st-logo', { src: '../assets/img/trakt.svg', alt: '' }); }

  /** Venster om Trakt te koppelen (apparaatcode op trakt.tv/activate) of de koppeling te beheren. */
  S.traktSheet = function () {
    var T = B.trakt;
    if (!B.plan.has('trakt')) return B.plan.sheet('trakt');
    var body = h('div.trakt-sheet');
    var flow = null, dlg = null;
    function done() { if (flow) { flow.cancel(); flow = null; } }
    function drawLinked() {
      U.clear(body);
      body.appendChild(h('div.trakt-head', [traktLogo(), h('div', [h('div.trakt-user', T.username() || 'Trakt'),
        h('div.muted.small', T.isSyncing() ? L('Syncing…') : (T.lastSync() ? syncedText(T.lastSync()) : ''))])]));
      body.appendChild(h('p.muted.small', L("What you watch in Bingr is scrobbled automatically. What you've watched on Trakt (or in another app) is checked off here.")));
      body.appendChild(h('div.dlg-buttons', [
        U.button(L('Sync now'), function () { T.refresh(true).then(drawLinked); drawLinked(); }, { icon: 'refresh', primary: true }),
        U.button(L('Sign out of Trakt'), function () {
          U.confirm(L('Sign out of Trakt'), null, L('Sign out'), function () { T.logout(); if (dlg) dlg.close(); }, { danger: true });
        }, { cls: 'danger' }),
        U.button(L('Close'), function () { dlg.close(); })
      ]));
    }
    function drawStart(err) {
      U.clear(body);
      body.appendChild(h('div.trakt-head', [traktLogo(), h('div.trakt-user', L('Connect your Trakt account'))]));
      body.appendChild(h('p.muted.small', L("What you watch in Bingr is scrobbled automatically. What you've watched on Trakt (or in another app) is checked off here.")));
      if (err) body.appendChild(h('div.login-err', err));
      body.appendChild(h('div.dlg-buttons', [U.button(L('Sign in to Trakt'), startFlow, { primary: true }), U.button(L('Cancel'), function () { dlg.close(); })]));
    }
    function startFlow() {
      U.clear(body);
      body.appendChild(h('div.trakt-wait', [U.spinner()]));
      T.startLogin().then(function (code) {
        if (!dlg || !document.body.contains(dlg.el)) return;
        U.clear(body);
        var url = code.url || 'https://trakt.tv/activate';
        var qr = h('div.trakt-qr');
        try {
          var q = window.qrcode(0, 'M'); q.addData(url); q.make();
          var n = q.getModuleCount(), cell = 5, cv = h('canvas', { role: 'img', 'aria-label': url });
          cv.width = cv.height = cell * (n + 4);
          var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#000';
          for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + 2) * cell, (r + 2) * cell, cell, cell);
          qr.appendChild(cv);
        } catch (e) { qr = null; }
        var status = h('span.muted.small', L('Waiting for confirmation…'));
        body.appendChild(h('p.trakt-go', [L('On your phone or computer, go to'), ' ', h('a', { href: url, target: '_blank', rel: 'noopener' }, url.replace(/^https?:\/\//, '')), ' ', L('and enter this code:')]));
        body.appendChild(h('div.trakt-code', code.userCode));
        if (qr) body.appendChild(qr);
        body.appendChild(h('div.tv-wait', [U.spinner(), status]));
        body.appendChild(h('div.dlg-buttons', [
          U.button(L('Open trakt.tv/activate'), function () {
            try { if (navigator.clipboard) navigator.clipboard.writeText(code.userCode); } catch (e) { /* stil */ }
            window.open(url, '_blank', 'noopener');
          }, { primary: true, icon: 'link' }),
          U.button(L('Cancel'), function () { dlg.close(); })
        ]));
        flow = T.finishLogin(code);
        flow.then(function () {
          flow = null;
          U.toast(L('Signed in as %@', T.username() || 'Trakt'));
          if (dlg) dlg.close();
        }, function (e) { flow = null; drawStart(e && e.message); });
      }, function (e) { drawStart((e && e.message) || L('Something went wrong. Please try again.')); });
    }
    if (!T.ready()) body.appendChild(h('p.muted', L('Trakt is not available right now. Try again later.')));
    else if (!T.allowed()) body.appendChild(h('p.muted', L('The server, Trakt and OpenSubtitles belong to the main account and are used by all profiles.')));
    else if (T.isLoggedIn()) drawLinked();
    else drawStart();
    var off = B.on('traktStatus', function () { if (T.isLoggedIn() && !flow) drawLinked(); });
    dlg = U.modal({ title: 'Trakt', body: body, cls: 'trakt-dlg', onClose: function () { done(); off(); },
      buttons: (!T.ready() || !T.allowed()) ? [{ label: L('OK') }] : null });
    return dlg;
  };

  /** Sectie Koppelingen (Instellingen): Trakt, scrobbelen en OpenSubtitles. Inloggen kan alleen het hoofdprofiel. */
  S.connectionsSection = function (list, rerender) {
    var main = isMain(), T = B.trakt, OS = B.opensubtitles;
    var sec = S.stSection(list, L('Connections'), L('The server, Trakt and OpenSubtitles belong to the main account and are used by all profiles.'));
    S.traktStatusRow(sec);
    if (main && T.isLoggedIn() && B.plan.has('trakt')) {
      var on = T.scrobbleEnabled();
      S.stRow(sec, L('Scrobble'), null, function () { D.setShared('traktScrobble', !on); setTimeout(rerender, 30); }, { toggle: on });
    }
    if (!OS.ready()) return sec;
    if (!main) { S.stRow(sec, 'OpenSubtitles', OS.isLoggedIn() ? OS.username() : L('Not linked'), null, { icon: 'subs' }); return sec; }
    if (OS.isLoggedIn()) {
      S.stRow(sec, 'OpenSubtitles', OS.username(), function () {
        U.confirm('OpenSubtitles', OS.username(), L('Sign out'), function () { OS.logout().then(rerender); }, { danger: true });
      }, { icon: 'subs' });
    } else {
      S.stRow(sec, 'OpenSubtitles', L('Not linked'), function () {
        U.form(L('Sign in to OpenSubtitles'), [{ key: 'user', label: L('Username'), autocomplete: 'username' }, { key: 'pass', label: L('Password'), type: 'password', autocomplete: 'current-password' }],
          function (v) {
            if (!v.user.trim() || !v.pass) throw new Error(L('Enter your username and password.'));
            return OS.login(v.user.trim(), v.pass).then(function () { U.toast(L('Signed in as %@', v.user.trim())); rerender(); });
          }, { saveLabel: L('Sign In'), note: L('No account yet? Create one for free at opensubtitles.com.') });
      }, { icon: 'subs' });
    }
    return sec;
  };

  // MARK: profielen beheren (alleen het hoofdprofiel, zoals canAdmin op iOS)

  S.pages.profiles = function () {
    var box = h('div.pm');
    var el = h('div.page.settings.profiles-page', [subHead(L('Manage profiles')), box]);
    var pg = { el: el, title: L('Manage profiles') };
    function render() {
      U.clear(box);
      if (!isMain()) {
        box.appendChild(h('div.state', [U.icon('lock', 'state-ic'), h('h2', L('Manage profiles')), h('p.muted', L('Profiles are managed in the main account.')),
          h('div.state-btns', [U.button(L('Switch profile'), function () { B.app.switchProfile(); }, { primary: true, icon: 'users' })])]));
        return;
      }
      var grid = h('div.pf-grid.pm-grid');
      D.profiles.forEach(function (p) {
        var t = h('button.pf.pm-tile', { type: 'button', 'aria-label': L('Edit profile') + ': ' + p.name, style: { '--pf-accent': D.accents[D.accentKey(p)] } }, [
          h('div.pm-av', [S.avatar(p, 'big'), h('div.pm-edit', [U.icon('edit')])]),
          h('div.pf-name', [p.name, D.pinFor(p) ? U.icon('lock', 'pf-lock') : null]),
          D.isMain(p) ? h('div.pf-kids', L('Main account')) : (p.kids ? h('div.pf-kids', L('Kids')) : (D.ageLimit(p) != null ? h('div.pf-kids', L('Up to %d years', D.ageLimit(p))) : null))
        ]);
        t.addEventListener('click', function () { S.profileEditor(p); });
        grid.appendChild(t);
      });
      var add = h('button.pf.pm-tile.pm-add', { type: 'button' }, [h('div.pm-plus', [U.icon('plus')]), h('div.pf-name', L('Add profile'))]);
      add.addEventListener('click', function () { S.profileEditor(null); });
      grid.appendChild(add);
      box.appendChild(grid);
      box.appendChild(h('p.st-foot.pm-foot', L('Each profile uses the same server, with its own My List, Continue watching, favorites, history and age limit.')));
    }
    pg.refresh = render;
    var off = B.on('profiles', function () { if (el.parentNode) render(); });
    pg.destroy = off;
    render();
    return pg;
  };

  /** Foto verkleinen tot een vierkante JPEG van max. 512 px (zoals AccountService.squareJPEG op iOS). */
  function squareJPEG(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(img.naturalWidth, img.naturalHeight), out = Math.min(512, s);
        var c = document.createElement('canvas');
        c.width = c.height = out;
        c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, out, out);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('jpeg')); }, 'image/jpeg', 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error(L('This image can’t be used.'))); };
      img.src = url;
    });
  }

  /** Profiel toevoegen of wijzigen (ProfileEditor op iOS): naam, figuurtje of icoon met kleur, foto, kinderprofiel, leeftijd, pincode. */
  S.profileEditor = function (existing) {
    if (!isMain()) { U.toast(L('Profiles are managed in the main account.')); return null; }
    var av = existing ? D.avatar(existing) : null;
    var rawAv = existing && existing.avatar && typeof existing.avatar === 'object' ? existing.avatar : {};
    var st = {
      name: existing ? existing.name || '' : '',
      symbol: existing ? (av.kind === 'kid' ? av.value : (rawAv.symbol || 'tv')) : D.symbols[Math.floor(Math.random() * D.symbols.length)],
      colorIndex: existing ? av.colorIndex : Math.floor(Math.random() * D.palettes.length),
      kids: existing ? !!existing.kids : false,
      ageLimit: existing ? B.int(existing.ageLimit) : null,
      photo: existing && existing.photo && existing.photo.path ? 'keep' : null,   // 'keep' | Blob | null
      photoURL: null
    };
    var isMainProfile = existing && D.isMain(existing);
    var preview = h('div.pe-preview');
    function drawPreview() {
      U.clear(preview);
      if (st.photo instanceof Blob) {
        if (!st.photoURL) st.photoURL = URL.createObjectURL(st.photo);
        preview.appendChild(h('div.avatar.big.pe-av', { style: { background: '#222' } }, [h('img.photo', { src: st.photoURL, alt: '' })]));
      } else if (st.photo === 'keep') preview.appendChild(S.avatar(existing, 'big.pe-av'));
      else preview.appendChild(S.avatar({ avatar: { symbol: st.symbol, colorIndex: st.colorIndex, emoji: D.symbolEmoji[st.symbol] || null }, kids: st.kids }, 'big.pe-av'));
    }
    var name = h('input', { type: 'text', value: st.name, placeholder: L('Name'), 'aria-label': L('Name'), maxlength: '30' });
    name.addEventListener('input', function () { st.name = name.value; save.disabled = !st.name.trim(); });
    var kidsGrid = h('div.kid-grid');
    function drawKids() {
      U.clear(kidsGrid);
      D.illustrations.forEach(function (k) {
        var on = st.symbol === k && !st.photo;
        var b = h('button.kid' + (on ? '.on' : ''), { type: 'button', 'aria-label': k, 'aria-pressed': on ? 'true' : 'false' }, [h('img', { src: '../assets/img/' + k + '.png', alt: '' })]);
        b.addEventListener('click', function () { st.symbol = k; st.photo = null; drawKids(); symbols.redraw(); drawPreview(); drawPhoto(); });
        kidsGrid.appendChild(b);
      });
    }
    // de keuze van icoon en kleur werkt rechtstreeks op st (een figuurtje of foto zet het icoon uit)
    var symState = {
      get symbol() { return st.symbol; }, set symbol(v) { st.symbol = v; },
      get colorIndex() { return st.colorIndex; }, set colorIndex(v) { st.colorIndex = v; },
      url: null,
      get photo() { return !!st.photo; }
    };
    var symbols = symbolPicker(symState, function () { drawKids(); drawPreview(); drawPhoto(); },
      { clearPhoto: function () { st.photo = null; } });
    var file = h('input', { type: 'file', accept: 'image/*', 'aria-label': L('Profile photo') });
    file.style.display = 'none';
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      squareJPEG(f).then(function (b) { st.photo = b; st.photoURL = null; drawPreview(); drawPhoto(); drawKids(); symbols.redraw(); }, function (e) { U.toast(e.message); });
      file.value = '';
    });
    var photoBox = h('div.pe-photo');
    function drawPhoto() {
      U.clear(photoBox);
      photoBox.appendChild(U.button(st.photo ? L('Change photo') : L('Choose a photo'), function () { file.click(); }, { icon: 'camera', cls: 'small' }));
      if (st.photo) photoBox.appendChild(U.button(L('Remove photo'), function () { st.photo = null; drawPreview(); drawPhoto(); drawKids(); symbols.redraw(); }, { cls: 'small danger' }));
      photoBox.appendChild(file);
    }
    var kidsChk = check(L('Kids profile'), st.kids, function (on) {
      st.kids = on;
      if (on && (st.ageLimit == null || st.ageLimit > 12)) { st.ageLimit = 12; ageSel.value = '12'; }
      // kinderprofiel zonder eigen foto: meteen een vrolijk figuurtje
      if (on && !st.photo && !/^kid\d\d$/.test(st.symbol)) { st.symbol = D.illustrations[Math.floor(Math.random() * D.illustrations.length)]; drawKids(); symbols.redraw(); drawPreview(); }
      kidsHelp.style.display = on ? '' : 'none';
    });
    var ageSel = h('select.form-select', { 'aria-label': L('Age limit for this profile') }, [h('option', { value: '' }, L('None'))].concat([6, 9, 12, 16].map(function (a) {
      return h('option', { value: String(a) }, L('Up to %d years', a));
    })));
    ageSel.value = st.ageLimit != null ? String(st.ageLimit) : '';
    if (st.ageLimit != null && !ageSel.value) { ageSel.appendChild(h('option', { value: String(st.ageLimit) }, L('Up to %d years', st.ageLimit))); ageSel.value = String(st.ageLimit); }
    ageSel.addEventListener('change', function () { st.ageLimit = ageSel.value ? B.int(ageSel.value) : null; });
    var kidsHelp = h('p.muted.small', L('Kids profile: only kids channels, cartoons/family titles and titles with a known age rating within the limit, plus its own Top 10 for kids.'));
    kidsHelp.style.display = st.kids ? '' : 'none';
    var pinBox = h('div.pe-pin');
    function drawPin() {
      U.clear(pinBox);
      if (!existing) { pinBox.appendChild(h('p.muted.small', L('You can set a PIN after saving the profile.'))); return; }
      var has = !!D.pinFor(existing);
      pinBox.appendChild(h('p.muted.small', has ? L('This profile is protected with a PIN') : L('No PIN on this profile')));
      var row = h('div.pe-btns');
      row.appendChild(U.button(has ? L('Change PIN') : L('Set PIN'), function () {
        U.choosePIN(function (pin) {
          D.setPin(existing.id, pin).then(function () { U.toast(L('Saved')); drawPin(); }, function (e) { U.toast(e.message); drawPin(); });
        }, S.avatar(existing, 'pinav'));
      }, { icon: 'lock', cls: 'small' }));
      if (has) row.appendChild(U.button(L('Remove PIN'), function () {
        U.confirm(L('Remove PIN'), existing.name, L('Remove PIN'), function () {
          D.setPin(existing.id, null).then(function () { U.toast(L('Saved')); drawPin(); }, function (e) { U.toast(e.message); drawPin(); });
        }, { danger: true });
      }, { cls: 'small danger' }));
      pinBox.appendChild(row);
      pinBox.appendChild(h('p.muted.small', L('With a PIN, the profile asks for the code when it is chosen in “Who\'s watching?”.')));
      // build 146: oudere apps kennen de pincode als hash niet
      if (has) pinBox.appendChild(h('p.muted.small', L('Also update Bingr on your other devices, otherwise the PIN won’t work there.')));
    }
    var adminRows = isMainProfile ? [] : [
      h('div.form-row', [kidsChk, kidsHelp]),
      h('div.form-row', [fieldLabel(L('Age limit for this profile')), ageSel])
    ];
    var body = h('div.form-dlg.pe-form', [
      preview,
      h('div.form-row', [fieldLabel(L('Name')), name]),
      h('div.form-row', [fieldLabel(L('Choose a character')), kidsGrid]),
      h('div.form-row', [fieldLabel(L('Identify with an icon')), symbols]),
      h('div.form-row', [fieldLabel(L('Profile photo')), photoBox])
    ].concat(adminRows, [h('div.form-row', [fieldLabel(L('PIN code')), pinBox])]));
    var dlg = U.modal({ title: existing ? L('Edit profile') : L('Add profile'), body: body, cls: 'wide-dlg', buttons: [],
      onClose: function () { if (st.photoURL) URL.revokeObjectURL(st.photoURL); } });
    var save = U.button(L('Save'), function () {
      if (save.disabled || !st.name.trim()) return;
      save.disabled = true;
      var id = existing ? existing.id : B.uuid().toUpperCase();
      var kid = /^kid\d\d$/.test(st.symbol);
      var avatar = B.assign({}, rawAv, { symbol: st.symbol, colorIndex: st.colorIndex });
      if (kid) delete avatar.emoji; else avatar.emoji = D.symbolEmoji[st.symbol] || null;
      if (avatar.emoji == null) delete avatar.emoji;
      var p = { id: id, name: st.name.trim(), avatar: avatar };
      if (!isMainProfile) { p.kids = !!st.kids; p.ageLimit = st.ageLimit != null ? st.ageLimit : null; }
      var photoStep = function () {
        if (st.photo instanceof Blob) return D.setProfilePhoto(id, st.photo);
        if (!st.photo && existing && existing.photo && existing.photo.path) return D.setProfilePhoto(id, null);
        return null;
      };
      D.saveProfile(p).then(function () { return photoStep(); }).then(function () {
        var cur = B.app.profile;
        if (cur && String(cur.id).toLowerCase() === String(id).toLowerCase()) {
          var fresh = D.profileById(id);
          var ageChanged = fresh && (D.ageLimit(fresh) !== D.ageLimit(cur) || !!fresh.kids !== !!cur.kids);
          if (fresh) B.app.profile = fresh;
          B.emit('profiles');
          if (ageChanged) Lib.applyFilters();
        }
        U.toast(L('Saved'));
        dlg.close();
      }, function (e) { save.disabled = false; U.toast((e && e.message) || L('Something went wrong. Please try again.')); });
    }, { primary: true });
    save.disabled = !st.name.trim();
    var btns = [save, U.button(L('Cancel'), function () { dlg.close(); })];
    if (existing && !isMainProfile) btns.push(U.button(L('Make main profile'), function () {
      U.confirm(L('Make main profile'), L('%@ becomes the main profile: managing profiles and servers, Trakt and the settings move there. You become a regular profile.').replace('%@', existing.name), L('Make main profile'), function () {
        D.setMainProfile(existing.id).then(function () { U.toast(L('Saved')); dlg.close(); }, function (e) { U.toast(e.message); });
      });
    }, { icon: 'users' }));
    if (existing && !isMainProfile) btns.push(U.button(L('Delete profile'), function () {
      U.confirm(L('Delete profile'), L('Delete %@', existing.name), L('Delete'), function () {
        D.deleteProfile(existing.id).then(function () { U.toast(L('Deleted')); dlg.close(); }, function (e) { U.toast(e.message); });
      }, { danger: true });
    }, { cls: 'danger', icon: 'trash' }));
    dlg.el.appendChild(h('div.dlg-buttons', btns));
    drawPreview(); drawKids(); drawPhoto(); drawPin();
    setTimeout(function () { if (!existing) name.focus(); }, 40);
    return dlg;
  };
})();
