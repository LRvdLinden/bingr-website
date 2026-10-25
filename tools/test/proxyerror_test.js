// Build 151c (spoedfix http_502): foutcodes van web-proxy (JSON {error}, zonder X-Upstream-Status) en van de server van de
// gebruiker (X-Upstream-Status) worden een leesbare melding in plaats van een kale http_502. Draaien: node tools/test/proxyerror_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const WEB = path.join(__dirname, '../../web/js');
global.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };
globalThis.document = { readyState: 'complete', hidden: false, documentElement: { getAttribute: () => null, dir: 'ltr' }, addEventListener: () => {}, createElement: () => ({}) };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
const load = (f) => (0, eval)(fs.readFileSync(path.join(WEB, f), 'utf8'));
load('core.js'); load('strings-b151.js');
const B = globalThis.B;
B.config = B.config || {}; B.config.supabaseUrl = 'https://x.supabase.co'; B.config.supabaseKey = 'k';
B.account = { validAccessToken: () => Promise.resolve('jwt') };

function fakeFetch(status, body, headers) {
  globalThis.fetch = () => Promise.resolve({ status, headers: new Headers(headers || {}), text: () => Promise.resolve(body), arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer) });
}
(async () => {
  // fout van de proxy zelf: proxy_<code>
  fakeFetch(502, '{"error":"tls_failed"}', { 'content-type': 'application/json' });
  let e = await B.getJSON('http://tv.example:8080/player_api.php?username=u&password=p').catch((x) => x);
  assert.strictEqual(e.message, 'proxy_tls_failed'); assert.strictEqual(e.upstream, null);
  fakeFetch(504, '{"error":"timeout"}');
  e = await B.getJSONPicked('http://tv.example:8080/player_api.php?action=get_vod_streams', null, 1000, { fields: ['stream_id'] }).catch((x) => x);
  assert.strictEqual(e.message, 'proxy_timeout');
  // fout van de server van de gebruiker (X-Upstream-Status): http_<status>, met upstream
  fakeFetch(502, '<html>bad gateway</html>', { 'x-upstream-status': '502' });
  e = await B.getJSON('http://tv.example:8080/player_api.php').catch((x) => x);
  assert.strictEqual(e.message, 'http_502'); assert.strictEqual(e.upstream, 502);
  // groot antwoord met noJSON: tekst komt ongeparst door
  const big = '[' + Array.from({ length: 20000 }, (_, i) => `{"stream_id":${i}}`).join(',') + ']';
  fakeFetch(200, big, { 'x-upstream-status': '200' });
  const r = await B.http('http://tv.example:8080/player_api.php?action=get_vod_streams', { noJSON: true });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json, null); assert.strictEqual(r.text.length, big.length);
  // leesbare meldingen (Nederlands), nooit de kale code
  B.lang = 'nl';
  const msg = (m) => B.netMessage({ message: m });
  assert.strictEqual(msg('proxy_timeout'), 'De server reageert niet (time-out).');
  assert.strictEqual(msg('proxy_too_large'), 'Het antwoord van de server is te groot (meer dan 200 MB).');
  assert.ok(/datacenters/.test(msg('proxy_connect_refused')));
  assert.ok(/certificaat/.test(msg('proxy_tls_failed')));
  assert.strictEqual(msg('http_502'), 'Je server gaf een fout (502). Probeer het later opnieuw.');
  assert.ok(/gebruikersnaam/.test(msg('http_401')));
  assert.ok(/gebruikslimiet/.test(msg('proxy_quota_exceeded')));
  for (const c of ['dns_failed', 'connect_reset', 'connect_failed', 'connect_timeout', 'tls_timeout', 'no_response', 'bad_response', 'upstream_failed', 'host_not_allowed', 'path_not_allowed'])
    assert.ok(!/proxy_|http_/.test(msg('proxy_' + c)) && msg('proxy_' + c).length > 10, c);
  assert.strictEqual(msg('Een eigen melding.'), 'Een eigen melding.');
  console.log('proxyerror_test: ok');
})().catch((err) => { console.error(err); process.exit(1); });
