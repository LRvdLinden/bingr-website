/*
 * Bingr web, build 147: PBKDF2 voor de pincode buiten de hoofdthread, alleen als crypto.subtle ontbreekt (geen veilige
 * context of een oude webview). Zelfde code als pin.js (pbkdf2Js, testvectoren in tools/test/pin_test.js).
 * Bericht in: {id, pin, salt: [bytes], iter}; uit: {id, ok, out: ArrayBuffer (32 bytes)}. Er gaat niets anders mee.
 */
/* global importScripts */
self.B = self.B || {};
importScripts('pin.js?v=149');
self.onmessage = function (e) {
  var d = e.data || {};
  try {
    var out = self.B.pin.pbkdf2Js(String(d.pin || ''), new Uint8Array(d.salt || []), d.iter | 0, 32);
    self.postMessage({ id: d.id, ok: true, out: out.buffer }, [out.buffer]);
  } catch (x) {
    self.postMessage({ id: d.id, ok: false });
  }
};
