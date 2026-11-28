'use strict';
// Build 193: betaaltrechter (assets/js/funnel.js). Pure logica: de body voor billing {action:"funnel"}, foutcodes, de build
// uit assets/changelog.json en het platform uit de link; plus dat de pagina's en de webspeler hem laden en gebruiken.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const F = require(path.join(root, 'assets', 'js', 'funnel.js'));
const eq = (a, b, m) => assert.deepStrictEqual(a, b, m);

// body volgens het contract
eq(F.payload('paywall_shown', { platform: 'web', build: 193 }), { action: 'funnel', step: 'paywall_shown', platform: 'web', build: 193 });
eq(F.payload('purchase_started', { platform: 'windows', build: '193', product: 'year' }), { action: 'funnel', step: 'purchase_started', platform: 'windows', build: 193, product: 'year' });
eq(F.payload('purchase_failed', { platform: 'web', build: 193, product: 'lifetime', error: 'Stripe Error!' }),
  { action: 'funnel', step: 'purchase_failed', platform: 'web', build: 193, product: 'lifetime', error: 'stripe_error' });
eq(F.payload('purchase_failed', { build: 193 }).error, 'unknown', 'mislukt zonder code = unknown');
eq(F.payload('purchase_ok', { build: 193, product: 'week', error: 'x' }), { action: 'funnel', step: 'purchase_ok', platform: 'web', build: 193 }, 'onbekend product weg, error alleen bij mislukt');
eq(F.payload('purchase_cancelled', { platform: 'playstation', build: 193 }).platform, 'web', 'onbekend platform = web');
eq(F.payload('bought', { build: 193 }), null, 'onbekende stap');
eq(F.payload('paywall_shown', { build: null }), null, 'zonder build niets sturen');
eq(F.payload('paywall_shown', { build: 0 }), null);
eq(F.payload('paywall_shown', { build: 19.3 }), null);
// nooit vrije tekst, id's of adressen: alleen [a-z0-9_], hooguit 40 tekens
const long = F.code('Card declined for cs_test_a1B2c3 (jan@example.com) — try again later please');
assert.ok(/^[a-z0-9_]{1,40}$/.test(long), long);
eq(F.code(''), null); eq(F.code(null), null); eq(F.code('___'), null);
eq(F.code('plan_required'), 'plan_required');

// foutcodes van billing `checkout`
eq(F.errorCode(400, { error: 'plan_required' }), 'plan_required');
eq(F.errorCode(409, { error: 'already_premium' }), 'already_premium');
eq(F.errorCode(503, { error: 'billing_unavailable' }), 'billing_unavailable');
eq(F.errorCode(503, {}), 'checkout_unavailable');
eq(F.errorCode(502, null), 'checkout_unavailable');
eq(F.errorCode(429, {}), 'rate_limited');
eq(F.errorCode(500, {}), 'server_error');
eq(F.errorCode(200, { url: 'https://example.com/' }), 'bad_checkout_url', '200 zonder Stripe-link');
eq(F.errorCode(418, {}), 'http_418');
eq(F.errorCode(0, null, 'Failed to fetch'), 'network');
eq(F.errorCode(0, null, 'signed_out'), 'signed_out');

// build: nieuwste build met een punt voor de website (zoals de voet van de site)
eq(F.webBuild([{ build: 194, items: [{ platforms: ['ios'] }] }, { build: 193, items: [{ platforms: ['web', 'server'] }] }]), 193);
eq(F.webBuild([{ build: 194, items: [{ platforms: ['ios'] }] }]), 194, 'geen webpunt: de nieuwste');
eq(F.webBuild([]), null); eq(F.webBuild(null), null);
const cl = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'changelog.json'), 'utf8'));
assert.ok(F.webBuild(cl) >= 191, 'changelog.json geeft een build');

// platform van /upgrade/: de app die doorstuurde, anders web
const q = (s) => new URLSearchParams(s);
eq(F.platformFromQuery(q('plan=year&from=app&platform=windows')), 'windows');
eq(F.platformFromQuery(q('from=app&platform=android')), 'android');
eq(F.platformFromQuery(q('from=app&platform=browser')), 'web');
eq(F.platformFromQuery(q('from=app&platform=%3Cscript%3E')), 'web');
eq(F.platformFromQuery(q('platform=android')), 'web', 'zonder from=app telt de pagina zelf');
eq(F.platformFromQuery(q('')), 'web');

