// Build 178: terugkijken in de tv-gids (web/js/build178.js). Draaien: node tools/test/build178_test.js
// Leest de gedeelde testgevallen uit ../iptv-ios-appletv/docs/build178_cases.json als die repo ernaast staat, anders de
// kopie tools/test/build178_cases.json (bron: iptv-ios-appletv/docs/build178_cases.json, niet hier aanpassen).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/build178.js'), 'utf8'));
const P = globalThis.B.b178;
const sibling = path.join(__dirname, '../../../iptv-ios-appletv/docs/build178_cases.json');
const C = JSON.parse(fs.readFileSync(fs.existsSync(sibling) ? sibling : path.join(__dirname, 'build178_cases.json'), 'utf8'));
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const t = (s) => Date.parse(s);

assert(C.durationDays.cases.length >= 15 && C.m3uURL.cases.length >= 15, 'gevallen geladen');
C.durationDays.cases.forEach(([v, d]) => eq(P.days(v), d, 'duur ' + v));
C.xtreamDays.cases.forEach(([a, d, w]) => eq(P.xtreamDays(a, d), w, 'xtream ' + a + ' ' + d));
C.stalkerDays.cases.forEach(([a, d, w]) => eq(P.stalkerDays(a, d), w, 'stalker ' + a + ' ' + d));
C.m3u.cases.forEach(([a, h, w]) => eq(P.m3u(a, h), { days: w[0], type: w[1], source: w[2] }, 'm3u ' + JSON.stringify(a) + JSON.stringify(h)));
C.xtreamURL.cases.forEach((c) => eq(P.xtreamURL(c[0], c[1], c[2], c[3], t(c[4]), t(c[5]), c[6]), c[7], 'xtream-url ' + c[6]));
C.m3uURL.cases.forEach((c) => eq(P.m3uURL(c[0], c[1], c[2], t(c[3]), t(c[4]), t(c[5]), c[6]), c[7], 'm3u-url ' + c[0] + ' ' + c[1]));
C.replay.cases.forEach((c) => eq(P.replayable(t(c[0]), t(c[1]), t(c[2]), c[3], c[4]), c[5], 'replay ' + JSON.stringify(c)));
C.dayOffsets.cases.forEach((c) => eq(P.dayOffsets(c[0], c[1]), c[2], 'dagen ' + JSON.stringify(c)));
C.keep.cases.forEach((c) => eq(P.keep(t(c[0]), t(c[1]), t(c[2]), c[3], c[4]), c[5], 'venster ' + JSON.stringify(c)));
C.simpleTable.cases.forEach(([json, want]) => eq(P.simpleTable(json).map((p) => [p.title, p.start, p.end, p.archive]),
  want.map((w) => [w[0], t(w[1]), t(w[2]), w[3]]), 'tabel'));
C.merge.cases.forEach(([g, a, w]) => eq(
  P.merge(g.map((x) => ({ title: x[0], start: t(x[1]), end: t(x[2]) })), a.map((x) => ({ title: x[0], start: t(x[1]), end: t(x[2]), archive: x[3] })))
    .map((p) => [p.title, p.start, p.end, p.archive]),
  w.map((x) => [x[0], t(x[1]), t(x[2]), x[3]]), 'samenvoegen'));
C.summary.cases.forEach(([d, w]) => eq(P.summary(d), w, 'samenvatting ' + d));
eq(P.text('Tk9TIEpvdXJuYWFs'), 'NOS Journaal', 'base64-titel');
eq(P.text('Test'), 'Test', 'korte gewone titel blijft');
console.log('build178: ' + n + ' controles, alles goed');
