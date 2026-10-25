// Build 151: rijen op Home zonder dubbele titels als een titel op meer servers staat (Voor jou, Nieuw op Bingr, Top 10,
// Verder kijken, Mijn lijst, Ontdek categorieën, rijen per categorie en Zenders). Twee servers met overlappende titels:
// ontdubbelen op TMDB-/IMDb-id, anders genormaliseerde titel + jaar; zenders op de opgeschoonde naam. De bron die blijft:
// eerst die in de audio-/app-taal, dan de actieve server, dan de rest. Verder kijken: één tegel met de nieuwste voortgang.
// Draaien: node tools/test/homededupe_test.js
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const WEB = path.join(__dirname, '../../web/js');
global.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 };
globalThis.document = { readyState: 'complete', hidden: false, documentElement: { getAttribute: () => null, dir: 'ltr' }, addEventListener: () => {}, createElement: () => ({}) };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'nl-NL', onLine: true }, configurable: true });
const load = (f) => (0, eval)(fs.readFileSync(path.join(WEB, f), 'utf8'));
load('core.js');
const B = globalThis.B;
B.lang = 'nl';
const D = B.data = { customization: () => ({}), ageLimit: () => null, strict: () => false, shared: (k, d) => d, profilePref: () => null, lockedGroups: () => [],
  hiddenCategoryNames: () => ({}), secret: () => '', sources: [], history: () => [], progressList: () => [], setList: () => [], progress: () => null,
  isWatched: () => false, isMain: () => true, key: (s, i) => s + '|' + i };
B.media = { isMediaServer: () => false };
B.on = () => () => {};
B.ui = { h: () => ({}), router: { link: (p) => '#/' + p.join('/') } };
load('language.js'); load('providers.js'); load('library.js');
const Lib = B.lib;
// xs.js zonder DOM-deel (alleen de pure logica)
B.data = null; load('xs.js'); B.data = D;
const X = B.xs;

// MARK: twee servers met overlappende titels
const S1 = { id: 'S1', name: 'Server 1' }, S2 = { id: 'S2', name: 'Server 2' };
const now = Date.now();
const mv = (id, t, g, extra) => Object.assign({ id, title: t, group: g, poster: 'https://img.test/' + id + '.jpg' }, extra || {});
const raw1 = { channels: [
  { id: 'c1', name: 'NL | NPO 1 HD', group: 'NL | Algemeen', logo: 'https://img.test/npo1.png', streamURL: 'https://s1/c1' },
  { id: 'c2', name: 'UK: BBC One HD', group: 'UK | General', logo: 'https://img.test/bbc.png', streamURL: 'https://s1/c2' },
  { id: 'c3', name: 'NL | NPO 1 FHD', group: 'NL | Algemeen', logo: 'https://img.test/npo1b.png', streamURL: 'https://s1/c3' }
], series: [
  mv('s1a', 'Squid Game', 'EN | Netflix', { tmdb: 93405, rating: 8, addedAt: now - 1000 }),
  mv('s1b', 'Wednesday (2022)', 'EN | Netflix', { rating: 7.5, addedAt: now - 3000 }),
  mv('s1c', 'The Office (2005)', 'EN | Comedy', { rating: 9, addedAt: now - 5000 })
], movies: [
  mv('m1a', 'Dune (2021)', 'NL: Films', { rating: 8.1, addedAt: now - 1000 }),
  mv('m1b', 'Dune 4K (2021)', '4K | Films', { rating: 8.1, addedAt: now - 1100 }),
  mv('m1c', 'Oppenheimer', 'EN | Films', { imdb: 'tt15398776', year: 2023, rating: 8.5, addedAt: now - 2000 }),
  mv('m1d', 'Heat (1995)', 'EN | Films', { tmdb: 949, rating: 8.3, addedAt: now - 4000 }),
  mv('m1e', 'Inception (2010)', 'EN | Films', { tmdb: 27205, rating: 8.8, addedAt: now - 6000 })
] };
for (let i = 0; i < 10; i++) raw1.movies.push(mv('m1x' + i, 'Film ' + i + ' (2019)', 'NL: Films', { rating: 6 + i / 10, addedAt: now - 90000 - i }));
const raw2 = { channels: [
  { id: 'd1', name: 'NPO1', group: 'Nederland', logo: 'https://img.test/npo1-2.png', streamURL: 'https://s2/d1' },
  { id: 'd2', name: '[NL] RTL 4 HD', group: 'Nederland', logo: 'https://img.test/rtl4.png', streamURL: 'https://s2/d2' }
], series: [
  mv('s2a', 'NL | Squid Game', '| NL | NETFLIX', { tmdb: 93405, rating: 8, addedAt: now - 900 }),
  mv('s2b', 'Wednesday', 'Netflix', { rating: 7.5, addedAt: now - 2900 }),
  mv('s2c', 'The Office (2001)', 'Comedy', { rating: 8.8, addedAt: now - 4900 })
], movies: [
  mv('m2a', 'Dune (2021)', 'Films', { rating: 8.1, addedAt: now - 950 }),
  mv('m2c', 'Oppenheimer (2023)', 'Films', { tmdb: 872585, imdb: 'tt15398776', rating: 8.5, addedAt: now - 1900 }),
  mv('m2d', 'Heat (1995)', 'Films', { tmdb: 1234567, rating: 7, addedAt: now - 3900 }),
  mv('m2e', 'Inception', 'NL | Films', { tmdb: 27205, rating: 8.8, addedAt: now - 5900 })
] };
const ctx = (id) => ({ custom: {}, hiddenCats: {}, lockedGroups: [], kids: false, ageLimit: null, playlist: id });
const lib2 = Lib.apply(raw2, ctx('S2'));
[['channel', lib2.channels], ['movie', lib2.movies], ['series', lib2.series]].forEach(([, l]) => l.forEach((x) => { x._src = S2; }));
Lib.lib = Lib.apply(raw1, ctx('S1')); Lib.version++;
Lib.source = S1;
const lib1 = Lib.lib;
const byId = (lib, id) => lib.movies.concat(lib.series, lib.channels).find((x) => x.id === id);
const src = (x) => (x._src ? x._src.id : 'S1');
const tag = (hit) => src(hit.item) + ':' + hit.item.id;
/** Geen titel twee keer (zelfde groep volgens X.groupHits). */
function noDupes(hits, what) {
  const groups = X.groupHits(hits);
  assert.strictEqual(groups.length, hits.length, what + ': dubbele titels ' + JSON.stringify(groups.filter((g) => g.length > 1).map((g) => g.map(tag))));
}

