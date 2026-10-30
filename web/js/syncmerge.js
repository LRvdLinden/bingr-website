/*
 * Bingr web, build 151: de pure kern van de sync (profile.<id>): serverobject lezen, samenvoegen, opschonen en terug naar
 * JSON. Uit sync.js gehaald zodat dezelfde code op de hoofdthread (terugval, in stappen) en in de Worker (sync-worker.js)
 * draait. Gebruikt alleen B.parseISO, B.num, B.copy, B.has, B.assign en B.iso uit core.js; geen DOM, geen opslag, geen netwerk.
 */
(function (root) {
  'use strict';
  var B = root.B;
  var SET_FIELDS = ['myList', 'favorites', 'watched', 'recentChannels', 'hiddenCategories'];
  var REMOVED_DAYS = 90, MAX_RECENT = 20, MAX_PROGRESS = 300, MAX_HISTORY = 500;

  function time(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
    return B.parseISO(v);
  }
  function putNewer(map, k, item) { var c = map[k]; if (!c || item.at > c.at) map[k] = item; }

  function parseSetField(e, removed) {
    var out = {};
    function parseList(a) {
      a.forEach(function (x) {
        if (typeof x === 'string' || typeof x === 'number') { if (String(x)) putNewer(out, String(x), { at: 0, on: true }); }
        else if (x && typeof x === 'object') {
          var k = x.id || x.key;
          if (!k) return;
          var at = time(x.at) || time(x.updatedAt) || 0;
          putNewer(out, String(k), { at: at, on: !(x.removed === true || x.deleted === true) });
        }
      });
    }
    if (Array.isArray(e)) parseList(e);
    else if (e && typeof e === 'object') {
      var list = Array.isArray(e.items) ? e.items : (Array.isArray(e.ids) ? e.ids : null);
      if (list) {
        parseList(list);
        if (e.removed && typeof e.removed === 'object') Object.keys(e.removed).forEach(function (k) { putNewer(out, k, { at: time(e.removed[k]) || 0, on: false }); });
      } else {
        Object.keys(e).forEach(function (k) {
          var v = e[k];
          if (v && typeof v === 'object') putNewer(out, k, { at: time(v.at) || time(v.updatedAt) || 0, on: !(v.removed === true || v.deleted === true) });
          else if (v === true || v === false) putNewer(out, k, { at: 0, on: v });
          else putNewer(out, k, { at: time(v) || 0, on: true });
        });
      }
    }
    if (removed && typeof removed === 'object') Object.keys(removed).forEach(function (k) { putNewer(out, k, { at: time(removed[k]) || 0, on: false }); });
    return out;
  }
  function parseProgress(o) {
    var pos = B.num(o.position) || 0, dur = B.num(o.duration);
    var frac = B.num(o.fraction);
    if (frac == null) { if (dur && dur > 0) frac = pos / dur; else return null; }
    var e = { fraction: frac, position: pos, updated: time(o.updatedAt) || time(o.updated) || 0, title: o.title || '' };
    if (o.artwork) e.artwork = o.artwork;
    if (o.playlistID) e.playlistID = o.playlistID;
    return e;
  }
  function parseHistory(o) {
    if (!o || !o.itemID) return null;
    var d = time(o.date) || time(o.at);
    if (!d) return null;
    var e = { itemID: String(o.itemID), title: o.title || '', type: String(o.type || 'movie').toLowerCase(), date: d };
    if (o.playlistID) e.playlistID = o.playlistID;
    if (o.subtitle) e.subtitle = o.subtitle;
    if (o.artwork) e.artwork = o.artwork;
    if (o.channelID) e.channelID = o.channelID;
    return e;
  }
  function historyId(e) { return (e.playlistID || '-') + '|' + e.itemID; }

  /** Serverobject → model {sets, progress, history}. */
  function parseState(o) {
    var removedObj = (o && o.removed && typeof o.removed === 'object') ? o.removed : {};
    // verwijderingen per veld: `removed.<veld>` plus de oudere iOS-velden `<veld>Removed` (`progressRemoved`,
    // `historyRemoved`, …) van Apple-builds vóór 60; per sleutel wint de nieuwste tijd
    function removedFor(f) {
      var a = removedObj[f], b = o ? o[f + 'Removed'] : null;
      a = (a && typeof a === 'object') ? a : null; b = (b && typeof b === 'object' && !Array.isArray(b)) ? b : null;
      if (!a || !b) return a || b;
      var out = B.copy(a);
      Object.keys(b).forEach(function (k) { if (!B.has(out, k) || (time(b[k]) || 0) > (time(out[k]) || 0)) out[k] = b[k]; });
      return out;
    }
    var removed = { progress: removedFor('progress'), history: removedFor('history') };
    var st = { sets: {}, progress: {}, history: {} };
    SET_FIELDS.forEach(function (f) { st.sets[f] = parseSetField(o[f], removedFor(f)); });
    var pr = o.progress || {};
    Object.keys(pr).forEach(function (k) {
      var p = pr[k];
      if (!p || typeof p !== 'object') return;
      if (p.removed === true || p.deleted === true) putNewer(st.progress, k, { at: time(p.updatedAt) || 0, v: null });
      else { var e = parseProgress(p); if (e) putNewer(st.progress, k, { at: e.updated, v: e }); }
    });
    if (removed.progress) Object.keys(removed.progress).forEach(function (k) { putNewer(st.progress, k, { at: time(removed.progress[k]) || 0, v: null }); });
    (Array.isArray(o.history) ? o.history : []).forEach(function (h) {
      var e = parseHistory(h);
      if (e) putNewer(st.history, historyId(e), { at: e.date, v: e });
    });
    if (removed.history) Object.keys(removed.history).forEach(function (k) {
      var at = time(removed.history[k]) || 0, c = st.history[k];
      if (!c || at >= c.at) st.history[k] = { at: at, v: null };
    });
    return st;
  }
  function mergeMaps(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { var l = out[k]; if (!l || b[k].at > l.at) out[k] = b[k]; });
    return out;
  }
  function mergeState(a, b) {
    var st = { sets: {}, progress: mergeMaps(a.progress, b.progress), history: mergeMaps(a.history, b.history) };
    SET_FIELDS.forEach(function (f) { st.sets[f] = mergeMaps(a.sets[f], b.sets[f]); });
    return st;
  }
  function alive(item) { return item.on === undefined ? item.v != null : item.on; }
  /** Oude verwijderingen weg, maximale lengtes (20 recente zenders, 300 voortgang, 500 geschiedenis). */
  function normalize(st) {
    var cutoff = Date.now() - REMOVED_DAYS * 86400000;
    function prune(m, max) {
      var keys = Object.keys(m).filter(function (k) { return alive(m[k]) || m[k].at >= cutoff; });
      var live = keys.filter(function (k) { return alive(m[k]); }).sort(function (x, y) { return m[y].at - m[x].at; });
      var keep = {};
      (max ? live.slice(0, max) : live).forEach(function (k) { keep[k] = true; });
      var out = {};
      keys.forEach(function (k) { if (!alive(m[k]) || keep[k]) out[k] = m[k]; });
      return out;
    }
    var o = { sets: {}, progress: prune(st.progress, MAX_PROGRESS), history: prune(st.history, MAX_HISTORY) };
    SET_FIELDS.forEach(function (f) { o.sets[f] = prune(st.sets[f] || {}, f === 'recentChannels' ? MAX_RECENT : 0); });
    capSize(o);
    return o;
  }
  /**
   * Build 154: profile.<id> hooguit 1 MB. Daarboven vallen eerst de titelsleutels van films (w:m:t:) weg die ook een
   * tmdb- of imdb-sleutel hebben (zelfde `at`, samen geschreven), de oudste eerst. Schatting zonder JSON.stringify.
   */
  var MAX_BYTES = 1000000;
  function estimate(o) {
    var n = 200;
    SET_FIELDS.forEach(function (f) { var m = o.sets[f] || {}; for (var k in m) n += k.length + 46; });
    for (var p in o.progress) n += p.length + 260;
    for (var h in o.history) n += h.length * 2 + 320;
    return n;
  }
  function capSize(o) {
    var n = estimate(o);
    if (n <= MAX_BYTES) return;
    var w = o.sets.watched || {}, ids = {};
    Object.keys(w).forEach(function (k) { if (/^w:m:(tmdb|imdb):/.test(k)) ids[w[k].at] = true; });
    var drop = Object.keys(w).filter(function (k) { return k.indexOf('w:m:t:') === 0 && ids[w[k].at]; })
      .sort(function (a, b) { return w[a].at - w[b].at; });
    for (var i = 0; i < drop.length && n > MAX_BYTES; i++) { n -= drop[i].length + 46; delete w[drop[i]]; }
  }
  function sortedKeys(m, pred) { return Object.keys(m).filter(pred).sort(); }

  /** Model → serverobject; onbekende velden (prefs, pin, homeLayout, …) blijven zoals de server ze had. */
  function toJSON(base, st) {
    var out = B.copy(base || {});
    var removed = {};
    SET_FIELDS.forEach(function (f) {
      var m = st.sets[f] || {};
      out[f] = Object.keys(m).filter(function (k) { return m[k].on; })
        .sort(function (x, y) { return (m[y].at - m[x].at) || (x < y ? -1 : x > y ? 1 : 0); })
        .map(function (k) { return { id: k, at: B.iso(m[k].at) }; });
      removed[f] = {};
      sortedKeys(m, function (k) { return !m[k].on; }).forEach(function (k) { removed[f][k] = B.iso(m[k].at); });
    });
    out.progress = {};
    removed.progress = {};
    sortedKeys(st.progress, function () { return true; }).forEach(function (k) {
      var it = st.progress[k];
      if (it.v == null) { removed.progress[k] = B.iso(it.at); return; }
      var e = it.v;
      var p = { position: e.position, duration: e.fraction > 0 ? e.position / e.fraction : 0, fraction: e.fraction, updatedAt: B.iso(e.updated), title: e.title };
      if (e.artwork) p.artwork = e.artwork;
      if (e.playlistID) p.playlistID = e.playlistID;
      out.progress[k] = p;
    });
    var hist = Object.keys(st.history).map(function (k) { return st.history[k]; }).filter(function (x) { return x.v; })
      .map(function (x) { return x.v; }).sort(function (a, b) { return b.date - a.date; });
    out.history = hist.map(function (e) {
      var h = { id: historyId(e), itemID: e.itemID };
      if (e.playlistID) h.playlistID = e.playlistID;
      h.title = e.title;
      if (e.subtitle) h.subtitle = e.subtitle;
      if (e.artwork) h.artwork = e.artwork;
      h.type = e.type;
      if (e.channelID) h.channelID = e.channelID;
      // `at` en `date` zijn dezelfde tijd (iOS las `at`, Android/Tizen `date`): schrijf allebei
      h.at = B.iso(e.date);
      h.date = h.at;
      return h;
    });
    removed.history = {};
    sortedKeys(st.history, function (k) { return !st.history[k].v; }).forEach(function (k) { removed.history[k] = B.iso(st.history[k].at); });
    var baseRemoved = (base && base.removed && typeof base.removed === 'object') ? B.copy(base.removed) : {};
    out.removed = B.assign(baseRemoved, removed);
    out.updatedAt = B.iso();
    return out;
  }
  function stateKey(st) {
    // vergelijkingssleutel zonder updatedAt
    var j = toJSON({}, st); delete j.updatedAt; return JSON.stringify(j);
  }

  function hasAny(st) {
    var any = Object.keys(st.progress).length || Object.keys(st.history).length;
    SET_FIELDS.forEach(function (f) { if (Object.keys(st.sets[f]).length) any = true; });
    return !!any;
  }


  /**
   * Build 151: het samenvoegen van één profiel als losse stappen (elk een eigen macrotaak op de hoofdthread, of allemaal
   * achter elkaar in de Worker). In: {datas: [serverobjecten van profile.<id>], local: model, base, prefsNewer}.
   * Uit (r): {merged, hasSrv, mergedKey, localKey, srvKey, json, stStr, baseStr, jsonStr} — json/jsonStr alleen als er
   * (misschien) geüpload moet worden; de teksten zijn JSON.stringify van st, base en json voor het bewaren.
   */
  function mergeSteps(inp, r) {
    var server = null, srv = null, steps = [];
    (inp.datas || []).forEach(function (d) {
      steps.push(function () { var s = parseState(d); server = server ? mergeState(server, s) : s; });
    });
    steps.push(function () { srv = server ? normalize(server) : null; server = null; r.hasSrv = !!srv; });
    steps.push(function () { r.merged = normalize(srv ? mergeState(inp.local, srv) : inp.local); });
    steps.push(function () { r.mergedKey = stateKey(r.merged); });
    steps.push(function () { r.localKey = stateKey(inp.local); });
    steps.push(function () { r.srvKey = srv ? stateKey(srv) : null; srv = null; });
    steps.push(function () {
      var need = inp.prefsNewer || (!r.hasSrv ? hasAny(r.merged) : r.mergedKey !== r.srvKey);
      if (need) { r.json = toJSON(inp.base, r.merged); r.jsonStr = JSON.stringify(r.json); }
    });
    steps.push(function () { r.stStr = JSON.stringify(r.merged); });
    steps.push(function () { r.baseStr = JSON.stringify(inp.base == null ? null : inp.base); });
    return steps;
  }
  /** Alles in één keer (in de Worker). */
  function mergeNow(inp) {
    var r = {};
    mergeSteps(inp, r).forEach(function (f) { f(); });
    return r;
  }

  B.syncMerge = {
    mergeSteps: mergeSteps, mergeNow: mergeNow,
    SET_FIELDS: SET_FIELDS, REMOVED_DAYS: REMOVED_DAYS, MAX_RECENT: MAX_RECENT, MAX_PROGRESS: MAX_PROGRESS, MAX_HISTORY: MAX_HISTORY,
    time: time, putNewer: putNewer, parseSetField: parseSetField, historyId: historyId, parseState: parseState,
    mergeMaps: mergeMaps, mergeState: mergeState, normalize: normalize, toJSON: toJSON, stateKey: stateKey, hasAny: hasAny
  };
})(typeof window !== 'undefined' ? window : self);
