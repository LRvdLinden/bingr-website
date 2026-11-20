// Build 179: pure logica van de webspeler (web/js/build179.js). Draaien: node tools/test/build179_test.js
// Leest de gedeelde testgevallen uit ../iptv-ios-appletv/docs/build179_cases.json als die repo ernaast staat, anders de
// kopie tools/test/build179_cases.json (bron: iptv-ios-appletv/docs/build179_cases.json, niet hier aanpassen).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/sportlogic.js'), 'utf8'));
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/build179.js'), 'utf8'));
const P = globalThis.B.b179, SL = globalThis.B.sportLogic;
const sibling = path.join(__dirname, '../../../iptv-ios-appletv/docs/build179_cases.json');
const C = JSON.parse(fs.readFileSync(fs.existsSync(sibling) ? sibling : path.join(__dirname, 'build179_cases.json'), 'utf8'));
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

C.refresh.cases.forEach((c) => eq(P.refreshAction(c[0], c[1], c[2], c[3], c[4], c[5], c[6]), c[7], 'refresh ' + JSON.stringify(c)));
C.engineFirst.cases.forEach((c) => eq(P.engineFirst(c[0], c[1]), c[2], 'engineFirst ' + JSON.stringify(c)));
C.engineSwitch.cases.forEach((c) => eq(P.engineSwitch(c[0], c[1], c[2], c[3], c[4], c[5]), c[6], 'engineSwitch ' + JSON.stringify(c)));
C.engineNext.cases.forEach((c) => eq(P.engineNext(c[0], c[1], c[2]), c[3], 'engineNext ' + JSON.stringify(c)));
C.engineMemo.cases.forEach((c) => eq(P.engineMemo(c[0], c[1], c[2], c[3]), c[4], 'engineMemo ' + JSON.stringify(c)));
C.zapSearch.cases.forEach((c) => eq(P.zapSearch(c.q, c.channels), c.expect, 'zapSearch ' + c.q));
C.zapCategories.cases.forEach((c) => eq(P.zapCategories(c[0], c[1]), c[2], 'zapCategories ' + JSON.stringify(c)));
C.teamEq.cases.forEach((c) => eq(P.teamEq(c[0], c[1], SL.teamKey), c[2], 'teamEq ' + JSON.stringify(c)));
C.espnLink.cases.forEach((c) => eq(P.espnLink(c.guide, c.events, SL.teamKey), c.expect, 'espnLink ' + JSON.stringify(c.guide)));
C.scoreText.cases.forEach((c) => eq(P.scoreText(c[0], c[1], c[2], c[3]), c[4], 'scoreText ' + JSON.stringify(c)));
C.teamColor.cases.forEach((c) => eq(P.teamColor(c[0], c[1]), c[2], 'teamColor ' + JSON.stringify(c)));
C.contrast.cases.forEach((c) => eq(P.contrast(c[0]), c[1], 'contrast ' + c[0]));
C.ratingText.cases.forEach((c) => eq(P.ratingText(c[0], c[1]), c[2], 'ratingText ' + JSON.stringify(c)));
C.forYou.cases.forEach((c, i) => eq(P.forYou(c), c.expect, 'forYou ' + i));
C.sort.cases.forEach((c) => eq(P.sortIndices(c.mode, c.items), c.expect, 'sort ' + c.mode));
C.sortKey.cases.forEach((c) => eq(P.sortKey(c[0], c[1], c[2]), c[3], 'sortKey ' + JSON.stringify(c)));
C.sortMerge.cases.forEach((c) => eq(P.sortMerge(c.a, c.b), c.expect, 'sortMerge'));
C.cleanupAllowed.cases.forEach((c) => eq(P.cleanupAllowed(c[0], c[1], c[2]), c[3], 'cleanupAllowed ' + JSON.stringify(c)));
C.cleanupAction.cases.forEach((c) => eq(P.cleanupAction(c[0], c[1]), c[2], 'cleanupAction ' + JSON.stringify(c)));
C.webdavParse.cases.forEach((c) => {
  const r = P.webdavParse(c.path), want = c.expect, got = { kind: r.kind };
  Object.keys(want).forEach((k) => { got[k] = r[k] === undefined ? null : r[k]; });
  eq(got, want, 'webdav ' + c.path);
});

