/*
 * Bingr web, build 149: een grote JSON-lijst van een server lezen en per item alleen de nodige velden houden.
 * Zelfde code op de hoofdthread (terugval) en in de Web Worker (js/json-worker.js). Pure functie, geen DOM.
 * spec = {fields: [veld, …], cat: 'category_id', skip: {categorie-id: true}}
 * → {list: [{veld: waarde}], skipped: {categorie-id: aantal}, hidden: [[…spec.keep]], total} of {error: 'bad_json'}.
 * spec.keep (build 149, zoeken): van overgeslagen items alleen deze velden als compacte rij (zoekindex verborgen categorieën).
 * Items uit een categorie in spec.skip (verborgen categorieën) worden alleen geteld, niet bewaard.
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  function items(j) {
    if (Array.isArray(j)) return j;
    if (j && typeof j === 'object') return Object.keys(j).map(function (k) { return j[k]; });
    return [];
  }
  B.jsonPick = function (text, spec, onPart, partSize, onHidden) {
    spec = spec || {};
    var j;
    if (!text) return { error: 'bad_json' };
    try { j = JSON.parse(text); } catch (e) { return { error: 'bad_json' }; }
    text = null;
    var all = items(j); j = null;
    var fields = spec.fields || null, cat = spec.cat || 'category_id', skip = spec.skip || null;
    var out = [], skipped = {}, total = all.length, nf = fields ? fields.length : 0, keep = spec.keep || null, hid = [];
    for (var i = 0; i < all.length; i++) {
      var x = all[i];
      all[i] = null;
      if (!x || typeof x !== 'object') continue;
      var c = x[cat] == null ? '' : String(x[cat]);
      if (skip && skip[c] === true) {
        skipped[c] = (skipped[c] || 0) + 1;
        if (keep) {
          var row = new Array(keep.length);
          for (var q = 0; q < keep.length; q++) { var kv = x[keep[q]]; row[q] = kv == null ? null : kv; }
          hid.push(row);
          if (onHidden && hid.length >= partSize) { onHidden(hid); hid = []; }
        }
        continue;
      }
      var o;
      if (fields) { o = {}; for (var f = 0; f < nf; f++) { var v = x[fields[f]]; if (v !== undefined && v !== null && v !== '') o[fields[f]] = v; } }
      else o = x;
      out.push(o);
      if (onPart && out.length >= partSize) { onPart(out); out = []; }
    }
    if (onPart && out.length) { onPart(out); out = []; }
    if (onHidden && hid.length) { onHidden(hid); hid = []; }
    return { list: out, skipped: skipped, hidden: hid, total: total };
  };
})(typeof self !== 'undefined' ? self : this);
