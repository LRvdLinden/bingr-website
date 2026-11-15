/*
 * Build 177 (versie 1.0.8): tv-gids per zender, pure logica zonder DOM (getest in tools/test/build177_test.js met de
 * gedeelde gevallen uit docs/build177_cases.json van iptv-ios-appletv). Dezelfde regels als Shared/Account/Build177.swift
 * (Apple) en Build177Logic.kt (Android):
 * - programma's per zender op volgorde (begin, bij gelijk begin het langste eerst);
 * - dubbelen samenvoegen: zelfde titel die binnen 5 min na een getoond programma begint (het langste einde telt);
 * - kleine overlap (hooguit 5 min) met het vorige programma: begint pas als dat afloopt, valt het erbinnen dan weg.
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var P = B.b177 = {};

  P.MERGE_MS = 300000;
  P.OVERLAP_MS = 300000;

  P.titleKey = function (s) { return String(s == null ? '' : s).toLowerCase().split(/\s+/).filter(Boolean).join(' '); };

  /** Opgeschoonde regels [{index, start, end}] (ms) voor titels/begin/einde. */
  P.cleanIndex = function (titles, starts, ends) {
    var n = Math.min(titles.length, starts.length, ends.length), order = [], i;
    for (i = 0; i < n; i++) order.push(i);
    order.sort(function (a, b) { return starts[a] - starts[b] || ends[b] - ends[a] || a - b; });
    var out = [], keys = [];
    order.forEach(function (i) {
      var p = { index: i, start: starts[i], end: ends[i] }, key = P.titleKey(titles[i]);
      for (var j = out.length - 1; j >= 0 && out[j].start >= p.start - P.MERGE_MS; j--) {
        if (keys[j] === key) { out[j].end = Math.max(out[j].end, p.end); return; }
      }
      var k = out[out.length - 1];
      if (k && p.start < k.end && k.end - p.start <= P.OVERLAP_MS) {
        if (p.end <= k.end) return;
        p.start = k.end;
      }
      out.push(p); keys.push(key);
    });
    return out;
  };

  /** Programma's ({title, start, end, ...}) op volgorde en zonder dubbelen; aangepaste tijden in een kopie. */
  P.clean = function (list) {
    if (!list || list.length < 2) return list || [];
    return P.cleanIndex(list.map(function (p) { return p.title; }), list.map(function (p) { return p.start; }),
      list.map(function (p) { return p.end; })).map(function (c) {
      var p = list[c.index];
      if (c.start === p.start && c.end === p.end) return p;
      var q = {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
      q.start = c.start; q.end = c.end;
      return q;
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
