// Build 146: test van web/js/pin.js met de testvectoren uit docs/ACCOUNT.md van iptv-ios-appletv ("Pincode als hash").
// Draaien: node tools/test/pin_test.js (WebCrypto van Node én de pure-JavaScript-terugval).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
const mem = {};
globalThis.B = { store: { get: (k, d) => (k in mem ? mem[k] : (d === undefined ? null : d)), set: (k, v) => { mem[k] = v; }, del: (k) => { delete mem[k]; } } };
eval(fs.readFileSync(path.join(__dirname, '../../web/js/pin.js'), 'utf8'));
const P = globalThis.B.pin;
const V = [
  ['1234', 'AAECAwQFBgcICQoLDA0ODw==', 'hp5sg1DFvrCsw5n7qsO2DSIEM4lrJqZHc00NjxWG4fo='],
  ['0000', 'QmluZ3ItcGluLXRlc3QtMQ==', '+fGTeA7fJpt28Rrq3DjQxUFemZFqDW4eAb85/ZRYHg8='],
  ['98765432', '//79/Pv6+fj39vX08/Lx8A==', 'ZPbmm6a1FOjvmJWC0XNDHIDHyxK4739iaGZkx4Oid7c='],
];
(async () => {
  let n = 0;
  for (const [pin, salt, hash] of V) {
    const s = P.b64decode(salt);
    assert.strictEqual(P.b64encode(P.pbkdf2Js(pin, s, 100000)), hash, 'pbkdf2Js ' + pin);
    const h = await P.make(pin, s);
    assert.deepStrictEqual(h, { alg: 'pbkdf2-sha256', iter: 100000, salt, hash }, 'make ' + pin);
    assert.ok(await P.verify(pin, h), 'verify ' + pin); n += 3;
  }
  const first = { alg: 'pbkdf2-sha256', iter: 100000, salt: V[0][1], hash: V[0][2] };
  assert.strictEqual(P.b64encode(P.pbkdf2Js('1234', P.b64decode(V[0][1]), 1)), 'i/F57D1qcIBBiv5AzlKB8LqqXqCNwubIJuZH8P6K1uI=');
  assert.strictEqual(P.b64encode(P.pbkdf2Js('1234', P.b64decode(V[0][1]), 2)), 'oNCs4eO5peWpZXM8MGUdRebd/Uv8TI0RC7CQ7Ngh0N4=');
  assert.strictEqual(await P.verify('1235', first), false);
  assert.strictEqual(await P.verify('01234', first), false);
  assert.strictEqual(P.parse({ ...first, alg: 'x' }), null);
  assert.strictEqual(P.parse({ ...first, iter: 9999 }), null);
  assert.strictEqual(await P.verify('1234', { ...first, iter: 5 }), false);
  // terugval zonder crypto.subtle
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: (b) => real.getRandomValues(b) }, configurable: true });
  assert.ok(await P.verify('0000', { alg: 'pbkdf2-sha256', iter: 100000, salt: V[1][1], hash: V[1][2] }), 'verify zonder subtle');
  const fresh = await P.make('4321');
  assert.ok(await P.verify('4321', fresh) && fresh.salt !== V[0][1]);
  Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
  // pincode-limiet
  const L = P.lockout;
  assert.deepStrictEqual([4, 5, 6, 9, 20].map(L.waitAfter), [0, 30000, 60000, 3600000, 3600000]);
  assert.strictEqual(L.remaining({ f: 5, t: 1000 }, 500), 30000);
  assert.strictEqual(L.remaining({ f: 5, t: 1000 }, 11000), 20000);
  for (let i = 0; i < 5; i++) P.failed();
  assert.ok(P.remaining() > 29000);
  P.succeeded(); assert.strictEqual(P.remaining(), 0);
  console.log('pin_test: alles goed (' + (n + 12) + ' controles)');
})().catch((e) => { console.error(e); process.exit(1); });
