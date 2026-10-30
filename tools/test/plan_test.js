// Build 157: abonnement in de webspeler (web/js/plan.js) volgens docs/ACCOUNT.md van iptv-ios-appletv
// ("Build 157: Gratis en Lifetime aangepast"): de nieuwe feature-vlaggen continue_watching, kids_profiles en opensubtitles
// (Gratis uit, Lifetime aan, een oude server zonder vlag = uit), Gratis 2 apparaten in de vergelijking, en een bestaand
// kinderprofiel dat bij Gratis een kinderprofiel blijft (en gefilterd blijft). Draaien: node tools/test/plan_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const WEB = path.join(__dirname, '../../web/js');
const ls = new Map();
global.window = globalThis;
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i], get length() { return ls.size; } };
globalThis.document = { readyState: 'complete', hidden: false, visibilityState: 'visible', documentElement: { getAttribute: () => null }, addEventListener: () => {}, createElement: () => ({}) };
globalThis.addEventListener = () => {};
globalThis.setInterval = () => 0;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
const load = (f) => (0, eval)(fs.readFileSync(path.join(WEB, f), 'utf8'));
load('core.js');
const B = globalThis.B;
B.L = (k) => k;
let uid = 'u1';
let answer = null;
B.account = { isSignedIn: () => true, userId: () => uid, getState: () => Promise.resolve({}), putState: () => Promise.resolve(B.iso()), readProfiles: () => Promise.resolve([]),
  authed: () => Promise.resolve(answer ? { ok: true, status: 200, json: answer } : { ok: false, status: 0 }) };
