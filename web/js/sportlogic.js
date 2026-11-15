/*
 * Build 172: Sport. Pure logica (zonder DOM), gelijk aan Sport173 op Apple (Shared/Sport/Build173.swift) en
 * Build173Logic.kt op Android. Gedeelde testgevallen: docs/sport_cases.json van iptv-ios-appletv
 * (kopie: tools/test/sport_cases.json). Unittests: node tools/test/sport_test.js
 *
 * - sportzenders herkennen aan de categorie (en favoriete zenders die op sport lijken);
 * - een programma is een wedstrijd als de titel een duel is ("A - B", "A vs B", "A v B") of een bekend evenement;
 * - herhalingen, samenvattingen en studio's niet; korter dan 20 min alleen evenementen;
 * - sport en competitie uit titel, beschrijving, zender en categorie (kleine tabel), anders "other";
 * - teamnamen opschonen, initialen (3 tekens) en een vaste kleur;
 * - ontdubbelen over zenders/servers (zelfde teams of titel, aftrap ±15 min), volgorde favoriet > kwaliteit > gids;
 * - een vaste sleutel per wedstrijd (herinneringen, dempen).
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var S = B.sportLogic = {};

  S.MIN_MINUTES = 20;          // korter = geen wedstrijd (behalve evenementen)
  S.MERGE_MS = 15 * 60000;     // zelfde wedstrijd als de aftrap hooguit 15 min verschilt
  S.DAYS = 7;                  // vooruit
  S.LEADS = [0, 5, 15];        // melding: bij de start, 5 of 15 min eerder
  S.DEFAULT_LEAD = 5;
  S.SPORTS = ['football', 'motorsport', 'tennis', 'darts', 'cycling', 'basketball', 'icehockey',
    'americanfootball', 'combat', 'golf', 'other'];
  S.COLORS = [0xC8102E, 0x1D4ED8, 0x15803D, 0xB45309, 0x7C3AED, 0xBE185D,
    0x0E7490, 0x4D7C0F, 0x9A3412, 0x1E3A8A, 0x6D28D9, 0x374151];

  var EXTRA = { 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ł': 'l', 'đ': 'd', 'ı': 'i', 'þ': 'th' };

  /** Kleine letters, zonder accenten (NFD zonder U+0300–U+036F) en een paar losse letters. */
  S.fold = function (s) {
    s = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) { var c = s[i]; out += EXTRA[c] !== undefined ? EXTRA[c] : c; }
    return out;
  };

  /** Woorden van [a-z0-9] na fold. */
  S.tokens = function (s) {
    var t = S.fold(s).split(/[^a-z0-9]+/);
    return t.filter(function (x) { return x.length > 0; });
  };

  function padded(s) { return ' ' + S.tokens(s).join(' ') + ' '; }
  function hasPhrase(p, phrase) { return p.indexOf(' ' + phrase + ' ') >= 0; }
  function anyPhrase(p, list) { for (var i = 0; i < list.length; i++) if (hasPhrase(p, list[i])) return list[i]; return null; }

  // MARK: zenders en categorieën

  var CAT_WORDS = ['sport', 'sports', 'voetbal', 'football', 'soccer', 'f1', 'motorsport', 'tennis', 'darts', 'golf',
    'nba', 'nfl', 'nhl', 'ufc', 'boxing', 'dazn', 'espn', 'eurosport', 'viaplay', 'bein', 'supersport'];
  var CAT_PHRASES = ['ziggo sport', 'sky sports', 'tnt sports', 'canal sport', 'arena sport'];
  var EVENT_WORDS = ['events', 'event', 'ppv'];

  /** Woord gelijk aan een sleutelwoord, of sleutelwoord + cijfers ("sport1", "espn2"). */
  function wordHit(tokens, words) {
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        if (t === w) return true;
        if (t.length > w.length && t.indexOf(w) === 0 && /^[0-9]+$/.test(t.slice(w.length))) return true;
      }
    }
    return false;
  }

  /** Lijkt deze naam (categorie of zender) op sport? */
  S.looksSport = function (name) {
    var t = S.tokens(name);
    return wordHit(t, CAT_WORDS) || anyPhrase(' ' + t.join(' ') + ' ', CAT_PHRASES) !== null;
  };
  /** EVENTS-/PPV-categorie. */
  S.isEventCategory = function (name) { return wordHit(S.tokens(name), EVENT_WORDS); };
  /** Sportcategorie (inclusief EVENTS/PPV). */
  S.isSportCategory = function (name) { return S.looksSport(name) || S.isEventCategory(name); };
  /** Doet deze zender mee: sportcategorie, of favoriete zender die op sport lijkt. */
  S.isSportChannel = function (channelName, category, favorite) {
    return S.isSportCategory(category) || (!!favorite && S.looksSport(channelName));
  };

  /** Kwaliteit uit de zendernaam: 4 = 4K/UHD, 3 = FHD, 2 = HD (en onbekend), 1 = SD. */
  S.quality = function (channelName) {
    var t = S.tokens(channelName);
    function has(list) { for (var i = 0; i < list.length; i++) if (t.indexOf(list[i]) >= 0) return true; return false; }
    if (has(['4k', 'uhd', '2160p', '2160'])) return 4;
    if (has(['fhd', '1080p', '1080', '1080i'])) return 3;
    if (has(['sd', '576p', '480p', '576i'])) return 1;
    return 2;
  };

  // MARK: titels opschonen

  var DROP_WORDS = ['live', 'hd', 'fhd', 'uhd', '4k', 'sd', 'hevc', 'h265', 'h264', '50fps', '60fps',
    '1080p', '720p', '2160p'];

  function isTime(w) { return /^[0-9]{1,2}[:.h][0-9]{2}u?$/i.test(w); }

  function stripBrackets(s) {
    var prev;
    do { prev = s; s = s.replace(/\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}/g, ' '); } while (s !== prev);
    return s;
  }

  function stripPrefixTags(s) {
    var prev;
    do {
      prev = s;
      s = s.replace(/^\s*\|[^|]{1,12}\|\s*/, '');
      s = s.replace(/^\s*[A-Z]{2,3}\s*[:|]\s*/, '');
    } while (s !== prev);
    return s;
  }

  var TRIM = ' -|:.,·•*–—_/';
  function trimPunct(s) {
    var a = 0, b = s.length;
    while (a < b && TRIM.indexOf(s[a]) >= 0) a++;
    while (b > a && TRIM.indexOf(s[b - 1]) >= 0) b--;
    return s.slice(a, b);
  }

  function dropWords(s) {
    var words = s.split(/\s+/).filter(function (w) { return w.length > 0; });
    var out = [];
    words.forEach(function (w) {
      var core = trimPunct(w);
      if (core.length > 0 && (DROP_WORDS.indexOf(S.fold(core)) >= 0 || isTime(core))) return;
      out.push(w);
    });
    return out.join(' ');
  }

  /** Titel zonder haakjes, voorvoegsels, LIVE, kwaliteit en tijden. */
  S.cleanTitle = function (raw) {
    var s = stripPrefixTags(String(raw || ''));
    s = stripBrackets(s);
    s = dropWords(s);
    s = trimPunct(s.replace(/\s+/g, ' ').trim());
    return s.replace(/\s+/g, ' ').trim();
  };

  /** Teamnaam opgeschoond (zonder land- en kwaliteitslabels, LIVE en tijden). */
  S.cleanTeam = function (raw) { return S.cleanTitle(raw); };

  // MARK: herhalingen

  var REPLAY_WORDS = ['herh', 'herhaling', 'replay', 'samenvatting', 'samenvattingen', 'highlights', 'studio',
    'voorbeschouwing', 'nabeschouwing', 'magazine'];

  /** Herhaling, samenvatting, studio of magazine. */
  S.isExcluded = function (title) {
    var raw = String(title || '');
    if (/\(\s*r\s*\)/i.test(raw)) return true;
    var t = S.tokens(raw);
    for (var i = 0; i < t.length; i++) if (REPLAY_WORDS.indexOf(t[i]) >= 0) return true;
    return false;
  };

  // MARK: competities

  // volgorde telt: specifiek vóór algemeen (Premier League Darts vóór Premier League, MotoGP vóór Formule 1)
  S.COMPETITIONS = [
    { id: 'premier-league-darts', name: 'Premier League Darts', sport: 'darts', p: ['premier league darts'] },
    { id: 'wk-darts', name: 'WK Darts', sport: 'darts', p: ['wk darts', 'world darts championship', 'pdc world championship'] },
    { id: 'pdc', name: 'PDC', sport: 'darts', p: ['pdc'] },
    { id: 'eredivisie', name: 'Eredivisie', sport: 'football', p: ['eredivisie'] },
    { id: 'kkd', name: 'Keuken Kampioen Divisie', sport: 'football', p: ['keuken kampioen divisie', 'kkd', 'eerste divisie'] },
    { id: 'knvb-beker', name: 'KNVB beker', sport: 'football', p: ['knvb beker', 'knvb cup'] },
    { id: 'champions-league', name: 'Champions League', sport: 'football', p: ['champions league', 'ucl'] },
    { id: 'europa-league', name: 'Europa League', sport: 'football', p: ['europa league', 'uel'] },
    { id: 'conference-league', name: 'Conference League', sport: 'football', p: ['conference league', 'uecl'] },
    { id: 'premier-league', name: 'Premier League', sport: 'football', p: ['premier league', 'epl'] },
    { id: 'laliga', name: 'LaLiga', sport: 'football', p: ['laliga', 'la liga'] },
    { id: 'serie-a', name: 'Serie A', sport: 'football', p: ['serie a'] },
    { id: 'bundesliga', name: 'Bundesliga', sport: 'football', p: ['bundesliga'] },
    { id: 'ligue-1', name: 'Ligue 1', sport: 'football', p: ['ligue 1'] },
    { id: 'jupiler-pro-league', name: 'Jupiler Pro League', sport: 'football', p: ['jupiler pro league', 'jupiler'] },
    { id: 'wk', name: 'WK', sport: 'football', p: ['wk voetbal', 'fifa world cup', 'wk kwalificatie', 'world cup qualifier', 'world cup qualifiers'] },
    { id: 'ek', name: 'EK', sport: 'football', p: ['ek voetbal', 'uefa euro', 'ek kwalificatie', 'euro qualifier', 'euro qualifiers'] },
    { id: 'motogp', name: 'MotoGP', sport: 'motorsport', p: ['motogp', 'moto gp'] },
    { id: 'formula-1', name: 'Formule 1', sport: 'motorsport', p: ['formule 1', 'formula 1', 'f1', 'grand prix', 'gp'] },
    { id: 'atp', name: 'ATP', sport: 'tennis', p: ['atp'] },
    { id: 'wta', name: 'WTA', sport: 'tennis', p: ['wta'] },
    { id: 'nba', name: 'NBA', sport: 'basketball', p: ['nba'] },
    { id: 'nfl', name: 'NFL', sport: 'americanfootball', p: ['nfl'] },
    { id: 'nhl', name: 'NHL', sport: 'icehockey', p: ['nhl'] },
    { id: 'ufc', name: 'UFC', sport: 'combat', p: ['ufc'] }
  ];

  /** Eerste bekende competitie in deze tekst, of null. */
  S.findCompetition = function (text) {
    var p = padded(text);
    if (p.length <= 2) return null;
    for (var i = 0; i < S.COMPETITIONS.length; i++) {
      if (anyPhrase(p, S.COMPETITIONS[i].p) !== null) return S.COMPETITIONS[i];
    }
    return null;
  };
  S.competitionById = function (id) {
    for (var i = 0; i < S.COMPETITIONS.length; i++) if (S.COMPETITIONS[i].id === id) return S.COMPETITIONS[i];
    return null;
  };

  // MARK: evenementen

  var EV_DARTS = ['darts', 'pdc', 'premier league darts', 'wk darts'];
  var EV_TENNIS = ['atp', 'wta', 'wimbledon', 'roland garros', 'australian open', 'us open', 'davis cup',
    'billie jean king cup', 'grand slam'];
  var EV_CYCLING = ['tour de', 'giro', 'vuelta', 'parijs roubaix', 'paris roubaix', 'ronde van vlaanderen',
    'tour of flanders', 'milaan sanremo', 'milano sanremo', 'luik bastenaken luik', 'liege bastogne liege',
    'amstel gold race', 'strade bianche', 'omloop het nieuwsblad', 'gent wevelgem', 'il lombardia', 'wielrennen',
    'cycling'];
  var EV_COMBAT = ['ufc', 'boksen', 'boxing', 'mma'];
  var EV_MOTOR = ['grand prix', 'gp', 'formule 1', 'formula 1', 'f1', 'motogp', 'moto gp', 'kwalificatie',
    'qualifying', 'indycar', 'nascar'];
  var EV_MOTOR_WEAK = ['race', 'sprint', 'training', 'vrije training', 'practice', 'fp1', 'fp2', 'fp3'];

  /** Sport van een bekend evenement in de titel (context: zender, categorie, beschrijving), of null. */
  S.eventSport = function (title, context) {
    var p = padded(title);
    if (anyPhrase(p, EV_DARTS)) return 'darts';
    if (anyPhrase(p, EV_TENNIS)) return 'tennis';
    if (anyPhrase(p, EV_CYCLING)) return 'cycling';
    if (anyPhrase(p, EV_COMBAT)) return 'combat';
    if (anyPhrase(p, EV_MOTOR)) return 'motorsport';
    if (anyPhrase(p, EV_MOTOR_WEAK) && anyPhrase(padded(context), EV_MOTOR.concat(['motorsport']))) return 'motorsport';
    return null;
  };

  // MARK: sport uit trefwoorden

  var KEYWORDS = [
    ['americanfootball', ['american football', 'nfl']],
    ['icehockey', ['ijshockey', 'ice hockey', 'hockey', 'nhl']],
    ['basketball', ['basketbal', 'basketball', 'nba', 'euroleague']],
    ['motorsport', ['f1', 'formule 1', 'formula 1', 'motorsport', 'motogp', 'racing']],
    ['tennis', ['tennis']],
    ['darts', ['darts']],
    ['cycling', ['wielrennen', 'cycling', 'wielersport']],
    ['combat', ['vechtsport', 'ufc', 'boxing', 'boksen', 'mma', 'kickboxing']],
    ['golf', ['golf', 'pga']],
    ['football', ['voetbal', 'football', 'soccer', 'fussball', 'futbol', 'calcio']]
  ];
  S.keywordSport = function (text) {
    var p = padded(text);
    for (var i = 0; i < KEYWORDS.length; i++) if (anyPhrase(p, KEYWORDS[i][1])) return KEYWORDS[i][0];
    return null;
  };

  // MARK: duels

  var NOT_TEAM = ['journaal', 'weer', 'nieuws', 'news', 'weather', 'talkshow', 'show', 'documentaire', 'documentary',
    'aflevering', 'episode', 'seizoen', 'season', 'deel', 'part', 'film', 'movie', 'serie', 'series',
    'race', 'sprint', 'kwalificatie', 'qualifying', 'training', 'etappe', 'stage', 'gp'];
  var GENERIC = ['sport', 'sports', 'voetbal', 'football', 'soccer', 'live', 'tennis', 'darts', 'wielrennen'];
  var SEP = /\s+(?:vs\.?|v|-|–|—)\s+/i;

  function isLabelPart(part) {
    var t = S.tokens(part);
    if (t.length === 0) return true;
    var j = t.join(' ');
    if (GENERIC.indexOf(j) >= 0) return true;
    for (var i = 0; i < S.COMPETITIONS.length; i++) if (S.COMPETITIONS[i].p.indexOf(j) >= 0 || S.fold(S.COMPETITIONS[i].name) === j) return true;
    return false;
  }

  function validTeam(name) {
    var t = S.tokens(name);
    var letters = S.fold(name).replace(/[^a-z]/g, '').length;
    if (letters < 2) return false;
    var words = name.split(/\s+/).filter(function (w) { return /[A-Za-zÀ-ɏ]/.test(w); });
    if (words.length > 4) return false;
    for (var i = 0; i < t.length; i++) if (NOT_TEAM.indexOf(t[i]) >= 0) return false;
    if (GENERIC.indexOf(t.join(' ')) >= 0) return false;
    return true;
  }

  function splitDuel(text) {
    var parts = text.split(SEP).map(function (x) { return x.trim(); });
    while (parts.length > 2 && isLabelPart(parts[0])) parts.shift();
    while (parts.length > 2 && isLabelPart(parts[parts.length - 1])) parts.pop();
    if (parts.length !== 2) return null;
    var home = S.cleanTeam(parts[0]), away = S.cleanTeam(parts[1]);
    if (!validTeam(home) || !validTeam(away)) return null;
    return { home: home, away: away };
  }

  /** Duel uit de titel: {home, away} of null. */
  S.parseDuel = function (title) {
    var s = stripPrefixTags(String(title || ''));
    s = stripBrackets(s).replace(/\s+/g, ' ').trim();
    var c = s.indexOf(': ');
    if (c > 0) {
      var head = s.slice(0, c), tail = s.slice(c + 2);
      if (!SEP.test(head)) { var d = splitDuel(tail); if (d) return d; }
    }
    return splitDuel(s);
  };

  // MARK: teams

  var AFFIX = ['fc', 'afc', 'cf', 'sc', 'sv', 'vv', 'bv', 'fk', 'sk', 'cd', 'ud', 'ac', 'as', 'ss', 'ssc', 'us', 'rc', 'sl'];

  /** Sleutel van een team om te vergelijken: fold, alleen letters/cijfers, zonder clubaffixen. */
  S.teamKey = function (name) {
    var t = S.tokens(S.cleanTeam(name));
    var k = t.filter(function (w) { return AFFIX.indexOf(w) < 0; });
    if (k.length === 0) k = t;
    return k.join('');
  };

  /** Initialen voor de cirkel (hooguit 3 tekens, hoofdletters). */
  S.short = function (name) {
    var clean = S.cleanTeam(name);
    var raw = clean.split(/[\s\-]+/).filter(function (w) { return S.tokens(w).length > 0; });
    var words = raw.filter(function (w) { return AFFIX.indexOf(S.tokens(w).join('')) < 0 && !/^[0-9.]+$/.test(w); });
    if (words.length === 0) words = raw;
    if (words.length === 0) return '';
    function letters(w) { return S.fold(w).replace(/[^a-z0-9]/g, '').toUpperCase(); }
    function isCaps(w) { var l = w.replace(/[^A-Za-z]/g, ''); return l.length > 0 && l === l.toUpperCase(); }
    var first = words[0];
    if (words.length === 1) {
      return letters(first).slice(0, 3);
    }
    if (words.length === 2) {
      if (isCaps(first) && letters(first).length <= 3) return letters(first);
      return letters(first).slice(0, 3);
    }
    return words.slice(0, 3).map(function (w) { return letters(w).slice(0, 1); }).join('');
  };

  /** FNV-1a (32 bit) over de UTF-8-bytes. */
  S.hash = function (s) {
    var bytes = unescape(encodeURIComponent(String(s)));
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  /** Index in COLORS, vast per team. */
  S.colorIndex = function (name) { return S.hash(S.teamKey(name)) % S.COLORS.length; };
  S.color = function (name) { return S.COLORS[S.colorIndex(name)]; };

  // MARK: herkennen

  /**
   * Is dit programma een wedstrijd? `p` = {title, description?, channel?, category?, start, end} (ms).
   * Geeft {kind: 'duel'|'event', title, home, away, sport, competition, competitionId} of null.
   */
  S.classify = function (p) {
    var title = String(p.title || '');
    if (!title || S.isExcluded(title)) return null;
    var desc = p.description || '', channel = p.channel || '', category = p.category || '';
    var ev = S.eventSport(title, [channel, category, desc].join(' '));
    var duel = ev === 'motorsport' || ev === 'cycling' ? null : S.parseDuel(title);   // geen duels in de motorsport/wielrennen
    if (!duel && !ev) return null;
    var minutes = (Number(p.end) - Number(p.start)) / 60000;
    if (duel && !ev && !(minutes >= S.MIN_MINUTES)) return null;   // korte duels niet, evenementen wel
    var comp = S.findCompetition(title) || S.findCompetition(desc);
    var sport;
    if (comp) sport = comp.sport;
    else {
      var cc = S.findCompetition(channel) || S.findCompetition(category);
      if (ev) { sport = ev; comp = cc && cc.sport === ev ? cc : null; }
      else if (cc) { sport = cc.sport; comp = cc; }
      else sport = S.keywordSport(title) || S.keywordSport(desc) || S.keywordSport(channel) || S.keywordSport(category) || 'other';
    }
    return {
      kind: duel ? 'duel' : 'event',
      title: duel ? duel.home + ' - ' + duel.away : S.cleanTitle(title),
      home: duel ? duel.home : '',
      away: duel ? duel.away : '',
      sport: sport,
      competition: comp ? comp.name : '',
      competitionId: comp ? comp.id : ''
    };
  };

  function utcStamp(ms, withTime) {
    var d = new Date(ms);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    var s = d.getUTCFullYear() + two(d.getUTCMonth() + 1) + two(d.getUTCDate());
    if (withTime) {
      var m = d.getUTCMinutes() < 30 ? 0 : 30;
      s += two(d.getUTCHours()) + two(m);
    }
    return s;
  }

  /** Vaste sleutel per wedstrijd: "sport:<a>~<b>:<jjjjmmdd>" (teams op volgorde) of "sport:<titel>:<jjjjmmdduumm>". */
  S.matchKey = function (m, startMs) {
    if (m.kind === 'duel') {
      var a = S.teamKey(m.home), b = S.teamKey(m.away);
      var pair = a <= b ? a + '~' + b : b + '~' + a;
      return 'sport:' + pair + ':' + utcStamp(startMs, false);
    }
    return 'sport:' + S.tokens(m.title).join('') + ':' + utcStamp(startMs, true);
  };

  /** Datum (jjjjmmdd) uit een sleutel, of null. */
  S.keyDay = function (key) {
    var m = /:([0-9]{8})(?:[0-9]{4})?$/.exec(String(key || ''));
    return m ? m[1] : null;
  };

  /** Zelfde identiteit (zelfde teams of zelfde titel) en binnen 15 min = dezelfde wedstrijd. */
  S.ident = function (m) {
    if (m.kind === 'duel') return 'd:' + [S.teamKey(m.home), S.teamKey(m.away)].sort().join('~');
    return 'e:' + S.tokens(m.title).join('');
  };

  /**
   * Ontdubbelen. `listings` in gidsvolgorde: [{id, channel, favorite, start, end, match}]. Geeft groepen
   * [{key, start, end, match, listings:[…]}] op aftrap gesorteerd; per groep de zenders: favoriet, kwaliteit, gids.
   * Een programma hoort bij de eerste wedstrijd met dezelfde identiteit waarvan het eerste programma ≤ 15 min verschilt.
   */
  S.dedupe = function (listings) {
    var groups = [], byIdent = {};
    (listings || []).forEach(function (l, i) {
      l._i = i;
      var id = S.ident(l.match);
      var cand = byIdent[id] || (byIdent[id] = []);
      for (var c = 0; c < cand.length; c++) {
        if (Math.abs(groups[cand[c]][0].start - l.start) <= S.MERGE_MS) { groups[cand[c]].push(l); return; }
      }
      cand.push(groups.length);
      groups.push([l]);
    });
    var out = groups.map(function (ls, gi) {
      ls.sort(function (a, b) {
        if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
        var qa = S.quality(a.channel), qb = S.quality(b.channel);
        if (qa !== qb) return qb - qa;
        return a._i - b._i;
      });
      var best = ls[0];
      return { key: S.matchKey(best.match, best.start), start: best.start, end: best.end, match: best.match, listings: ls, _g: gi };
    });
    out.sort(function (a, b) {
      if (a.start !== b.start) return a.start - b.start;
      if (a.match.title !== b.match.title) return a.match.title < b.match.title ? -1 : 1;
      return a._g - b._g;
    });
    out.forEach(function (g) { delete g._g; g.listings.forEach(function (l) { delete l._i; }); });
    return out;
  };

  // MARK: herinneringen

  /** Toegestane voorlooptijd in minuten (0, 5 of 15; anders de standaard). */
  S.lead = function (n) { n = Number(n); return S.LEADS.indexOf(n) >= 0 ? n : S.DEFAULT_LEAD; };

  /** Hoort deze wedstrijd bij een favoriet team of een favoriete competitie? */
  S.isFavorite = function (m, teams, competitions) {
    var keys = (teams || []).map(S.teamKey);
    if (m.kind === 'duel' && (keys.indexOf(S.teamKey(m.home)) >= 0 || keys.indexOf(S.teamKey(m.away)) >= 0)) return true;
    return !!m.competitionId && (competitions || []).indexOf(m.competitionId) >= 0;
  };

  /**
   * Welke groepen krijgen automatisch een belletje: favoriet, binnen 7 dagen, nog niet begonnen, niet gedempt en nog
   * geen herinnering. Geeft de sleutels.
   */
  S.autoReminders = function (groups, opts) {
    var now = opts.now, until = now + S.DAYS * 86400000;
    var muted = opts.muted || [], existing = opts.existing || [];
    return (groups || []).filter(function (g) {
      return g.start > now && g.start <= until && S.isFavorite(g.match, opts.teams, opts.competitions)
        && muted.indexOf(g.key) < 0 && existing.indexOf(g.key) < 0;
    }).map(function (g) { return g.key; });
  };

  /** Gedempte sleutels opruimen: alles van meer dan 2 dagen geleden (UTC-datum in de sleutel). */
  S.pruneMuted = function (keys, now) {
    var limit = utcStamp(now - 2 * 86400000, false);
    return (keys || []).filter(function (k) { var d = S.keyDay(k); return !d || d >= limit; });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : globalThis);