// MARK: zelfde werk herkennen
{
  const g = X.groupHits(['s1a', 's1b', 's1c'].map((id) => ({ type: 'series', item: byId(lib1, id) }))
    .concat(['s2a', 's2b', 's2c'].map((id) => ({ type: 'series', item: byId(lib2, id) }))));
  assert.deepStrictEqual(g.map((x) => x.map(tag)), [['S1:s1a', 'S2:s2a'], ['S1:s1b', 'S2:s2b'], ['S1:s1c'], ['S2:s2c']],
    'TMDB-id; titel + jaar (geen jaar aan één kant = zelfde titel); ander jaar = andere serie');
  const m = X.groupHits(lib1.movies.concat(lib2.movies).map((x) => ({ type: 'movie', item: x })));
  const of = (id) => m.find((gr) => gr.some((h) => h.item.id === id)).map(tag);
  assert.deepStrictEqual(of('m1c'), ['S1:m1c', 'S2:m2c'], 'IMDb-id');
  assert.deepStrictEqual(of('m1d'), ['S1:m1d'], 'andere TMDB-id = andere film, ook met dezelfde titel + jaar');
  assert.deepStrictEqual(of('m1a'), ['S1:m1a', 'S1:m1b', 'S2:m2a'], '"Dune 4K (2021)" = "Dune (2021)" (opschoning)');
  assert.deepStrictEqual(of('m1e'), ['S1:m1e', 'S2:m2e'], 'TMDB-id, titel zonder jaar');
  assert.ok(X.sameWork('movie', byId(lib1, 'm1a'), byId(lib2, 'm2a')) && !X.sameWork('movie', byId(lib1, 'm1d'), byId(lib2, 'm2d')));
  assert.ok(X.sameWork('series', byId(lib1, 's1b'), byId(lib2, 's2b')) && !X.sameWork('series', byId(lib1, 's1c'), byId(lib2, 's2c')));
  assert.strictEqual(X.chanKey('NL | NPO 1 HD'), X.chanKey('NPO1'));
}

