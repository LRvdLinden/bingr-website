/*
 * Bingr web, build 146: pincode van een profiel als hash (`pinHash`), contract docs/ACCOUNT.md van iptv-ios-appletv,
 * "Build 146" → "Pincode als hash"; referentie supabase/functions/_shared/pin.ts (zelfde testvectoren in
 * tools/test/pin_test.js).
 *
 * {"alg":"pbkdf2-sha256","iter":100000,"salt":"<base64, 16 bytes>","hash":"<base64, 32 bytes>"}
 * - PBKDF2-HMAC-SHA256 met WebCrypto (crypto.subtle); zonder veilige context de pure-JavaScript-versie pbkdf2Js
 *   (gekopieerd uit pin.ts, zelfde uitkomst).
 * - Controleren = opnieuw afleiden en in vaste tijd vergelijken. Lezen: iter 10.000 t/m 2.000.000; schrijven: 100.000.
 * - Pincode-limiet (build 141, zoals de apps): na 5 foute pogingen op rij een oplopende wachttijd (30 s, 1 min, 5 min,
 *   15 min, 1 uur), voor alle pincodes samen, per browser bewaard (bingr.web.pinLockout).
 * Lokaal staat alleen de hash, nooit de pincode zelf.
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var PIN = B.pin = {};

  var ALG = PIN.ALG = 'pbkdf2-sha256';
  var ITER = PIN.ITER = 100000;
  var SALT_BYTES = 16, HASH_BYTES = 32, ITER_MIN = 10000, ITER_MAX = 2000000;

  PIN.valid = function (pin) { return typeof pin === 'string' && /^[0-9]{4,8}$/.test(pin); };

  function b64encode(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64decode(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null;
    try {
      var raw = atob(s), out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }
  PIN.b64encode = b64encode; PIN.b64decode = b64decode;

  /** Geldig pinHash-object, anders null. Onbekende extra velden worden genegeerd. */
  PIN.parse = function (v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (v.alg !== ALG) return null;
    var iter = Number(v.iter);
    if (!isFinite(iter) || Math.floor(iter) !== iter || iter < ITER_MIN || iter > ITER_MAX) return null;
    var salt = b64decode(String(v.salt == null ? '' : v.salt)), hash = b64decode(String(v.hash == null ? '' : v.hash));
    if (!salt || salt.length < 8 || salt.length > 64 || !hash || hash.length !== HASH_BYTES) return null;
    return { alg: ALG, iter: iter, salt: String(v.salt), hash: String(v.hash) };
  };

  function utf8(s) {
    if (root.TextEncoder) return new root.TextEncoder().encode(s);
    var u = unescape(encodeURIComponent(s)), out = new Uint8Array(u.length);
    for (var i = 0; i < u.length; i++) out[i] = u.charCodeAt(i);
    return out;
  }
  function subtle() {
    try { var c = root.crypto; return c && c.subtle && typeof c.subtle.deriveBits === 'function' ? c.subtle : null; } catch (e) { return null; }
  }

  // MARK: pure JavaScript (zonder crypto.subtle), uit supabase/functions/_shared/pin.ts

  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  var IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var W = new Uint32Array(64);
  function fromArr(a) { var u = new Uint32Array(a.length); for (var i = 0; i < a.length; i++) u[i] = a[i]; return u; }
  function compress(state, m) {
    var i;
    for (i = 0; i < 16; i++) W[i] = m[i];
    for (i = 16; i < 64; i++) {
      var x = W[i - 15], y = W[i - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    var a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
    for (i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    state[0] += a; state[1] += b; state[2] += c; state[3] += d; state[4] += e; state[5] += f; state[6] += g; state[7] += h;
  }
  function words(bytes) {
    var w = new Uint32Array(Math.ceil(bytes.length / 4));
    for (var i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
    return w;
  }
  function sha256Js(msg, state0, prefixLen) {
    prefixLen = prefixLen || 0;
    var st = fromArr(state0 || IV);
    var total = prefixLen + msg.length;
    var padLen = ((msg.length + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(padLen);
    buf.set(msg); buf[msg.length] = 0x80;
    var bits = total * 8;
    buf[padLen - 4] = (bits >>> 24) & 255; buf[padLen - 3] = (bits >>> 16) & 255; buf[padLen - 2] = (bits >>> 8) & 255; buf[padLen - 1] = bits & 255;
    buf[padLen - 5] = Math.floor(bits / 4294967296) & 255;
    var w = words(buf);
    for (var i = 0; i < w.length; i += 16) compress(st, w.subarray(i, i + 16));
    return st;
  }
  /**
   * PBKDF2-HMAC-SHA256 in pure JavaScript als stappenteller (build 147): run(n) doet hooguit n iteraties en geeft true
   * als hij klaar is; result() geeft de bytes. Zo kan het ook in stukjes op de hoofdthread (zonder Worker).
   */
  function pbkdf2State(pin, salt, iter, dkLen) {
    dkLen = dkLen || HASH_BYTES;
    if (dkLen > 32) throw new Error('dkLen > 32');
    var key = utf8(pin), i;
    if (key.length > 64) {
      var hk = sha256Js(key), kb = new Uint8Array(32);
      for (i = 0; i < 32; i++) kb[i] = (hk[i >> 2] >>> (24 - (i & 3) * 8)) & 255;
      key = kb;
    }
    var ipad = new Uint8Array(64), opad = new Uint8Array(64);
    for (i = 0; i < 64; i++) { ipad[i] = 0x36; opad[i] = 0x5c; }
    for (i = 0; i < key.length; i++) { ipad[i] ^= key[i]; opad[i] ^= key[i]; }
    var inner = fromArr(IV), outer = fromArr(IV);
    compress(inner, words(ipad)); compress(outer, words(opad));
    var first = new Uint8Array(salt.length + 4); first.set(salt); first[salt.length + 3] = 1;
    var ih = sha256Js(first, inner, 64);
    var blk = new Uint32Array(16); blk[8] = 0x80000000; blk[15] = 768;
    var st = new Uint32Array(8);
    function hmac32(msg, out) {
      for (var j = 0; j < 8; j++) blk[j] = msg[j];
      st.set(inner); compress(st, blk);
      for (j = 0; j < 8; j++) blk[j] = st[j];
      out.set(outer); compress(out, blk);
    }
    var u = new Uint32Array(8), t = new Uint32Array(8);
    for (i = 0; i < 8; i++) blk[i] = ih[i];
    u.set(outer); compress(u, blk);
    t.set(u);
    var n = 1;
    return {
      run: function (max) {
        var stop = Math.min(iter, n + max);
        for (; n < stop; n++) { hmac32(u, u); for (var k = 0; k < 8; k++) t[k] ^= u[k]; }
        return n >= iter;
      },
      result: function () {
        var out = new Uint8Array(dkLen);
        for (var k = 0; k < dkLen; k++) out[k] = (t[k >> 2] >>> (24 - (k & 3) * 8)) & 255;
        return out;
      }
    };
  }
  /** PBKDF2-HMAC-SHA256 in pure JavaScript; dkLen max. 32. */
  PIN.pbkdf2Js = function (pin, salt, iter, dkLen) {
    var s = pbkdf2State(pin, salt, iter, dkLen);
    s.run(iter);
    return s.result();
  };
  /** In stukjes van ~2000 iteraties (~10–30 ms), elk in een eigen macrotaak: de hoofdthread blijft vrij. */
  PIN.pbkdf2JsChunked = function (pin, salt, iter, dkLen) {
    return new Promise(function (resolve, reject) {
      var s;
      try { s = pbkdf2State(pin, salt, iter, dkLen); } catch (e) { reject(e); return; }
      (function step() {
        try { if (s.run(2000)) { resolve(s.result()); return; } } catch (e) { reject(e); return; }
        setTimeout(step, 0);
      })();
    });
  };

  // build 147: zonder crypto.subtle (geen veilige context, oude webview) rekent een Web Worker (js/pin-worker.js, zelfde
  // code; CSP worker-src 'self'); lukt dat niet, dan in stukjes op de hoofdthread. Nooit meer 100.000 iteraties in één keer.
  var worker = null, workerBroken = false, wSeq = 0, wWait = {};
  function viaWorker(pin, salt, iter) {
    if (workerBroken || typeof root.Worker !== 'function' || typeof root.document === 'undefined') return null;
    try {
      if (!worker) {
        worker = new root.Worker('js/pin-worker.js?v=149');
        worker.onmessage = function (e) {
          var d = e.data || {}, w = wWait[d.id];
          if (!w) return;
          delete wWait[d.id];
          if (d.ok) w.resolve(new Uint8Array(d.out)); else w.fallback();
        };
        worker.onerror = function () {
          workerBroken = true;
          Object.keys(wWait).forEach(function (k) { var w = wWait[k]; delete wWait[k]; w.fallback(); });
        };
      }
    } catch (e) { workerBroken = true; return null; }
    return new Promise(function (resolve) {
      var id = ++wSeq;
      var fallback = function () { resolve(PIN.pbkdf2JsChunked(pin, salt, iter, HASH_BYTES)); };
      wWait[id] = { resolve: resolve, fallback: fallback };
      try { worker.postMessage({ id: id, pin: pin, salt: Array.prototype.slice.call(salt), iter: iter }); } catch (e) { delete wWait[id]; fallback(); }
    });
  }
  function deriveJs(pin, salt, iter) {
    var tid = B.task ? B.task.begin('pin_check') : 0;
    var p = viaWorker(pin, salt, iter) || PIN.pbkdf2JsChunked(pin, salt, iter, HASH_BYTES);
    p.then(function () { if (tid) B.task.end(tid); }, function () { if (tid) B.task.end(tid); });
    return p;
  }
  PIN._deriveJs = deriveJs;

  /** PBKDF2 met WebCrypto, anders pbkdf2Js. Geeft een Promise met de bytes. */
  PIN.derive = function (pin, salt, iter) {
    var s = subtle();
    if (!s) return deriveJs(pin, salt, iter);
    return s.importKey('raw', utf8(pin), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: iter }, key, HASH_BYTES * 8);
    }).then(function (bits) { return new Uint8Array(bits); }, function () { return deriveJs(pin, salt, iter); });
  };

  function randomSalt() {
    var b = new Uint8Array(SALT_BYTES);
    (root.crypto || root.msCrypto).getRandomValues(b);
    return b;
  }
  /** Nieuwe hash (nieuwe salt, tenzij meegegeven voor een test). */
  PIN.make = function (pin, salt) {
    if (!PIN.valid(pin)) return Promise.reject(new Error('bad_pin'));
    var s = salt || randomSalt();
    return PIN.derive(pin, s, ITER).then(function (h) { return { alg: ALG, iter: ITER, salt: b64encode(s), hash: b64encode(h) }; });
  };
  /** Klopt de pincode bij deze hash? Vaste-tijdvergelijking; ongeldig object = false. */
  PIN.verify = function (pin, h) {
    var p = PIN.parse(h);
    if (!p || !PIN.valid(pin)) return Promise.resolve(false);
    var want = b64decode(p.hash);
    return PIN.derive(pin, b64decode(p.salt), p.iter).then(function (got) {
      var d = got.length ^ want.length;
      for (var i = 0; i < Math.min(got.length, want.length); i++) d |= got[i] ^ want[i];
      return d === 0;
    });
  };

  // MARK: pincode-limiet (build 141, gelijk aan Build141Logic.PinLockout en tizen/js/build141.js)

  var FREE = 5, WAITS = [30000, 60000, 300000, 900000, 3600000];
  var lockout = PIN.lockout = {
    waitAfter: function (f) { return f < FREE ? 0 : WAITS[Math.min(f - FREE, WAITS.length - 1)]; },
    remaining: function (s, now) {
      s = s || {};
      var w = lockout.waitAfter(s.f || 0);
      if (!w) return 0;
      var t = s.t || 0;
      if (now < t) return w; // klok teruggezet: de hele wachttijd opnieuw
      return Math.max(0, t + w - now);
    },
    failed: function (s, now) { return { f: ((s && s.f) || 0) + 1, t: now }; },
    shortText: function (ms) {
      var s = Math.floor((ms + 999) / 1000);
      if (s < 60) return s + ' s';
      if (s < 3600) return Math.floor((s + 59) / 60) + ' min';
      return Math.floor((s + 3599) / 3600) + ' h';
    }
  };
  var monoUntil = 0;
  function nowMono() { try { return root.performance && performance.now ? performance.now() : Date.now(); } catch (e) { return Date.now(); } }
  function stored() { return B.store ? B.store.get('pinLockout', null) : null; }
  PIN.remaining = function () { return Math.max(lockout.remaining(stored(), Date.now()), Math.max(0, monoUntil - nowMono())); };
  PIN.failed = function () {
    var s = lockout.failed(stored(), Date.now());
    if (B.store) B.store.set('pinLockout', s);
    var w = lockout.waitAfter(s.f);
    monoUntil = w ? nowMono() + w : 0;
  };
  PIN.succeeded = function () { if (B.store) B.store.del('pinLockout'); monoUntil = 0; };
})(typeof window !== 'undefined' ? window : globalThis);
