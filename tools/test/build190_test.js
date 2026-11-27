'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'js', 'build190.js'), 'utf8'));
const P = globalThis.B.b190;

assert.deepStrictEqual(P.numberDuplicates(['Polish', 'Polish', 'English']), ['Polish', 'Polish (2)', 'English']);
assert.deepStrictEqual(P.numberDuplicates(['A', 'a', 'A']), ['A', 'a (2)', 'A (3)']);
assert.deepStrictEqual(P.numberDuplicates([]), []);
assert.deepStrictEqual(P.numberDuplicates(null), []);
assert.deepStrictEqual(P.numberDuplicates(['x', 'y']), ['x', 'y']);
console.log('build190_test ok');