// MARK: welke bron blijft staan
{
  const hits = [{ type: 'series', item: byId(lib1, 's1a') }, { type: 'series', item: byId(lib2, 's2a') }];
  assert.strictEqual(tag(X.pickHit(hits, { langs: ['nl'], activeId: 'S1' })), 'S2:s2a', 'eerst de bron in de audio-/app-taal (NL), ook op een andere server');
  assert.strictEqual(tag(X.pickHit(hits, { langs: ['de'], activeId: 'S1' })), 'S1:s1a', 'geen bron in de taal: de actieve server');
  assert.strictEqual(tag(X.pickHit(hits, { langs: ['de'], activeId: 'S3' })), 'S1:s1a', 'anders de eerste');
  assert.strictEqual(tag(X.pickHit(hits.slice().reverse(), { langs: ['en'], activeId: 'S2' })), 'S1:s1a', 'taal gaat voor de actieve server');
  const dune = [{ type: 'movie', item: byId(lib2, 'm2a') }, { type: 'movie', item: byId(lib1, 'm1b') }, { type: 'movie', item: byId(lib1, 'm1a') }];
  assert.strictEqual(tag(X.pickHit(dune, { langs: ['nl'], activeId: 'S1' })), 'S1:m1a', 'NL-categorie van de actieve server');
  assert.strictEqual(tag(X.pickHit(dune, { langs: ['fr'], activeId: 'S1' })), 'S1:m1b', 'actieve server');
  assert.deepStrictEqual(X.prefLangs(), ['nl'], 'audiotaal = app-taal (nl)');
  // plek in de rij: waar de titel het eerst staat
  const row = X.dedupeHome([{ type: 'movie', item: byId(lib1, 'm1e') }].concat(dune, [{ type: 'movie', item: byId(lib2, 'm2e') }]), { langs: ['nl'], activeId: 'S1' });
  assert.deepStrictEqual(row.map(tag), ['S2:m2e', 'S1:m1a'], 'Inception op zijn eerste plek, de NL-bron van server 2');
}

