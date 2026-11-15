// Build 176: pure logica van de webspeler (web/js/build176.js). Draaien: node tools/test/build176_test.js
// Leest de gedeelde testgevallen uit ../iptv-ios-appletv/docs/build176_cases.json als die repo ernaast staat, anders de
// kopie tools/test/build176_cases.json (bron: iptv-ios-appletv/docs/build176_cases.json, niet hier aanpassen).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/build176.js'), 'utf8'));
const P = globalThis.B.b176;
const sibling = path.join(__dirname, '../../../iptv-ios-appletv/docs/build176_cases.json');
const C = JSON.parse(fs.readFileSync(fs.existsSync(sibling) ? sibling : path.join(__dirname, 'build176_cases.json'), 'utf8'));
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// MARK: gedeelde gevallen
C.autoplay.cases.forEach(([v, kids, due, exp]) => eq(P.autoplayStarts(v, kids, due), exp, 'autoplay ' + JSON.stringify([v, kids, due])));
C.lock.cases.forEach(([locked, pin, at, now, exp]) => eq(P.lockAsks(locked, pin, at, now), exp, 'lock ' + JSON.stringify([locked, pin, at, now])));
C.dataMode.cases.forEach(([mode, net, con, exp]) => eq(P.isSaver(mode, net, con), exp, 'dataMode ' + JSON.stringify([mode, net, con])));
C.variant.cases.forEach((c) => eq(P.pickVariant(c.variants, c.saver), c.expect, 'variant ' + JSON.stringify(c)));
C.epgSearch.cases.forEach((c) => {
  const m = P.matchProgram(c.title, c.desc, c.q);
  eq(m ? { field: m.field, highlight: m.highlight } : null, c.expect, 'epg ' + JSON.stringify(c.q));
});
const iso = (t) => new Date(P.time(t)).toISOString();
const simple = (l) => l.map((x) => ({ id: x.id, removed: x.removed === true, at: iso(x.at) }));
C.bookmarks.cases.forEach((c) => {
  eq(simple(P.mergeBookmarks(c.local, c.server, Date.parse(c.now))), simple(c.expect), 'bookmarks ' + c.name);
});
{
  const lim = C.bookmarks.limit, base = Date.parse('2026-11-01T00:00:00Z');
  const list = []; for (let i = 0; i < lim.count; i++) list.push({ id: 'abc|k' + i + '@1', key: 'k' + i, t: 1, at: new Date(base + i * 60000).toISOString() });
  const out = P.mergeBookmarks(list, [], Date.parse('2026-11-15T12:00:00Z'));
  eq(out.length, lim.keep, 'limiet');
  eq(out.some((x) => /^abc\|k[0-4]@1$/.test(x.id)), false, 'oudste vijf weg');
}
C.bookmarkID.cases.forEach(([sid, key, t, exp]) => eq(P.bookmarkID(sid, key, t), exp, 'bookmarkID ' + key));
C.releaseReminder.cases.forEach(([type, tmdb, season, prof, date, tz, id, start]) => {
  eq(P.releaseID(type, tmdb, season, prof), id, 'release id ' + id);
  eq(P.releaseStart(date, tz), start, 'release start ' + id);
  const r = P.releaseReminder({ mediaType: type, tmdb, season, profileID: prof, date, tz, title: 'X', at: '2026-11-15T12:00:00Z' });
  eq([r.id, r.start, r.kind, r.channelID.startsWith('release:'), r.playlistID], [id, start, 'release', true, P.NO_SERVER], 'release item ' + id);
});

// MARK: eigen controles
eq(P.autoplayValue({ value: false, at: 'x' }), false); eq(P.autoplayValue(undefined), null); eq(P.autoplayValue(true), true);
eq(P.mergeAutoplay({ value: true, at: '2026-01-01T00:00:00Z' }, { value: false, at: '2026-02-01T00:00:00Z' }).value, false, 'nieuwste wint');
eq(Object.keys(P.pruneUnlocked({ a: 1000, b: 1000 + 14400 * 1000 }, 1000 + 14400 * 1000 + 5)), ['b'], 'verlopen ontgrendeling weg');
eq(P.norm('Café-X').length, 'Café-X'.length, 'norm even lang');
eq(P.words('ab'), []); eq(P.words('x-men'), ['men']); eq(P.words('f1 gp'), ['f1', 'gp']);
eq(P.highlight('Live: Eredivisie, ronde', 'eredivisie ronde').filter((s) => s.hit).map((s) => s.t), ['Eredivisie', 'ronde']);
eq(P.highlight('Reportage uit een Café', ['cafe']).map((s) => s.t).join(''), 'Reportage uit een Café', 'origineel intact');
eq(P.snippet('a'.repeat(400), 200, 150).text.length <= 152, true);
eq(P.finishHits([{ chKey: 'a', p: { start: 2 }, m: { field: 'description' } }, { chKey: 'a', p: { start: 5 }, m: { field: 'title' } },
  { chKey: 'a', p: { start: 2 }, m: { field: 'description' } }]).map((x) => x.p.start), [5, 2], 'titel eerst, ontdubbeld');
