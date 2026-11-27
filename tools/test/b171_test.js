// Build 171: pure logica van de webspeler (web/js/b171logic.js). Draaien: node tools/test/b171_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/b171logic.js'), 'utf8'));
const X = globalThis.B.b171;
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const H = 3600000;

// 1. Kijk je nog?
let sw = new X.StillWatching(0);
eq(sw.shouldAsk(2 * H, 3, true), false, '2 uur: nog niet');
eq(sw.shouldAsk(3 * H, 3, true), true, '3 uur zonder bediening');
eq(sw.shouldAsk(3 * H, 3, false), false, 'uit = nooit');
eq(sw.shouldAsk(2 * H, 2, true), true, 'keuze 2 uur');
eq(sw.shouldAsk(3 * H, 7, true), true, 'onbekende keuze = 3 uur');
sw.interaction(2 * H);
eq(sw.shouldAsk(4 * H, 3, true), false, 'bediening zet de klok terug');
sw = new X.StillWatching(0);
sw.autoEpisode(1000); sw.interaction(2000);
eq(sw.autoEpisodes, 1, 'bediening in het stille venster telt niet');
sw.autoEpisode(10000); sw.autoEpisode(20000);
eq(sw.shouldAsk(21000, 3, true), true, 'na 3 automatische afleveringen');
sw.answered(22000);
eq(sw.shouldAsk(23000, 3, true), false, 'na Verder kijken opnieuw');
sw.autoEpisode(30000); sw.interaction(40000);
eq(sw.autoEpisodes, 0, 'bediening na het stille venster zet de teller op 0');
eq(X.secondsLeft(0, 29001), 1); eq(X.secondsLeft(0, 40000), 0);
eq(X.timedOut(0, 29999), false); eq(X.timedOut(0, 30000), true);

// 15/20. sleutels
eq(X.channelKey('ABC-1', 'x12'), 'abc-1|x12');
eq(X.titleKey('ABC', 'movie', 'xv9'), 'abc|movie:xv9');
eq(X.titleKey('ABC', 'series', 'xs9'), 'abc|series:xs9');
eq(X.parseKey('ABC|series:xs9'), { sid: 'abc', kind: 'series', item: 'xs9' });
eq(X.parseKey('abc|x12'), { sid: 'abc', kind: null, item: 'x12' });
eq(X.parseKey('geen'), null); eq(X.parseKey('abc|'), null); eq(X.parseKey('abc|movie:'), null);
const keys = ['ABC|x1', 'abc|movie:xv1', 'abc|series:xs1', 'def|x2'];
eq(Object.keys(X.idsFor(keys, 'abc', null)), ['x1']);
eq(Object.keys(X.idsFor(keys, 'ABC', 'movie')), ['xv1']);
eq(Object.keys(X.idsFor(keys, 'abc', 'series')), ['xs1']);
eq(X.filterOut([{ id: 'x1' }, { id: 'x3' }], X.idsFor(keys, 'abc', null)), [{ id: 'x3' }]);
eq(X.filterOut([{ id: 'x1' }], {}), [{ id: 'x1' }], 'leeg = alles');

// 17. regio's
eq(X.region('| NL | Sport'), 'NL');
eq(X.region('NL: Films'), 'NL');
eq(X.region('BE - Nieuws'), 'BE');
eq(X.region('[UK] Kids'), 'UK');
eq(X.region('GB| Sports'), 'UK', 'GB = UK');
eq(X.region('| MULTI / LINGO | Netflix'), null, 'MULTI is geen land');
eq(X.region('| HD | DE | Sport'), 'DE', 'kwaliteit overslaan');
eq(X.region('EXYU: Filmovi'), 'EXYU');
eq(X.region('Sport'), null);
eq(X.region('Nederland - Sport'), null, 'lange woorden zijn geen label');
eq(X.chips(['NL', 'NL', 'BE', null, 'DE', 'BE', 'NL']), ['NL', 'BE', 'DE']);
eq(X.chips(['NL', 'NL']), [], 'één regio = geen chips');
eq(X.pinnedFirst([1, 2, 3, 4], (x) => x % 2 === 0), [2, 4, 1, 3]);

