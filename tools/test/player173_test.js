// Build 173: pure logica van de webspeler (web/js/player173.js). Draaien: node tools/test/player173_test.js
// Zelfde gevallen als tools/selftest (Apple) en Build173PlayerLogicTest.kt (Android).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/player173.js'), 'utf8'));
const P = globalThis.B.p173;
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const M = 60000, H = 3600000, now = Date.UTC(2026, 10, 15, 20, 0);

// 2. Vanaf het begin / Terug naar live
eq(P.canStartOver(true, now - 10 * M, now, 0), true, 'loopt 10 min, live');
eq(P.canStartOver(false, now - 10 * M, now, 0), false, 'zonder terugkijken nooit');
eq(P.canStartOver(true, now - 30000, now, 0), false, 'net begonnen');
eq(P.canStartOver(true, now - 10 * M, now, 590), false, 'al aan het begin');
eq(P.canStartOver(true, now + M, now, 0), false, 'nog niet begonnen');
eq(P.canStartOver(true, null, now, 0), false, 'geen gids');
eq(P.askStartOver(true, now - 5 * M, now + 30 * M, now), true, 'vraag bij een lopend programma');
eq(P.askStartOver(false, now - 5 * M, now + 30 * M, now), false, 'zonder terugkijken: direct live');
eq(P.askStartOver(true, now - 60000, now + 30 * M, now), false, 'pas 1 min bezig');
eq(P.askStartOver(true, now - 30 * M, now + 30000, now), false, 'bijna afgelopen');
eq(P.askStartOver(true, now - 30 * M, now - 31 * M, now), false, 'ongeldige tijden');
eq(P.canGoLive(now + M, now), true); eq(P.canGoLive(now - M, now), false); eq(P.canGoLive(null, now), false);

// 3. Zappen
eq(P.zapOrder(['NL', 'Sport', 'NL', 'BE', 'Sport'], [false, false, false, true, false], 'Sport'), [3, 1, 4, 0, 2], 'favorieten, categorie, rest');
eq(P.zapOrder(['A', 'B'], [], null), [0, 1], 'zonder favorieten en categorie: volgorde van de server');
const pc = new P.PreviousChannel();
pc.tuned('a'); eq([pc.current, pc.previous], ['a', null]);
pc.tuned('b'); eq([pc.current, pc.previous], ['b', 'a']);
pc.tuned('b'); eq([pc.current, pc.previous], ['b', 'a'], 'zelfde zender: niets');
pc.tuned(pc.previous); eq([pc.current, pc.previous], ['a', 'b'], 'terug en weer terug');

// 4. Dubbeltikken
const dt = new P.DoubleTap();
eq(dt.tap(true, 1000), { total: 10, delta: 10 });
eq(dt.tap(true, 1500), { total: 20, delta: 10 }, 'binnen 800 ms telt op');
eq(dt.tap(true, 2200), { total: 30, delta: 10 });
eq(dt.active(2900), true); eq(dt.active(3100), false);
eq(dt.tap(true, 3100), { total: 10, delta: 10 }, 'na het venster opnieuw');
eq(dt.tap(false, 3300), { total: -10, delta: -10 }, 'andere kant begint opnieuw');
eq(dt.tap(false, 3600), { total: -20, delta: -10 });
dt.reset(); eq(dt.active(3700), false);
eq(P.tapSide(10, 400), 'back'); eq(P.tapSide(390, 400), 'fwd'); eq(P.tapSide(200, 400), null); eq(P.tapSide(5, 0), null);

// 6. Eindtijd
eq(P.endsAt(now, 30 * M, 1), now + 30 * M);
eq(P.endsAt(now, 30 * M, 1.5), now + 20 * M, 'sneller afspelen');
eq(P.endsAt(now, 30 * M, 0), now + 30 * M, 'snelheid 0 = 1');
eq(P.endsAt(now, 0, 1), null); eq(P.endsAt(now, NaN, 1), null); eq(P.endsAt(now, Infinity, 1), null);

// 7. Ondertitels na terugspoelen
eq(P.rewindSubtitles(-10, false, true, true), true);
eq(P.rewindSubtitles(-30, false, true, true), true);
eq(P.rewindSubtitles(-31, false, true, true), false, 'te ver');
eq(P.rewindSubtitles(-5, false, true, true), false, 'te kort');
eq(P.rewindSubtitles(10, false, true, true), false, 'vooruit');
eq(P.rewindSubtitles(-10, true, true, true), false, 'staan al aan');
eq(P.rewindSubtitles(-10, false, false, true), false, 'geen spoor');
eq(P.rewindSubtitles(-10, false, true, false), false, 'instelling uit');
eq(P.rewindSubtitlesDone(100, 110, 90), false); eq(P.rewindSubtitlesDone(110, 110, 90), true, 'voorbij het punt');
eq(P.rewindSubtitlesDone(80, 110, 90), true, 'ver teruggesprongen');
eq(P.subtitleTrack(['en', 'nl'], ['nl']), 1);
eq(P.subtitleTrack(['English', 'Nederlands'], ['nl', 'en']), 1, 'naam van het spoor');
eq(P.subtitleTrack(['eng', 'dut'], ['nl-NL']), 1, 'regio en drieletterige code');
eq(P.subtitleTrack(['fr', 'de'], ['nl', 'en']), null);
eq(P.subtitleTrack(['de', 'en'], ['nl', 'en']), 1, 'tweede keus');
eq(P.subtitleTrack(['pt_BR'], ['pt']), 0);

