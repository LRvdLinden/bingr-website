// Build 167: Bingr wordt alleen Lifetime (docs/ACCOUNT.md van iptv-ios-appletv, "Build 167: alleen Lifetime").
// Webspeler: access/lifetime_only in web/js/plan.js en de logica van web/js/lifetime.js (fases, code, ?code=, 403
// activation_required). Site: assets/js/lifetime.js (fases, prijs na korting, banner, teksten) en assets/js/plans.js
// (zonder opties precies de tabel van vóór build 167; "Gratis (tot …)"; alleen Lifetime).
// Draaien: node tools/test/lifetime_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '../..');
const WEB = path.join(ROOT, 'web/js');
const ls = new Map();
global.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i], get length() { return ls.size; } };
globalThis.document = { readyState: 'complete', hidden: false, visibilityState: 'visible', documentElement: { getAttribute: () => null }, addEventListener: () => {}, createElement: () => ({}) };
globalThis.addEventListener = () => {};
globalThis.setInterval = () => 0;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
const load = (f) => (0, eval)(fs.readFileSync(f, 'utf8'));
load(path.join(WEB, 'core.js'));
const B = globalThis.B;
B.lang = 'en';
let answer = null;
B.account = { isSignedIn: () => false, userId: () => 'u1',
  authed: () => Promise.resolve(answer ? { ok: true, status: 200, json: answer } : { ok: false, status: 0 }) };
