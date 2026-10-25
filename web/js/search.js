/*
 * Build 149: zoeken in de webspeler ("in Stremio komt het op, in de app niet").
 * - Woorden in plaats van de letterlijke zin: elk woord moet voorkomen (volgorde maakt niet uit), als begin van een woord
 *   of als deel ervan.
 * - Normaliseren (B.search.norm): kleine letters, zonder accenten en diakrieten, & = and, leestekens weg; bij titels ook
 *   voorvoegsels als "NL | ", "4K - ", "[NL] ". De zoeksleutel wordt per item één keer berekend (x._sk).
 * - Volgorde: exact, begint met, elk woord als woordbegin, bevat; daarna titels met één typefout (woorden van 5+ letters).
 * - Bereik: alle servers (actieve eerst), films, series en zenders; Stremio-add-ons met een zoekcatalogus
 *   (/catalog/<type>/<id>/search=<q>.json, via de proxy als dat moet), samengevoegd en ontdubbeld.
 * - Verborgen categorieën: de compacte zoekindex (lib.hiddenMovies/Series/Live, niet ingelezen items); die treffers komen
 *   onderaan met het label "verborgen categorie".
 * - In stukjes (B.chunked) en alleen het laatste zoekwoord telt (het scherm wacht 220 ms na de laatste toets).
 */
