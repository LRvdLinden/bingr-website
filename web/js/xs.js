/*
 * Bingr web: één lijst over alle servers (build 128, contract in docs/ACCOUNT.md van iptv-ios-appletv, sectie Build 128).
 *
 * Per profiel bestaat er, ongeacht het aantal servers, één Verder kijken, één Mijn lijst, één set favoriete en recente
 * zenders en één geschiedenis; collecties gelden over alle servers. Sleutels blijven `<server-id>|<item>`.
 *
 * - Weergave: items van ALLE servers. Actieve server: uit de geladen bibliotheek. Andere server die nog bestaat: uit
 *   zijn catalogus (IndexedDB `lib:<id>`, dezelfde cache als bij het wisselen; anders op de achtergrond geladen),
 *   gefilterd met de kinderslot-/leeftijdsregels en verborgen categorieën van die server; openen en afspelen via die
 *   server, zonder de actieve server te wisselen (item._src). Verwijderde server of item weg: tegel uit `catalogmeta`.
 * - Matching (films/series: TMDB-id, anders genormaliseerde titel + jaar ±1; afleveringen: serie + seizoen/aflevering;
 *   zenders: EPG-id of genormaliseerde naam) op de achtergrond (rustig, niet tijdens afspelen, met time-outs) en bij
 *   aanklikken. Gevonden → `remap` (oude sleutel → nieuwe) in state-section `catalogmeta`, toegepast op alle profielen
 *   en collecties. Niet gevonden → het item blijft staan; bij aanklikken een melding (Verwijderen / Zoeken / Annuleren).
 * - `catalogmeta` {items, remap, updatedAt}: per sleutel wint de nieuwste `at`; begrensd (6000 items / ~1 MB; items
 *   waar niets meer naar verwijst na 90 dagen weg, remap na 180 dagen).
 * - Migratie bij de eerste start (vlag per apparaat): meta aanvullen voor alles in de lijsten van alle profielen.
 *
 * De pure logica (normaliseren, matchen, remap-ketens, samenvoegen, opruimen) staat bovenaan en wordt ook met node getest
 * en met een Playwright-test met nepservers (build 128).
 */