// 31. apparaten
const now = Date.parse('2026-11-15T12:00:00Z');
const devs = [
  { id: 'me', lastUsed: now, current: true },
  { id: 'tv', lastUsed: now - 2 * H },
  { id: 'oud', lastUsed: now - 30 * 24 * H },
  { id: 'nooit', lastUsed: null }
];
eq(X.sortDevices(devs).map((d) => d.id), ['nooit', 'oud', 'tv', 'me']);
eq(X.suggestion(devs, now).id, 'nooit');
eq(X.suggestion([devs[1], devs[0]], now), null, '2 uur is te kort');
eq(X.suggestion([{ id: 'k', lastUsed: now - 3 * 24 * H, watching: true }], now), null, 'kijkt nu');
eq(X.relTime(now - 30000, now), 'just now');
eq(X.relTime(now - 5 * 60000, now), '5 minutes ago');
eq(X.relTime(now - 2 * H, now), '2 hours ago');
eq(X.relTime(now - 24 * H, now), '1 day ago');
eq(X.relTime(now - 90 * 24 * H, now), '3 months ago');

// 37. crash
eq(X.scrub('GET http://iptv.example.invalid:8080/live/jan/geheim/1.ts mislukt'), 'GET <url> mislukt');
eq(X.scrub('/live/jan/geheim/1.m3u8'), '<url>');
eq(X.scrub('jan:geheim@iptv.example.invalid/get'), '<url>');
eq(X.scrub('mail jan@example.invalid'), 'mail <email>');
eq(X.scrub('ip 192.0.2.4:80'), 'ip <ip>');
eq(X.scrub('token=abc&x'), 'token=<redacted>&x');
eq(X.scrub('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'), 'jwt <token>');
eq(X.scrub('h 0123456789abcdef0123456789abcdef'), 'h <token>');
eq(X.scrub('at render (player.js:120:7)'), 'at render (player.js:120:7)', 'stackregel blijft');
eq(X.clipBytes('ééé', 5), 'éé');
eq(X.clipBytes('a😀b', 3), 'a');
const stack = 'TypeError: x is undefined\n    at f (https://bingr.online/web/js/player.js?v=167:120:9)\n    at g (https://bingr.online/web/js/app.js:5:1)';
eq(X.topFrame(stack), 'player.js:120');
eq(X.signature('TypeError', "Cannot read properties of undefined (reading 'id') 42", stack), 'TypeError: Cannot read properties of undefined (reading …) # @ player.js:120');
const r = X.report('error', 'TypeError', 'bad http://a.example.invalid/x', stack, { platform: 'web', app_version: '1.0.7 (171)', build: 171, at: now });
eq(r.message, 'bad <url>');
eq(r.platform, 'web'); eq(r.build, 171); eq(r.count, 1); eq(r.at, '2026-11-15T12:00:00.000Z');
assert.ok(r.stack.indexOf('https://') < 0, 'geen URL in de stack'); n++;
eq(r.stack.split('\n')[1].trim(), 'at f (web/js/player.js:120:9)', 'eigen scripts leesbaar');
eq(X.ownFrames('at x (https://iptv.example.invalid/live/u/p/1.ts:3:4)'), 'at x (https://iptv.example.invalid/live/u/p/1.ts:3:4)', 'andere URL blijft voor scrub');
eq(X.report('error', 'E', 'x'.repeat(900), '', {}).message.length, 500);
let q = X.enqueue([], r, now);
q = X.enqueue(q, Object.assign({}, r, { at: '2026-11-15T12:01:00.000Z' }), now);
eq(q.length, 1); eq(q[0].count, 2); eq(q[0].at, '2026-11-15T12:01:00.000Z');
eq(X.prune([{ at: '2026-11-01T00:00:00Z' }, { at: '2026-11-14T00:00:00Z' }], now).length, 1, '7 dagen bewaren');
const s = new X.Session();
eq(s.accept('a'), true); eq(s.accept('a'), false, 'ontdubbeld');
for (let i = 0; i < 9; i++) s.accept('s' + i);
eq(s.accept('z'), false, 'max. 10 per sessie');

console.log(`build 171 (webspeler, pure logica): ${n} controles geslaagd`);