(function () {
  'use strict';
  var B = window.B;
  var Lib = B.lib, D = B.data;
  var Q = B.search = {};

  var PREFIX = /^\s*(?:\[[^\]]{1,8}\]\s*|\([^)]{1,8}\)\s*|\|[^|]{1,8}\|\s*|[a-z0-9+]{2,4}(?:\s*[|:»]\s*|\s+[-–]\s*|[-–]\s+))/;
  var JUNK = /[^a-z0-9À-ɏͰ-ϿЀ-ӿ֐-ۿ぀-ヿ㐀-鿿가-힯]+/g;
  /** Zoektekst: opgevouwen, & = and, leestekens weg. title = true: ook landen-/kwaliteitsvoorvoegsels weg. */
  Q.norm = function (s, title) {
    s = B.fold(s == null ? '' : s).replace(/&/g, ' and ').replace(/[’'`´]/g, '');
    if (title) {
      var prev = null;
      while (s !== prev) { prev = s; var n = s.replace(PREFIX, ''); if (n.trim()) s = n; else break; }
    }
    return s.replace(JUNK, ' ').trim();
  };
  /** Zoeksleutel van een item (één keer): titel of zendernaam. */
  Q.keyOf = function (x, field) {
    if (x._sk != null) return x._sk;
    var v = Q.norm(x[field] || x.title || x.name || '', true);
    try { Object.defineProperty(x, '_sk', { value: v, writable: true, configurable: true, enumerable: false }); } catch (e) { x._sk = v; }
    return v;
  };
  /** Hooguit één bewerking (invoegen, weglaten, vervangen of twee letters omgedraaid) verschil? */
  function within1(a, b) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0;
    while (i < la && i < lb && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    if (i === la && i === lb) return true;
    if (la === lb) {
      if (a.slice(i + 1) === b.slice(i + 1)) return true;
      return i + 1 < la && a.charCodeAt(i) === b.charCodeAt(i + 1) && a.charCodeAt(i + 1) === b.charCodeAt(i) && a.slice(i + 2) === b.slice(i + 2);
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  Q.within1 = within1;
  /** Vooraf voor een zoekopdracht: {q, words}. */
  Q.query = function (q) {
    var n = Q.norm(q, false);
    var w = n ? n.split(' ') : [];
    var seen = {};
    w = w.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
    // langste woord eerst: valt het snelst af
    var order = w.slice().sort(function (a, b) { return b.length - a.length; });
    return { q: n, words: order };
  };
  /**
   * Score van sleutel k voor zoekopdracht qq (lager = beter): 0 exact, 1 begint met, 2 elk woord als woordbegin,
   * 3 elk woord ergens, 4 met één typefout (woord van 5+ letters), -1 = geen treffer.
   */
  Q.score = function (k, qq) {
    if (!k || !qq.q) return -1;
    if (k === qq.q) return 0;
    if (k.lastIndexOf(qq.q, 0) === 0) return 1;
    var sp = ' ' + k, ws = qq.words, allStart = true, i;
    for (i = 0; i < ws.length; i++) {
      var at = sp.indexOf(' ' + ws[i]);
      if (at < 0) { allStart = false; if (k.indexOf(ws[i]) < 0) break; }
    }
    if (i === ws.length) return allStart ? 2 : 3;
    // één typefout toegestaan per woord van 5+ letters (de rest moet gewoon voorkomen)
    var toks = null;
    for (i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (k.indexOf(w) >= 0) continue;
      if (w.length < 5) return -1;
      toks = toks || k.split(' ');
      var ok = false;
      for (var t = 0; t < toks.length && !ok; t++) {
        var tk = toks[t];
        if (tk.length >= w.length - 1 && (within1(w, tk) || (tk.length > w.length && within1(w, tk.slice(0, w.length))))) ok = true;
      }
      if (!ok) return -1;
    }
    return 4;
  };
  var KINDS = [['channel', 'channels', 'name'], ['movie', 'movies', 'title'], ['series', 'series', 'title']];
  /**
   * Gerangschikt zoeken over lijsten van bibliotheken (synchroon, voor kleine lijsten en de bestaande aanroepen):
   * libs = [{channels, movies, series}], → {channels, movies, series}. dedupe(type, items) mag dubbele weghalen.
   */
  Q.rankSync = function (libs, q, limit, dedupe) {
    var qq = Q.query(q), out = { channels: [], movies: [], series: [] };
    if (!qq.q) return out;
    KINDS.forEach(function (kd) {
      var b = [[], [], [], [], []];
      (libs || []).forEach(function (lib) {
        var list = (lib && lib[kd[1]]) || [];
        for (var i = 0; i < list.length; i++) { var s = Q.score(Q.keyOf(list[i], kd[2]), qq); if (s >= 0 && b[s].length < limit * 3) b[s].push(list[i]); }
      });
      var all = b[0].concat(b[1], b[2], b[3], b[4]);
      out[kd[1]] = (dedupe ? dedupe(kd[0], all) : all).slice(0, limit);
    });
    return out;
  };
  /** Hetzelfde in stukjes (grote catalogi): Promise; cancel() via het teruggegeven object. */
  Q.rank = function (libs, q, limit, dedupe) {
    var qq = Q.query(q), out = { channels: [], movies: [], series: [] }, job = null, cancelled = false;
    var p = Promise.resolve();
    if (qq.q) {
      KINDS.forEach(function (kd) {
        var b = [[], [], [], [], []];
        (libs || []).forEach(function (lib) {
          p = p.then(function () {
            if (cancelled) throw new Error('cancelled');
            job = B.chunked((lib && lib[kd[1]]) || [], function (x) { var s = Q.score(Q.keyOf(x, kd[2]), qq); if (s >= 0 && b[s].length < limit * 3) b[s].push(x); });
            return job;
          });
        });
        p = p.then(function () { var all = b[0].concat(b[1], b[2], b[3], b[4]); out[kd[1]] = (dedupe ? dedupe(kd[0], all) : all).slice(0, limit); });
      });
    }
    var r = p.then(function () { return out; });
    r.cancel = function () { cancelled = true; if (job && job.cancel) job.cancel(); };
    return r;
  };

  // MARK: verborgen categorieën (compacte rijen uit providers.js: [id, naam, afbeelding, categorie(, extensie)])

  var HKINDS = [['channel', 'hiddenLive'], ['movie', 'hiddenMovies'], ['series', 'hiddenSeries']];
  /** Treffers in de zoekindex van verborgen categorieën: [{type, title, poster, group, sid}] (hooguit limit per soort). */
  Q.hiddenHits = function (raws, q, limit) {
    var qq = Q.query(q), out = [];
    if (!qq.q) return Promise.resolve(out);
    var p = Promise.resolve();
    (raws || []).forEach(function (r) {
      HKINDS.forEach(function (hk) {
        var rows = (r.raw && r.raw[hk[1]]) || [];
        if (!rows.length) return;
        p = p.then(function () {
          var b = [[], [], [], [], []];
          return B.chunked(rows, function (row) {
            if (row[5] == null) row[5] = Q.norm(row[1] || '', true);
            var s = Q.score(row[5], qq);
            if (s >= 0 && b[s].length < limit) b[s].push(row);
          }).then(function () {
            b[0].concat(b[1], b[2], b[3], b[4]).slice(0, limit).forEach(function (row) {
              var t = B.parseTitle ? B.parseTitle(row[1] || '').title : row[1];
              out.push({ type: hk[0], title: (B.clang ? B.clang.strip(t) : t) || row[1], poster: row[2] || null, group: row[3], sid: r.sid });
            });
          });
        });
      });
    });
    return p.then(function () { return out; });
  };

  // MARK: Stremio (zoekcatalogi van de add-ons)

  var remoteCache = {};
  /** Treffers van Stremio-add-ons met een zoekcatalogus: Promise<{movies, series}> (items met _src als het een andere server is). */
  Q.stremio = function (q) {
    var M = B.media, qs = String(q || '').trim();
    var out = { movies: [], series: [] };
    if (!M || !M.Stremio || !M.Stremio.search || qs.length < 2) return Promise.resolve(out);
    var srcs = ((D && D.sources) || []).filter(function (s) { return s && s.kind === 'Stremio' && !s.deleted; });
    if (!srcs.length) return Promise.resolve(out);
    var key = qs.toLowerCase();
    var cached = remoteCache[key];
    if (cached && Date.now() - cached.at < 10 * 60000) return cached.p;
    var p = Promise.all(srcs.map(function (src) {
      return M.Stremio.search(src, qs).then(function (r) {
        var other = !(Lib.source && String(Lib.source.id).toLowerCase() === String(src.id).toLowerCase());
        function tag(x) { if (other) x._src = src; return x; }
        out.movies = out.movies.concat((r.movies || []).map(tag));
        out.series = out.series.concat((r.series || []).map(tag));
      }, B.noop);
    })).then(function () { return out; });
    remoteCache[key] = { at: Date.now(), p: p };
    return p;
  };
})();
