// Build 177: tv-gids per zender (web/js/build177.js). Draaien: node tools/test/build177_test.js
// Leest de gedeelde testgevallen uit ../iptv-ios-appletv/docs/build177_cases.json als die repo ernaast staat, anders de
// kopie tools/test/build177_cases.json (bron: iptv-ios-appletv/docs/build177_cases.json, niet hier aanpassen).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/build177.js'), 'utf8'));
const P = globalThis.B.b177;
const sibling = path.join(__dirname, '../../../iptv-ios-appletv/docs/build177_cases.json');
const C = JSON.parse(fs.readFileSync(fs.existsSync(sibling) ? sibling : path.join(__dirname, 'build177_cases.json'), 'utf8'));
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const t = (s) => Date.parse(s);

assert(C.clean.cases.length >= 8, 'gevallen geladen');
C.clean.cases.forEach(([input, want]) => {
  const got = P.cleanIndex(input.map((x) => x[0]), input.map((x) => t(x[1])), input.map((x) => t(x[2])));
  eq(got, want.map((x) => ({ index: x[0], start: t(x[1]), end: t(x[2]) })), 'clean ' + JSON.stringify(input.map((x) => x[0])));
});
// eigen gevallen: lijst met objecten
const list = [{ title: 'B', start: 20, end: 30, id: 'b' }, { title: 'A', start: 10, end: 20, id: 'a' }, { title: 'a', start: 11, end: 19, id: 'a2' }];
eq(P.clean(list).map((p) => p.id), ['a', 'b'], 'clean lijst');
eq(P.clean([]), [], 'leeg');
eq(P.titleKey('  De   Frogers '), 'de frogers', 'titelsleutel');
const keep = [{ title: 'X', start: 0, end: 10 }];
eq(P.clean(keep), keep, 'één programma ongewijzigd');
console.log('build177: ' + n + ' controles, alles goed');