load(path.join(WEB, 'plan.js'));
load(path.join(WEB, 'lifetime.js'));
const P = B.plan, LT = B.lifetime;
let n = 0;
const ok = (v, m) => { assert.ok(v, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const CUT = '2026-12-07T00:00:00+01:00';
const BEFORE = new Date('2026-11-20T12:00:00Z'), AFTER = new Date('2026-12-08T12:00:00Z');
function ent(plan, extra) {
  return Object.assign({ plan, limits: plan === 'free' ? { streams: 1, devices: 2, servers: 1 } : { streams: 3, devices: 15, servers: null },
    features: {}, upgrade: { url: 'https://bingr.online/upgrade/', link: true, price: '€ 4,99', price_en: '€4.99' } }, extra || {});
}
const LO = { enabled: true, announced: true, cutover_at: CUT, code: 'BINGR-7K2Q-9FXM', code_valid_until: CUT, discount_pct: 30, trial_until: null };

// MARK: webspeler, plan.normalize

let p = P.normalize(ent('free'));
eq(p.access, 'full', 'zonder access (oudere server) = full');
eq(p.lifetime_only, null, 'zonder lifetime_only = null');
eq(P.normalize(ent('free', { access: 'activate' })).access, 'activate', 'access activate blijft');
eq(P.normalize(ent('free', { access: 'iets' })).access, 'full', 'onbekende access = full');
eq(P.normalize(ent('free', { lifetime_only: { enabled: false, cutover_at: CUT } })).lifetime_only, null, 'enabled false = null');
p = P.normalize(ent('free', { lifetime_only: LO }));
eq(p.lifetime_only.code, 'BINGR-7K2Q-9FXM', 'code doorgegeven');
eq(p.lifetime_only.discount_pct, 30, 'korting');
eq(P.normalize(ent('free', { lifetime_only: Object.assign({}, LO, { code: 'x"><script>' }) })).lifetime_only.code, null, 'rare code geweigerd');
eq(P.normalize(ent('free', { lifetime_only: Object.assign({}, LO, { discount_pct: 250 }) })).lifetime_only.discount_pct, null, 'onzinnige korting geweigerd');
eq(P.normalize({ entitlements: ent('lifetime', { access: 'full' }) }).access, 'full', 'ook via {entitlements}');

// MARK: webspeler, B.lifetime.info

let i = LT.info(P.normalize(ent('free')), BEFORE);
eq([i.enabled, i.phase, i.activate, i.announce, i.code], [false, 'off', false, false, null], 'uit = niets');
i = LT.info(P.normalize(ent('free', { lifetime_only: LO })), BEFORE);
eq([i.phase, i.activate, i.announce, i.code], ['before', false, true, 'BINGR-7K2Q-9FXM'], 'Gratis vóór de overgang: aankondiging met code');
i = LT.info(P.normalize(ent('free', { lifetime_only: Object.assign({}, LO, { announced: false }) })), BEFORE);
eq([i.phase, i.announce], ['before', false], 'nog niet aangekondigd: geen kaart');
i = LT.info(P.normalize(ent('lifetime', { lifetime_only: Object.assign({}, LO, { code: null }) })), BEFORE);
eq([i.announce, i.code, i.activate], [false, null, false], 'Lifetime: geen aankondiging, geen code');
i = LT.info(P.normalize(ent('free', { access: 'activate', lifetime_only: LO })), AFTER);
eq([i.phase, i.activate, i.announce, i.code], ['after', true, false, null], 'na de overgang: activeren, code verlopen');
i = LT.info(P.normalize(ent('free', { access: 'activate', lifetime_only: Object.assign({}, LO, { code_valid_until: '2027-01-01T00:00:00Z' }) })), AFTER);
eq(i.code, 'BINGR-7K2Q-9FXM', 'code die nog geldig is blijft zichtbaar op het activeerscherm');
i = LT.info(P.normalize(ent('free', { access: 'full', lifetime_only: LO })), AFTER);
eq([i.activate, i.announce], [false, false], 'proefperiode (access full na de overgang): niets');

// ?code= in de upgrade-link
eq(LT.upgradeUrl(P.normalize(ent('free', { lifetime_only: LO })), BEFORE), 'https://bingr.online/upgrade/?code=BINGR-7K2Q-9FXM', '?code=');
eq(LT.upgradeUrl(P.normalize(ent('free', { lifetime_only: LO, upgrade: { url: 'https://bingr.online/upgrade/?from=app', link: true } })), BEFORE),
  'https://bingr.online/upgrade/?from=app&code=BINGR-7K2Q-9FXM', '&code= als er al een ? is');
eq(LT.upgradeUrl(P.normalize(ent('free')), BEFORE), 'https://bingr.online/upgrade/', 'zonder code de gewone link');

// "Gratis (tot …)" in de vergelijking
eq(LT.freeLabel(P.normalize(ent('free')), BEFORE), 'Free', 'uit: Gratis');
eq(LT.freeLabel(P.normalize(ent('free', { lifetime_only: LO })), BEFORE), 'Free (until 7 December 2026)', 'vóór de overgang: met datum (Amsterdam)');
eq(LT.freeLabel(P.normalize(ent('free', { lifetime_only: LO })), AFTER), 'Free', 'erna: zonder datum');

// 403 activation_required
ok(P.isActivationResponse({ status: 403, errorCode: 'activation_required', json: { error: 'activation_required', plan: 'free' } }), '403 activation_required');
ok(P.isActivationResponse({ status: 403, json: { error: 'activation_required' } }), 'ook alleen in json');
ok(!P.isActivationResponse({ status: 403, errorCode: 'stream_limit', json: { error: 'stream_limit' } }), 'stream_limit is iets anders');
ok(!P.isActivationResponse({ status: 400, json: { error: 'activation_required' } }), 'alleen bij 403');

// markActivation: onthouden en de event 'plan'
let events = 0, fetched = 0;
B.on('plan', () => { events++; });
P.fetch = () => { fetched++; return Promise.resolve(false); };
P.apply(ent('free', { lifetime_only: LO }));
const evBefore = events;
P.markActivation();
eq(P.get().access, 'activate', 'markActivation zet activate');
ok(events > evBefore && fetched === 1, 'event plan en opnieuw ophalen');
P.markActivation();
eq(fetched, 2, 'nogmaals: alleen ophalen');
P.apply(ent('free', { access: 'full', lifetime_only: LO }));
eq(P.get().access, 'full', 'volgende antwoord van de server gaat voor');
ok(P.apply(ent('free', { access: 'full', lifetime_only: Object.assign({}, LO, { announced: false }) })) && events > 0, 'andere lifetime_only = nieuw event');

// MARK: site, assets/js/lifetime.js

load(path.join(ROOT, 'assets/js/lifetime.js'));
const S = globalThis.BingrLifetime;
eq(S.parse(null), null, 'geen antwoord');
eq(S.parse({ enabled: true, price_cents: 499 }), null, 'billing config zonder lifetime_only (enabled = Stripe) = uit');
eq(S.parse({ enabled: true, lifetime_only: { enabled: false } }), null, 'lifetime_only enabled false = uit');
let lo = S.parse({ enabled: true, price_cents: 499, lifetime_only: Object.assign({}, LO, { code: ' bingr-7k2q-9fxm ' }) });
eq(lo.code, 'BINGR-7K2Q-9FXM', 'code in hoofdletters');
eq([S.phase(null, BEFORE), S.phase(lo, BEFORE), S.phase(lo, AFTER)], ['off', 'before', 'after'], 'fases');
eq(S.phase(Object.assign({}, lo, { announced: false }), BEFORE), 'off', 'niet aangekondigd: nog niets');
eq(S.phase(Object.assign({}, lo, { announced: false }), AFTER), 'after', 'na de overgang altijd alleen Lifetime');
eq(S.discounted(499, lo), 349, '30% van € 4,99: korting afgerond op 150 cent');
eq(S.discounted(499, Object.assign({}, lo, { discounted_price_cents: 350 })), 350, 'bedrag van de server gaat voor');
eq(S.discounted(499, Object.assign({}, lo, { discount_pct: null })), null, 'zonder korting geen bedrag');
eq([S.euro(349, 'nl'), S.euro(499, 'en')], ['€ 3,49', '€4.99'], 'bedragen');
eq([S.cleanCode('abc'), S.cleanCode('bingr 7k2q 9fxm'), S.cleanCode('<x>')], ['', 'BINGR7K2Q9FXM', ''], 'cleanCode');
ok(S.codeValid(lo, BEFORE) && !S.codeValid(lo, AFTER), 'code geldig tot code_valid_until');
eq(S.freeName(lo, 'nl', BEFORE), 'Gratis (tot 7 december 2026)', 'Gratis (tot …)');
eq(S.freeName(lo, 'nl', AFTER), null, 'na de overgang geen Gratis');
eq(S.freeName(null, 'nl', BEFORE), null, 'uit: standaardnaam');
ok(S.banner(lo, 'nl', { now: BEFORE }).indexOf('Bingr wordt Lifetime op 7 december 2026.') >= 0, 'banner NL');
ok(S.banner(lo, 'en', { now: BEFORE }).indexOf('Bingr is going Lifetime on 7 December 2026.') >= 0, 'banner EN');
eq([S.banner(lo, 'nl', { now: AFTER }), S.banner(null, 'nl', { now: BEFORE })], ['', ''], 'geen banner erna of als het uit staat');
eq(S.homeTexts(null, 'nl', BEFORE), {}, 'uit: homepage ongewijzigd');
eq(S.homeTexts(lo, 'nl', AFTER)['hero.signup'], 'Maak een account', 'na de overgang: geen "gratis account"');
eq(S.homeTexts(lo, 'en', AFTER)['hero.signup'], 'Create an account', 'EN');
ok(!/gratis account/i.test(Object.values(S.homeTexts(lo, 'nl', AFTER)).join(' ')), 'nergens meer "gratis account"');
ok(S.homeTexts(lo, 'nl', BEFORE)['plans.sub'] && !S.homeTexts(lo, 'nl', BEFORE)['hero.signup'], 'vóór de overgang alleen de ondertitel');
eq(S.termsDate('nl'), /^\d{4}-\d{2}-\d{2}$/.test(S.TERMS_DATE) ? S.termsDate('nl') : 'DATUM-D', 'DATUM-D zolang niet ingevuld');

// publieke billing config (zonder inloggen, AANVULLING 1): zonder `announced`, met after_cutover
lo = S.parse({ enabled: true, lifetime_only: { enabled: true, cutover_at: CUT, after_cutover: false, trial_days: 0 } });
eq([lo.announced, S.phase(lo, BEFORE)], [true, 'before'], 'publiek: enabled zonder announced = aangekondigd');
eq(S.phase(S.parse({ lifetime_only: { enabled: true, cutover_at: CUT, after_cutover: true } }), BEFORE), 'after', 'after_cutover van de server gaat voor');
eq(S.phase(S.parse({ lifetime_only: { enabled: true, cutover_at: CUT, announce_at: '2099-01-01T00:00:00Z' } }), BEFORE), 'off', 'announce_at in de toekomst: nog niets');

// webspeler: welkomstscherm na de overgang (publieke config)
ok(!LT.publicAfter(null) && !LT.publicAfter({ enabled: true }), 'zonder lifetime_only: welkomstscherm zoals nu');
ok(!LT.publicAfter({ lifetime_only: { enabled: false, after_cutover: true } }), 'enabled false: zoals nu');
ok(LT.publicAfter({ lifetime_only: { enabled: true, after_cutover: true } }), 'after_cutover: Koop Lifetime');
ok(!LT.publicAfter({ lifetime_only: { enabled: true, after_cutover: false, cutover_at: CUT } }, AFTER), 'server zegt nog niet: niet');
ok(LT.publicAfter({ lifetime_only: { enabled: true, cutover_at: CUT } }, AFTER) && !LT.publicAfter({ lifetime_only: { enabled: true, cutover_at: CUT } }, BEFORE), 'zonder after_cutover de klok');

// AANVULLING 2: zonder cutover_at van de server de vaste datum 1 december 2026
eq(S.parse({ lifetime_only: { enabled: true } }).cutover_at, '2026-12-01T00:00:00+01:00', 'site: terugval cutover_at');
eq(S.freeName(S.parse({ lifetime_only: { enabled: true, announced: true } }), 'nl', BEFORE), 'Gratis (tot 1 december 2026)', 'site: Gratis (tot 1 december 2026)');
eq(LT.info(P.normalize(ent('free', { lifetime_only: { enabled: true, announced: true } })), BEFORE).cutover.toISOString(), '2026-11-30T23:00:00.000Z', 'webspeler: terugval cutover_at');
eq(LT.freeLabel(P.normalize(ent('free', { lifetime_only: { enabled: true, announced: true } })), BEFORE), 'Free (until 1 December 2026)', 'webspeler: Free (until 1 December 2026)');
ok(LT.publicAfter({ lifetime_only: { enabled: true } }, AFTER) && !LT.publicAfter({ lifetime_only: { enabled: true } }, BEFORE), 'welkomstscherm: terugval op 1 december 2026');

// MARK: site, assets/js/plans.js

load(path.join(ROOT, 'assets/js/plans.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/<div id="plansTable">([\s\S]*?<\/div>)<\/div>/);
ok(m, 'statische tabel in index.html gevonden');
eq(globalThis.BingrPlans.table('nl', { base: '' }), m[1], 'zonder opties precies de tabel van vóór build 167 (NL in de HTML)');
eq(globalThis.BingrPlans.table('nl', { base: '', freeName: null, lifetimeOnly: false }), m[1], 'opties uit = hetzelfde');
let t = globalThis.BingrPlans.table('nl', { base: '', freeName: 'Gratis (tot 7 december 2026)' });
ok(t.indexOf('<span class="pl-name">Gratis (tot 7 december 2026)</span>') >= 0, 'Gratis (tot …) in de kop');
t = globalThis.BingrPlans.table('nl', { base: '', lifetimeOnly: true });
ok(t.indexOf('>Gratis<') < 0 && t.indexOf('koppelen/?mode=signup') < 0, 'alleen Lifetime: geen kolom Gratis en geen knop gratis account');
ok(t.indexOf('pl-only') >= 0 && t.indexOf('upgrade/') >= 0, 'alleen Lifetime: knop upgraden blijft');
eq((t.split('<tbody>')[1].split('</tbody>')[0].match(/<td>/g) || []).length, 0, 'geen cellen voor Gratis');

console.log('lifetime_test: ' + n + ' controles geslaagd');