// versturen: één POST naar billing, zonder inlog, en nooit een fout naar buiten
(async () => {
  const calls = [];
  const win = { BINGR_SUPABASE: { url: 'https://x.example', anonKey: 'k' }, location: { href: 'https://bingr.online/upgrade/' },
    document: { currentScript: { src: 'https://bingr.online/assets/js/funnel.js?v=193' } },
    setTimeout, sessionStorage: { m: {}, getItem(k) { return this.m[k] || null; }, setItem(k, v) { this.m[k] = v; }, removeItem(k) { delete this.m[k]; } },
    fetch(url, o) {
      calls.push([url, o]);
      if (/changelog\.json$/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ build: 193, items: [{ platforms: ['web'] }] }]) });
      return Promise.reject(new Error('offline'));
    } };
  const src = fs.readFileSync(path.join(root, 'assets', 'js', 'funnel.js'), 'utf8');
  new Function('window', 'globalThis', 'module', src)(win, win, undefined);
  const W = win.BingrFunnel;
  W.once('paywall', 'paywall_shown', { platform: 'web' });
  W.once('paywall', 'paywall_shown', { platform: 'web' });
  W.remember({ platform: 'windows', product: 'half' });
  eq(W.recall(true), { platform: 'windows', product: 'half' });
  eq(W.recall(), { platform: 'windows', product: 'half' });
  eq(W.recall(), null, 'na het uitlezen weg');
  W.send('purchase_failed', { platform: 'web', product: 'year', error: 'stripe_error' });
  W.send('nope', {});
  await new Promise((r) => setTimeout(r, 20));
  const posts = calls.filter((c) => c[1] && c[1].method === 'POST');
  eq(calls[0][0], 'https://bingr.online/assets/changelog.json', 'build uit assets/changelog.json');
  eq(posts.length, 2, 'paywall één keer + mislukt; onbekende stap niet');
  eq(posts[0][0], 'https://x.example/functions/v1/billing');
  eq(JSON.parse(posts[0][1].body), { action: 'funnel', step: 'paywall_shown', platform: 'web', build: 193 });
  eq(JSON.parse(posts[1][1].body), { action: 'funnel', step: 'purchase_failed', platform: 'web', build: 193, product: 'year', error: 'stripe_error' });
  assert.strictEqual(posts[0][1].keepalive, true);
  assert.ok(!('Authorization' in posts[0][1].headers), 'zonder inlog');
  // zonder config of fetch: niets doen, geen fout
  const bare = { location: { href: 'https://bingr.online/' }, setTimeout };
  new Function('window', 'globalThis', 'module', src)(bare, bare, undefined);
  bare.BingrFunnel.send('paywall_shown', {});

  // de pagina's en de webspeler laden en gebruiken hem
  const up = fs.readFileSync(path.join(root, 'upgrade', 'index.html'), 'utf8');
  const klaar = fs.readFileSync(path.join(root, 'upgrade', 'klaar', 'index.html'), 'utf8');
  const web = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const lt = fs.readFileSync(path.join(root, 'web', 'js', 'lifetime.js'), 'utf8');
  for (const [name, html] of [['upgrade', up], ['klaar', klaar], ['web', web]]) assert.ok(/assets\/js\/funnel\.js\?v=193/.test(html), name + ' laadt funnel.js');
  assert.ok(web.indexOf('funnel.js') < web.indexOf('js/premium.js'), 'webspeler: funnel.js vóór premium.js');
  for (const s of ['funnelPaywall()', 'funnelStart(b.dataset.plan)', 'funnelStart("lifetime")', 'funnelBack("purchase_ok")', 'funnelBack("purchase_cancelled")', 'funnelFail(']) assert.ok(up.includes(s), 'upgrade: ' + s);
  assert.ok(klaar.includes('"purchase_ok"'), 'klaar: purchase_ok');
  assert.ok(lt.includes("'paywall_shown'"), 'webspeler: paywall_shown');
  // de build staat nergens vast in de aanroepen
  for (const [name, t] of [['upgrade', up], ['klaar', klaar], ['lifetime.js', lt]]) assert.ok(!/build:\s*19\d/.test(t), name + ': geen vast buildnummer');
  console.log('build193_test ok');
})().catch((e) => { console.error(e); process.exit(1); });
