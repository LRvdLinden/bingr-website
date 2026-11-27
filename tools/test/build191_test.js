'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = globalThis;
const root = path.join(__dirname, '..', '..', 'web', 'js');
(0, eval)(fs.readFileSync(path.join(root, 'build191.js'), 'utf8'));
(0, eval)(fs.readFileSync(path.join(root, 'b171logic.js'), 'utf8'));
const P = globalThis.B.b191;

assert.deepStrictEqual(P.tabs({ episodes: 10, more: 5, trailers: 1 }), ['episodes', 'more', 'trailers']);
assert.deepStrictEqual(P.tabs({ episodes: 0, more: true, trailers: true }), ['more', 'trailers']);
assert.deepStrictEqual(P.tabs({}), []);
assert.deepStrictEqual(P.tabs(null), []);
assert.strictEqual(P.pick(['episodes', 'more'], 'more'), 'more');
assert.strictEqual(P.pick(['more'], 'episodes'), 'more');
assert.strictEqual(P.pick([], 'x'), null);
assert.strictEqual(P.showBar(['more']), false);
assert.strictEqual(P.showBar(['more', 'trailers']), true);
// Kijk je nog? telt af vanaf 30 seconden
assert.strictEqual(globalThis.B.b171.ANSWER_SECONDS, 30);
console.log('build191_test ok');