eq(P.network({ connection: { type: 'cellular' } }).net, 'cellular'); eq(P.network({ connection: { effectiveType: '3g' } }).net, 'cellular');
eq(P.network({ connection: { type: 'wifi', saveData: true } }), { net: 'wifi', constrained: true }); eq(P.network({}).net, 'unknown');
eq(P.previewAllowed({ setting: true }), true); eq(P.previewAllowed({ saver: true }), false); eq(P.previewAllowed({ locked: true }), false);
eq(P.helpURL('nl-NL'), 'https://support.bingr.online/hulp/'); eq(P.helpURL('de'), 'https://support.bingr.online/hulp/?lang=en');
eq(P.tmdbSize(160), 185); eq(P.tmdbSize(304), 342); eq(P.tmdbSize(2000, 'backdrop'), 1280);
eq(P.tmdbSrcset('https://image.tmdb.org/t/p/w500/abc.jpg', 160), { src: 'https://image.tmdb.org/t/p/w185/abc.jpg',
  srcset: 'https://image.tmdb.org/t/p/w185/abc.jpg 185w, https://image.tmdb.org/t/p/w342/abc.jpg 342w', sizes: '160px' });
eq(P.tmdbSrcset('https://example.com/a.jpg', 160), null); eq(P.tmdbSrcset('https://image.tmdb.org/t/p/original/x.png', 400).src, 'https://image.tmdb.org/t/p/w500/x.png');
eq(P.clock(3723), '1:02:03'); eq(P.clock(65), '1:05');
eq(P.bookmarksFor([{ id: 'a|k@9', key: 'k', t: 9, at: 1 }, { id: 'a|k@3', key: 'k', t: 3, at: 2 }, { id: 'a|z@1', key: 'z', t: 1, at: 3 },
  { id: 'a|k@1', removed: true, at: 4 }], ['k']).map((x) => x.t), [3, 9]);

// MARK: sync van de momenten via syncmerge.js (zelfde gedeelde gevallen, het echte samenvoegpad van profile.<id>)
{
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; } };
  globalThis.document = { readyState: 'complete', hidden: false, visibilityState: 'visible', documentElement: { getAttribute: () => null }, addEventListener: () => {}, createElement: () => ({}) };
  globalThis.addEventListener = () => {};
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
  const WEB = path.join(__dirname, '../../web/js');
  (0, eval)(fs.readFileSync(path.join(WEB, 'core.js'), 'utf8'));
  (0, eval)(fs.readFileSync(path.join(WEB, 'syncmerge.js'), 'utf8'));
  const SM = globalThis.B.syncMerge;
  const realNow = Date.now;
  C.bookmarks.cases.forEach((c) => {
    Date.now = () => Date.parse(c.now);
    const st = SM.normalize(SM.mergeState(SM.parseState({ bookmarks: c.local }), SM.parseState({ bookmarks: c.server })));
    const out = SM.toJSON({}, st).bookmarks || [];
    eq(simple(out), simple(c.expect), 'sync bookmarks ' + c.name);
  });
  Date.now = realNow;
  // onbekende velden blijven, lockedChannels/lockedTitles als sets, autoplayNext blijft in de basis
  const base = { autoplayNext: { value: false, at: '2026-11-15T10:00:00Z' }, lockedTitles: [{ id: 's1|movie:m1', at: '2026-11-15T10:00:00Z' }], prefs: { x: 1 } };
  const j = SM.toJSON(base, SM.normalize(SM.parseState(base)));
  eq([j.autoplayNext.value, j.lockedTitles[0].id, j.prefs.x, 'bookmarks' in j], [false, 's1|movie:m1', 1, false], 'velden van build 176 in profile.<id>');
}

// MARK: tik op een herinnering op de releasedatum: titel-link uit build 120 → #/titel van de webspeler (sw.js)
{
  const sw = { location: { origin: 'https://bingr.online', href: 'https://bingr.online/web/sw.js' }, addEventListener: () => {}, registration: {}, clients: {} };
  const target = new Function('self', fs.readFileSync(path.join(__dirname, '../../web/sw.js'), 'utf8') + '\nreturn target;')(sw);
  eq(target({ kind: 'release', deeplink: 'bingr://title?type=movie&id=550&q=Fight%20Club' }),
    { url: 'https://bingr.online/web/#/titel?type=movie&id=550&q=Fight%20Club', title: 'type=movie&id=550&q=Fight%20Club' }, 'release-herinnering (film)');
  eq(target({ kind: 'reminder', deeplink: 'bingr://title?type=tv&id=1399&q=Game+of+Thrones' }).url, 'https://bingr.online/web/#/titel?type=tv&id=1399&q=Game%20of%20Thrones', 'serie');
  eq(target({ kind: 'release', deeplink: 'bingr://title?type=tv&id=abc' }).url.indexOf('#/titel'), -1, 'ongeldige link: niet naar #/titel');
  eq(target({ kind: 'release', deeplink: 'bingr://changelog?p=web&b=176' }).url, 'https://bingr.online/changelog/?p=web#build-176', 'app-release blijft de changelog');
  eq(target({ kind: 'reminder', deeplink: 'bingr://live?channel=c1' }).reminder.channel, 'c1', 'gewone herinnering blijft live');
}

console.log('build176: ' + n + ' controles ok');