B.pin = { parse: () => null, valid: () => false, make: () => Promise.resolve(null) };
load('plan.js');
load('syncmerge.js');
load('sync.js');
const P = B.plan, D = B.data;
const NEW = ['continue_watching', 'kids_profiles', 'opensubtitles'];
let n = 0;
const ok = (v, m) => { assert.ok(v, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

function ent(plan, features, extra) {
  return Object.assign({ plan, limits: plan === 'free' ? { streams: 1, devices: 2, servers: 1 } : { streams: 3, devices: 15, servers: null },
    features, upgrade: { url: 'https://bingr.online/upgrade/', link: true, price: '€ 4,99', price_en: '€4.99' } }, extra || {});
}
const OLD_FREE = { stats: false, now_watching: false, trakt: false, multi_server: false, themes: false };
const OLD_LIFE = { stats: true, now_watching: true, trakt: true, multi_server: true, themes: true };
const PLANS = { free: { streams: 1, devices: 2, servers: 1 }, lifetime: { streams: 3, devices: 15, servers: null } };

// 1. niets bekend (geen antwoord, netwerkfout): Lifetime aangenomen, niemand raakt iets kwijt
ok(!P.isKnown() && !P.isFree(), 'zonder antwoord: aangenomen Lifetime');
NEW.forEach((k) => ok(P.has(k), 'zonder antwoord ' + k + ' aan'));

// 2. Gratis (nieuwe server): de drie nieuwe onderdelen op slot, 2 apparaten
ok(P.apply(ent('free', Object.assign({}, OLD_FREE, { continue_watching: false, kids_profiles: false, opensubtitles: false }), { plans: PLANS })), 'Gratis toegepast');
ok(P.isFree() && P.isKnown(), 'Gratis bekend');
NEW.forEach((k) => ok(!P.has(k), 'Gratis: ' + k + ' op slot'));
eq(P.limit('devices'), 2, 'Gratis: 2 apparaten');
eq(P.plans().free, { streams: 1, devices: 2, servers: 1 }, 'vergelijking Gratis 1/2/1');
eq(P.plans().lifetime, { streams: 3, devices: 15, servers: null }, 'vergelijking Lifetime 3/15/onbeperkt');

// 3. Lifetime (nieuwe server): alles aan
ok(P.apply(ent('lifetime', Object.assign({}, OLD_LIFE, { continue_watching: true, kids_profiles: true, opensubtitles: true }), { plans: PLANS })), 'Lifetime toegepast');
NEW.concat(Object.keys(OLD_LIFE)).forEach((k) => ok(P.has(k), 'Lifetime: ' + k + ' aan'));

// 4. oude server zonder de nieuwe vlaggen (en zonder plans) = Gratis voor die onderdelen, ook bij Lifetime
ok(P.apply(ent('lifetime', OLD_LIFE)), 'oude server Lifetime');
NEW.forEach((k) => ok(!P.has(k), 'oude server Lifetime: ' + k + ' uit'));
ok(P.has('stats') && P.has('themes'), 'oude server Lifetime: oude onderdelen volgen het abonnement');
eq(P.plans().free, { streams: 1, devices: 2, servers: 1 }, 'zonder plans: Gratis 1/2/1');
eq(P.plans().lifetime, { streams: 3, devices: 15, servers: null }, 'zonder plans: Lifetime 3/15/onbeperkt');
ok(P.apply(ent('free', OLD_FREE)), 'oude server Gratis');
NEW.forEach((k) => ok(!P.has(k), 'oude server Gratis: ' + k + ' uit'));
// een vlag als tekst/getal
ok(P.apply(ent('free', Object.assign({}, OLD_FREE, { continue_watching: 'true', kids_profiles: 1, opensubtitles: 'false' }))), 'vlaggen als tekst');
ok(P.has('continue_watching') && P.has('kids_profiles') && !P.has('opensubtitles'), 'vlaggen als tekst gelezen');

// 5. cache van vóór build 157 (zonder v): de nieuwe sleutels volgen het abonnement tot het volgende antwoord
uid = 'u2';
B.store.set('plan.u2', { plan: 'lifetime', limits: { streams: 3, devices: 15, servers: null }, features: OLD_LIFE, upgrade: { url: 'https://bingr.online/upgrade/', link: true, price: '€ 4,99', price_en: '€4.99' }, at: 1 });
NEW.forEach((k) => ok(P.has(k), 'oude cache Lifetime: ' + k + ' aan'));
uid = 'u3';
B.store.set('plan.u3', { plan: 'free', limits: { streams: 1, devices: 8, servers: 1 }, features: OLD_FREE, upgrade: {}, at: 1 });
NEW.forEach((k) => ok(!P.has(k), 'oude cache Gratis: ' + k + ' uit'));
eq(P.plans().free.devices, 2, 'oude cache: vergelijking Gratis 2 apparaten');
// een nieuwe cache (met v) houdt een ontbrekende vlag uit
uid = 'u1';
B.store.del('plan.u1');
ok(P.apply(ent('lifetime', OLD_LIFE)), 'Lifetime zonder vlaggen');
uid = 'u4'; P.get(); uid = 'u1';
ok(B.store.get('plan.u1').v >= 157, 'cache met versie');
ok(!P.has('continue_watching'), 'nieuwe cache: ontbrekende vlag blijft uit');

// 6. feature_locked zonder abonnement: alles op slot (ook de nieuwe)
uid = 'u5';
P.markLocked('continue_watching');
ok(P.isFree(), 'markLocked: Gratis');
NEW.forEach((k) => ok(!P.has(k), 'markLocked: ' + k + ' uit'));

// 7. kinderprofielen: Gratis = geen nieuw kinderprofiel; bestaand kinderprofiel blijft kinderprofiel met dezelfde leeftijd
uid = 'u1';
ok(P.apply(ent('free', Object.assign({}, OLD_FREE, { continue_watching: false, kids_profiles: false, opensubtitles: false }))), 'Gratis voor kinderprofielen');
const kid = { id: 'K', name: 'Kind', kids: true, ageLimit: 9 };
eq(P.kidsSave(kid, { kids: false, ageLimit: 16 }), { kids: true, ageLimit: 9 }, 'Gratis: bestaand kinderprofiel blijft kinderprofiel (alleen te lezen)');
eq(P.kidsSave({ id: 'K2', kids: true }, { kids: false, ageLimit: null }), { kids: true, ageLimit: null }, 'Gratis: kinderprofiel zonder eigen leeftijd blijft');
eq(P.kidsSave(null, { kids: true, ageLimit: 12 }), { kids: false, ageLimit: 12 }, 'Gratis: geen nieuw kinderprofiel');
eq(P.kidsSave({ id: 'A', kids: false }, { kids: true, ageLimit: 12 }), { kids: false, ageLimit: 12 }, 'Gratis: geen profiel ombouwen tot kinderprofiel');
eq(P.kidsSave({ id: 'A', kids: false }, { kids: false, ageLimit: 16 }), { kids: false, ageLimit: 16 }, 'Gratis: leeftijd van een gewoon profiel blijft vrij');
ok(P.kidsReadOnly(kid) && !P.kidsReadOnly({ kids: false }) && !P.kidsReadOnly(null), 'Gratis: alleen een bestaand kinderprofiel is alleen te lezen');
// en blijft gefilterd (sync.js): kinderprofiel = streng, standaard tot 12 jaar
ok(D.strict(kid) && D.ageLimit(kid) === 9, 'Gratis: bestaand kinderprofiel blijft gefilterd');
ok(D.strict({ kids: true }) && D.ageLimit({ kids: true }) === 12, 'Gratis: kinderprofiel zonder leeftijd tot 12');
ok(P.apply(ent('lifetime', Object.assign({}, OLD_LIFE, { continue_watching: true, kids_profiles: true, opensubtitles: true }))), 'Lifetime voor kinderprofielen');
eq(P.kidsSave(null, { kids: true, ageLimit: 12 }), { kids: true, ageLimit: 12 }, 'Lifetime: nieuw kinderprofiel');
eq(P.kidsSave(kid, { kids: false, ageLimit: null }), { kids: false, ageLimit: null }, 'Lifetime: kinderprofiel wijzigen mag');
ok(!P.kidsReadOnly(kid), 'Lifetime: kinderprofiel te wijzigen');

// 8. fetch: entitlements van de server toegepast
uid = 'u6';
answer = ent('free', Object.assign({}, OLD_FREE, { continue_watching: false, kids_profiles: false, opensubtitles: false }), { plans: PLANS });
// (eerst de fetch van markLocked hierboven laten aflopen)
new Promise((r) => setTimeout(r, 0)).then(() => P.fetch()).then((r) => {
  ok(r === true && P.isFree() && !P.has('opensubtitles'), 'fetch: Gratis');
  console.log('plan_test: alles goed (' + n + ' controles)');
}).catch((e) => { console.error(e); process.exit(1); });
