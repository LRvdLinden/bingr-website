/*
 * Build 179 (versie 1.0.8): onderdelen van de webspeler rond de pure logica in build179.js. Contract: docs/ACCOUNT.md
 * van iptv-ios-appletv, sectie "Build 179". Zelf gebouwd vanaf de bestaande Bingr-code.
 * - 1: servers en tv-gids vanzelf verversen (per browser: refresh.catalog, refresh.epg, refresh.cellular), bij openen,
 *   bij terugkeer naar het tabblad en elke 15 minuten; niet tijdens het afspelen; data besparen telt mee.
 * - 3: onthouden welke engine (hls / mpegts / native) per stream werkte (player.engineMemo, alleen deze browser).
 * - 5: de zaplijst toont alle zenders van de open server (zelfde filters).
 * - 13: na een volledige verversing titels die de aanbieder verwijderd heeft uit Mijn lijst en Verder kijken halen, of
 *   naar een andere server laten wijzen; melding "%d titels niet meer beschikbaar".
 * - 9, 10, 11, 12 en 16: zie de delen verderop.
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, Lib = B.lib, P = B.b179;
  var h = U.h;
  var L = function () { return B.L.apply(null, arguments); };
  var UI = B.b179ui = {};
  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }
  function nowS() { return Math.floor(Date.now() / 1000); }
  function prof() { return B.app && B.app.profile; }
  function saver() { try { return !!(B.b176ui && B.b176ui.saver()); } catch (e) { return false; } }
  function playing() { return !!(B.player && B.player.current); }

  // MARK: 1. vanzelf verversen

  var LAST_KEY = 'refresh.last';   // {server-id kleine letters: {full: s, epg: s}}
  UI.catalog = function () { return P.catalogValue(D.local('refresh.catalog', 'daily')); };
  UI.epg = function () { return P.epgValue(D.local('refresh.epg', '6h')); };
  UI.cellular = function () { return D.local('refresh.cellular', false) === true; };
  function lastAll() { var v = B.store.get(LAST_KEY, null); return v && typeof v === 'object' ? v : {}; }
  function setLast(sid, field, s) {
    var all = lastAll(), k = lower(sid);
    all[k] = all[k] || {};
    all[k][field] = s;
    B.store.set(LAST_KEY, all);
  }
  UI.last = function (sid) { return lastAll()[lower(sid)] || {}; };
  /** Bij de eerste keer na de update: de tijd van de bewaarde catalogus en gids als laatste verversing. */
  function seedLast() {
    (D.sources || []).forEach(function (src) {
      var l = UI.last(src.id);
      if (l.full == null) B.idb.getMeta('lib:' + src.id).then(function (m) { if (m && m.at && UI.last(src.id).full == null) setLast(src.id, 'full', Math.floor(m.at / 1000)); }, B.noop);
      if (l.epg == null) B.idb.getMeta('epg:' + src.id).then(function (m) { if (m && m.at && UI.last(src.id).epg == null) setLast(src.id, 'epg', Math.floor(m.at / 1000)); }, B.noop);
    });
  }
  B.on('sources', seedLast);
  setTimeout(seedLast, 0);

  // geslaagde volledige verversing (catalogus binnen, ook handmatig en de eerste keer) en geslaagde gids
  var origNoteSeen = Lib.noteSeen;
  Lib.noteSeen = function (src, oldRaw, newRaw) {
    if (src && newRaw) {
      setLast(src.id, 'full', nowS());
      try { noteRemoved(src, oldRaw, newRaw); } catch (e) { B.log('opruimen', e && e.message); }
    }
    return origNoteSeen.apply(this, arguments);
  };
  var origFetchEpg = Lib.fetchEpg;
  Lib.fetchEpg = function (src, lib, force) {
    var p = origFetchEpg.apply(this, arguments);
    if (force && src) p.then(function (epg) { if (epg && Object.keys(epg).length) setLast(src.id, 'epg', nowS()); }, B.noop);
    return p;
  };

  function usableSources() {
    return (D.sources || []).filter(function (s) { return !!s && (s.kind !== 'WebDAV' || !!(B.webdav && B.webdav.usable(s))); });
  }
  /** Wat moet er per server gebeuren? {full: [ids], epg: [ids], blocked: n} */
  UI.plan = function () {
    var out = { full: [], epg: [], blocked: 0 }, now = nowS(), sv = saver(), cell = UI.cellular();
    var act = Lib.source ? lower(Lib.source.id) : null;
    usableSources().forEach(function (src) {
      var l = UI.last(src.id);
      var a = P.refreshAction(UI.catalog(), UI.epg(), l.full == null ? null : l.full, l.epg == null ? null : l.epg, now, sv, cell);
      if (a === 'full') out.full.push(src.id);
      // gids-alleen: alleen de open server (de andere halen hun gids bij gebruik)
      else if (a === 'epg' && lower(src.id) === act && !B.media.isMediaServer(src.kind)) out.epg.push(src.id);
      else if (a === 'blocked') out.blocked++;
    });
    // de open server eerst
    out.full.sort(function (a, b) { return (lower(b) === act) - (lower(a) === act); });
    return out;
  };
  var busy = false, epgBusy = false;
  /** Kijken en zo nodig verversen; true als er iets begon. */
  UI.check = function (why) {
    if (!prof() || !B.xs || busy || (B.xs.refreshing && B.xs.refreshing())) return false;
    if (document.hidden) return false;
    var pl = UI.plan();
    if (pl.full.length) {
      busy = true;
      B.log('vanzelf verversen (' + why + '):', pl.full.length, 'server(s)');
      B.xs.refreshAll({ background: true, wait: true, only: pl.full, stale: function () { return !prof(); } })
        .then(function () { busy = false; }, function () { busy = false; });
      return true;
    }
    if (pl.epg.length && !playing() && !epgBusy && Lib.source && !Lib.loading) {
      var src = Lib.source, raw = Lib.raw;
      if (!raw || !raw.epgURL) return false;
      epgBusy = true;
      B.log('tv-gids vanzelf verversen (' + why + ')');
      Lib.fetchEpg(src, raw, true).then(function (epg) {
        epgBusy = false;
        if (epg && Object.keys(epg).length && Lib.source && Lib.source.id === src.id) { Lib.raw.epg = epg; Lib.lib.epg = epg; B.emit('epg'); }
      }, function () { epgBusy = false; });
      return true;
    }
    return false;
  };
  /** xs.js na de profielkeuze: een automatische verversing vervangt die keer de vraag "Servers bijwerken?". */
  UI.afterOpen = function () {
    var pl = UI.plan();
    if (pl.full.length) { setTimeout(function () { UI.check('openen'); }, 1500); return true; }
    if (pl.epg.length) setTimeout(function () { UI.check('openen'); }, 3000);
    return false;
  };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(function () { UI.check('zichtbaar'); }, 2000); });
  setInterval(function () { UI.check('timer'); }, P.CHECK_MS);

  // MARK: 3. onthouden engine per stream (player.engineMemo)

  var MEMO = 'player.engineMemo';
  UI.engineFor = function (key) {
    if (!key) return null;
    var m = B.store.get(MEMO, null), v = m && m[key];
    return v && v.e && Date.now() - v.at < P.MEMO_DAYS * 86400000 ? v.e : null;
  };
  UI.rememberEngine = function (key, engine) {
    if (!key) return;
    var cur = UI.engineFor(key);
    if (cur === (engine || null) && engine) return;
    B.store.set(MEMO, P.memoPut(B.store.get(MEMO, null) || {}, key, engine || null, Date.now()));
  };

  // MARK: 5. zaplijst: alle zenders van de open server

  UI.zapChannels = function (list, item) {
    var ch = item && item.channel;
    if (!ch || ch._src || ch._key || !Lib.source) return list;
    var all = (Lib.lib && Lib.lib.channels) || [];
    if (all.length <= list.length) return list;
    var mine = all.some(function (c) { return c.id === ch.id; });
    return mine ? all.filter(function (c) { return !c.radio; }) : list;
  };

  // MARK: 13. opruimen wat de aanbieder verwijderd heeft

  var queue = [];   // [{src, removed: {id: {type, item}}}]
  function idsOf(list) { return (list || []).map(function (x) { return String(x.id); }); }
  function noteRemoved(src, oldRaw, newRaw) {
    if (!oldRaw) return;
    var before = (oldRaw.movies || []).length + (oldRaw.series || []).length;
    var after = (newRaw.movies || []).length + (newRaw.series || []).length;
    // series van Xtream kunnen later binnenkomen: een soort die leeg terugkwam telt als niet volledig
    var complete = !((oldRaw.movies || []).length && !(newRaw.movies || []).length) && !((oldRaw.series || []).length && !(newRaw.series || []).length);
    if (!P.cleanupAllowed(before, after, complete)) return;
    var removed = {}, n = 0;
    [['movie', 'movies'], ['series', 'series']].forEach(function (k) {
      var have = Object.create(null);
      idsOf(newRaw[k[1]]).forEach(function (id) { have[id] = 1; });
      (oldRaw[k[1]] || []).forEach(function (x) { if (!have[String(x.id)]) { removed[String(x.id)] = { type: k[0], item: x }; n++; } });
    });
    if (n) queue.push({ src: src, removed: removed });
  }
  /** Na "alle servers bijwerken": per verwijzing keep/remap/remove (cleanupAction). */
  function processQueue() {
    var jobs = queue.splice(0);
    if (!jobs.length || !prof() || !B.xs) return Promise.resolve(0);
    var X = B.xs, count = 0, chain = Promise.resolve();
    jobs.forEach(function (job) {
      var sid = lower(job.src.id);
      var refs = [];
      D.setList('myList').forEach(function (k) {
        var p = X.split(k);
        if (p && lower(p.sid) === sid && job.removed[p.item]) refs.push({ field: 'myList', key: k, id: p.item });
      });
      D.progressList().forEach(function (e) {
        if (e.e && lower(e.e.playlistID) === sid && job.removed[e.key] && job.removed[e.key].type === 'movie') refs.push({ field: 'progress', key: job.src.id + '|' + e.key, id: e.key, pkey: e.key });
      });
      refs.forEach(function (r) {
        chain = chain.then(function () {
          var info = job.removed[r.id];
          if (!X.meta(r.key)) X.putMeta(r.key, X.metaFor(job.src.id, info.type, info.item));
          return X.search(r.key, info.type, true).then(function (found) { return found; }, function () { return null; }).then(function (found) {
            var act = P.cleanupAction(false, !!(found && !found.guess));
            if (act === 'remap') X.commit(r.key, found);
            else if (r.field === 'myList') D.toggleSet('myList', r.key, false);
            else D.clearProgress(r.pkey);
            count++;
          });
        });
      });
    });
    return chain.then(function () { return count; });
  }
  UI.refreshed = function () {
    processQueue().then(function (n) {
      if (n > 0) { U.toast(L('%d titles no longer available', n), 6000); B.emit('profileData'); }
    }, B.noop);
  };

  // MARK: server-functies (ratings, introdb): apikey + Bearer, zoals de andere functies

  function callFn(name, body) {
    var A = B.account;
    if (!A || !A.isSignedIn()) return Promise.resolve(null);
    return A.validAccessToken().then(function (token) {
      if (!token) return null;
      return B.http(B.config.supabaseUrl + '/functions/v1/' + name, { method: 'POST', timeout: 15000, body: body,
        headers: { apikey: B.config.supabaseKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' } })
        .then(function (r) { return r && r.status === 200 ? (r.json || null) : null; }, function () { return null; });
    }, function () { return null; });
  }
  function cacheGet(store, key, days) {
    var m = B.store.get(store, null) || {}, v = m[key];
    return v && Date.now() - v.at < days * 86400000 ? v : null;
  }
  function cachePut(store, key, val, max) {
    var m = B.store.get(store, null) || {};
    m[key] = { at: Date.now(), v: val };
    var keys = Object.keys(m);
    if (keys.length > max) keys.sort(function (a, b) { return m[a].at - m[b].at; }).slice(0, keys.length - max).forEach(function (k) { delete m[k]; });
    B.store.set(store, m);
  }

  // MARK: 9. beoordelingen (functie ratings, MDBList op de server)

  var RNAMES = { imdb: 'IMDb', tomatoes: 'RT', tomatoesaudience: null, metacritic: 'MC', letterboxd: 'Letterboxd', trakt: 'Trakt', tmdb: 'TMDB' };
  /** [{source, value}] van een titel (cache 7 dagen), of [] als de functie niet beschikbaar is. */
  UI.ratings = function (type, tmdb) {
    tmdb = B.int(tmdb);
    if (!tmdb) return Promise.resolve([]);
    var key = (type === 'series' ? 'show:' : 'movie:') + tmdb, hit = cacheGet('b179.ratings', key, P.RATINGS_DAYS);
    if (hit) return Promise.resolve(hit.v || []);
    return callFn('ratings', { type: type === 'series' ? 'show' : 'movie', tmdb: tmdb }).then(function (j) {
      if (!j || j.ok !== true || !Array.isArray(j.ratings)) return [];
      cachePut('b179.ratings', key, j.ratings, 300);
      return j.ratings;
    });
  };
  /** Rij "IMDb 8.8 · RT 92% · Publiek 85% · MC 66 · …" (null als er niets te tonen is). */
  UI.ratingsLine = function (list) {
    var by = {};
    (list || []).forEach(function (r) { if (r && r.source) by[r.source] = r.value; });
    var parts = [];
    P.RATING_ORDER.forEach(function (src) {
      var t = P.ratingText(src, by[src]);
      if (t == null) return;
      var name = src === 'tomatoesaudience' ? L('Audience') : RNAMES[src];
      parts.push(h('span.rt-it', [h('span.rt-src', name), ' ' + t]));
    });
    if (!parts.length) return null;
    var out = [];
    parts.forEach(function (p, i) { if (i) out.push(h('span.rt-dot', ' · ')); out.push(p); });
    return h('div.dt-ratings', { 'aria-label': L('Ratings') }, out);
  };

  // MARK: 11. duim omhoog/omlaag (profile.<id>.ratings) en Voor jou

  function thumbs() { var v = D.profileField ? D.profileField('ratings') : null; return Array.isArray(v) ? v : []; }
  UI.thumbOf = function (key) {
    var v = 0;
    thumbs().forEach(function (r) { if (r && r.key === key) v = r.value; });
    return v;
  };
  UI.setThumb = function (key, value) {
    var list = thumbs().filter(function (r) { return r && r.key !== key; });
    var prev = 0;
    thumbs().forEach(function (r) { if (r && r.key === key) prev = P.time(r.at); });
    list.push({ key: key, value: value, at: B.iso(Math.max(Date.now(), prev + 1)) });
    D.setProfileField('ratings', P.mergeThumbs([], list, Date.now()));
    fyVer++;
    B.emit('forYou');
  };
  /** Duimen op de detailpagina; nog eens tikken = weghalen (0). */
  UI.thumbButtons = function (keyFn) {
    var box = h('div.dt-thumbs', { role: 'group', 'aria-label': L('Rate') });
    function draw() {
      U.clear(box);
      var key = keyFn(), v = UI.thumbOf(key);
      [[1, 'thumbUp', L('I like this')], [-1, 'thumbDown', L('Not for me')]].forEach(function (t) {
        var on = v === t[0];
        var b = h('button.icon-btn.dt-thumb' + (on ? '.on' : ''), { type: 'button', title: t[2], 'aria-label': t[2], 'aria-pressed': on ? 'true' : 'false' }, [U.icon(t[1])]);
        b.addEventListener('click', function (e) { e.stopPropagation(); UI.setThumb(keyFn(), on ? 0 : t[0]); draw(); if (!on) U.toast(t[0] > 0 ? L('We’ll show more like this in For you.') : L('We’ll show less like this.'), 2500); });
        box.appendChild(b);
      });
    }
    draw();
    box.redraw = draw;
    return box;
  };
  UI.forYouOn = function () { return D.local('home.forYou', true) !== false; };

  var fyVer = 0, fyRecs = {}, fyAsked = {}, fyDetails = {};
  function sidOf(x) { return (x._src || Lib.source || {}).id || ''; }
  function keyOfItem(type, x) { return P.thumbKey(type, x.tmdb || x.tmdbID, sidOf(x), x.id); }
  function genresOf(x, type) { return B.categories && B.categories.genresOf ? B.categories.genresOf(x, type === 'series') : []; }
  function castOf(x) { return String(x.cast || x.actors || '').split(/[,/]/).map(function (c) { return P.norm(c); }).filter(Boolean).slice(0, 5); }
  function normT(t) { var p = B.parseTitle(t); return P.norm((p && p.title) || t).replace(/ /g, ''); }
  /** TMDB-details (genres/cast/aanbevelingen) van een paar titels met een duim of die je bekeek (op de achtergrond). */
  function askDetails(list) {
    if (!B.details || !B.ageRatings || !B.ageRatings.hasKey()) return;
    list.slice(0, 6).forEach(function (e) {
      if (fyAsked[e.key]) return;
      fyAsked[e.key] = true;
      B.details.load(e.item, e.type === 'series', {}).then(function (d) {
        if (!d) return;
        fyDetails[e.key] = { genres: (d.genres || []).map(P.norm), cast: (d.cast || []).slice(0, 5).map(function (c) { return P.norm(c.name); }) };
        fyRecs[e.key] = (d.recommendations || []).map(function (r) { return { t: normT(r.title), o: r.original ? normT(r.original) : null, s: !!r.isShow }; });
        fyVer++;
        B.emit('forYou');
      }, B.noop);
    });
  }
  /**
   * Voor jou volgens het contract (forYou), alleen als dit profiel duimen heeft; anders null (dan de bestaande rij).
   * Titels: de (gefilterde) bibliotheken van je servers; kinderprofiel en verborgen/geblokkeerde titels tellen niet mee.
   */
  UI.forYou = function () {
    var p = prof();
    var th = thumbs().filter(function (r) { return r.value === 1 || r.value === -1; });
    if (!p || !th.length) return null;
    var libs = B.xs ? B.xs.libs(null) : [Lib.lib];
    var hist = D.history();
    var sig = 'fy179:' + p.id + ':' + th.length + ':' + (th.length ? th[th.length - 1].at : '') + ':' + hist.length + ':' + fyVer + ':' + (B.xs ? B.xs.version : 0) + ':' + libs.length;
    return Lib.memo(sig, function () {
      var thumbBy = {};
      th.forEach(function (r) { thumbBy[r.key] = r.value; });
      var titles = [], byKey = {}, byTitle = {};
      var hide = B.b171ui && B.b171ui.hides ? B.b171ui.hides : null;
      libs.forEach(function (lib) {
        [['movie', lib.movies || []], ['series', lib.series || []]].forEach(function (pl) {
          for (var i = 0; i < pl[1].length && i < 20000; i++) {
            var x = pl[1][i], type = pl[0], k = keyOfItem(type, x);
            if (byKey[k]) continue;
            var e = { key: k, title: x.title || '', type: type, item: x, rating: x.rating > 10 ? x.rating / 10 : (x.rating || 0) };
            byKey[k] = e;
            byTitle[type + '|' + normT(x.rawTitle || x.title)] = byTitle[type + '|' + normT(x.rawTitle || x.title)] || e;
            titles.push(e);
          }
        });
      });
      var liked = [], disliked = [], watched = [], blocked = [];
      titles.forEach(function (e) {
        var v = thumbBy[e.key];
        if (v === 1) liked.push(e); else if (v === -1) disliked.push(e);
        try { if (hide && (hide(e.item, e.type) || (B.b176ui && B.b176ui.isLocked(e.item, e.type)))) blocked.push(e.key); } catch (er) { /* stil */ }
      });
      // bekeken = kijkgeschiedenis (films en series) zonder duim
      hist.slice(0, 80).forEach(function (h0) {
        if (h0.type === 'live') return;
        var t = h0.type === 'movie' ? 'movie' : 'series';
        var e = byTitle[t + '|' + normT(h0.type === 'movie' ? h0.title : (h0.title || ''))];
        if (e && !thumbBy[e.key] && watched.indexOf(e) < 0) watched.push(e);
      });
      askDetails(liked.concat(disliked, watched.slice(0, 3)));
      function recCount(list) {
        var out = {};
        list.forEach(function (e) {
          (fyRecs[e.key] || []).forEach(function (r) {
            var hit = byTitle[(r.s ? 'series' : 'movie') + '|' + r.t] || (r.o ? byTitle[(r.s ? 'series' : 'movie') + '|' + r.o] : null);
            if (hit) out[hit.key] = (out[hit.key] || 0) + 1;
          });
        });
        return out;
      }
      var input = {
        titles: titles.map(function (e) {
          var d = fyDetails[e.key];
          return { key: e.key, title: e.title, rating: e.rating, genres: d && d.genres.length ? d.genres : genresOf(e.item, e.type), cast: d && d.cast.length ? d.cast : castOf(e.item) };
        }),
        liked: liked.map(function (e) { return e.key; }), disliked: disliked.map(function (e) { return e.key; }),
        watched: watched.map(function (e) { return e.key; }), blocked: blocked,
        recLiked: recCount(liked), recWatched: recCount(watched.slice(0, 3))
      };
      // genres uit TMDB (namen) en uit de bibliotheek (sleutels) lopen uiteen: voor titels met details beide meetellen
      input.titles.forEach(function (t) {
        var e = byKey[t.key], own = genresOf(e.item, e.type);
        own.forEach(function (g) { if (t.genres.indexOf(g) < 0) t.genres.push(g); });
      });
      var keys = P.forYou(input);
      var items = keys.map(function (k) { return { type: byKey[k].type, item: byKey[k].item }; });
      if (S().dedupeRow) items = S().dedupeRow(items);
      return items.length ? { popular: false, items: items } : null;
    });
  };
  function S() { return B.screens || {}; }

  // MARK: 12. sorteren per categorie (profile.<id>.categorySort)

  function sorts() { var v = D.profileField ? D.profileField('categorySort') : null; return v && typeof v === 'object' ? v : {}; }
  UI.sortFor = function (sid, kind, category) { var e = sorts()[P.sortKey(sid, kind, category)]; return P.sortValue(e && e.value); };
  UI.setSort = function (sid, kind, category, value) {
    var k = P.sortKey(sid, kind, category), cur = sorts(), prev = cur[k] ? P.time(cur[k].at) : 0;
    var next = B.assign({}, cur);
    next[k] = { value: P.sortValue(value), at: B.iso(Math.max(Date.now(), prev + 1)) };
    D.setProfileField('categorySort', next);
  };
  UI.SORT_LABELS = function () { return { server: L('Default'), name: L('Name A–Z'), year: L('Year (newest)'), added: L('Added (newest)'), rating: L('Rating') }; };
  /** Titels gesorteerd volgens de keuze. */
  UI.sortItems = function (items, mode) {
    if (P.sortValue(mode) === 'server') return items;
    var idx = P.sortIndices(mode, items.map(function (x) {
      var r = x.rating > 10 ? x.rating / 10 : x.rating;
      return { name: x.title, year: x.year, added: x.addedAt ? Math.floor(x.addedAt / 1000) : null, rating: r };
    }));
    return idx.map(function (i) { return items[i]; });
  };
  /** Knop "Sorteren" met menu. */
  UI.sortButton = function (sid, kind, category, after) {
    var labels = UI.SORT_LABELS(), cur = UI.sortFor(sid, kind, category);
    var b = U.button(labels[cur], function () {
      U.menu(b, P.SORTS.map(function (v) {
        return { icon: v === cur ? 'check' : 'blank', label: labels[v], fn: function () { if (v === cur) return; UI.setSort(sid, kind, category, v); if (after) after(); } };
      }), L('Sort'));
    }, { icon: 'sort', cls: 'cat-sort', title: L('Sort') + ': ' + labels[cur] });
    b.setAttribute('aria-haspopup', 'menu');
    return b;
  };

  // MARK: 10. intro en samenvatting overslaan (functie introdb)

  /** {intro, recap, credits} in seconden voor een aflevering, of null (dan de bestaande intro-markeringen).
   *  Build 186: zonder TMDB-id de serie (titel, jaar, imdb) meegeven; de server zoekt dan zelf het TMDB-id. */
  UI.introFor = function (tmdb, season, episode, imdb, series) {
    var t = B.int(tmdb) || null;
    var rq = P.introRequest(t, imdb || (series && series.imdbID) || null, t ? null : series && (series.rawTitle || series.title),
      t ? null : series && series.year, season, episode);
    if (!rq) return Promise.resolve(null);
    var hit = cacheGet('b179.introdb', rq.key, P.INTRO_DAYS);
    if (hit && (hit.v || Date.now() - hit.at < P.INTRO_MISS_DAYS * 86400000)) return Promise.resolve(hit.v || null);
    return callFn('introdb', rq.body).then(function (j) {
      var seg = P.introSegments(j);
      if (j && (seg || j.error === 'not_found')) cachePut('b179.introdb', rq.key, seg, 400);
      return seg;
    });
  };
  /** TMDB-id van een serie (eigen veld, anders de bestaande opzoeking via de leeftijden/TMDB). */
  UI.seriesTmdb = function (series) {
    if (!series) return Promise.resolve(null);
    var t = B.int(series.tmdb || series.tmdbID);
    if (t) return Promise.resolve(t);
    if (!B.ageRatings || !B.ageRatings.hasKey()) return Promise.resolve(null);
    return B.ageRatings.lookup(series, true).then(function (r) { return r && r.found !== false && r.id != null ? r.id : null; }, function () { return null; });
  };

  // MARK: instellingen (Servers > Bijwerken)

  var CAT_LABELS = function () { return { '6h': L('Every 6 hours'), daily: L('Daily'), '3d': L('Every 3 days'), weekly: L('Weekly'), manual: L('Manually only') }; };
  var EPG_LABELS = function () { return { '6h': L('Every 6 hours'), '12h': L('Every 12 hours'), daily: L('Daily') }; };
  /** Algemeen: rij Voor jou aan/uit (lokaal home.forYou). */
  UI.generalRows = function (section, row, render) {
    var on = UI.forYouOn();
    var sec = section(L('Start screen'));
    row(sec, L('For you'), null, function () { D.setLocal('home.forYou', !on); render(); },
      { toggle: on, icon: 'sparkle', sub: L('A row on Home with titles from your servers, based on what you watched and your thumbs up or down.') });
  };
  UI.settingsRows = function (sec, row, render) {
    var cl = CAT_LABELS(), el = EPG_LABELS();
    row(sec, L('Refresh channels, movies and series'), cl[UI.catalog()], function () {
      U.choose(L('Refresh channels, movies and series'), P.CATALOG_ORDER.map(function (k) { return { value: k, label: cl[k] }; }), UI.catalog(), function (v) {
        D.setLocal('refresh.catalog', P.catalogValue(v)); render(); setTimeout(function () { UI.check('instelling'); }, 500);
      });
    }, { icon: 'refresh', sub: L('In the background while Bingr is open, not while you watch. Applies to this browser.') });
    row(sec, L('Refresh TV guide'), el[UI.epg()], function () {
      U.choose(L('Refresh TV guide'), P.EPG_ORDER.map(function (k) { return { value: k, label: el[k] }; }), UI.epg(), function (v) {
        D.setLocal('refresh.epg', P.epgValue(v)); render(); setTimeout(function () { UI.check('instelling'); }, 500);
      });
    }, { icon: 'guide' });
    // alleen waar de browser het netwerk kent (telefoon/tablet)
    if (navigator.connection && (U.isPhone && U.isPhone() || 'ontouchstart' in window)) {
      var on = UI.cellular();
      row(sec, L('Also on cellular'), null, function () { D.setLocal('refresh.cellular', !on); render(); },
        { toggle: on, sub: L('With data saver on, Bingr only refreshes on Wi-Fi unless you allow cellular.') });
    }
  };
})();
