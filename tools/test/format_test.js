// Build 149: snelle ISO-parser (B.parseISO zonder Date.parse per item), gedeelde datumopmakers (B.dateFmt) en de
// naam-, kleur- en logo-logica van "Ontdek categorieën" (web/js/discovercats.js). Draaien: node tools/test/format_test.js
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
const realParseTitle = B.parseTitle;
// parseISO: zelfde uitkomst als Date.parse voor alle vormen die de apps schrijven
const cases = ['2026-10-12T18:00:00.000Z', '2026-10-12T18:00:00Z', '2026-10-12T18:00Z', '2026-10-12', '2026-10-12T18:00:00.1234567Z',
  '2026-10-12T18:00:00+02:00', '2026-10-12T18:00:00.5-05:30', '2026-10-12 18:00:00', '2024-02-29T23:59:59.999Z', '2026-10-12T18:00:00+0200'];
const ref = (s) => { s = s.replace(/\.(\d+)/, (m, d) => '.' + (d + '000').slice(0, 3)); if (s.length === 10) s += 'T00:00:00Z'; if (/^\d{4}-\d\d-\d\d \d/.test(s)) s = s.replace(' ', 'T') + 'Z'; s = s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'); return Date.parse(s); };
cases.forEach((c) => assert.strictEqual(B.parseISO(c), ref(c), c));
assert.strictEqual(B.parseISO(''), null); assert.strictEqual(B.parseISO('onzin'), null); assert.strictEqual(B.parseISO(null), null);
assert.strictEqual(B.parseISO(1700000000), 1700000000000);
assert.ok(Number.isNaN(B.fastISO('2026-13-01')), 'maand 13');
assert.strictEqual(B.parseISO('Mon, 12 Oct 2026 18:00:00 GMT'), Date.parse('Mon, 12 Oct 2026 18:00:00 GMT'), 'terugval Date.parse');
// snel: 200k keer
let t0 = performance.now(); for (let i = 0; i < 200000; i++) B.parseISO('2026-10-12T18:00:00.000Z'); const fast = performance.now() - t0;
console.log(`parseISO 200k: ${fast.toFixed(0)} ms`);
// gedeelde opmaker
B.lang = 'nl';
assert.strictEqual(B.dateFmt({ day: 'numeric', month: 'long' }), B.dateFmt({ day: 'numeric', month: 'long' }), 'één opmaker per taal + opties');
assert.strictEqual(B.fmtDate(Date.UTC(2026, 9, 12, 12), { day: 'numeric', month: 'long', timeZone: 'UTC' }), new Date(Date.UTC(2026, 9, 12, 12)).toLocaleDateString('nl', { day: 'numeric', month: 'long', timeZone: 'UTC' }));
// fold: ASCII snel, accenten nog steeds weg
assert.strictEqual(B.fold('Amélie ÇA'), 'amelie ca'); assert.strictEqual(B.fold('Plain Title'), 'plain title');
// json-lezen: velden en verborgen categorieën
load('jsonpick.js');
const r = B.jsonPick(JSON.stringify([{ stream_id: 1, name: 'a', category_id: '1', extra: 'x' }, { stream_id: 2, name: 'b', category_id: 2 }, { stream_id: 3, category_id: '2' }]), { fields: ['stream_id', 'name', 'category_id'], skip: { 2: true }, keep: ['stream_id', 'name'] });
assert.deepStrictEqual(r, { list: [{ stream_id: 1, name: 'a', category_id: '1' }], skipped: { 2: 2 }, hidden: [[2, 'b'], [3, null]], total: 3 });
assert.deepStrictEqual(B.jsonPick('{"a":{"x":1}}', {}).list, [{ x: 1 }]);
assert.strictEqual(B.jsonPick('<html>', {}).error, 'bad_json');
// Ontdek categorieën (zonder DOM)
B.ui = { h: () => ({}), router: { link: (p) => '#/' + p.join('/') } }; B.lib = { memo: (k, f) => f() }; B.on = () => {};
load('discovercats.js');
const DC = B.discoverCats;
assert.strictEqual(DC.cleanName('NL | Netflix'), 'Netflix'); assert.strictEqual(DC.cleanName('4K - Disney+'), 'Disney+');
assert.strictEqual(DC.cleanName('[EN] Prime Video'), 'Prime Video'); assert.strictEqual(DC.cleanName('Sci-Fi'), 'Sci-Fi');
assert.strictEqual(DC.cleanName('NL: 4K | Actie'), 'Actie');
assert.strictEqual(DC.colorIndex('NL | Actie'), DC.colorIndex('Actie')); assert.ok(DC.colorIndex('Actie') >= 0 && DC.colorIndex('Actie') < 10);
const idx = DC.buildIndex([{ results: [{ provider_name: 'Netflix', logo_path: '/n.jpg', display_priority: 1 }, { provider_name: 'Disney Plus', logo_path: '/d.jpg' },
  { provider_name: 'HBO Max', logo_path: '/h.jpg' }, { provider_name: 'Amazon Prime Video', logo_path: '/p.jpg' }, { provider_name: 'Apple TV+', logo_path: '/a.jpg' },
  { provider_name: 'SkyShowtime', logo_path: '/s.jpg' }, { provider_name: 'Videoland', logo_path: '/v.jpg' }, { provider_name: 'Viaplay', logo_path: '/vp.jpg' }] }]);
const logo = (g) => (DC.logoFor(g, idx) || '').replace('https://image.tmdb.org/t/p/w300', '');
assert.strictEqual(logo('NL | Netflix Series'), '/n.jpg'); assert.strictEqual(logo('4K - Disney+ Movies'), '/d.jpg');
assert.strictEqual(logo('HBO'), '/h.jpg'); assert.strictEqual(logo('NL: Prime Video'), '/p.jpg'); assert.strictEqual(logo('Apple TV+'), '/a.jpg');
assert.strictEqual(logo('SkyShowtime'), '/s.jpg'); assert.strictEqual(logo('Videoland 4K'), '/v.jpg'); assert.strictEqual(logo('Viaplay'), '/vp.jpg');
assert.strictEqual(logo('NL | Actie'), ''); assert.strictEqual(logo('Netflixen en chillen'), '');
// build 151: rij Zenders (channelrow.js): recente/favoriete zenders eerst, dan om en om uit de grootste categorieën (logo eerst),
// hooguit 15, geen dubbele namen, kinderprofiel alleen kindercategorieën, namen opgeschoond
load('language.js'); load('channelrow.js');
const CR = B.channelRow;
assert.strictEqual(CR.cleanName('NL | NPO 1 HD'), 'NPO 1'); assert.strictEqual(CR.cleanName('[NL] Ziggo Sport 4K'), 'Ziggo Sport');
assert.strictEqual(CR.cleanName('UK: BBC One HD'), 'BBC One'); assert.strictEqual(CR.cleanName('NPO 2'), 'NPO 2');
B.parental = { isKidsCategory: (g) => /kids/i.test(g) };
const mk = (id, name, group, logo) => ({ id, name, group, rawGroup: group, logo: logo ? 'https://img.test/' + id + '.png' : null, streamURL: 'https://s.test/' + id });
const chs = [];
for (let i = 0; i < 30; i++) chs.push(mk('a' + i, 'NL | Groot ' + i + ' HD', 'Groot', i % 3 !== 0));
for (let i = 0; i < 10; i++) chs.push(mk('b' + i, 'Middel ' + i, 'Middel', true));
for (let i = 0; i < 4; i++) chs.push(mk('k' + i, 'Kids ' + i, 'NL | Kids', i !== 0));
const byG = {}; chs.forEach((c) => (byG[c.group] = byG[c.group] || []).push(c));
const clib = { channels: chs, channelGroups: ['Middel', 'Groot', 'NL | Kids'] };
const fav = [mk('m1', 'NL: Mijn zender', 'Middel', false), mk('a5', 'NL | Groot 5', 'Groot', true), { _key: 'x', name: 'Elders' }];
let pick = CR.pick(fav, clib, false, byG);
assert.strictEqual(pick.length, 15);
assert.deepStrictEqual(pick.slice(0, 2).map((c) => c.id), ['m1', 'a5'], 'recente en favorieten eerst; placeholder van een andere server niet');
assert.strictEqual(pick[2].group, 'Groot', 'daarna de grootste categorie');
assert.ok(pick.slice(2).every((c) => c.logo), 'genoeg met logo: alleen zenders met een logo als aanvulling');
assert.strictEqual(new Set(pick.map((c) => B.fold(CR.cleanName(c.name)))).size, 15, 'geen dubbele namen ("Groot 5" en "NL | Groot 5 HD")');
assert.ok(pick.some((c) => c.group === 'Middel') && pick.some((c) => c.group === 'NL | Kids'), 'om en om uit meer categorieën');
pick = CR.pick(fav, clib, true, byG);
assert.deepStrictEqual(pick.map((c) => c.id), ['k1', 'k2', 'k3', 'k0'], 'kinderprofiel: alleen kinderzenders, logo eerst');
assert.deepStrictEqual(CR.pick([], { channels: [] }, false, {}), []);
// zoeken (search.js): accenten, woordvolgorde, voorvoegsels, deelwoorden, & = and, typefout, volgorde van de treffers
B.data = { sources: [] }; B.parseTitle = (t) => ({ title: t }); B.chunked = (list, fn) => { list.forEach(fn); return Promise.resolve(); };
load('search.js');
const Q = B.search;
assert.strictEqual(Q.norm('NL | Amélie & Co.', true), 'amelie and co');
assert.strictEqual(Q.norm('[NL] 4K - Café Society', true), 'cafe society');
const lib = { channels: [{ name: 'NL: RTL 4 HD' }, { name: 'Discovery Channel' }], series: [{ title: 'Breaking Bad' }],
  movies: ['NL | Amélie', 'The Lord of the Rings: The Return of the King', 'Fast & Furious', 'Kingdom', 'King', 'The King\'s Speech', 'Spider-Man: No Way Home', 'Interstellar'].map((t) => ({ title: t })) };
const titles = (q) => Q.rankSync([lib], q, 20).movies.map((m) => m.title);
assert.deepStrictEqual(titles('amelie'), ['NL | Amélie'], 'accenten en voorvoegsel');
assert.deepStrictEqual(titles('AMÉLIE'), ['NL | Amélie']);
assert.deepStrictEqual(titles('king return lord'), ['The Lord of the Rings: The Return of the King'], 'woordvolgorde maakt niet uit');
assert.deepStrictEqual(titles('fast and furious'), ['Fast & Furious'], '& = and');
assert.deepStrictEqual(titles('fast furious'), ['Fast & Furious']);
assert.deepStrictEqual(titles('spiderman').length, 0, 'spiderman is één woord, Spider-Man twee (geen typefout van 1)');
assert.deepStrictEqual(titles('spider man home'), ['Spider-Man: No Way Home'], 'leestekens');
assert.deepStrictEqual(titles('stell'), ['Interstellar'], 'deel van een woord');
assert.deepStrictEqual(titles('intersteller'), ['Interstellar'], 'één typefout bij 5+ letters');
assert.deepStrictEqual(titles('kng').length, 0, 'geen typefout bij korte woorden');
assert.deepStrictEqual(titles('king'), ['King', 'Kingdom', 'The Lord of the Rings: The Return of the King', 'The King\'s Speech'], 'exact, begint met, woordbegin (binnen een groep de volgorde van de lijst)');
assert.deepStrictEqual(Q.rankSync([lib], 'rtl 4', 5).channels.map((c) => c.name), ['NL: RTL 4 HD'], 'zenders');
assert.strictEqual(Q.score('breaking bad', Q.query('bad breaking')), 2);
assert.ok(Q.within1('interstellar', 'intersteller') && Q.within1('abcd', 'abdc') && !Q.within1('abc', 'axz'));
// build 150: taal-, land- en kwaliteitsaanduidingen weg (B.catClean/B.catName, één plek in core.js) en samenvoegen
const CC = (g) => B.catName(g);
[['| NL | NETFLIX', 'Netflix'], ['| MULTI / LINGO | NETFLIX', 'Netflix'], ['NL: Bioscoop', 'Bioscoop'], ['[EN] Disney+ 4K', 'Disney+'],
  ['BE ¦ VTM GO', 'VTM GO'], ['NETFLIX (NL)', 'Netflix'], ['TR - DIZI', 'Dizi'], ['4K | UHD | SPORT', 'Sport'], ['| NL | BIOSCOOP', 'Bioscoop'],
  ['| NL | VIDEOLAND', 'Videoland'], ['NL', 'NL'], ['4K', '4K'], ['Kids NL', 'Kids'], ['MULTI-LINGO | NETFLIX', 'Netflix'], ['NL │ Films', 'Films'],
  ['UK ★ DRAMA', 'Drama'], ['» NL « Actie', 'Actie'], ['{FR} Comédie', 'Comédie'], ['NL • RTL 4', 'RTL 4'], ['DE — Sport HD', 'Sport'],
  ['Nederlands | Kinderfilms', 'Kinderfilms'], ['Kids Nederlands', 'Kids'], ['VOD | Netflix', 'Netflix'], ['Netflix MULTI-SUB', 'Netflix'],
  ['NL: 4K | Actie', 'Actie'], ['EX-YU | Filmovi', 'Filmovi'], ['(NL) HBO MAX', 'HBO Max'], ['NL / PRIME VIDEO', 'Prime Video'],
  ['NL | NPO START', 'NPO Start'], ['APPLE TV+ [NL]', 'Apple TV+'], ['NL | SKYSHOWTIME', 'SkyShowtime'], ['NL · VIAPLAY', 'Viaplay'],
  ['BBC', 'BBC'], ['SBS6', 'SBS6'], ['F1', 'F1'], ['ESPN', 'ESPN'], ['NPO', 'NPO'], ['RTL', 'RTL'], ['TV', 'TV'], ['Films', 'Films'], ['SERIES', 'Series'],
  ['Sci-Fi', 'Sci-Fi'], ['SCI-FI', 'Sci-Fi'], ['Spider-Man', 'Spider-Man'], ['AL-JAZEERA', 'Al-Jazeera'], ['US Open', 'US Open'], ['TOP OF THE POPS', 'Top of the Pops'],
  ['  | NL |  ', 'NL'], ['', ''], ['Netflix', 'Netflix'], ['HBO Max', 'HBO Max']
].forEach(([a, b]) => assert.strictEqual(CC(a), b, 'catName ' + JSON.stringify(a)));
assert.deepStrictEqual(B.catClean('| NL | NETFLIX').tags, ['NL']); assert.deepStrictEqual(B.catClean('| MULTI / LINGO | NETFLIX').tags, ['Multi']);
assert.deepStrictEqual(B.catClean('NLD | Netflix').tags, ['NL'], 'drieletter-code als chip in twee letters');
// titels: alleen met scheidingsteken of tussen haakjes (geen "US Marshals" of "The Italian Job" stuk maken)
[['| MULTI / LINGO | Breaking Bad', 'Breaking Bad'], ['NL | Amélie', 'Amélie'], ['Mission: Impossible', 'Mission: Impossible'], ['US Marshals', 'US Marshals'],
  ['The Italian Job', 'The Italian Job'], ['Alien: Covenant', 'Alien: Covenant'], ['Dune 4K', 'Dune'], ['Spider-Man: No Way Home', 'Spider-Man: No Way Home'], ['Up', 'Up']
].forEach(([a, b]) => assert.strictEqual(B.stripTags(a), b, 'stripTags ' + a));
assert.strictEqual(realParseTitle('| MULTI / LINGO | Breaking Bad (2008)').title, 'Breaking Bad');
// Ontdek categorieën: dezelfde naam, logo op de opgeschoonde naam
assert.strictEqual(DC.cleanName('| MULTI / LINGO | NETFLIX'), 'Netflix');
assert.strictEqual(logo('| NL | NETFLIX'), '/n.jpg'); assert.strictEqual(logo('| MULTI / LINGO | NETFLIX'), '/n.jpg'); assert.strictEqual(logo('| NL | VIDEOLAND'), '/v.jpg');
assert.strictEqual(logo('NL | HBO MAX'), '/h.jpg'); assert.strictEqual(logo('[NL] DISNEY+ 4K'), '/d.jpg'); assert.strictEqual(logo('NL: PRIME VIDEO'), '/p.jpg');
assert.strictEqual(logo('| NL | SKYSHOWTIME'), '/s.jpg'); assert.strictEqual(logo('NL · VIAPLAY'), '/vp.jpg'); assert.strictEqual(logo('APPLE TV+ (NL)'), '/a.jpg');
const idx2 = DC.buildIndex([{ results: [{ provider_name: 'NPO Start', logo_path: '/npo.jpg' }] }]);
assert.ok(DC.logoFor('| NL | NPO START', idx2), 'NPO Start');
assert.ok(DC.logoFor('NL | NPO', idx2), 'NPO → NPO Start');
// zoeken: zelfde opschoning
assert.strictEqual(Q.norm('| MULTI / LINGO | Breaking Bad', true), 'breaking bad');
assert.strictEqual(Q.norm('Dune (NL) 4K', true), 'dune');
// build 153: alle pipe-achtige tekens (┃ ｜ ‖ …) = "|"; een stuk tussen twee pipes voorin/achterin weg, wat er ook tussen staat
[['┃NL┃ NPO 1', 'NPO 1'], ['┃NL┃NPO 1', 'NPO 1'], ['|NL| Netflix', 'Netflix'], ['| MULTI / LINGO | NETFLIX', 'Netflix'],
  ['┃NL┃ ┃HD┃ RTL 4', 'RTL 4'], ['NL┃ Videoland', 'Videoland'], ['NL ┃ NPO 1', 'NPO 1'], ['RTL 4 ┃NL┃', 'RTL 4'], ['｜DE｜ Sky Cinema', 'Sky Cinema'],
  ['|ABC 123|', 'ABC 123'], ['Kids | NL', 'Kids'], ['Film | 2024', 'Film | 2024'], ['FILMS | NL', 'Films | NL'], ['|4K| Netflix', 'Netflix'],
  ['|NL| |HD| Ziggo Sport', 'Ziggo Sport'], ['|NL|', 'NL'], ['‖ NL ‖ Actie', 'Actie'], ['∣EN∣ Drama', 'Drama'], ['丨NL丨 Kids', 'Kids'],
  ['╎NL╎ Films', 'Films'], ['︱NL︱ Films', 'Films'], ['⏐NL⏐ Films', 'Films'], ['ǀNLǀ Films', 'Films'], ['|XYZ RANDOM| Netflix', 'Netflix'],
  ['Netflix |NL|', 'Netflix'], ['NL ¦ Netflix', 'Netflix'], ['NL │ Netflix', 'Netflix']
].forEach(([a, b]) => assert.strictEqual(CC(a), b, 'catName (153) ' + JSON.stringify(a)));
assert.deepStrictEqual(B.catClean('┃NL┃ NETFLIX').tags, ['NL'], 'chip uit het stuk tussen pipes');
assert.deepStrictEqual(B.catClean('┃NL┃ ┃MULTI┃ NETFLIX').tags, ['NL', 'Multi']);
assert.ok(CC('|ABC 123|') && CC('┃NL┃') === 'NL', 'nooit leeg');
// titels en zoeken
[['┃NL┃ Breaking Bad', 'Breaking Bad'], ['｜DE｜ Dark', 'Dark'], ['The Office ┃US┃', 'The Office'], ['Film | 2024', 'Film | 2024'], ['US Marshals', 'US Marshals']
].forEach(([a, b]) => assert.strictEqual(B.stripTags(a), b, 'stripTags (153) ' + a));
assert.strictEqual(realParseTitle('┃NL┃ Breaking Bad (2008)').title, 'Breaking Bad');
assert.strictEqual(Q.norm('┃NL┃ ┃4K┃ The Witcher', true), 'the witcher');
// zendernamen (Live TV, rij Zenders, gids, nu afspelen, favorieten): B.chanName; de zender zelf blijft ruw
[['┃NL┃ NPO 1', 'NPO 1'], ['┃NL┃NPO 1', 'NPO 1'], ['┃NL┃ ┃HD┃ RTL 4', 'RTL 4'], ['NL┃ Videoland', 'Videoland'], ['RTL 4 ┃NL┃', 'RTL 4'],
  ['｜DE｜ Sky Cinema', 'Sky Cinema'], ['NL | NPO 1 HD', 'NPO 1'], ['|NL| NPO 2 FHD', 'NPO 2'], ['|ABC 123|', 'ABC 123'], ['NPO 1', 'NPO 1'], ['', '']
].forEach(([a, b]) => assert.strictEqual(B.chanName(a), b, 'chanName ' + JSON.stringify(a)));
assert.strictEqual(CR.cleanName('┃NL┃ NPO 1 HD'), 'NPO 1');
// overige getoonde namen (detailpagina, afleveringen, speler, documenttitel, media-sessie, gids): B.showName
[['┃NL┃ Breaking Bad', 'Breaking Bad'], ['┃NL┃ Journaal', 'Journaal'], ['Journaal ｜NL｜', 'Journaal'], ['|NL| |4K| Dune', 'Dune'], ['NL┃ Pilot', 'Pilot'],
  ['Mission: Impossible', 'Mission: Impossible'], ['S1:E2 · Pilot', 'S1:E2 · Pilot'], ['2024', '2024'], [null, ''], ['', '']
].forEach(([a, b]) => assert.strictEqual(B.showName(a), b, 'showName ' + JSON.stringify(a)));
assert.strictEqual(B.xs ? B.xs.chanKey('┃NL┃ NPO 1') : B.fold(CR.cleanName('┃NL┃ NPO 1')).replace(/[^a-z0-9]/g, ''), B.xs ? B.xs.chanKey('NPO 1') : 'npo1');
// gedeelde gevallen van bingr-android (tools/test/*_cases.json), als die er zijn
{
  const dir = path.join(__dirname, '../../../bingr-android/tools/test');
  const known = new Set(['NL SUB | Netflix', 'Netflix NL SUBS']); // build 150: verschil met Android (labels), buiten build 153
  let n = 0;
  if (fs.existsSync(dir)) fs.readdirSync(dir).filter((f) => /^build15[03]_cases\.json$/.test(f)).forEach((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    (j.clean || []).forEach(([a, nm, tags]) => {
      if (known.has(a)) return;
      const r = B.catClean(a); n++;
      assert.strictEqual(r.name, nm, f + ' ' + JSON.stringify(a));
      if (tags) assert.deepStrictEqual(r.tags, tags, f + ' labels ' + JSON.stringify(a));
    });
    (j.search || []).forEach(([a, b]) => { n++; assert.strictEqual(Q.norm(a, true), b, f + ' zoeken ' + JSON.stringify(a)); });
    (j.pipes || []).forEach(([a, b]) => { n++; assert.strictEqual(B.pipes(a), b, f + ' pipe ' + JSON.stringify(a)); });
  });
  console.log('gedeelde gevallen: ' + n);
}
// samenvoegen + ontdubbelen (library.js): "| NL | NETFLIX" + "| MULTI / LINGO | NETFLIX" = één categorie "Netflix"
{
  const saved = { data: B.data, lib: B.lib, pt: B.parseTitle };
  B.parseTitle = realParseTitle;
  B.data = { customization: () => ({}), ageLimit: () => null, strict: () => false, shared: (k, d) => d, lockedGroups: () => [], hiddenCategoryNames: () => ({}), secret: () => '', sources: [] };
  B.media = { isMediaServer: () => false };
  B.on = () => () => {};
  load('language.js'); load('providers.js'); delete B.lib; load('library.js');
  const L2 = B.lib;
  const mv = (id, t, g, extra) => Object.assign({ id: 'm' + id, title: t, group: g, poster: 'p' + id }, extra || {});
  const raw = { channels: [], series: [], movies: [
    mv(1, 'Squid Game', '| NL | NETFLIX', { tmdb: 93405 }), mv(2, 'Squid Game', '| MULTI / LINGO | NETFLIX', { tmdb: 93405 }),
    mv(3, 'Wednesday (2022)', '| NL | NETFLIX'), mv(4, 'Wednesday', '| MULTI / LINGO | NETFLIX', { year: 2022 }), mv(5, 'Ozark', '| MULTI / LINGO | NETFLIX'),
    mv(6, 'Bad Boys', 'NL: Bioscoop'), mv(7, 'Dune', '[EN] Bioscoop 4K') ] };
  const ctx = { custom: {}, hiddenCats: { '[EN] Bioscoop 4K': true }, lockedGroups: [], kids: false, ageLimit: null, playlist: 'S1' };
  L2.lib = L2.apply(raw, ctx); L2.version++;
  assert.deepStrictEqual([...new Set(L2.lib.movies.map((m) => m.group))], ['Netflix', 'Bioscoop'], 'getoonde namen');
  const by = L2.byGroup('movie');
  assert.deepStrictEqual(Object.keys(by), ['Netflix', 'Bioscoop']);
  assert.strictEqual(by.Netflix.length, 3, 'ontdubbeld: Squid Game (TMDB) en Wednesday (titel + jaar) één keer');
  assert.strictEqual(by['| NL | NETFLIX'], by.Netflix, 'oude naam wijst naar de samengevoegde categorie');
  assert.deepStrictEqual(L2.groupSources('movie', 'Netflix'), ['| NL | NETFLIX', '| MULTI / LINGO | NETFLIX']);
  assert.deepStrictEqual(L2.groupTags('movie', 'Netflix'), ['NL', 'Multi']);
  assert.strictEqual(by.Bioscoop.length, 1, 'verborgen bron blijft verborgen (per bron-id)');
  B.lang = 'nl';
  assert.strictEqual(by.Netflix[0].rawGroup, '| NL | NETFLIX', 'bron in de taal van de gebruiker');
  // hernoemd = eigen naam blijft
  L2.lib = L2.apply(raw, Object.assign({}, ctx, { custom: { renamed: { 'group:| NL | NETFLIX': 'Mijn Netflix' } } })); L2.version++;
  assert.deepStrictEqual([...new Set(L2.lib.movies.map((m) => m.group))], ['Mijn Netflix', 'Netflix', 'Bioscoop']);
  B.data = saved.data; B.parseTitle = saved.pt;
}
// verborgen categorieën: compacte rijen [id, naam, afbeelding, categorie]
Q.hiddenHits([{ sid: 'S1', raw: { hiddenMovies: [[1, 'NL | Amélie 2', 'p.jpg', 'Films 3'], [2, 'Iets anders', null, 'Films 3']] } }], 'amelie', 10).then((h) => {
  assert.deepStrictEqual(h, [{ type: 'movie', title: 'Amélie 2', poster: 'p.jpg', group: 'Films 3', sid: 'S1' }]);
  console.log('format_test: alles goed');
  process.exit(0); // build 150: library.js zet timers (heartbeat); niet wachten
});
