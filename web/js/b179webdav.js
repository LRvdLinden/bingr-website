/*
 * Build 179 (#16): WebDAV als bron in de webspeler (kind "WebDAV", docs/ACCOUNT.md "Build 179"). Een WebDAV-bron wordt in
 * de apps toegevoegd; hier alleen gebruikt als de server browsers toelaat (CORS met Authorization, PROPFIND en Range).
 * Lukt de proef niet (CORS, of alleen Digest), dan staat de bron niet in de webspeler (één melding).
 * - Doorbladeren: PROPFIND Depth 1, recursief tot 6 niveaus en max. 20.000 bestanden, Basic-inlog.
 * - Herkennen: B.b179.webdavParse (films, series met seizoenen en afleveringen); geen live tv en geen downloads.
 * - Afspelen: een <video> kan geen Authorization-kop meesturen, dus het adres loopt via de service worker van de
 *   webspeler (sw.js, route __dav/), die de kop toevoegt; de inloggegevens staan alleen in het geheugen van die worker.
 */
(function () {
  'use strict';
  var B = window.B, D = B.data, P = B.b179;
  var W = B.webdav = {};
  var L = function () { return B.L.apply(null, arguments); };
  var KIND = 'WebDAV', MAX_DEPTH = 6, MAX_FILES = 20000;
  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }
  function okKey(src) { return 'webdav.ok.' + lower(src.id); }
  function base(src) { var u = String(src.serverURL || '').trim(); return u && !/\/$/.test(u) ? u + '/' : u; }
  function auth(src) {
    var user = src.username || '', pw = D.secret(src, 'password');
    if (!user && !pw) return null;
    try { return 'Basic ' + btoa(unescape(encodeURIComponent(user + ':' + pw))); } catch (e) { return null; }
  }
  W.isWebDAV = function (src) { return !!src && src.kind === KIND; };
  /** Mag deze bron in de browser gebruikt worden? (proef gelukt) */
  W.usable = function (src) { return W.isWebDAV(src) && B.store.get(okKey(src), null) === true; };

  function propfind(src, url) {
    var h = { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' };
    var a = auth(src);
    if (a) h.Authorization = a;
    var ctl = window.AbortController ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    return fetch(url, { method: 'PROPFIND', headers: h, credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined,
      body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>' })
      .then(function (r) {
        if (t) clearTimeout(t);
        if (r.status === 401) { var e = new Error(/digest/i.test(r.headers.get('WWW-Authenticate') || '') ? 'digest' : 'auth'); e.status = 401; throw e; }
        if (r.status !== 207 && !r.ok) { var e2 = new Error('http ' + r.status); e2.status = r.status; throw e2; }
        return r.text();
      }, function (e) { if (t) clearTimeout(t); var x = new Error('cors'); x.cors = true; x.cause = e; throw x; });
  }
  /** Proef: één PROPFIND op de basismap. true = bruikbaar, false = niet in de browser. */
  W.probe = function (src) {
    if (!W.isWebDAV(src) || !base(src)) return Promise.resolve(false);
    return propfind(src, base(src)).then(function () { B.store.set(okKey(src), true); return true; }, function (e) {
      // alleen een weigering van de browser (CORS) of alleen Digest telt als "geen browsers"; een netwerkfout niet onthouden
      if (e && (e.cors || e.message === 'digest')) { B.store.set(okKey(src), false); return false; }
      return B.store.get(okKey(src), null) === true;
    });
  };
  var noted = {};
  /** Nieuwe of gewijzigde WebDAV-bronnen proberen; niet bruikbaar = één melding. */
  W.check = function (all) {
    (all || []).filter(W.isWebDAV).forEach(function (src) {
      if (B.store.get(okKey(src), null) != null) return;
      W.probe(src).then(function (ok) {
        if (ok) { if (D.reapplySources) D.reapplySources(); return; }
        if (!noted[lower(src.id)] && B.ui && B.ui.toast) { noted[lower(src.id)] = true; B.ui.toast(L('This WebDAV server doesn’t allow browsers') + ' (' + (src.name || 'WebDAV') + ')', 7000); }
      });
    });
  };

  // MARK: bibliotheek

  function abs(src, href) {
    try { return new URL(href, base(src)).href; } catch (e) { return null; }
  }
  /** Alle videobestanden (recursief), als [{url, path}]. */
  function walk(src) {
    var files = [], root = base(src), rootPath;
    try { rootPath = new URL(root).pathname; } catch (e) { rootPath = '/'; }
    var queue = [{ url: root, depth: 0 }];
    function next() {
      if (!queue.length || files.length >= MAX_FILES) return Promise.resolve(files);
      var dir = queue.shift();
      var selfPath; try { selfPath = new URL(dir.url).pathname; } catch (e) { selfPath = dir.url; }
      return propfind(src, dir.url).then(function (xml) {
        P.parsePropfind(xml, selfPath).forEach(function (it) {
          var u = abs(src, it.href);
          if (!u) return;
          if (it.dir) { if (dir.depth + 1 < MAX_DEPTH) queue.push({ url: u, depth: dir.depth + 1 }); return; }
          var path; try { path = new URL(u).pathname; } catch (e) { path = it.href; }
          if (path.indexOf(rootPath) === 0) path = '/' + path.slice(rootPath.length);
          if (files.length < MAX_FILES) files.push({ url: u, path: path });
        });
      }, function (e) { if (dir.depth === 0) throw e; }).then(next);
    }
    return next();
  }
  /** Bibliotheek in de vorm van een M3U-bibliotheek: films en series (met afleveringen), geen zenders. */
  W.library = function (src) {
    if (!W.usable(src)) return Promise.reject(new Error(L('This WebDAV server doesn’t allow browsers')));
    var prefix = String(src.id).slice(0, 8);
    return walk(src).then(function (files) {
      var movies = [], series = {}, order = [];
      files.forEach(function (f) {
        var r = P.webdavParse(f.path);
        var id = prefix + '-' + B.stableHash(f.url);
        var parts = f.path.split('/').filter(Boolean), group = parts.length > 1 ? decodeURIComponentSafe(parts[0]) : 'WebDAV';
        if (r.kind === 'movie') movies.push({ id: id, title: r.title, year: r.year, poster: null, group: group, streamURL: f.url });
        else if (r.kind === 'episode') {
          var k = P.norm(r.title);
          if (!series[k]) { series[k] = { id: 's-' + B.stableHash(src.id + '|' + k), title: r.title, year: null, poster: null, group: group, episodes: [] }; order.push(k); }
          series[k].episodes.push({ id: id, seriesID: series[k].id, season: r.season, number: r.episode, title: r.title + ' S' + r.season + 'E' + r.episode, streamURL: f.url, still: null });
        }
      });
      var list = order.map(function (k) { var s = series[k]; s.episodes.sort(function (a, b) { return a.season - b.season || a.number - b.number; }); return s; });
      return { channels: [], movies: movies, series: list, epg: {},
        fetch: { live: { status: 'empty', count: 0 }, movie: { status: movies.length ? 'ok' : 'empty', count: movies.length }, series: { status: list.length ? 'ok' : 'empty', count: list.length } } };
    });
  };
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  // MARK: afspelen via de service worker

  function worker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.reject(new Error('no_sw'));
    var reg = navigator.serviceWorker.controller ? Promise.resolve() : navigator.serviceWorker.register('sw.js', { scope: './' }).then(function () { return navigator.serviceWorker.ready; });
    return reg.then(function () {
      if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
      // net geregistreerd: de worker neemt de pagina over (clients.claim)
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error('no_sw')); }, 4000);
        navigator.serviceWorker.addEventListener('controllerchange', function () { clearTimeout(t); resolve(navigator.serviceWorker.controller); }, { once: true });
      });
    });
  }
  /** Afspeeladres voor een bestand op deze bron (via sw.js, met de inlog in het geheugen van de worker). */
  W.playURL = function (src, url) {
    var a = auth(src);
    if (!a) return Promise.resolve(url);
    return worker().then(function (sw) {
      sw.postMessage({ type: 'bingr-dav', base: base(src), auth: a });
      var b64 = btoa(unescape(encodeURIComponent(url))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return new URL('__dav/' + b64, location.href.split('#')[0].replace(/[^\/]*$/, '')).href;
    }, function () { throw new Error(L('This WebDAV server doesn’t allow browsers')); });
  };

  B.on('sources', function () { setTimeout(function () { W.check(D.allSources || D.sources); }, 500); });
})();
