// Build 172: Sport (pure logica, web/js/sportlogic.js). Leest de gedeelde testgevallen uit
// ../iptv-ios-appletv/docs/sport_cases.json als die repo ernaast staat, anders de kopie tools/test/sport_cases.json
// (bron: iptv-ios-appletv/docs/sport_cases.json, niet hier aanpassen). Draaien: node tools/test/sport_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const S = require(path.join(__dirname, '../../web/js/sportlogic.js'));
const sibling = path.join(__dirname, '../../../iptv-ios-appletv/docs/sport_cases.json');
const C = JSON.parse(fs.readFileSync(fs.existsSync(sibling) ? sibling : path.join(__dirname, 'sport_cases.json'), 'utf8'));
const ms = (iso) => Date.parse(iso);
let n = 0;
let bad = 0;
const eq = (a, b, what) => { n++; try { assert.deepStrictEqual(a, b, what); } catch (e) { bad++; console.log("FOUT " + what + "\n  kreeg " + JSON.stringify(a) + "\n  verwacht " + JSON.stringify(b)); } };

C.categories.forEach(([name, want]) => eq(S.isSportCategory(name), want, 'categorie ' + name));
C.channels.forEach(([ch, cat, fav, want]) => eq(S.isSportChannel(ch, cat, fav), want, 'zender ' + ch + ' / ' + cat));
C.quality.forEach(([ch, q]) => eq(S.quality(ch), q, 'kwaliteit ' + ch));
C.excluded.forEach(([t, want]) => eq(S.isExcluded(t), want, 'herhaling ' + t));
C.clean.forEach(([raw, want]) => eq(S.cleanTeam(raw), want, 'opschonen ' + raw));
C.short.forEach(([name, want]) => eq(S.short(name), want, 'initialen ' + name));
C.teamKey.forEach(([name, want]) => eq(S.teamKey(name), want, 'teamsleutel ' + name));
// kleur: zelfde team (ook met/zonder FC) = zelfde kleur; de index staat in de gevallen
C.color.forEach(([name, idx]) => eq(S.colorIndex(name), idx, 'kleur ' + name));

const start = ms('2026-11-21T19:30:00Z');
C.classify.forEach((c) => {
  const got = S.classify({ title: c.title, description: c.description, channel: c.channel, category: c.category,
    start, end: start + c.minutes * 60000 });
  if (c.expect === null) return eq(got, null, 'geen wedstrijd: ' + c.title);
  const want = Object.assign({ competitionId: '' }, c.expect);
  eq(got, want, 'wedstrijd: ' + c.title);
});

C.matchKey.forEach((c) => {
  const s = ms(c.start);
  const m = S.classify({ title: c.title, channel: c.channel || 'Sport', category: 'Sport', start: s, end: s + 7200000 });
  eq(S.matchKey(m, s), c.key, 'sleutel ' + c.title);
});

function listings(list) {
  return list.map((l) => {
    const s = ms(l.start), e = s + l.minutes * 60000;
    return { id: l.id, channel: l.channel, favorite: !!l.favorite, start: s, end: e,
      match: S.classify({ title: l.title, channel: l.channel, category: 'Sport', start: s, end: e }) };
  });
}
C.dedupe.forEach((c, i) => eq(S.dedupe(listings(c.listings)).map((g) => g.listings.map((l) => l.id)), c.expect, 'ontdubbelen ' + i));

C.auto.forEach((c, i) => {
  const groups = S.dedupe(listings(c.listings));
  eq(S.autoReminders(groups, { now: ms(c.now), teams: c.teams, competitions: c.competitions, muted: c.muted, existing: c.existing }),
    c.expect, 'automatisch ' + i);
});
C.pruneMuted.forEach((c, i) => eq(S.pruneMuted(c.keys, ms(c.now)), c.expect, 'dempen opruimen ' + i));

// eigen controles
eq(S.lead(15), 15, 'lead 15'); eq(S.lead(7), 5, 'lead onbekend = 5'); eq(S.lead(0), 0, 'lead 0');
eq(S.hash(''), 0x811c9dc5, 'fnv leeg');
eq(S.hash('a'), 0xe40c292c, 'fnv a');
eq(S.fold('Atlético Ølstykke Straße'), 'atletico olstykke strasse', 'fold');
if (bad) { console.log('sport: ' + bad + ' van ' + n + ' controles fout'); process.exit(1); }
console.log('sport: ' + n + ' controles goed');