// 9. Slaaptimer
eq(P.sleepDeadline(30, now, null), now + 30 * M);
eq(P.sleepDeadline('end', now, now + 12 * M), now + 12 * M, 'live: einde van het programma');
eq(P.sleepDeadline('end', now, null), null, 'aflevering: bij het einde');
eq(P.sleepDeadline('off', now, null), null);
eq(P.sleepDue(30, now + 30 * M, now + 29 * M, false), false);
eq(P.sleepDue(30, now + 30 * M, now + 30 * M, false), true);
eq(P.sleepDue('end', null, now, false), false); eq(P.sleepDue('end', null, now, true), true, 'na deze aflevering');
eq(P.sleepDue('end', now + M, now + M, false), true, 'einde programma');
eq(P.sleepDue('off', null, now, true), false); eq(P.sleepDue(null, null, now, true), false);
eq(P.countdown(0), '0:00'); eq(P.countdown(59001), '1:00'); eq(P.countdown(30 * M), '30:00'); eq(P.countdown(90 * M), '1:30:00'); eq(P.countdown(61500), '1:02');

// A. Weergave
eq(P.subSize('large'), 'large'); eq(P.subSize('x'), 'medium'); eq(P.subBackground('shadow'), 'shadow'); eq(P.subBackground(null), 'box');

// 0c. Trakt
eq(P.traktClassify(401), 'reauth'); eq(P.traktClassify(403), 'reauth'); eq(P.traktClassify(423), 'locked');
eq(P.traktClassify(429), 'transient'); eq(P.traktClassify(503), 'transient'); eq(P.traktClassify(null), 'transient');
eq(P.traktRefreshFailure([400, 401]), 'reauth', 'refresh-token geweigerd');
eq(P.traktRefreshFailure([400, null]), 'transient', 'netwerkfout = later opnieuw');
eq(P.traktRefreshFailure([500]), 'transient'); eq(P.traktRefreshFailure([]), 'transient');
eq(P.traktShowWarning(null, now - 48 * H, now), false);
eq(P.traktShowWarning('reauth', null, now), true); eq(P.traktShowWarning('locked', null, now), true);
eq(P.traktShowWarning('transient', now - 23 * H, now), false, 'tijdelijk < 24 uur: geen waarschuwing');
eq(P.traktShowWarning('transient', now - 24 * H, now), true, 'tijdelijk ≥ 24 uur');
eq(P.traktShowWarning('transient', null, now), false);
eq(P.traktNextFailure('reauth', 'transient'), 'reauth', 'tijdelijk overschrijft geen blijvende fout');
eq(P.traktNextFailure(null, 'transient'), 'transient'); eq(P.traktNextFailure('transient', 'locked'), 'locked');
const loc = { accessToken: 'A2', expiresAt: now + 90 * 24 * H };
eq(P.traktAdoptRemote(loc, { accessToken: 'A1', expiresAt: now + 89 * 24 * H }), false, 'ouder token uit het account niet over een nieuwer');
eq(P.traktAdoptRemote(loc, { accessToken: 'A3', expiresAt: now + 91 * 24 * H }), true, 'nieuwer token wel');
eq(P.traktAdoptRemote(loc, { accessToken: 'A2', expiresAt: now }), true, 'hetzelfde token');
eq(P.traktAdoptRemote(null, { accessToken: 'A1', expiresAt: now }), true, 'hier geen token');

// 0c. OpenSubtitles
eq(P.osShouldRenew(now - 22 * H, now, true), false);
eq(P.osShouldRenew(now - 23 * H, now, true), true, 'na 23 uur stil vernieuwen');
eq(P.osShouldRenew(now - 23 * H, now, false), false, 'zonder wachtwoord niet');
eq(P.osShouldRenew(null, now, true), true, 'onbekend = vernieuwen');
eq(P.osShouldRenew(now + H, now, true), true, 'klok verzet');
eq(P.osOnResponse(401, true, true), 'relogin'); eq(P.osOnResponse(401, true, false), 'expired');
eq(P.osOnResponse(401, false, true), 'keep', 'zonder token (zoeken)');
eq(P.osOnResponse(429, true, true), 'keep'); eq(P.osOnResponse(503, true, true), 'keep'); eq(P.osOnResponse(null, true, true), 'keep', 'netwerkfout');
eq(P.osLoginResult(200), 'ok'); eq(P.osLoginResult(400), 'bad'); eq(P.osLoginResult(401), 'bad');
eq(P.osLoginResult(403), 'transient'); eq(P.osLoginResult(429), 'transient'); eq(P.osLoginResult(502), 'transient'); eq(P.osLoginResult(null), 'transient');

console.log('player173: ' + n + ' controles ok');
