// Build 172: categorieën slim samenvoegen (web/js/catmerge.js). Leest de gedeelde testgevallen uit
// ../iptv-ios-appletv/docs/merge_cases.json als die repo ernaast staat, anders de kopie tools/test/merge_cases.json
// (bron: iptv-ios-appletv/docs/merge_cases.json, niet hier aanpassen). Draaien: node tools/test/catmerge_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/catmerge.js'), 'utf8'));
const M = globalThis.B.catMerge;
const sibling = path.join(__dirname, '../../../iptv-ios-appletv/docs/merge_cases.json');
const C = JSON.parse(fs.readFileSync(fs.existsSync(sibling) ? sibling : path.join(__dirname, 'merge_cases.json'), 'utf8'));
let n = 0;
C.norm.forEach((c) => { const r = M.norm(c.name); assert.deepStrictEqual([r.tokens, r.country], [c.tokens, c.country], 'norm ' + c.name); n++; });
C.brand.forEach((c) => { assert.strictEqual(M.brandOf(c.name), c.brand, 'merk ' + c.name); n++; });
C.suggest.forEach((c) => {
  const got = M.suggest(c).map((s) => ({ id: s.id, kind: s.kind, target: s.target, targetGroup: s.targetGroup, groups: s.groups,
    total: s.total, on: s.on, renamed: s.renamed }));
  assert.deepStrictEqual(got, c.expect, 'voorstellen: ' + c.name); n++;
});
C.apply.forEach((c) => { assert.deepStrictEqual(M.apply(c.custom, c.groups, c.targetGroup, c.targetName, c.cleanName), c.expect, 'apply: ' + c.name); n++; });
C.detach.forEach((c) => { assert.deepStrictEqual(M.detach(c.custom, c.target, c.sources, c.madeName), c.expect, 'detach: ' + c.name); n++; });
C.summary.forEach((c) => {
  const sc = C.suggest.find((x) => x.name === c.case);
  assert.deepStrictEqual(M.summary(M.suggest(sc)), c.expect, 'samenvatting: ' + c.name); n++;
});
// prestaties: 5.000 groepen binnen een seconde
const big = [];
for (let i = 0; i < 5000; i++) big.push({ name: i % 5 ? 'NL | Categorie ' + i + ' Films' : (i % 2 ? 'Netflix ' : 'Disney+ ') + i, count: i });
const t0 = Date.now(); M.suggest({ groups: big }); const ms = Date.now() - t0;
assert.ok(ms < 1000, '5.000 groepen in ' + ms + ' ms'); n++;
console.log('catmerge: ' + n + ' controles goed (5.000 groepen: ' + ms + ' ms)');
