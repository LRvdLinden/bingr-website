// Build 178: sport-logo's (pure logica, web/js/sportlogos.js). Leest de gedeelde testgevallen uit
// ../iptv-ios-appletv/docs/sportlogos_cases.json als die repo ernaast staat, anders de kopie tools/test/sportlogos_cases.json
// (bron: iptv-ios-appletv/docs/sportlogos_cases.json, niet hier aanpassen). Draaien: node tools/test/sportlogos_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const G = require(path.join(__dirname, '../../web/js/sportlogos.js'));
const sibling = path.join(__dirname, '../../../iptv-ios-appletv/docs/sportlogos_cases.json');
const C = JSON.parse(fs.readFileSync(fs.existsSync(sibling) ? sibling : path.join(__dirname, 'sportlogos_cases.json'), 'utf8'));
let n = 0;
let bad = 0;
const eq = (a, b, what) => { n++; try { assert.deepStrictEqual(a, b, what); } catch (e) { bad++; console.log('FOUT ' + what + '\n  kreeg ' + JSON.stringify(a) + '\n  verwacht ' + JSON.stringify(b)); } };

eq(C.keys.length >= 10 && C.teamArt.length >= 8, true, 'gevallen geladen');
C.keys.forEach(([name, want]) => eq(G.keys(name), want, 'sleutels ' + name));
C.match.forEach(([name, want]) => eq(G.match(G.keys(name), C.matchIndex), want, 'zoeken ' + name));
eq(G.buildIndex(C.buildIndex.teams), C.buildIndex.expect, 'index uit een teamlijst');
C.sportsDBThumb.forEach(([b, want]) => eq(G.sportsDBThumb(b), want, 'TheSportsDB-badge ' + b));
C.sportsDBSport.forEach(([s, want]) => eq(G.sportsDBSport(s), want, 'TheSportsDB-sport ' + s));
C.leagueSlug.forEach(([id, want]) => eq(G.leagueSlug(id), want, 'slug ' + id));
C.site.forEach(([id, want]) => eq(G.site(id), want, 'site ' + id));
C.competitionURLs.forEach(([id, small, want]) => eq(G.competitionURLs(id, small), want, 'competitie-adressen ' + id + ' ' + small));
C.espnLeagues.forEach(([s, c, want]) => eq(G.espnLeagues(s, c), want, 'ESPN ' + s + ' ' + c));
C.countryCode.forEach(([name, want]) => eq(G.countryCode(name), want, 'land ' + name));
C.teamArt.forEach(([name, s, c, want]) => eq(G.teamArt(name, s, c), want, 'team ' + name + ' ' + s));
C.urls.league.forEach(([s, want]) => eq(G.leagueURL(s), want, 'url competitie ' + s));
C.urls.flag.forEach(([s, want]) => eq(G.flagURL(s), want, 'url vlag ' + s));
C.urls.favicon.forEach(([d, size, want]) => eq(G.faviconURL(d, size), want, 'url favicon ' + d));
C.urls.espnTeams.forEach(([c, want]) => eq(G.espnTeamsURL(c), want, 'url ESPN ' + c));
C.urls.sportsDBSearch.forEach(([name, want]) => eq(G.sportsDBSearchURL(name), want, 'url TheSportsDB ' + name));
C.usable.forEach(([k, age, s, want]) => eq(G.usable(k, age, s), want, 'cache ' + [k, age, s].join(' ')));
C.cacheName.forEach(([p, k, e, want]) => eq(G.cacheName(p, k, e), want, 'cachenaam ' + k));

// alleen web: ESPN- en TheSportsDB-JSON naar teamlijsten
eq(G.espnTeams({ sports: [{ leagues: [{ teams: [{ team: { displayName: 'AFC Ajax', shortDisplayName: 'Ajax', location: 'Ajax',
  logos: [{ href: 'https://a.espncdn.com/x.png' }] } }] }] }] }), [{ names: ['AFC Ajax', 'Ajax', 'Ajax'], logo: 'https://a.espncdn.com/x.png' }], 'ESPN-lijst');
eq(G.espnTeams({}), [], 'ESPN-lijst leeg');
eq(G.sportsDBTeams({ teams: [{ strTeam: 'Go Ahead Eagles', strTeamShort: 'GAE', strTeamAlternate: 'G.A. Eagles', strSport: 'Soccer', strBadge: 'https://r2.thesportsdb.com/b.png' },
  { strTeam: 'Eagles', strSport: 'American Football', strBadge: 'https://x/e.png' }] }, 'football'),
  [{ names: ['Go Ahead Eagles', 'GAE', 'G.A. Eagles'], logo: 'https://r2.thesportsdb.com/b.png/small' }], 'TheSportsDB-lijst (alleen voetbal)');
eq(G.sportsDBTeams({ teams: null }, 'football'), [], 'TheSportsDB leeg');

console.log(n + ' controles, ' + bad + ' fout');
process.exit(bad ? 1 : 0);