(function () {
  'use strict';
  var B = window.B;
  var X = B.xs = {};
  var L = function () { return B.L.apply(null, arguments); };
  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }
  function ms(v) { return v == null ? 0 : (typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : (B.parseISO(v) || 0)); }
  var DAY = 86400000, META_DAYS = 90, REMAP_DAYS = 180, MAX_META = 6000, MAX_BYTES = 1000000;
  X.limits = { META_DAYS: META_DAYS, REMAP_DAYS: REMAP_DAYS, MAX_META: MAX_META, MAX_BYTES: MAX_BYTES };

  // MARK: pure logica (ook in node getest)

  /** "<server>|<item>" → {sid, item} (item mag zelf '|' bevatten), anders null. */
  X.split = function (k) {
    k = String(k == null ? '' : k);
    var i = k.indexOf('|');
    return i <= 0 ? null : { sid: k.slice(0, i), item: k.slice(i + 1) };
  };
  /** Sleutel in catalogmeta.items: server-id in kleine letters, item-id exact. */
  X.metaKey = function (sid, item) { return lower(sid) + '|' + item; };
  X.metaKeyOf = function (k) { var p = X.split(k); return p ? X.metaKey(p.sid, p.item) : String(k); };

  var NON_WORD = (function () { try { return new RegExp('[^\\p{L}\\p{N}]+', 'gu'); } catch (e) { return /[^a-z0-9À-￿]+/g; } })();
  /** Titel voor vergelijken: zonder voorvoegsel ("NL | "), jaar, kwaliteit, taal-tag, leestekens, accenten, hoofdletters. */
  X.normTitle = function (t) {
    var p = B.parseTitle(t || '');
    return B.fold((p && p.title) || t || '').replace(NON_WORD, '');
  };
  /** Jaar uit de titel als het item er geen heeft. */
  X.yearOf = function (x) {
    var y = B.int(x && x.year);
    if (y) return y;
    var p = B.parseTitle((x && (x.rawTitle || x.title)) || '');
    return p && p.year ? p.year : null;
  };
  /** Zendernaam voor vergelijken (= reservebron): zonder "NL |", "NL:", HD/FHD/UHD/4K/HEVC/50fps, leestekens. */
  X.normChannel = function (n) { return B.lib.normalizeName(n || ''); };
  function tmdbOf(x) { var v = x && (x.tmdb != null ? x.tmdb : (x.tmdbID != null ? x.tmdbID : x.tmdbId)); v = B.int(v); return v ? v : null; }
  X.tmdbOf = tmdbOf;

  /** Zoekindex van een (ongefilterde) bibliotheek. */
  X.buildIndex = function (raw) {
    var idx = { movie: Object.create(null), series: Object.create(null), tmdb: { movie: Object.create(null), series: Object.create(null) },
      chanName: Object.create(null), chanEpg: Object.create(null), byId: Object.create(null) };
    function add(kind, x) {
      idx.byId[x.id] = { type: kind, item: x };
      var n = X.normTitle(x.rawTitle || x.title);
      if (n) (idx[kind][n] = idx[kind][n] || []).push(x);
      var t = tmdbOf(x);
      if (t && !idx.tmdb[kind][t]) idx.tmdb[kind][t] = x;
    }
    ((raw && raw.movies) || []).forEach(function (m) { add('movie', m); });
    ((raw && raw.series) || []).forEach(function (s) { add('series', s); });
    ((raw && raw.channels) || []).forEach(function (c) {
      idx.byId[c.id] = { type: 'channel', item: c };
      var e = c.epgID ? lower(String(c.epgID).trim()) : '';
      if (e && !idx.chanEpg[e]) idx.chanEpg[e] = c;
      var n = X.normChannel(c.name);
      if (n.length >= 2 && !idx.chanName[n]) idx.chanName[n] = c;
    });
    return idx;
  };
  /** Titel bij meta: TMDB-id, anders titel + jaar (±1; zonder jaar aan één kant alleen als er geen met jaar is). */
  X.matchTitle = function (meta, idx, kind) {
    kind = kind || (meta.k === 'series' ? 'series' : 'movie');
    var t = B.int(meta.tmdb);
    if (t && idx.tmdb[kind][t]) return idx.tmdb[kind][t];
    var list = idx[kind][X.normTitle(meta.t)] || [];
    if (!list.length) return null;
    var y = B.int(meta.y);
    if (!y) return list[0];
    var best = null, bestD = 9;
    list.forEach(function (c) { var cy = X.yearOf(c); if (cy) { var d = Math.abs(cy - y); if (d <= 1 && d < bestD) { best = c; bestD = d; } } });
    if (best) return best;
    for (var i = 0; i < list.length; i++) if (!X.yearOf(list[i])) return list[i];
    return null;
  };
  X.matchChannel = function (meta, idx) {
    var epg = meta.ch && meta.ch.epg ? lower(String(meta.ch.epg).trim()) : '';
    if (epg && idx.chanEpg[epg]) return idx.chanEpg[epg];
    var n = X.normChannel((meta.ch && meta.ch.name) || meta.t);
    return n.length >= 2 ? (idx.chanName[n] || null) : null;
  };
  /** Aflevering in een lijst afleveringen op seizoen + nummer. */
  X.matchEpisode = function (meta, episodes) {
    var s = B.int(meta.ep && meta.ep.s), e = B.int(meta.ep && meta.ep.e);
    if (s == null || e == null) return null;
    for (var i = 0; i < (episodes || []).length; i++) { var x = episodes[i]; if (B.int(x.season) === s && B.int(x.number) === e) return x; }
    return null;
  };

  /**
   * Remap-keten volgen (a→b→c): {to, at} van de laatste stap, of null. Een lus (a→b→a) geeft null: dan blijft alles staan.
   * `at` = de nieuwste tijd in de keten (ms).
   */
  X.resolve = function (remap, key) {
    if (!remap) return null;
    var cur = lower(key), seen = {}, last = null, at = 0, steps = 0;
    while (B.has(remap, cur) && remap[cur] && remap[cur].to) {
      if (seen[cur] || ++steps > 10) return null;
      seen[cur] = true;
      last = remap[cur];
      at = Math.max(at, ms(last.at));
      cur = lower(last.to);
    }
    if (!last || seen[cur] || cur === lower(key)) return null;
    return { to: String(last.to), at: at };
  };

  function liveVariant(m, k) {
    var lk = lower(k);
    if (B.has(m, k)) return k;
    var keys = Object.keys(m);
    for (var i = 0; i < keys.length; i++) if (lower(keys[i]) === lk) return keys[i];
    return null;
  }
  /**
   * Remap toepassen op het model van één profiel ({sets, progress, history}, zoals sync.js het gebruikt). Nieuwe sleutel
   * met dezelfde `at` (volgorde), positie en bekeken; oude sleutel als verwijdering (remap-tijd, minstens na de oude).
   * Idempotent. Geeft true als er iets veranderde.
   */
  X.applyRemapState = function (st, remap) {
    if (!st || !remap || !Object.keys(remap).length) return false;
    var changed = false;
    function res(k) { return X.resolve(remap, k); }
    ['myList', 'favorites', 'recentChannels'].forEach(function (f) {
      var m = st.sets && st.sets[f];
      if (!m) return;
      Object.keys(m).forEach(function (k) {
        var it = m[k];
        if (!it || !it.on) return;
        var r = res(k);
        if (!r) return;
        var cur = liveVariant(m, r.to);
        if (!cur) m[r.to] = { at: it.at, on: true };
        else if (m[cur].at < it.at) m[cur] = { at: it.at, on: true };
        m[k] = { at: Math.max(r.at, (it.at || 0) + 1), on: false };
        changed = true;
      });
    });
    // bekeken (sleutels zonder server: item-id en ep:<serie>|s-e): de nieuwe id erbij, de oude blijft (onschadelijk)
    var w = st.sets && st.sets.watched;
    if (w) {
      var byItem = Object.create(null);
      Object.keys(remap).forEach(function (lk) {
        var p = X.split(lk), r = res(lk), q = r && X.split(r.to);
        if (p && q) byItem[p.item] = q.item;
      });
      if (Object.keys(byItem).length) {
        Object.keys(w).forEach(function (k) {
          var it = w[k];
          if (!it || !it.on) return;
          var nk = null, lk = lower(k);
          if (byItem[lk] != null) nk = byItem[lk];
          else if (lk.indexOf('ep:') === 0) {
            var bar = k.lastIndexOf('|');
            if (bar > 3) { var s = lower(k.slice(3, bar)); if (byItem[s] != null) nk = 'ep:' + byItem[s] + k.slice(bar); }
          }
          if (nk == null || nk === k || liveVariant(w, nk)) return;
          w[nk] = { at: it.at, on: true };
          changed = true;
        });
      }
    }
    // voortgang: sleutel = item-id, server in playlistID
    var pr = st.progress || {};
    Object.keys(pr).forEach(function (k) {
      var it = pr[k], v = it && it.v;
      if (!v || !v.playlistID) return;
      var r = res(v.playlistID + '|' + k), q = r && X.split(r.to);
      if (!q) return;
      var nv = B.assign({}, v, { playlistID: q.sid });
      if (q.item === k) { pr[k] = { at: it.at, v: nv }; changed = true; return; }
      var cur = pr[q.item];
      if (!cur || cur.at < it.at) pr[q.item] = { at: it.at, v: nv };
      pr[k] = { at: Math.max(r.at, (it.at || 0) + 1), v: null };
      changed = true;
    });
    // geschiedenis: id = <server>|<item>
    var hi = st.history || {};
    Object.keys(hi).forEach(function (id) {
      var it = hi[id], v = it && it.v;
      if (!v || !v.playlistID) return;
      var r = res(v.playlistID + '|' + v.itemID), q = r && X.split(r.to);
      if (!q) return;
      var nv = B.assign({}, v, { playlistID: q.sid, itemID: q.item });
      if (v.channelID) nv.channelID = q.item;
      var nid = q.sid + '|' + q.item;
      var cur = liveVariant(hi, nid);
      if (!cur || hi[cur].at < it.at) hi[cur || nid] = { at: it.at, v: nv };
      hi[id] = { at: Math.max(r.at, (it.at || 0) + 1), v: null };
      changed = true;
    });
    return changed;
  };

  /**
   * Collectie-items {type, id, sid?} herschrijven. Zonder sid hoort het item bij collection.sourceID; zonder beide bij
   * de server waarop het gevonden wordt: dan alleen remappen als de oude server niet meer bestaat (alive(sid) false).
   * Geeft de nieuwe lijst of null (niets veranderd). Dubbele items (zelfde type, id en server) vallen weg.
   */
  X.remapCollectionItems = function (items, sourceID, remap, alive) {
    if (!Array.isArray(items) || !items.length || !remap || !Object.keys(remap).length) return null;
    var byItem = null;
    function candidates(id) {
      if (!byItem) {
        byItem = Object.create(null);
        Object.keys(remap).forEach(function (lk) { var p = X.split(lk); if (p) (byItem[p.item] = byItem[p.item] || []).push(p.sid); });
      }
      return byItem[lower(id)] || [];
    }
    var changed = false, out = [], seen = Object.create(null);
    items.forEach(function (it) {
      if (!it || it.id == null) return;
      var sid = it.sid || sourceID || null, r = null;
      if (sid) r = X.resolve(remap, sid + '|' + it.id);
      else {
        var c = candidates(it.id).filter(function (s) { return !alive(s); });
        for (var i = 0; i < c.length && !r; i++) r = X.resolve(remap, c[i] + '|' + it.id);
      }
      var o = it, q = r && X.split(r.to);
      if (q) { o = B.assign({}, it, { id: q.item, sid: q.sid }); changed = true; }
      var dk = (o.type || '') + '|' + lower(o.sid || sourceID || '') + '|' + o.id;
      if (seen[dk]) { changed = true; return; }
      seen[dk] = true;
      out.push(o);
    });
    return changed ? out : null;
  };

  /** catalogmeta samenvoegen: per sleutel (hoofdletterongevoelig) wint de nieuwste `at`. */
  X.mergeMeta = function (a, b) {
    a = a && typeof a === 'object' ? a : {};
    b = b && typeof b === 'object' ? b : {};
    var out = { items: {}, remap: {} };
    function mergeMap(name, keyFn) {
      var idx = {};
      [a[name], b[name]].forEach(function (m) {
        if (!m || typeof m !== 'object') return;
        Object.keys(m).forEach(function (k) {
          var v = m[k];
          if (!v || typeof v !== 'object') return;
          var nk = keyFn(k), cur = idx[nk];
          if (!cur || ms(v.at) > ms(cur.v.at) || (ms(v.at) === ms(cur.v.at) && m === b[name])) idx[nk] = { k: nk, v: v };
        });
      });
      Object.keys(idx).forEach(function (k) { out[name][idx[k].k] = idx[k].v; });
    }
    mergeMap('items', X.metaKeyOf);
    mergeMap('remap', lower);
    var ua = ms(a.updatedAt), ub = ms(b.updatedAt);
    out.updatedAt = B.iso(Math.max(ua, ub) || Date.now());
    return out;
  };
  /**
   * Opruimen. refs = {keys: {kleine-letter-sleutel: true}, items: {kleine-letter-item-id: true}} (collectie-items zonder
   * server) of null (onbekend: dan alleen remap op leeftijd en de harde grens).
   */
  X.pruneMeta = function (cm, refs, now) {
    now = now || Date.now();
    var out = { items: {}, remap: {}, updatedAt: cm.updatedAt };
    function referenced(k) {
      if (!refs) return true;
      var lk = lower(k), p = X.split(lk);
      return !!(refs.keys[lk] || (p && refs.items[p.item]));
    }
    Object.keys(cm.remap || {}).forEach(function (k) {
      var r = cm.remap[k];
      if (r && r.to && now - ms(r.at) <= REMAP_DAYS * DAY) out.remap[k] = r;
    });
    // de doelen van remap tellen ook als verwijzing (nodig om de nieuwe sleutel te tonen)
    var targets = {};
    Object.keys(out.remap).forEach(function (k) { targets[X.metaKeyOf(out.remap[k].to)] = true; });
    var keys = Object.keys(cm.items || {});
    var keep = keys.filter(function (k) {
      var v = cm.items[k];
      if (!v) return false;
      return referenced(k) || targets[k] || now - ms(v.at) <= META_DAYS * DAY;
    });
    function len(k) { return k.length + JSON.stringify(cm.items[k]).length + 4; }
    var total = 0;
    keep.forEach(function (k) { total += len(k); });
    if (keep.length > MAX_META || total > MAX_BYTES) {
      // eerst de oudste waar niets naar verwijst
      var soft = keep.filter(function (k) { return !referenced(k) && !targets[k]; }).sort(function (x, y) { return ms(cm.items[x].at) - ms(cm.items[y].at); });
      var drop = {}, count = keep.length;
      for (var i = 0; i < soft.length && (count > MAX_META || total > MAX_BYTES); i++) { drop[soft[i]] = true; count--; total -= len(soft[i]); }
      keep = keep.filter(function (k) { return !drop[k]; });
    }
    keep.forEach(function (k) { out.items[k] = cm.items[k]; });
    return out;
  };

  /** Alle sleutels waar een profiel naar verwijst (uit het model van sync.js). */
  X.refsOfState = function (st, refs) {
    refs = refs || { keys: {}, items: {} };
    if (!st) return refs;
    ['myList', 'favorites', 'recentChannels'].forEach(function (f) {
      var m = st.sets && st.sets[f] || {};
      Object.keys(m).forEach(function (k) { if (m[k] && m[k].on) refs.keys[lower(k)] = true; });
    });
    Object.keys(st.progress || {}).forEach(function (k) {
      var v = st.progress[k] && st.progress[k].v;
      if (v && v.playlistID) refs.keys[lower(v.playlistID + '|' + k)] = true;
    });
    Object.keys(st.history || {}).forEach(function (k) {
      var v = st.history[k] && st.history[k].v;
      if (v && v.playlistID) refs.keys[lower(v.playlistID + '|' + v.itemID)] = true;
    });
    return refs;
  };

  /** Werk-sleutel voor dubbele tegels: TMDB, anders titel + jaar; zenders op naam. */
  X.workKey = function (type, x) {
    if (!x) return null;
    if (type === 'channel') { var n = X.normChannel(x.name || x.title); return n ? 'c|' + n : null; }
    var t = tmdbOf(x);
    if (t) return type + '|tmdb|' + t;
    var nt = X.normTitle(x.rawTitle || x.title);
    return nt ? type + '|' + nt + '|' + (X.yearOf(x) || '') : null;
  };

  // test- en browserloze modus: hieronder alleen met een DOM
  if (!B.data || !B.lib || typeof document === 'undefined') return;

  var D = B.data, Lib = B.lib, A = B.account, PC = B.parental;

  // MARK: catalogmeta (state-section, voor het hele account)

  var CM = { items: {}, remap: {}, updatedAt: null };
  var pending = { items: {}, remap: {} };
  var lastRefs = null;
  var cmReady = Promise.all([B.idb.get('catalogmeta'), B.idb.get('catalogmetaPending')]).then(function (r) {
    if (r[0] && typeof r[0] === 'object') CM = X.mergeMeta(r[0], CM);
    if (r[1] && typeof r[1] === 'object') { pending = { items: r[1].items || {}, remap: r[1].remap || {} }; CM = X.mergeMeta(CM, pending); }
  }).catch(B.noop);
  X.ready = function () { return cmReady; };
  X.meta = function (key) {
    if (key == null) return null;
    var mk = X.metaKeyOf(key);
    if (B.has(CM.items, mk)) return CM.items[mk];
    var lk = lower(mk);
    var keys = Object.keys(CM.items);
    for (var i = 0; i < keys.length; i++) if (lower(keys[i]) === lk) return CM.items[keys[i]];
    return null;
  };
  X.remapRules = function () { return CM.remap; };
  X.rulesVersion = function () { return Object.keys(CM.remap).length + ':' + (CM.updatedAt || ''); };
  /** TMDB-titel uit Binnenkort/Nieuw op Bingr (geen bibliotheekitem; hoort bij geen server). */
  function external(key) { var p = X.split(key); return !!(p && B.discover && B.discover.isExternal && B.discover.isExternal(p.item)); }
  X.external = external;
  X._CM = function () { return CM; };
  function saveLocal() {
    B.idb.set('catalogmeta', CM);
    B.idb.set('catalogmetaPending', pending);
  }
  var uploadTimer = null, uploading = null;
  function scheduleUpload(ms0) {
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(upload, ms0 || 4000);
  }
  function hasPending() { return Object.keys(pending.items).length || Object.keys(pending.remap).length; }
  /** Nieuwste versie van de server lezen, eigen wijzigingen erover, opruimen, terugzetten. Mislukt: blijft openstaan. */
  function upload() {
    if (!hasPending() || uploading || !A.isSignedIn()) return uploading || Promise.resolve();
    var sent = pending;
    pending = { items: {}, remap: {} };
    uploading = A.getState(['catalogmeta']).then(function (all) {
      if (!all) throw new Error('offline');
      var srv = all.catalogmeta && all.catalogmeta.data;
      var merged = X.pruneMeta(X.mergeMeta(X.mergeMeta(srv, CM), sent), lastRefs);
      merged.updatedAt = B.iso();
      return A.putState('catalogmeta', merged).then(function (at) {
        if (at == null) throw new Error('put');
        CM = X.mergeMeta(merged, pending);
      });
    }).catch(function () {
      // terug in de wachtrij (wat er intussen bij kwam blijft)
      pending = X.mergeMeta(sent, pending);
      delete pending.updatedAt;
      scheduleUpload(60000);
    }).then(function () { uploading = null; saveLocal(); if (hasPending()) scheduleUpload(); });
    return uploading;
  }
  X.flush = function () { clearTimeout(uploadTimer); return upload(); };
  function same(a, b) {
    if (!a || !b) return false;
    return a.t === b.t && (a.y || null) === (b.y || null) && a.k === b.k && (a.tmdb || null) === (b.tmdb || null) && (a.img || null) === (b.img || null) &&
      a.sname === b.sname && JSON.stringify(a.ep || null) === JSON.stringify(b.ep || null) && JSON.stringify(a.ch || null) === JSON.stringify(b.ch || null);
  }
  /** Meta van een item zetten (alleen als hij nieuw of veranderd is). */
  X.putMeta = function (key, m) {
    if (!key || !m || !m.t) return false;
    var mk = X.metaKeyOf(key), cur = X.meta(mk);
    if (same(cur, m)) return false;
    m.at = B.iso();
    CM.items[mk] = m; pending.items[mk] = m;
    saveLocal(); scheduleUpload();
    return true;
  };
  /** Oude sleutel → nieuwe (gevonden op een andere server). Geen lus maken. */
  X.addRemap = function (oldKey, newKey) {
    var lo = lower(oldKey);
    if (!oldKey || !newKey || lo === lower(newKey)) return false;
    var back = X.resolve(CM.remap, newKey);
    if (back && lower(back.to) === lo) return false;
    var r = { to: String(newKey), at: B.iso() };
    CM.remap[lo] = r; pending.remap[lo] = r;
    saveLocal(); scheduleUpload(1500);
    return true;
  };

  // MARK: meta uit een item

  function sourceName(sid) { var s = D.sourceById(sid); if (s) return s.name || ''; var m = metaSourceName(sid); return m || ''; }
  function metaSourceName(sid) {
    var ls = lower(sid), keys = Object.keys(CM.items);
    for (var i = 0; i < keys.length; i++) { var v = CM.items[keys[i]]; if (v && lower(v.sid) === ls && v.sname) return v.sname; }
    return null;
  }
  X.sourceName = sourceName;
  /** Meta van een bibliotheekitem; type = movie | series | channel. */
  X.metaFor = function (sid, type, x) {
    if (!x) return null;
    var src = D.sourceById(sid);
    var m = { t: String(type === 'channel' ? (x.name || x.title || '') : (x.title || x.rawTitle || '')), y: type === 'channel' ? null : X.yearOf(x),
      k: type, tmdb: type === 'channel' ? null : tmdbOf(x), img: (type === 'channel' ? x.logo : x.poster) || null,
      sid: src ? src.id : sid, sname: src ? (src.name || '') : sourceName(sid), ep: null,
      ch: type === 'channel' ? { name: String(x.name || ''), epg: x.epgID ? String(x.epgID) : null } : null };
    return m.t ? m : null;
  };
  /** Meta van een aflevering (speler-item of aflevering + serie). */
  X.episodeMeta = function (sid, ep, series) {
    var src = D.sourceById(sid);
    var st = series ? series.title : (ep.seriesTitle || ep.title || '');
    var m = { t: String(st || ep.title || ''), y: series ? X.yearOf(series) : null, k: 'episode', tmdb: null,
      img: (series && series.poster) || ep.still || ep.artwork || null, sid: src ? src.id : sid, sname: src ? (src.name || '') : sourceName(sid),
      ep: { series: sid + '|' + (ep.seriesID || (series && series.id) || ''), st: String(st || ''), s: B.int(ep.season), e: B.int(ep.number != null ? ep.number : ep.episode) },
      ch: null };
    return m.t ? m : null;
  };

  /** Meta van sleutel k aanvullen uit de catalogus van zijn server (als die geladen is). */
  X.noteKey = function (k, hint) {
    var p = X.split(k);
    if (!p) return false;
    var cat = catNow(p.sid);
    var hit = cat && cat.idx.byId[p.item];
    if (!hit) return false;
    if (hint && hint !== hit.type) return false;
    var view = viewOf(p.sid), shown = view && view.byId[p.item];
    return X.putMeta(k, X.metaFor(p.sid, hit.type, shown ? shown.item : hit.item));
  };
  /** Afspelen (speler): meta van film, aflevering of zender. */
  X.notePlayed = function (item, ctx) {
    try {
      var src = (item && item._src) || Lib.source;
      if (!src || !item) return;
      if (item.type === 'live' && item.channel) X.putMeta(src.id + '|' + item.channel.id, X.metaFor(src.id, 'channel', item.channel));
      else if (item.type === 'movie') {
        var hit = viewOf(src.id) && viewOf(src.id).byId[item.id];
        X.putMeta(src.id + '|' + item.id, X.metaFor(src.id, 'movie', hit ? hit.item : { title: item.title, year: item.year, poster: item.artwork }));
      } else if (item.type === 'episode') {
        var series = ctx && ctx.series;
        X.putMeta(src.id + '|' + item.id, X.episodeMeta(src.id, { seriesID: item.seriesID, season: item.season, episode: item.episode, title: item.title, artwork: item.artwork }, series));
        if (series) X.putMeta(src.id + '|' + series.id, X.metaFor(src.id, 'series', series));
      }
    } catch (e) { B.log('xs meta', e && e.message); }
  };

  // MARK: catalogi van de servers (actieve: Lib.raw; andere: IndexedDB / op de achtergrond geladen)

  var cats = {};     // kleine-letter-id → {src, raw, idx, at, epg}
  var loading = {};  // kleine-letter-id → Promise
  var failed = {};   // kleine-letter-id → tijd
  var LIB_TTL = 24 * 3600000, LOAD_TIMEOUT = 120000;
  function isActive(sid) { return !!(Lib.source && lower(Lib.source.id) === lower(sid)); }
  X.isActive = isActive;
  var activeCat = null;
  function catNow(sid) {
    if (isActive(sid)) {
      var raw = Lib.raw;
      if (!raw || (!raw.channels.length && !raw.movies.length && !raw.series.length)) return null;
      if (!activeCat || activeCat.raw !== raw) activeCat = { src: Lib.source, raw: raw, idx: X.buildIndex(raw), at: Date.now(), active: true };
      return activeCat;
    }
    return cats[lower(sid)] || null;
  }
  X.catalog = catNow;
  function withTimeout(p, t) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, t); })]);
  }
  /** Catalogus van een server laden (cache eerst). fetch=false: alleen uit de cache. */
  X.loadCatalog = function (src, fetch) {
    if (!src) return Promise.resolve(null);
    var lid = lower(src.id);
    if (isActive(src.id)) return Promise.resolve(catNow(src.id));
    if (cats[lid] && (cats[lid].fresh || !fetch)) return Promise.resolve(cats[lid]);
    if (loading[lid]) return loading[lid];
    var p = loading[lid] = B.idb.get('lib:' + src.id).then(function (c) {
      if (c && c.lib) {
        put(src, c.lib, c.at);
        if (Date.now() - (c.at || 0) < LIB_TTL || !fetch) { cats[lid].fresh = Date.now() - (c.at || 0) < LIB_TTL; return cats[lid]; }
      }
      if (!fetch) return cats[lid] || null;
      if (failed[lid] && Date.now() - failed[lid] < 30 * 60000) return cats[lid] || null;
      return withTimeout(Lib.fetchLibrary(src), LOAD_TIMEOUT).then(function (lib) {
        lib.epg = lib.epg || {};
        B.idb.set('lib:' + src.id, { at: Date.now(), lib: lib });
        B.idb.set('chan:' + src.id, lib.channels.map(function (x) { return { name: x.name, epgID: x.epgID, streamURL: x.streamURL, stalkerCmd: x.stalkerCmd || null }; }));
        put(src, lib, Date.now());
        cats[lid].fresh = true;
        return cats[lid];
      }, function (e) { failed[lid] = Date.now(); B.log('xs catalogus', src.name, e && e.message); return cats[lid] || null; });
    }).then(function (c) {
      delete loading[lid];
      if (c && !c.epgAsked) {
        c.epgAsked = true;
        B.idb.get('epg:' + src.id).then(function (e) { if (e && e.epg && cats[lid] === c) { c.epg = e.epg; B.emit('epg'); } });
      }
      return c;
    }, function () { delete loading[lid]; return null; });
    return p;
  };
  function put(src, raw, at) {
    var lid = lower(src.id);
    raw.channels = raw.channels || []; raw.movies = raw.movies || []; raw.series = raw.series || [];
    var old = cats[lid];
    cats[lid] = { src: src, raw: raw, idx: X.buildIndex(raw), at: at || Date.now(), epg: old ? old.epg : null, epgAsked: old ? old.epgAsked : false };
    views[lid] = null;
    changedSoon();
  }
  /**
   * Gids van een andere server (voor nu/straks en terugkijken). Eerst de cache; ontbreekt hij of is hij oud, dan rustig
   * ophalen (XMLTV van die server, met zijn eigen gegevens), hooguit eens per 30 minuten per server bij een fout.
   */
  var epgBusy = {};
  X.epgOf = function (sid) {
    var lid = lower(sid), c = cats[lid];
    if (!c) return {};
    if ((!c.epg || !c.epgFresh) && !epgBusy[lid] && !(c.epgFailed && Date.now() - c.epgFailed < 30 * 60000)) {
      epgBusy[lid] = true;
      var src = D.sourceById(sid) || c.src;
      setTimeout(function () {
        withTimeout(Lib.fetchEpg(src, c.raw, false), 180000).then(function (epg) {
          if (cats[lid] !== c) return;
          if (epg && Object.keys(epg).length) { c.epg = epg; c.epgFresh = true; B.emit('epg'); } else { c.epgFailed = Date.now(); c.epgFresh = true; }
        }, function () { c.epgFailed = Date.now(); }).then(function () { delete epgBusy[lid]; });
      }, 0);
    }
    return c.epg || {};
  };
  var changeTimer = null;
  function changedSoon() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(function () { X.version++; B.emit('xsCatalog'); B.emit('profileData'); }, 250);
  }
  X.version = 0;
  // wisselen naar een server die we al geladen hebben: zijn catalogus is dan de actieve
  B.on('library', function () { activeCat = null; X.version++; });
  B.on('sources', function () {
    Object.keys(cats).forEach(function (k) { var s = D.sourceById(k); if (!s) { delete cats[k]; delete views[k]; } else cats[k].src = s; });
    X.version++;
    kick(3000);
  });

  // gefilterde weergave van een andere server (kinderslot, leeftijd, verborgen categorieën van die server), items met _src
  var views = {};
  function viewOf(sid) {
    if (isActive(sid)) return Lib.lib && Lib.lib.byId ? Lib.lib : null;
    var lid = lower(sid), c = cats[lid];
    if (!c) return null;
    var src = D.sourceById(sid) || c.src;
    var ctx = Lib.contextFor(src);
    var key = JSON.stringify(ctx) + '|' + Lib.version;
    var v = views[lid];
    if (v && v.raw === c.raw && v.key === key) return v.lib;
    var lib = Lib.apply(c.raw, ctx);
    var byId = Object.create(null);
    function tag(list, type) { list.forEach(function (x) { x._src = src; byId[x.id] = { type: type, item: x }; }); }
    tag(lib.channels, 'channel'); tag(lib.movies, 'movie'); tag(lib.series, 'series');
    lib.byId = byId;
    views[lid] = { raw: c.raw, key: key, lib: lib };
    return lib;
  }
  X.view = viewOf;

  // MARK: tegels (weergave over alle servers)

  function ageOK(type, t, y) {
    var p = B.app && B.app.profile;
    var limit = p ? D.ageLimit(p) : null;
    if (limit == null || PC.isUnlocked()) return true;
    if (type === 'channel') return PC.channelAllowedFor(t, null, limit, D.strict(p));
    var AR = B.ageRatings;
    return PC.allowedFor(null, null, limit, null, D.strict(p), AR ? AR.cached(t, y, type === 'series') : null);
  }
  /** Tegel van een item dat (nog) niet in een catalogus staat: uit catalogmeta, of uit wat de lijst zelf weet. */
  function placeholder(key, type, state, field, fb) {
    var p = X.split(key) || { sid: '', item: String(key) };
    var m = X.meta(key) || {};
    fb = fb || {};
    var title = m.t || fb.title || '';
    var t = type || m.k || fb.type || 'movie';
    if (t === 'episode') t = 'series';
    if (m.k === 'episode') title = (m.ep && m.ep.st) || title;
    var x = { id: p.item, _key: key, _meta: X.meta(key), _xs: state, _field: field || null, _type: t, _fb: fb };
    if (t === 'channel') { x.name = title || L('Unknown title'); x.logo = m.img || fb.artwork || null; x.group = ''; }
    else { x.title = title || L('Unknown title'); x.poster = m.img || fb.artwork || null; x.year = m.y || null; }
    if (!ageOK(t, title, m.y)) return null;
    return { type: t, item: x };
  }
  X.placeholder = placeholder;
  /**
   * Tegel voor sleutel `<server>|<item>`: {type, item} of null (verborgen voor dit profiel). item._src = andere server
   * (bestaat), item._key = tegel uit catalogmeta (server verwijderd, item weg, of catalogus nog niet geladen).
   */
  X.tileFor = function (key, hint, field, fb) {
    var r = X.resolve(CM.remap, key);
    if (r) key = r.to;
    var p = X.split(key);
    if (!p) return null;
    var src = D.sourceById(p.sid);
    if (!src) return placeholder(key, hint, 'orphan', field, fb);
    var cat = catNow(p.sid), view = viewOf(p.sid);
    if (!cat || !view) {
      if (!isActive(p.sid)) kick(800);
      else if (Lib.loading || !Lib.lib.byId) return placeholder(key, hint, 'pending', field, fb);
      return placeholder(key, hint, 'pending', field, fb);
    }
    var hit = view.byId[p.item];
    if (hit && (!hint || hint === hit.type || (hint === 'title' && hit.type !== 'channel'))) return hit;
    if (cat.idx.byId[p.item]) return null; // staat er wel, maar verborgen (kinderslot, categorie) voor dit profiel
    return placeholder(key, hint === 'title' ? null : hint, 'missing', field, fb);
  };
  function dedupe(list) {
    var seen = {};
    return list.filter(function (hit) {
      if (!hit) return false;
      var wk = X.workKey(hit.type, hit.item);
      if (!wk) return true;
      if (seen[wk]) return false;
      seen[wk] = true;
      return true;
    });
  }
  X.dedupe = dedupe;
  /** Mijn lijst / favorieten / recente zenders over alle servers, nieuwste eerst, zonder dubbele. kind: 'title' | 'channel'. */
  X.listTiles = function (field, kind) {
    var out = [];
    D.setList(field).forEach(function (k) {
      if (external(k)) return;
      var hit = X.tileFor(k, kind === 'channel' ? 'channel' : (kind === 'title' ? 'title' : null), field);
      if (!hit) return;
      if (kind === 'channel' && hit.type !== 'channel') return;
      if (kind === 'title' && hit.type === 'channel') return;
      out.push(hit);
    });
    return dedupe(out);
  };
  /** Sleutel van een tegel of item (voor Mijn lijst/favorieten). */
  X.keyOf = function (x) {
    if (!x) return '';
    if (x._key) return x._key;
    var src = x._src || Lib.source;
    return D.key(src ? src.id : '', x.id);
  };
  X.srcOf = function (x) { return (x && x._src) || Lib.source; };

  /**
   * Verder kijken over alle servers: films met voortgang en per serie één kaart (alle sleutels van die serie).
   * [{x, type, p, keys}] — keys = progress-sleutels (om te verwijderen).
   */
  X.continueEntries = function (max) {
    max = max || 20;
    var out = [], bySeries = {}, seenWork = {};
    function seriesByTitle(sid) {
      var v = viewOf(sid);
      if (!v) return {};
      var memo = v._xsByTitle;
      if (!memo) { memo = v._xsByTitle = {}; v.series.forEach(function (s) { if (!memo[s.title]) memo[s.title] = s; var n = X.normTitle(s.rawTitle || s.title); if (n && !memo['\u0001' + n]) memo['\u0001' + n] = s; }); }
      return memo;
    }
    D.progressList().forEach(function (pe) {
      var sid = pe.e.playlistID || (Lib.source && Lib.source.id) || '';
      var key = sid + '|' + pe.key;
      var r = X.resolve(CM.remap, key);
      if (r) { key = r.to; }
      var kp = X.split(key);
      var m = X.meta(key);
      var src = kp && D.sourceById(kp.sid);
      var view = kp && src ? viewOf(kp.sid) : null;
      var hit = view && view.byId[kp.item];
      if (hit && hit.type === 'channel') return;
      var entry = null;
      if (hit && hit.type === 'movie') entry = { x: hit.item, type: 'movie', p: pe.e.fraction, keys: [pe.key] };
      else if (hit && hit.type === 'series') return;
      else if (view && !(m && m.k === 'movie')) {
        // aflevering: serie op titel (zoals de apps) of via de meta
        var bt = seriesByTitle(kp.sid);
        var st = (m && m.ep && m.ep.st) || pe.e.title;
        var s = bt[st] || bt['\u0001' + X.normTitle(st)];
        if (!s && m && m.ep && m.ep.series) { var sp = X.split(m.ep.series); var sh = sp && view.byId[sp.item]; if (sh && sh.type === 'series') s = sh.item; }
        if (s) {
          var sk = lower(kp.sid) + '|' + s.id;
          if (bySeries[sk]) { bySeries[sk].keys.push(pe.key); return; }
          entry = bySeries[sk] = { x: s, type: 'series', p: pe.e.fraction, keys: [pe.key] };
        } else if (catNow(kp.sid) && catNow(kp.sid).idx.byId[kp.item]) return;
      }
      if (!entry) {
        // niet (meer) te vinden, server verwijderd of catalogus nog niet geladen: tegel uit meta / voortgang
        var state = !src ? 'orphan' : (view ? 'missing' : 'pending');
        if (src && !view && !isActive(kp.sid)) kick(800);
        var phType = m && (m.k === 'episode' || m.k === 'series') ? 'series' : 'movie';
        var ph = placeholder(key, phType, state, 'continue', { title: pe.e.title, artwork: pe.e.artwork, type: phType });
        if (!ph) return;
        var gk = 'ph|' + lower(ph.item.title) + '|' + ph.type;
        if (ph.type === 'series' && bySeries[gk]) { bySeries[gk].keys.push(pe.key); return; }
        entry = { x: ph.item, type: ph.type, p: pe.e.fraction, keys: [pe.key] };
        if (ph.type === 'series') bySeries[gk] = entry;
        ph.item._progressKeys = entry.keys;
      }
      var wk = X.workKey(entry.type, entry.x);
      if (wk && seenWork[wk]) { seenWork[wk].keys = seenWork[wk].keys.concat(entry.keys); return; }
      if (wk) seenWork[wk] = entry;
      if (out.length < max) out.push(entry);
    });
    return out;
  };

  /** Geschiedenis over alle servers (zonder dubbele schrijfwijzen; remap toegepast). */
  X.history = function () { return D.history(); };

  /**
   * Inhoud van een collectie over alle servers. Handmatig: per item {type, id, sid?}: sid → die server; anders
   * collection.sourceID; anders de actieve server en daarna de andere (eerste die hem heeft). Slim: zoekwoorden in de
   * catalogi van alle (of alleen sourceID) servers. Zonder resultaat in een catalogus: tegel uit catalogmeta.
   */
  X.collectionItems = function (c, limit) {
    limit = limit || 60;
    var out = [];
    var sids = orderedSources().map(function (s) { return s.id; });
    if (c.kind === 'smart') {
      var words = String(c.query || '').split(',').map(function (w) { return B.fold(w).trim(); }).filter(Boolean);
      if (!words.length) return [];
      var types = Array.isArray(c.types) ? c.types : ['channel', 'movie', 'series'];
      var count = { channel: 0, movie: 0, series: 0 };
      // slim: in de actieve server, of in sourceID als die gezet is (contract build 128)
      var want = c.sourceID && D.sourceById(c.sourceID) ? D.sourceById(c.sourceID).id : (Lib.source ? Lib.source.id : null);
      sids.forEach(function (sid) {
        if (!want || lower(want) !== lower(sid)) return;
        var v = viewOf(sid);
        if (!v) { if (!isActive(sid)) kick(800); return; }
        [['channel', v.channels, 'name'], ['movie', v.movies, 'title'], ['series', v.series, 'title']].forEach(function (pl) {
          if (types.indexOf(pl[0]) < 0) return;
          var pool = c.group ? pl[1].filter(function (x) { return x.group === c.group; }) : pl[1];
          for (var i = 0; i < pool.length && count[pl[0]] < limit; i++) {
            var x = pool[i], t = B.fold(x[pl[2]] || ''), g = B.fold(x.group || '');
            for (var w = 0; w < words.length; w++) if (t.indexOf(words[w]) >= 0 || g.indexOf(words[w]) >= 0) { out.push({ type: pl[0], item: x }); count[pl[0]]++; break; }
          }
        });
      });
      return dedupe(out);
    }
    var field = 'collection:' + c.id;
    (c.items || []).forEach(function (it) {
      if (!it || it.id == null || out.length >= limit) return;
      var sid = it.sid || c.sourceID || null;
      if (sid) {
        var hit = X.tileFor(sid + '|' + it.id, it.type, field);
        if (hit) { hit.item._collItem = it; out.push(hit); }
        return;
      }
      // zonder server: actieve eerst, dan de andere
      for (var i = 0; i < sids.length; i++) {
        var v = viewOf(sids[i]);
        var h2 = v && v.byId[it.id];
        if (h2 && (!it.type || h2.type === it.type)) { out.push(h2); return; }
        var cat = catNow(sids[i]);
        if (cat && cat.idx.byId[it.id] && (!it.type || cat.idx.byId[it.id].type === it.type)) return; // verborgen voor dit profiel
      }
      // meta van een server die het item had (verwijderd of niet meer)
      var mk = metaKeyForItem(it.id, it.type);
      if (mk) { var ph = X.tileFor(mk, it.type, field); if (ph) { ph.item._collItem = it; out.push(ph); } }
      else if (sids.some(function (s) { return !viewOf(s); })) { kick(800); }
      else { var ph2 = placeholder('|' + it.id, it.type, 'orphan', field); if (ph2) { ph2.item._key = null; ph2.item._collItem = it; ph2.item._noKey = true; out.push(ph2); } }
    });
    return dedupe(out);
  };
  function metaKeyForItem(id, type) {
    var keys = Object.keys(CM.items), best = null;
    for (var i = 0; i < keys.length; i++) {
      var p = X.split(keys[i]);
      if (!p || p.item !== String(id)) continue;
      var m = CM.items[keys[i]];
      if (type && m.k !== type) continue;
      if (!best || ms(m.at) > ms(CM.items[best].at)) best = keys[i];
    }
    return best ? (CM.items[best].sid || X.split(best).sid) + '|' + String(id) : null;
  }
  /** Servers op volgorde van voorrang: actieve, daarna de andere zoals in het account. */
  function orderedSources() {
    var list = D.sources.slice();
    var act = Lib.source;
    if (!act) return list;
    return [act].concat(list.filter(function (s) { return lower(s.id) !== lower(act.id); }));
  }
  X.orderedSources = orderedSources;

  // MARK: zoeken op andere servers en remap

  var searched = {}; // sleutel → {at, found}
  /**
   * Item zoeken op de andere servers (voorrang: actieve, daarna de rest). Geeft {key, type, item, src} of null.
   * fetch=true laadt ontbrekende catalogi (bij aanklikken); op de achtergrond alleen wat al geladen of gecachet is.
   */
  X.search = function (key, hint, fetch) {
    var p = X.split(key);
    var m = X.meta(key) || {};
    var fb = (searched[lower(key)] && searched[lower(key)].fb) || {};
    if (!m.t && fb.title) m = { t: fb.title, k: fb.type || hint || 'movie', y: null, guess: !fb.type && !hint };
    if (!p || !m.t) return Promise.resolve(null);
    var kind = m.k || hint || 'movie';
    if (m.guess) m = B.assign({}, m, { guess: true });
    var others = orderedSources().filter(function (s) { return lower(s.id) !== lower(p.sid); });
    var i = 0;
    function next() {
      if (i >= others.length) return Promise.resolve(null);
      var src = others[i++];
      return X.loadCatalog(src, fetch).then(function (cat) {
        if (!cat) return next();
        if (kind === 'channel') {
          var ch = X.matchChannel(m, cat.idx);
          return ch ? { key: src.id + '|' + ch.id, type: 'channel', item: ch, src: src } : next();
        }
        if (kind === 'episode') {
          var smeta = m.ep && m.ep.series ? X.meta(m.ep.series) : null;
          var sm = { t: (smeta && smeta.t) || (m.ep && m.ep.st) || m.t, y: (smeta && smeta.y) || m.y, tmdb: smeta && smeta.tmdb, k: 'series' };
          var s = X.matchTitle(sm, cat.idx, 'series');
          if (!s) return next();
          var view = viewOf(src.id), shown = view && view.byId[s.id] ? view.byId[s.id].item : B.assign({}, s, { _src: isActive(src.id) ? undefined : src });
          return withTimeout(Lib.episodes(shown), 30000).then(function (r) {
            var ep = X.matchEpisode(m, r && r.episodes);
            return ep ? { key: src.id + '|' + ep.id, type: 'episode', item: ep, series: shown, src: src } : next();
          }, function () { return next(); });
        }
        var x = X.matchTitle(m, cat.idx, kind === 'series' ? 'series' : 'movie');
        if (x) return { key: src.id + '|' + x.id, type: kind === 'series' ? 'series' : 'movie', item: x, src: src };
        // titel uit voortgang/geschiedenis zonder soort (m.guess): misschien een serie; dan openen, niet remappen
        if (m.guess) { var gs = X.matchTitle(B.assign({}, m, { k: 'series' }), cat.idx, 'series'); if (gs) return { key: src.id + '|' + gs.id, type: 'series', item: gs, src: src, guess: true }; }
        return next();
      }, function () { return next(); });
    }
    return next();
  };
  /** Gevonden: remap vastleggen, meta van het nieuwe item, en meteen toepassen (actief profiel, collecties, andere profielen). */
  X.commit = function (oldKey, found) {
    if (!found || found.guess) return false;
    if (found.type === 'episode') {
      X.putMeta(found.key, X.episodeMeta(found.src.id, found.item, found.series));
      if (found.series) X.putMeta(found.src.id + '|' + found.series.id, X.metaFor(found.src.id, 'series', found.series));
    } else X.putMeta(found.key, X.metaFor(found.src.id, found.type, found.item));
    // de meta van de oude sleutel blijft (nodig voor oudere apps en om de keten te volgen)
    if (!X.addRemap(oldKey, found.key)) return false;
    applyNow();
    return true;
  };
  var applyTimer = null;
  function applyNow() {
    if (D.applyRemapNow) D.applyRemapNow();
    remapCollections();
    clearTimeout(applyTimer);
    // andere profielen: bij de volgende sync (die leest alles); kort daarna
    applyTimer = setTimeout(function () { D.syncState(); }, 2500);
  }
  X.applyNow = applyNow;

  function alive(sid) { return !!D.sourceById(sid); }
  /** Remap op de collecties van alle profielen. */
  function remapCollections() {
    var rules = CM.remap;
    if (!Object.keys(rules).length || !D.collections) return;
    var d = D._normalizeCollections(D.collections);
    Object.keys(d.profiles || {}).forEach(function (pid) {
      var b = d.profiles[pid];
      if (!b || !Array.isArray(b.items)) return;
      var changed = [];
      b.items.forEach(function (c) {
        if (!c || c.deleted === true || c.kind === 'smart') return;
        var ni = X.remapCollectionItems(c.items || [], c.sourceID, rules, alive);
        if (!ni) return;
        var o = B.copy(c);
        o.items = ni;
        // collectie die alleen voor een verwijderde server gold: naar de server waar de items nu staan
        if (o.sourceID && !alive(o.sourceID)) {
          var to = ni.filter(function (x) { return x.sid; }).map(function (x) { return x.sid; })[0];
          if (to) o.sourceID = to;
        }
        o.updatedAt = B.iso();
        changed.push(o);
      });
      if (changed.length) D.saveCollections(pid, changed);
    });
  }
  X._remapCollections = remapCollections;

  // MARK: sync-haken (sync.js roept deze aan)

  /** Op het model van het actieve profiel (sync.js: laden, samenvoegen, na een remap). */
  D.stateTransforms = D.stateTransforms || [];
  D.stateTransforms.push(function (st) { return X.applyRemapState(st, CM.remap); });
  D.stateTransforms.push(function (st) { return catTransforms(st); });

  // MARK: categorieën per profiel (profile.<id>.hiddenCategories, "<server-id>|<categorienaam>")

  var CAT_FLAG = 'xs.catMigrated128';
  /**
   * Op het model van één profiel: (1) categorieën van verwijderde servers weg (als verwijdering); (2) eenmalig per
   * apparaat de oude keuzes ("group:<naam>" in het platformblok van de bron dat de webspeler las: android.customization)
   * overnemen met een oude tijd (epoch), zodat een nieuwere keuze per profiel voorgaat.
   */
  function catTransforms(st) {
    if (!D.sourcesSynced || !st || !st.sets) return false;
    var m = st.sets.hiddenCategories = st.sets.hiddenCategories || {};
    var changed = false, now = Date.now();
    Object.keys(m).forEach(function (k) {
      var p = X.split(k);
      if (m[k] && m[k].on && p && !D.sourceById(p.sid)) { m[k] = { at: Math.max(now, m[k].at + 1), on: false }; changed = true; }
    });
    if (!B.store.get(CAT_FLAG, false)) {
      D.sources.forEach(function (src) {
        (D.customization(src).hidden || []).forEach(function (h) {
          if (String(h).indexOf('group:') !== 0) return;
          var k = src.id + '|' + String(h).slice(6);
          if (liveVariant(m, k)) return;
          m[k] = { at: 0, on: true };
          changed = true;
        });
      });
    }
    return changed;
  }
  X._catTransforms = catTransforms;
  var lastCats = null;
  B.on('profileData', function () {
    var now = JSON.stringify(D.setList('hiddenCategories'));
    if (lastCats !== null && now !== lastCats) Lib.applyFilters();
    lastCats = now;
  });

  /** Na elke volledige sync: catalogmeta samenvoegen, remap op andere profielen en collecties, verwijzingen voor opruimen. */
  B.on('state', function (all) {
    if (!all) return;
    var sec = all.catalogmeta && all.catalogmeta.data;
    var before = Object.keys(CM.remap).length + '|' + Object.keys(CM.items).length;
    if (sec) CM = X.mergeMeta(sec, X.mergeMeta(CM, pending));
    var rulesChanged = before !== Object.keys(CM.remap).length + '|' + Object.keys(CM.items).length;
    saveLocal();
    // verwijzingen van alle profielen en collecties
    var refs = { keys: {}, items: {} };
    var active = B.app && B.app.profile ? lower('profile.' + B.app.profile.id) : null;
    var others = [];
    Object.keys(all).forEach(function (name) {
      if (lower(name).indexOf('profile.') !== 0) return;
      var data = all[name] && all[name].data;
      if (!data || typeof data !== 'object') return;
      var st = D._parseState(data);
      X.refsOfState(st, refs);
      if (lower(name) !== active) others.push({ name: name, data: data, st: st });
    });
    collectionRefs(all.collections && all.collections.data, refs);
    lastRefs = refs;
    otherProfiles.list = others;
    var catsDone = D.sourcesSynced && !B.store.get(CAT_FLAG, false);
    // na het actieve profiel (sync.js voegt dat direct hierna samen): vlag van de categoriemigratie zetten
    if (catsDone) setTimeout(function () { B.store.set(CAT_FLAG, B.iso()); }, 0);
    {
      // andere profielen: remap en categorieën toepassen en terugzetten (alleen als er iets verandert)
      others.forEach(function (o) {
        var a1 = Object.keys(CM.remap).length ? X.applyRemapState(o.st, CM.remap) : false;
        var a2 = catTransforms(o.st);
        if (!a1 && !a2) return;
        var json = D._toJSON(o.data, D._normalize(o.st));
        A.putState(o.name, json).catch(B.noop);
      });
      setTimeout(remapCollections, 0);
    }
    if (rulesChanged) B.emit('profileData');
    kick(4000);
  });
  var otherProfiles = { list: [] };
  function collectionRefs(data, refs) {
    if (!data || typeof data !== 'object') return;
    var buckets = data.profiles && typeof data.profiles === 'object' ? Object.keys(data.profiles).map(function (k) { return data.profiles[k]; }) : [];
    if (Array.isArray(data.items)) buckets.push({ items: data.items });
    buckets.forEach(function (b) {
      ((b && b.items) || []).forEach(function (c) {
        if (!c || c.deleted === true) return;
        (c.items || []).forEach(function (it) {
          if (!it || it.id == null) return;
          var sid = it.sid || c.sourceID;
          if (sid) refs.keys[lower(sid + '|' + it.id)] = true; else refs.items[lower(it.id)] = true;
        });
      });
    });
  }

  // meta bij elke toevoeging (Mijn lijst, favorieten, recente zenders, collecties)
  var origToggle = D.toggleSet;
  D.toggleSet = function (field, k, on) {
    origToggle.apply(D, arguments);
    if ((field === 'myList' || field === 'favorites') && D.inSet(field, k)) X.noteKey(k);
  };
  var origRecent = D.pushRecentChannel;
  D.pushRecentChannel = function (playlist, channelID) {
    origRecent.apply(D, arguments);
    X.noteKey(D.key(playlist, channelID), 'channel');
  };
  var origColl = D.toggleInCollection;
  D.toggleInCollection = function (profileId, id, item) {
    return origColl.apply(D, arguments).then(function (added) {
      if (added && item && item.sid) X.noteKey(item.sid + '|' + item.id, item.type);
      return added;
    });
  };

  // MARK: achtergrond (migratie en zoeken; rustig, niet tijdens afspelen)

  var MIG_FLAG = 'xs.migrated128';
  var kickTimer = null, running = false;
  function kick(ms0) {
    if (running) return;
    clearTimeout(kickTimer);
    kickTimer = setTimeout(function () { B.idle(function () { run(); }, 3000); }, ms0 || 2000);
  }
  X.kick = kick;
  /** Alle sleutels uit de lijsten van alle profielen (actief: het lokale model; andere: de laatste sync) en collecties. */
  function allKeys() {
    var out = {}; // sleutel → {type, fb}
    function addState(st) {
      if (!st) return;
      ['myList', 'favorites', 'recentChannels'].forEach(function (f) {
        var m = st.sets && st.sets[f] || {};
        Object.keys(m).forEach(function (k) { if (m[k] && m[k].on && !out[k]) out[k] = { type: f === 'myList' ? null : 'channel', fb: null }; });
      });
      Object.keys(st.progress || {}).forEach(function (k) {
        var v = st.progress[k] && st.progress[k].v;
        if (v && v.playlistID) { var key = v.playlistID + '|' + k; if (!out[key] || !out[key].fb) out[key] = { type: null, fb: { title: v.title, artwork: v.artwork } }; }
      });
      Object.keys(st.history || {}).forEach(function (k) {
        var v = st.history[k] && st.history[k].v;
        if (v && v.playlistID) {
          var key = v.playlistID + '|' + v.itemID;
          var t = v.type === 'live' ? 'channel' : (v.type === 'episode' ? 'episode' : (v.type === 'series' ? 'series' : 'movie'));
          if (!out[key] || !out[key].fb) out[key] = { type: t, fb: { title: v.title, artwork: v.artwork, type: t, subtitle: v.subtitle } };
        }
      });
    }
    addState(D._P && D._P.st);
    otherProfiles.list.forEach(function (o) { addState(o.st); });
    var d = D.collections ? D._normalizeCollections(D.collections) : null;
    if (d) Object.keys(d.profiles || {}).forEach(function (pid) {
      ((d.profiles[pid] && d.profiles[pid].items) || []).forEach(function (c) {
        if (!c || c.deleted === true || c.kind === 'smart') return;
        (c.items || []).forEach(function (it) {
          var sid = it && (it.sid || c.sourceID);
          if (sid) { var key = sid + '|' + it.id; if (!out[key]) out[key] = { type: it.type, fb: null }; }
        });
      });
    });
    return out;
  }
  /**
   * Eén ronde: (1) meta aanvullen uit de catalogus van de eigen server (migratie: ook niet-actieve servers, één
   * catalogus tegelijk); voortgang/geschiedenis hebben al titel en artwork: die als terugval; (2) items van verwijderde
   * servers of die niet meer op hun server staan zoeken op de andere servers en remappen.
   */
  function run() {
    if (running || !B.app || !B.app.profile || !A.isSignedIn()) return;
    if (B.player && B.player.current) { kick(30000); return; }
    running = true;
    var keys = allKeys();
    var bySid = {}, orphans = [];
    Object.keys(keys).forEach(function (k) {
      if (external(k)) return;
      var r = X.resolve(CM.remap, k);
      var key = r ? r.to : k;
      var p = X.split(key);
      if (!p) return;
      var src = D.sourceById(p.sid);
      if (!src) { orphans.push({ key: key, info: keys[k] }); return; }
      (bySid[lower(p.sid)] = bySid[lower(p.sid)] || { src: src, keys: [] }).keys.push({ key: key, info: keys[k] });
    });
    var chain = Promise.resolve(), work = 0;
    Object.keys(bySid).forEach(function (lid) {
      var g = bySid[lid];
      var needMeta = g.keys.filter(function (e) { return !X.meta(e.key); });
      // catalogus nodig: voor ontbrekende meta, of om te tonen (er staan items van deze server in de lijsten)
      chain = chain.then(function () {
        if (B.player && B.player.current) return;
        var hasCat = !!catNow(g.src.id);
        if (isActive(g.src.id) && !hasCat) return; // actieve server laadt zelf
        return (hasCat ? Promise.resolve(catNow(g.src.id)) : X.loadCatalog(g.src, true)).then(function (cat) {
          if (!cat) return;
          needMeta.forEach(function (e) {
            if (X.noteKey(e.key, e.info.type === 'episode' ? null : e.info.type)) { work++; return; }
            // aflevering of onbekend: terugval op wat de lijst zelf weet (voortgang/geschiedenis)
            if (e.info.fb && e.info.fb.title && !cat.idx.byId[X.split(e.key).item]) fallbackMeta(e.key, e.info);
          });
          // items die niet meer op deze (bestaande) server staan
          if (cat.raw.movies.length + cat.raw.series.length + cat.raw.channels.length > 0) {
            g.keys.forEach(function (e) {
              var p = X.split(e.key);
              if (cat.idx.byId[p.item]) return;
              var m = X.meta(e.key);
              if (m && m.k === 'episode') { if (!episodeStillThere(cat, m)) orphans.push(e); return; }
              if (m || (e.info.fb && e.info.fb.title)) orphans.push(e);
            });
          }
        });
      });
    });
    chain.then(function () {
      // verwijderde servers: meta-terugval (titel uit voortgang/geschiedenis), daarna zoeken
      orphans.forEach(function (e) { if (!X.meta(e.key) && e.info && e.info.fb && e.info.fb.title) fallbackMeta(e.key, e.info); });
      return searchAll(orphans);
    }).catch(function (e) { B.log('xs achtergrond', e && e.message); }).then(function () {
      running = false;
      var unloaded = Object.keys(bySid).some(function (lid) { return !catNow(bySid[lid].src.id) && !isActive(bySid[lid].src.id); });
      if (!unloaded && !B.store.get(MIG_FLAG, false) && D.syncedOnce) B.store.set(MIG_FLAG, B.iso());
      if (work) changedSoon();
    });
  }
  X.run = run;
  X.migrated = function () { return !!B.store.get(MIG_FLAG, false); };
  function episodeStillThere(cat, m) {
    var sp = m.ep && m.ep.series ? X.split(m.ep.series) : null;
    return !!(sp && cat.idx.byId[sp.item]); // serie staat er nog: de aflevering waarschijnlijk ook (afleveringen niet geladen)
  }
  function fallbackMeta(key, info) {
    var p = X.split(key);
    var fb = info.fb || {};
    var t = info.type === 'channel' ? 'channel' : (fb.type || info.type || (fb.subtitle && /S\d+:E\d+/.test(fb.subtitle) ? 'episode' : null));
    var m = { t: String(fb.title), y: null, k: t || 'movie', tmdb: null, img: fb.artwork || null, sid: p.sid, sname: sourceName(p.sid), ep: null, ch: null };
    if (t === 'channel') m.ch = { name: String(fb.title), epg: null };
    if (t === 'episode' && fb.subtitle) {
      var mm = /S(\d+):E(\d+)/.exec(fb.subtitle);
      if (mm) m.ep = { series: '', st: String(fb.title), s: parseInt(mm[1], 10), e: parseInt(mm[2], 10) };
      else m.k = 'series';
    }
    if (!t) {
      // voortgang zonder soort: als film bewaren; zoeken probeert ook series (zonder remap, alleen openen)
      m.k = 'movie'; m.guess = true;
    }
    X.putMeta(key, m);
  }
  function searchAll(list) {
    var seen = {}, chain = Promise.resolve();
    list.forEach(function (e) {
      var lk = lower(e.key);
      if (seen[lk]) return;
      seen[lk] = true;
      var s = searched[lk];
      if (s && Date.now() - s.at < 6 * 3600000) return;
      chain = chain.then(function () {
        if (B.player && B.player.current) return;
        searched[lk] = { at: Date.now(), fb: e.info && e.info.fb };
        return X.search(e.key, e.info && e.info.type, false).then(function (found) {
          if (found) X.commit(e.key, found);
        }).catch(B.noop);
      });
    });
    return chain;
  }

  // MARK: openen (aanklikken van een tegel uit catalogmeta)

  function fieldName(field) {
    if (field === 'myList') return L('My List');
    if (field === 'favorites' || field === 'recentChannels') return L('Favorites');
    if (field === 'continue') return L('Continue watching');
    if (field === 'history') return L('Watch history');
    if (field && field.indexOf('collection:') === 0) {
      var c = D.collectionById(B.app.profile.id, field.slice(11));
      return L('the collection “%@”', c ? c.name : '');
    }
    return L('My List');
  }
  /** Melding als het item nergens gevonden is. */
  X.notFound = function (tile, done) {
    var x = tile.item, key = x._key;
    var p = key ? X.split(key) : null;
    var m = X.meta(key) || {};
    var title = x.title || x.name || m.t || L('Unknown title');
    var sname = (p && sourceName(p.sid)) || m.sname || L('a removed server');
    var q = B.lang === 'nl' ? ['‘', '’'] : ['“', '”'];
    var others = D.sources.filter(function (s) { return !p || lower(s.id) !== lower(p.sid); }).map(function (s) { return q[0] + (s.name || '') + q[1]; });
    var names = others.join(', ');
    var gone = !p || !D.sourceById(p.sid);
    var text;
    if (!others.length) text = gone ? L('“%@” was on “%@”, but that server has been removed, and you have no other server to search.', title, sname)
      : L('“%@” is no longer on “%@”, and you have no other server to search.', title, sname);
    else text = gone ? L('“%@” was on “%@”, but that server has been removed. This title wasn’t found on your other servers (%@).', title, sname, names)
      : L('“%@” is no longer on “%@” and wasn’t found on %@ either.', title, sname, names);
    var field = x._field || 'myList';
    var fname = fieldName(field);
    function remove() {
      if (field === 'continue') (x._progressKeys || []).forEach(function (k) { D.clearProgress(k); });
      else if (field === 'history') { if (x._hist) D.removeHistory(x._hist); }
      else if (field.indexOf('collection:') === 0) { if (x._collItem) D.toggleInCollection(B.app.profile.id, field.slice(11), x._collItem); }
      else if (key) D.toggleSet(field, key, false);
      U().toast(L('Removed'));
    }
    U().modal({ title: title, text: text, cls: 'xs-dlg', onClose: function () { if (done) done(); }, buttons: [
      { label: L('Remove from %@', fname), danger: true, fn: remove },
      { label: L('Search'), icon: 'search', fn: function () { setTimeout(function () { B.ui.router.go('/search?q=' + encodeURIComponent(title)); }, 0); } },
      { label: L('Cancel') }
    ] });
  };
  function U() { return B.ui; }
  /**
   * Tegel uit catalogmeta openen: catalogus van zijn server laden (bestaat hij nog), anders/daarna zoeken op de andere
   * servers. Geeft {type, item} op de (nieuwe) server of null (niet gevonden). Speelt niets af.
   */
  X.resolveTile = function (tile) {
    var x = tile.item, key = x._key;
    if (!key) return Promise.resolve(null);
    var p = X.split(key);
    var src = p && D.sourceById(p.sid);
    var first = src ? X.loadCatalog(src, true) : Promise.resolve(null);
    return first.then(function (cat) {
      if (cat) {
        var v = viewOf(p.sid), hit = v && v.byId[p.item];
        if (hit) return hit;
        if (cat.idx.byId[p.item]) return null;
      }
      var lk = lower(key);
      searched[lk] = { at: Date.now(), fb: x._fb };
      return X.search(key, tile.type, true).then(function (found) {
        if (!found) return null;
        X.commit(key, found);
        if (found.type === 'episode') return { type: 'series', item: found.series };
        var v2 = viewOf(found.src.id), h2 = v2 && v2.byId[found.item.id];
        return h2 || null;
      });
    });
  };
  /** Aangeklikt: ophalen en openen (detailpagina of afspelen), of de melding. */
  X.open = function (tile, opts) {
    opts = opts || {};
    var ui = U();
    ui.toast(L('Loading…'), 20000);
    return X.resolveTile(tile).then(function (hit) {
      ui.toast(L('Loading…'), 1);
      if (!hit) { X.notFound(tile, opts.onDone); return; }
      if (hit.type === 'channel') { B.player.playChannel(hit.item, [hit.item]); if (opts.onDone) opts.onDone(); return; }
      if (opts.play && hit.type === 'movie') { B.player.playVOD(B.player.movieItem(hit.item)); if (opts.onDone) opts.onDone(); return; }
      ui.router.go(B.screens.titleLink(hit.type, hit.item).slice(1), !!opts.replace);
    }, function () { ui.toast(L('Something went wrong. Please try again.')); });
  };

  // eerste start: na de eerste volledige sync rustig beginnen
  B.on('profileData', function () { if (!X.migrated()) kick(5000); });
  B.on('library', function () { kick(4000); });
})();