// MARK: Nieuw op Bingr (discover.js) over beide servers
{
  B.screens = { pages: {}, navOwner: {} }; B.ageRatings = { hasKey: () => false };
  Lib.firstSeen = () => 0;
  X.libs = () => [lib1, lib2]; X.version = 0; Lib.seenVersion = 0;
  load('discover.js');
  const nb = B.discover.newOnBingr(30);
  noDupes(nb, 'Nieuw op Bingr');
  assert.strictEqual(nb.length, 19, '25 titels, 6 dubbel (Squid Game, Wednesday, Dune ×2, Oppenheimer, Inception) → 19');
  const sq = nb.find((e) => /Squid/.test(e.item.title));
  assert.strictEqual(tag(sq), 'S2:s2a', 'Squid Game: de NL-bron van server 2');
  assert.deepStrictEqual(nb.slice(0, 2).map((e) => e.item.title.replace(/ \(.*/, '')), ['Squid Game', 'Dune'], 'nieuwste eerst (Dune van server 2 is nieuwer dan die van server 1)');
  assert.strictEqual(tag(nb[1]), 'S1:m1a', 'Dune: de NL-bron van de actieve server blijft staan, op de plek van de nieuwste');
  assert.ok(nb.some((e) => tag(e) === 'S1:m1d') && nb.some((e) => tag(e) === 'S2:m2d'), 'Heat: twee verschillende films (andere TMDB-id)');
}

// MARK: Voor jou / Populair (mybingr.js) over beide servers
{
  B.account = {}; B.app = { profile: { id: 'p1' } };
  Lib.warmers = [];
  load('mybingr.js');
  const S = B.screens;
  S.movieWatched = () => false; S.seriesWatchedCount = () => 0;
  const fy = S.forYou();
  assert.strictEqual(fy.popular, true);
  noDupes(fy.items, 'Voor jou');
  assert.ok(fy.items.length >= 14, 'Voor jou gevuld: ' + fy.items.length);
  assert.strictEqual(tag(fy.items.find((e) => /Squid/.test(e.item.title))), 'S2:s2a', 'Voor jou: NL-bron');
  assert.strictEqual(tag(fy.items.find((e) => /Dune/.test(e.item.title))), 'S1:m1a', 'Voor jou: NL-bron, actieve server');
}

// MARK: Top 10 (actieve server; "Dune" en "Dune 4K" = één)
{
  const t = Lib.top10(lib1.movies);
  assert.strictEqual(t.length, 10);
  noDupes(t.map((x) => ({ type: 'movie', item: x })), 'Top 10 films');
  assert.strictEqual(t.filter((x) => /Dune/.test(x.title)).length, 1);
  assert.strictEqual(t.find((x) => /Dune/.test(x.title)).id, 'm1a', 'Top 10: de NL-bron');
  noDupes(Lib.top10(lib1.series).map((x) => ({ type: 'series', item: x })), 'Top 10 series');
}

// MARK: rijen per categorie en Ontdek categorieën (actieve server, samengevoegde categorie "Films")
{
  const by = Lib.byGroup('movie');
  const films = by.Films || [];
  assert.ok(films.length >= 11, 'samengevoegd: NL: Films + 4K | Films + EN | Films');
  const rowHits = X.dedupeHome(films.slice(0, 60).map((x) => ({ type: 'movie', item: x }))).slice(0, 30);
  noDupes(rowHits, 'rij Films');
  load('discovercats.js');
  const DC = B.discoverCats;
  const one = { channels: [], series: [], movies: [
    mv('d1', 'Dune (2021)', 'NL | Actie'), mv('d2', 'Dune 4K (2021)', 'NL | Actie'), mv('d3', 'Heat (1995)', 'NL | Actie'),
    mv('d4', 'Alien (1979)', 'NL | Actie'), mv('d5', 'Aliens (1986)', 'NL | Actie') ] };
  const keep = { lib: Lib.lib, v: Lib.version };
  Lib.lib = Lib.apply(one, ctx('S1')); Lib.version++;
  Lib.lib.movieGroups = Object.keys(Lib.byGroup('movie')); Lib.lib.seriesGroups = [];
  const dc = DC.pick(Lib.lib, false);
  assert.strictEqual(dc.length, 1);
  assert.deepStrictEqual(dc[0].posters.map((p) => p.replace(/^.*\/|\.jpg$/g, '')), ['d1', 'd3', 'd4', 'd5'], 'Ontdek categorieën: vier verschillende titels');
  Lib.lib = keep.lib; Lib.version++;
}

// MARK: Verder kijken: dezelfde titel op twee servers = één tegel, met de meest recente voortgang
{
  const entries = [ // nieuwste eerst (D.progressList)
    { x: byId(lib2, 'm2c'), type: 'movie', p: 0.7, keys: ['m2c'] },
    { x: byId(lib1, 's1a'), type: 'series', p: 0.2, keys: ['ep1', 'ep2'] },
    { x: byId(lib1, 'm1c'), type: 'movie', p: 0.1, keys: ['m1c'] },
    { x: byId(lib2, 's2a'), type: 'series', p: 0.9, keys: ['ep9'] },
    { x: byId(lib1, 'm1e'), type: 'movie', p: 0.5, keys: ['m1e'] }
  ];
  const c = X.mergeContinue(entries, 20);
  assert.deepStrictEqual(c.map((e) => src(e.x) + ':' + e.x.id + '@' + e.p), ['S2:m2c@0.7', 'S1:s1a@0.2', 'S1:m1e@0.5'], 'één tegel per titel, de nieuwste voortgang');
  assert.deepStrictEqual(c[0].keys, ['m2c', 'm1c']); assert.deepStrictEqual(c[1].keys, ['ep1', 'ep2', 'ep9'], 'alle sleutels (Verwijderen uit Verder kijken)');
  assert.strictEqual(X.mergeContinue(entries, 2).length, 2);
}

// MARK: Mijn lijst (zelfde titel van beide servers toegevoegd) en Zenders
{
  const list = [{ type: 'series', item: byId(lib1, 's1a') }, { type: 'movie', item: byId(lib1, 'm1e') }, { type: 'series', item: byId(lib2, 's2a') }];
  let merged = null;
  const ml = X.dedupeHome(list, { langs: ['nl'], activeId: 'S1', onMerge: (p, o) => { merged = [tag(p), o.map(tag)]; } });
  assert.deepStrictEqual(ml.map(tag), ['S2:s2a', 'S1:m1e'], 'Mijn lijst: één Squid Game (NL-bron), op de eerste plek');
  assert.deepStrictEqual(merged, ['S2:s2a', ['S1:s1a']], 'de andere bron gaat mee (sleutels om te verwijderen)');
  load('channelrow.js');
  const CR = B.channelRow;
  B.parental = { isKidsCategory: () => false };
  // recente/favoriete zenders van beide servers
  const first = X.dedupeHome([byId(lib2, 'd1'), byId(lib1, 'c1'), byId(lib2, 'd2'), byId(lib1, 'c3')].map((x) => ({ type: 'channel', item: x })), { langs: ['nl'], activeId: 'S1' });
  assert.deepStrictEqual(first.map(tag), ['S1:c1', 'S2:d2'], 'NPO 1 (drie keer, twee servers) = één, de NL-categorie van de actieve server');
  const chans = CR.pick(first.map((h) => h.item), lib1, false, Lib.byGroup('channel'));
  const names = chans.map((c) => X.chanKey(c.name));
  assert.strictEqual(new Set(names).size, names.length, 'Zenders: geen dubbele namen ' + names);
  assert.deepStrictEqual(chans.map((c) => src(c) + ':' + c.id), ['S1:c1', 'S2:d2', 'S1:c2'], 'NPO 1 FHD van dezelfde server telt niet nog eens');
}
console.log('homededupe_test: alles goed');
process.exit(0); // library.js zet timers