// eigen controles (web): pogingen herordenen, geheugen, IntroDB, PROPFIND, duimen
const steps = [{ how: 'hls' }, { how: 'mpegts' }, { how: 'direct' }];
eq(P.orderOf(steps), ['hls', 'mpegts', 'native'], 'volgorde engines');
eq(P.startWith(steps, 'native').map((s) => s.how), ['direct', 'hls', 'mpegts'], 'native eerst');
eq(P.startWith(steps, null), steps, 'zonder voorkeur');
let mem = P.memoPut({}, 'a|1', 'mpegts', 1e12);
eq(mem['a|1'].e, 'mpegts', 'onthouden');
eq(P.memoPut(mem, 'a|1', null, 1e12)['a|1'], undefined, 'wissen');
eq(Object.keys(P.memoPut(mem, null, null, 1e12 + 61 * 86400000)).length, 0, 'na 60 dagen weg');
eq(P.memoKey('ABC', { channel: { id: 7 } }), 'abc|7', 'sleutel live');
eq(P.memoKey('ABC', { type: 'movie', id: 9 }), 'abc|movie:9', 'sleutel film');
eq(P.introSegments({ ok: true, intro: { start: 12.5, end: 75 }, recap: null, credits: { start: 2580 } }),
  { intro: { start: 12.5, end: 75 }, recap: null, credits: { start: 2580, end: null } }, 'introdb');
eq(P.introSegments({ ok: false, error: 'not_found' }), null, 'introdb niet gevonden');
const xml = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/Films/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>' +
  '<d:response><d:href>/dav/Films/Heat%20(1995)/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>' +
  '<d:response><d:href>/dav/Films/Avatar.mkv</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>123</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>';
const pf = P.parsePropfind(xml, '/dav/Films/');
eq(pf.map((x) => [x.href, x.dir, x.size]), [['/dav/Films/Heat%20(1995)/', true, null], ['/dav/Films/Avatar.mkv', false, 123]], 'propfind');
eq(P.thumbKey('series', 1396, 'X', 5), 'tmdb:tv:1396', 'duim-sleutel tmdb');
eq(P.thumbKey('movie', null, 'X', 5), 'x|movie:5', 'duim-sleutel zonder tmdb');
const now = Date.parse('2026-11-15T12:00:00Z');
eq(P.mergeThumbs([{ key: 'a', value: 1, at: '2026-11-15T10:00:00Z' }], [{ key: 'a', value: 0, at: '2026-11-15T11:00:00Z' }, { key: 'b', value: 0, at: '2026-01-01T00:00:00Z' }], now),
  [{ key: 'a', value: 0, at: '2026-11-15T11:00:00Z' }], 'duimen samenvoegen, oude tombstone weg');
eq(P.espnLeague('eredivisie'), 'soccer/ned.1', 'competitie → ESPN');
eq(P.espnLeague('wk'), null, 'geen scores voor andere competities');
// X2: opnieuw verbinden bij live (gelijk aan Stream179 op Apple)
eq([0, 1, 2, 3, 4, 5].map((a) => P.retryDelay(a, true, true, 0)), [0.5, 1.5, 3, 5, 8, null], 'live met beeld');
eq([0, 1, 2].map((a) => P.retryDelay(a, true, false, 0)), [1.5, 3, null], 'live zonder beeld');
eq([0, 1].map((a) => P.retryDelay(a, false, true, 0)), [1.5, null], 'film');
eq(P.retryDelay(0, true, true, 46), null, 'storing te lang');
eq(P.stopReason(false, true, true, 0), 'serverClosed', 'server sloot');
eq(P.stopReason(true, true, true, 0), 'error', 'fout gaat voor');
eq(P.stopReason(false, false, true, 16), 'timeout', 'time-out');
eq(P.stopReason(false, true, false, 0), null, 'film afgelopen');
eq(P.pushStop([1, 2, 3], 0, 3), [0, 1, 2], 'nieuwste eerst, max');
console.log('build179: ' + n + ' controles, alles goed');
