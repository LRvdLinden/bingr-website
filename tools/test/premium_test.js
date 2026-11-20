// Build 181: Bingr Premium (docs/ACCOUNT.md van iptv-ios-appletv, "Build 181: Bingr Premium"). Site: assets/js/premium.js
// (prijsblok, prijzen en voordeel, wat de apps tonen op de gedeelde gevallen, groep client). Webspeler: web/js/premium.js.
// tools/test/build181_cases.json is een kopie van iptv-ios-appletv/docs/build181_cases.json (niet hier aanpassen).
// Draaien: node tools/test/premium_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '../..');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(ROOT, 'assets/js/premium.js'), 'utf8'));
const P = globalThis.BingrPremium;
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'build181_cases.json'), 'utf8'));
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// gedeelde gevallen: wat de apps tonen
for (const c of cases.client) eq(P.screen(c.entitlements, Date.parse(c.now), c.offline), c.expect, 'site client: ' + c.name);
const WEB = path.join(ROOT, 'web/js/premium.js');
if (fs.existsSync(WEB)) {
  global.B = globalThis.B || {};
  (0, eval)(fs.readFileSync(WEB, 'utf8'));
  for (const c of cases.client) eq(globalThis.B.premium.screen(c.entitlements, Date.parse(c.now), c.offline), c.expect, 'webspeler client: ' + c.name);
  const W = globalThis.B.premium;
  eq(W.normalize(null), null, 'webspeler: oudere server');
  const nv = W.normalize({ enabled: true, active: true, source: 'stripe', plan: 'year', status: 'trialing', expires_at: '2026-12-04T10:00:00Z',
    trial_until: '2026-12-04T10:00:00Z', will_renew: true, manage: 'stripe', prices: { month: 599 }, source_x: 1 });
  eq([nv.enabled, nv.source, nv.plan, nv.status, nv.manage, nv.prices.month, nv.prices.year], [true, 'stripe', 'year', 'trialing', 'stripe', 599, 2999], 'webspeler: normalize');
  eq(W.normalize({ source: 'hacker', plan: 'week', status: 'x', manage: 'paypal', expires_at: 'morgen' }), Object.assign(W.normalize({}), {}), 'webspeler: onbekende waarden weg');
  eq([W.isSubscription(nv), W.isSubscription({ active: true, source: 'legacy' }), W.savings(nv.prices, 'year')], [true, false, 58], 'webspeler: abonnement en voordeel');
  eq(W.upgradeUrl('half'), 'https://bingr.online/upgrade/?plan=half&from=app&platform=web', 'webspeler: upgrade-link');
}

// prijzen en voordeel
const pr = P.prices({ prices: cases.defaults.prices });
eq(pr, { month: 499, half: 1999, year: 2999, lifetime: 4999 }, 'prijzen');
eq(P.prices(null), pr, 'zonder config de standaard');
eq([P.savings(pr, 'month'), P.savings(pr, 'half'), P.savings(pr, 'year'), P.savings(pr, 'lifetime')], [0, 33, 50, 0], 'voordeel 33% en 50%');
eq([P.euro(2999, 'nl'), P.euro(2999, 'en'), P.euro(P.perMonth(pr, 'year'), 'nl'), P.euro(P.perMonth(pr, 'half'), 'en')], ['€ 29,99', '€29.99', '€ 2,50', '€3.33'], 'bedragen');
eq([P.cleanPeriod('half'), P.cleanPeriod('lifetime'), P.cleanPeriod('x')], ['half', 'year', 'year'], 'periode');

// parse
eq(P.parse({}), null, 'geen premium = null');
const p = P.parse({ premium: { enabled: true, show_prices_web: true, trial_days: 3, stripe_ready: true, prices: cases.defaults.prices } });
eq([p.enabled, p.show, p.trial_days, p.stripe_ready], [true, true, 3, true], 'parse');

// prijsblok
let h = P.pricing(p, 'nl', { period: 'year', mode: 'home', base: '' });
ok(h.includes('Meest gekozen · 50% voordeliger'), 'jaar uitgelicht');
ok(h.includes('3 dagen gratis') && h.includes('Probeer 3 dagen gratis'), 'proefbadge');
ok(h.includes('€ 29,99') && h.includes('€ 2,50 per maand') && h.includes('€ 49,99'), 'prijzen in het blok');
ok(h.includes('href="upgrade/?plan=year"') && h.includes('href="upgrade/?plan=lifetime"'), 'knoppen naar /upgrade/');
ok(h.includes('aria-checked="true"') && (h.match(/role="radio"/g) || []).length === 3, 'schakelaar met drie keuzes');
h = P.pricing(p, 'en', { period: 'month', mode: 'upgrade', trialDays: 0 });
ok(!h.includes('days free') && h.includes('data-plan="month"') && h.includes('Choose Premium') && !h.includes('pp-hl'), 'maand, geen proef, upgrade-knoppen');
h = P.pricing(p, 'nl', { period: 'half', mode: 'upgrade', disabled: true });
ok(h.includes('33% voordeliger') && h.includes('Binnenkort beschikbaar') && !h.includes('data-plan='), 'uitgeschakeld');
ok(!/<script/i.test(P.pricing(Object.assign({}, p, { prices: { month: '<script>' } }), 'nl', {})), 'geen HTML uit de config');
console.log(`premium_test: ${n} controles geslaagd`);
