// Build 164: pure logica van de tv-gids (web/js/guidelogic.js): dagbalk, NU-index, venster voor de tv, stilstaand beeld
// (30 min, max. 200 zenders) en de instelling "Live voorbeeld in de gids". Draaien: node tools/test/guide_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/guidelogic.js'), 'utf8'));
const G = globalThis.B.guideLogic;
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const MIN = 60000, H = 60 * MIN;

// dagbalk: gisteren t/m 7 dagen vooruit; verder terug alleen met terugkijken (max. 7)
const now = new Date(2026, 10, 6, 12, 40).getTime();
let d = G.days(now, 0);
eq(d.length, 9, 'gisteren + vandaag + 7');
eq(d[0].offset, -1, 'begint gisteren');
eq(d[d.length - 1].offset, 7, 't/m 7 dagen vooruit');
eq(d[1].start, new Date(2026, 10, 6).getTime(), 'vandaag om middernacht');
eq(d[1].end, new Date(2026, 10, 7).getTime(), 'tot morgen middernacht');
eq(G.days(now, 3)[0].offset, -3, 'terugkijken 3 dagen');
eq(G.backDays([{ catchupDays: 2 }, { catchupDays: 0 }, {}]), 2, 'grootste terugkijkdagen');
eq(G.backDays([{ catchupDays: 14 }]), 7, 'hooguit 7');
eq(G.backDays([]), 0, 'geen zenders');
eq(G.days(now, G.backDays([{ catchupDays: 14 }]))[0].offset, -7, 'dagbalk max. 7 terug');
// zomertijd → wintertijd (25-uursdag): de volgende dag begint toch om middernacht
const dst = G.days(new Date(2026, 9, 25, 12).getTime(), 0);
eq(new Date(dst[2].start).getHours(), 0, 'middernacht na de klokwissel');
eq(G.dayKey(-1), 'yesterday'); eq(G.dayKey(0), 'today'); eq(G.dayKey(1), 'tomorrow'); eq(G.dayKey(2), null);

// NU-index en stand
const t0 = new Date(2026, 10, 6, 11).getTime();
const progs = [
  { start: t0, end: t0 + H }, { start: t0 + H, end: t0 + H + 15 * MIN }, { start: t0 + H + 15 * MIN, end: t0 + 2 * H },
  { start: t0 + 2 * H, end: t0 + 2 * H + 20 * MIN }, { start: t0 + 3 * H, end: t0 + 4 * H }
];
eq(G.nowIndex(progs, now), 2, 'lopend programma');
eq(G.nowIndex(progs, t0 - MIN), 0, 'alles nog te komen: eerste');
eq(G.nowIndex(progs, t0 + 2 * H + 30 * MIN), 4, 'gat in de gids: eerstvolgende');
eq(G.nowIndex(progs, t0 + 9 * H), 4, 'alles voorbij: laatste');
eq(G.nowIndex([], now), -1, 'lege lijst');
eq(G.nowIndex(progs, t0 + H), 1, 'precies op de begintijd');
eq(G.state(progs[0], now), 'past'); eq(G.state(progs[2], now), 'now'); eq(G.state(progs[3], now), 'next');
eq(G.minutesLeft(progs[2], now), 20, 'nog 20 min');
eq(Math.round(G.progress(progs[2], now) * 100), 56, 'voortgang 25 van 45 min');
eq(G.progress(progs[0], now), 1, 'voorbij = vol');
// tv: 2 eerder, NU, 4 later
const w = G.window(progs, now);
eq(w.before.length, 2); eq(w.now, progs[2]); eq(w.after.length, 2);
eq(G.window(progs, t0 + 10 * MIN).before.length, 0, 'geen eerdere');

// stilstaand beeld: hooguit 30 min oud
eq(G.pickStill({ at: now - 10 * MIN, d: 'data:x' }, now), 'data:x', 'vers beeld');
eq(G.pickStill({ at: now - 31 * MIN, d: 'data:x' }, now), null, 'te oud');
eq(G.pickStill({ at: now + MIN, d: 'data:x' }, now), null, 'uit de toekomst (klok verzet)');
eq(G.pickStill(null, now), null, 'geen beeld');
eq(G.pickStill({ at: now }, now), null, 'zonder data');
// max. 200 zenders, de oudste eerst weg
const idx = {};
for (let i = 0; i < 203; i++) idx['s|' + i] = 1000 + i;
eq(G.pruneStills(idx), ['s|0', 's|1', 's|2'], 'drie oudste weg');
eq(G.pruneStills({ a: 1 }), [], 'onder de grens');
eq(G.pruneStills({ a: 3, b: 1, c: 2 }, 1), ['b', 'c'], 'eigen grens, oudste eerst');
eq(G.stillKey('ABC', 12), 'abc|12', 'server hoofdletterongevoelig');

// instelling: Altijd, Alleen wifi (standaard), Nooit
eq(G.normalizeMode(undefined), 'wifi'); eq(G.normalizeMode('bogus'), 'wifi'); eq(G.normalizeMode('never'), 'never');
eq(G.previewMode('wifi', { cellular: false }), 'auto', 'wifi: vanzelf');
eq(G.previewMode('wifi', { cellular: true }), 'tap', 'mobiel netwerk: na een tik');
eq(G.previewMode('wifi', { cellular: true }, true), 'auto', 'tv: Alleen wifi = aan');
eq(G.previewMode('always', { cellular: true }), 'auto');
eq(G.previewMode('never', { cellular: false }), 'off');
eq(G.network({ connection: { type: 'cellular' } }), { cellular: true });
eq(G.network({ connection: { type: 'wifi' } }), { cellular: false });
eq(G.network({ connection: { saveData: true } }), { cellular: true }, 'databesparing zonder type = als mobiel');
eq(G.network({}), { cellular: false }, 'onbekend = geen mobiel netwerk');

console.log('guide_test: ' + n + ' controles geslaagd');
