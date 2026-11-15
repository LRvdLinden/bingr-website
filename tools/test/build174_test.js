// Build 174: pure logica van de webspeler (web/js/build174.js). Draaien: node tools/test/build174_test.js
// Zelfde gevallen als tools/selftest (Apple) en Build174LogicTest.kt (Android).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
global.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../../web/js/build174.js'), 'utf8'));
const P = globalThis.B.b174;
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// 1. knoppen onder Afspelen
eq(P.compactActions({ hasListID: true, hasTrailer: true, otherSources: 2, languageVersions: 0, isMovie: true }),
  ['myList', 'trailer', 'sources', 'watched', 'more'], 'vijf knoppen');
eq(P.compactActions({ hasListID: true, hasTrailer: false, otherSources: 0, languageVersions: 0, isMovie: true }),
  ['myList', 'watched', 'more'], 'geen trailer en één bron');
eq(P.compactActions({ hasListID: false, hasTrailer: true, otherSources: 0, languageVersions: 1, isMovie: false }),
  ['trailer', 'sources', 'more'], 'serie zonder Gezien');
eq(P.isCompact(390), true); eq(P.isCompact(820), false); eq(P.isCompact(0), false);
eq(P.sourcesTarget(1, 1), 'choose'); eq(P.sourcesTarget(0, 2), 'languages'); eq(P.sourcesTarget(3, 0), 'otherSources'); eq(P.sourcesTarget(0, 0), 'none');

// 2. trailers
const c = [{ key: 'aaaaaaaaaaa', source: 'server' },
  { key: 'bbbbbbbbbbb', source: 'tmdb', type: 'Teaser', language: 'nl' },
  { key: 'ccccccccccc', source: 'tmdb', type: 'Trailer', language: 'en', official: true },
  { key: 'ddddddddddd', source: 'tmdb', type: 'Trailer', language: 'nl', official: true },
  { key: 'eeeeeeeeeee', source: 'tmdb', type: 'Featurette', language: 'nl' }];
eq(P.bestTrailer(c, 'nl-NL'), 'ddddddddddd', 'trailer in app-taal');
eq(P.bestTrailer(c, 'de'), 'ccccccccccc', 'Engels als er geen Duitse is');
eq(P.bestTrailer([c[0], c[1]], 'nl'), 'aaaaaaaaaaa', 'server gaat voor teaser');
eq(P.bestTrailer([c[1], c[4]], 'nl'), 'bbbbbbbbbbb', 'teaser als er niets beters is');
eq(P.bestTrailer([c[4]], 'nl'), null, 'featurette telt niet');
eq(P.bestTrailer([{ key: 'bad<id>', source: 'server' }], 'nl'), null, 'ongeldige id');
eq(P.bestTrailer([{ key: 'fffffffffff', source: 'tmdb', type: 'Trailer', language: 'en', official: false },
  { key: 'ggggggggggg', source: 'tmdb', type: 'Trailer', language: 'en', official: true }], 'en'), 'ggggggggggg', 'officieel eerst');
eq(P.bestTrailer([{ key: 'hhhhhhhhhhh', source: 'trakt' }, { key: 'iiiiiiiiiii', source: 'server' }], 'nl'), 'iiiiiiiiiii', 'server voor Trakt');
eq(P.bestTrailer([{ key: 'jjjjjjjjjjj', source: 'tmdb', type: 'Trailer', site: 'Vimeo' }], 'nl'), null, 'alleen YouTube');
eq(P.youtubeID('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), 'dQw4w9WgXcQ', 'watch-link');
eq(P.youtubeID('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'korte link');
eq(P.youtubeID('dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'kale id');
eq(P.youtubeID('javascript:alert(1)'), null, 'rommel');
eq(P.tmdbCandidates([{ key: 'k', type: 'Trailer', iso_639_1: 'nl', official: true, site: 'YouTube' }])[0].source, 'tmdb');
eq(P.opening(false, false, false), 'notInstalled'); eq(P.opening(false, true, false), 'youtubeApp'); eq(P.opening(true, true, true), 'inApp');

console.log('build174: ' + n + ' controles ok');
