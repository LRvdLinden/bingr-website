/*
 * Build 178: sport-logo's. Pure logica (zonder DOM), gelijk aan SportLogos178 op Apple (Shared/Sport/SportLogos178.swift)
 * en SportLogos178Logic.kt op Android. Gedeelde testgevallen: docs/sportlogos_cases.json van iptv-ios-appletv
 * (kopie: tools/test/sportlogos_cases.json). Unittests: node tools/test/sportlogos_test.js
 *
 * Werkt zoals Weekdot: niets in de site of de repo; logo's worden live opgehaald en in de browser bewaard, en alleen ter
 * herkenning getoond (vermelding onderaan het sportoverzicht).
 * - competitielogo's: maak-agenda.nl/images/leagues/<slug>.png, anders het favicon van de officiële site (Google);
 * - vlaggen van landenteams: maak-agenda.nl/images/national/<LAND>.png;
 * - clublogo's: de teamlijst van ESPN per competitie, zoeken op de opgeschoonde naam; niet gevonden: TheSportsDB;
 * - cache: index 7 dagen, niet gevonden 1 dag, afbeeldingen 7 dagen; met Data besparen alleen uit de cache.
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var SL = B.sportLogic || (typeof require === 'function' ? require('./sportlogic.js') : null);
  var G = B.sportLogos = {};

  G.INDEX_MAX_AGE = 7 * 86400;
  G.MISS_MAX_AGE = 1 * 86400;
  G.IMAGE_MAX_AGE = 7 * 86400;
  G.TEAM_SPORTS = ['football', 'basketball', 'americanfootball', 'icehockey'];

  var AFFIXES = ['fc', 'sc', 'afc', 'cf', 'ac', 'sv', 'bv', 'vv', 'fk', 'sk', 'if', 'bk',
    'club', 'cd', 'ud', 'sd', 'rc', 'rcd', 'ss', 'as', 'us', 'ogc', 'losc', 'the'];

  /** Sleutels om een club te zoeken: alle woorden aan elkaar, en zonder clubaffixen (als dat iets anders is). */
  G.keys = function (name) {
    var t = SL.tokens(SL.cleanTeam(String(name == null ? '' : name)));
    var full = t.join('');
    var stripped = t.filter(function (w) { return AFFIXES.indexOf(w) < 0; }).join('');
    var out = [];
    [full, stripped].forEach(function (k) { if (k && out.indexOf(k) < 0) out.push(k); });
    return out;
  };

  /** Zoeken in een index (sleutel → logo): eerst precies, dan een uniek voorvoegsel. */
  G.match = function (wanted, index) {
    var i, k;
    for (i = 0; i < wanted.length; i++) {
      if (Object.prototype.hasOwnProperty.call(index, wanted[i])) return index[wanted[i]];
    }
    var keys = Object.keys(index);
    for (i = 0; i < wanted.length; i++) {
      k = wanted[i];
      if (k.length < 3) continue;
      var found = {}, n = 0, last = null;
      keys.forEach(function (key) {
        if (key.indexOf(k) === 0 || (k.indexOf(key) === 0 && key.length >= 4)) {
          var v = index[key];
          if (!found[v]) { found[v] = true; n++; last = v; }
        }
      });
      if (n === 1) return last;
    }
    return null;
  };

  /** Index uit een teamlijst [{names, logo}]: elke naam → logo (alleen https; de eerste wint). */
  G.buildIndex = function (teams) {
    var index = {};
    (teams || []).forEach(function (t) {
      var logo = String(t.logo || '').trim();
      if (logo.toLowerCase().indexOf('https://') !== 0) return;
      (t.names || []).forEach(function (name) {
        G.keys(name).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(index, k)) index[k] = logo; });
      });
    });
    return index;
  };

  /** ESPN-teamlijst (JSON) → [{names, logo}]: sports[0].leagues[0].teams[].team. */
  G.espnTeams = function (json) {
    try {
      var teams = json.sports[0].leagues[0].teams || [];
      return teams.map(function (w) {
        var t = w && w.team || {};
        var logo = t.logos && t.logos[0] && t.logos[0].href || '';
        var names = ['displayName', 'shortDisplayName', 'name', 'location', 'nickname']
          .map(function (f) { return t[f]; }).filter(function (v) { return typeof v === 'string'; });
        return { names: names, logo: logo };
      });
    } catch (e) { return []; }
  };

  /** TheSportsDB-zoekresultaat (JSON) → [{names, logo}], alleen records van deze sport. */
  G.sportsDBTeams = function (json, sport) {
    var want = G.sportsDBSport(sport);
    return ((json && json.teams) || []).filter(function (r) { return (r.strSport || 'Soccer') === want; }).map(function (r) {
      var names = [];
      if (typeof r.strTeam === 'string') names.push(r.strTeam);
      if (typeof r.strTeamShort === 'string') names.push(r.strTeamShort);
      if (typeof r.strTeamAlternate === 'string') names = names.concat(r.strTeamAlternate.split(','));
      return { names: names, logo: G.sportsDBThumb(r.strBadge || '') || '' };
    });
  };

  /** Kleine versie van een TheSportsDB-badge ("…/small"), alleen https. */
  G.sportsDBThumb = function (badge) {
    var b = String(badge || '').trim();
    if (b.toLowerCase().indexOf('https://') !== 0) return null;
    return /\/small$/.test(b) ? b : b + '/small';
  };

  G.sportsDBSport = function (sport) {
    return { basketball: 'Basketball', americanfootball: 'American Football', icehockey: 'Ice Hockey' }[sport] || 'Soccer';
  };

  // MARK: competities

  G.LEAGUE_SLUGS = {
    eredivisie: 'eredivisie', kkd: 'keuken-kampioen-divisie', 'knvb-beker': 'beker',
    'champions-league': 'champions-league', 'europa-league': 'europa-league',
    'conference-league': 'uefa-conference-league', 'premier-league': 'premier-league', laliga: 'primera-division',
    'serie-a': 'serie-a', bundesliga: 'bundesliga', 'ligue-1': 'ligue-1', 'jupiler-pro-league': 'jupiler-pro-league',
    wk: 'fifa-world-cup-2026', motogp: 'motogp', 'formula-1': 'formula-1', nba: 'nba', nfl: 'nfl'
  };
  G.SITES = {
    'premier-league-darts': 'pdc.tv', 'wk-darts': 'pdc.tv', pdc: 'pdc.tv',
    eredivisie: 'eredivisie.nl', kkd: 'keukenkampioendivisie.nl', 'knvb-beker': 'knvb.nl',
    'champions-league': 'uefa.com', 'europa-league': 'uefa.com', 'conference-league': 'uefa.com',
    'premier-league': 'premierleague.com', laliga: 'laliga.com', 'serie-a': 'legaseriea.it',
    bundesliga: 'bundesliga.com', 'ligue-1': 'ligue1.com', 'jupiler-pro-league': 'proleague.be',
    wk: 'fifa.com', ek: 'uefa.com', motogp: 'motogp.com', 'formula-1': 'formula1.com',
    atp: 'atptour.com', wta: 'wtatennis.com', nba: 'nba.com', nfl: 'nfl.com', nhl: 'nhl.com', ufc: 'ufc.com'
  };
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; }
  G.leagueSlug = function (id) { return own(G.LEAGUE_SLUGS, id); };
  G.site = function (id) { return own(G.SITES, id); };

  /** Adressen voor het logo van een competitie: groot = maak-agenda.nl, dan favicon; klein = eerst het favicon. */
  G.competitionURLs = function (id, small) {
    var out = [];
    var s = G.leagueSlug(id), d = G.site(id);
    if (s) out.push(G.leagueURL(s));
    if (d) out.push(G.faviconURL(d, 128));
    return small ? out.reverse() : out;
  };

  // MARK: clubs

  var FOOTBALL_MAJOR = ['ned.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'por.1', 'bel.1', 'tur.1',
    'sco.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'ned.2'];
  var FOOTBALL_BY_COMP = {
    eredivisie: ['ned.1', 'ned.2'], kkd: ['ned.2', 'ned.1'], 'knvb-beker': ['ned.1', 'ned.2'],
    'champions-league': ['uefa.champions'], 'europa-league': ['uefa.europa'], 'conference-league': ['uefa.europa.conf'],
    'premier-league': ['eng.1', 'eng.2'], laliga: ['esp.1'], 'serie-a': ['ita.1'], bundesliga: ['ger.1', 'ger.2'],
    'ligue-1': ['fra.1'], 'jupiler-pro-league': ['bel.1'], wk: [], ek: []
  };

  /** ESPN-competities waarin clubs van deze wedstrijd gezocht worden (leeg = geen clubs). */
  G.espnLeagues = function (sport, competitionID) {
    if (sport === 'basketball') return ['basketball/nba'];
    if (sport === 'americanfootball') return ['football/nfl'];
    if (sport === 'icehockey') return ['hockey/nhl'];
    if (sport !== 'football') return [];
    var l = own(FOOTBALL_BY_COMP, competitionID || '');
    return (l || FOOTBALL_MAJOR).slice();
  };

  // MARK: landenteams

  var COUNTRY_LIST = [
    ['NL', ['nederland', 'netherlands', 'holland', 'oranje', 'niederlande', 'pays bas', 'paises bajos']],
    ['BE', ['belgie', 'belgium', 'belgien', 'belgique', 'belgica']],
    ['DE', ['duitsland', 'germany', 'deutschland', 'allemagne', 'alemania']],
    ['FR', ['frankrijk', 'france', 'frankreich', 'francia']],
    ['GB', ['engeland', 'england', 'angleterre', 'inglaterra', 'groot brittannie', 'great britain']],
    ['ES', ['spanje', 'spain', 'spanien', 'espagne', 'espana']],
    ['IT', ['italie', 'italy', 'italien', 'italia']],
    ['PT', ['portugal']],
    ['DK', ['denemarken', 'denmark', 'danemark', 'dinamarca']],
    ['SE', ['zweden', 'sweden', 'schweden', 'suede', 'suecia']],
    ['NO', ['noorwegen', 'norway', 'norwegen', 'norvege', 'noruega']],
    ['FI', ['finland', 'finnland', 'finlande', 'finlandia']],
    ['IS', ['ijsland', 'iceland', 'island', 'islande', 'islandia']],
    ['IE', ['ierland', 'ireland', 'irland', 'irlande', 'irlanda']],
    ['CH', ['zwitserland', 'switzerland', 'schweiz', 'suisse', 'suiza']],
    ['AT', ['oostenrijk', 'austria', 'osterreich', 'autriche']],
    ['PL', ['polen', 'poland', 'pologne', 'polonia']],
    ['CZ', ['tsjechie', 'czechia', 'czech republic', 'tschechien', 'tchequie', 'chequia']],
    ['SK', ['slowakije', 'slovakia', 'slowakei', 'slovaquie', 'eslovaquia']],
    ['HU', ['hongarije', 'hungary', 'ungarn', 'hongrie', 'hungria']],
    ['RO', ['roemenie', 'romania', 'rumanien', 'roumanie', 'rumania']],
    ['BG', ['bulgarije', 'bulgaria', 'bulgarien', 'bulgarie']],
    ['GR', ['griekenland', 'greece', 'griechenland', 'grece', 'grecia']],
    ['TR', ['turkije', 'turkey', 'turkiye', 'turkei', 'turquie', 'turquia']],
    ['HR', ['kroatie', 'croatia', 'kroatien', 'croatie', 'croacia']],
    ['RS', ['servie', 'serbia', 'serbien', 'serbie']],
    ['SI', ['slovenie', 'slovenia', 'slowenien', 'eslovenia']],
    ['BA', ['bosnie', 'bosnia', 'bosnie herzegovina', 'bosnia and herzegovina', 'bosnien']],
    ['ME', ['montenegro']],
    ['AL', ['albanie', 'albania', 'albanien']],
    ['MK', ['noord macedonie', 'north macedonia', 'nordmazedonien']],
    ['UA', ['oekraine', 'ukraine', 'ucrania']],
    ['GE', ['georgie', 'georgia', 'georgien']],
    ['AM', ['armenie', 'armenia', 'armenien']],
    ['AZ', ['azerbeidzjan', 'azerbaijan', 'aserbaidschan']],
    ['KZ', ['kazachstan', 'kazakhstan', 'kasachstan']],
    ['IL', ['israel']],
    ['CY', ['cyprus', 'zypern', 'chypre', 'chipre']],
    ['LU', ['luxemburg', 'luxembourg']],
    ['LT', ['litouwen', 'lithuania', 'litauen']],
    ['LV', ['letland', 'latvia', 'lettland']],
    ['EE', ['estland', 'estonia']],
    ['MT', ['malta']],
    ['FO', ['faeroer', 'faroe islands', 'faroer']],
    ['SM', ['san marino']],
    ['AD', ['andorra']],
    ['LI', ['liechtenstein']],
    ['GI', ['gibraltar']],
    ['MD', ['moldavie', 'moldova', 'moldawien']],
    ['BY', ['wit rusland', 'belarus', 'weissrussland']],
    ['RU', ['rusland', 'russia', 'russland', 'russie', 'rusia']],
    ['US', ['verenigde staten', 'united states', 'usa']],
    ['CA', ['canada', 'kanada']],
    ['MX', ['mexico', 'mexiko']],
    ['BR', ['brazilie', 'brazil', 'brasilien', 'bresil', 'brasil']],
    ['AR', ['argentinie', 'argentina', 'argentinien', 'argentine']],
    ['UY', ['uruguay']],
    ['CO', ['colombia', 'kolumbien', 'colombie']],
    ['CL', ['chili', 'chile']],
    ['EC', ['ecuador']],
    ['PE', ['peru']],
    ['PY', ['paraguay']],
    ['JP', ['japan', 'japon']],
    ['KR', ['zuid korea', 'south korea', 'korea republic', 'sudkorea']],
    ['AU', ['australie', 'australia', 'australien']],
    ['MA', ['marokko', 'morocco', 'maroc', 'marruecos']],
    ['SN', ['senegal']],
    ['NG', ['nigeria']],
    ['GH', ['ghana']],
    ['CM', ['kameroen', 'cameroon', 'kamerun', 'cameroun']],
    ['EG', ['egypte', 'egypt', 'agypten']],
    ['TN', ['tunesie', 'tunisia', 'tunesien', 'tunisie']],
    ['DZ', ['algerije', 'algeria', 'algerien', 'algerie']],
    ['CI', ['ivoorkust', 'ivory coast', 'cote d ivoire', 'elfenbeinkuste']],
    ['ZA', ['zuid afrika', 'south africa', 'sudafrika']],
    ['SA', ['saoedi arabie', 'saudi arabia', 'saudi arabien']],
    ['QA', ['qatar', 'katar']],
    ['IR', ['iran']],
    ['CW', ['curacao']],
    ['SR', ['suriname']]
  ];
  var COUNTRIES = {};
  COUNTRY_LIST.forEach(function (c) { c[1].forEach(function (n) { COUNTRIES[SL.tokens(n).join('')] = c[0]; }); });
  var WOMEN = ['vrouwen', 'women', 'womens', 'dames', 'frauen', 'femmes', 'w'];

  /** Landcode als deze naam een landenteam is, anders null. */
  G.countryCode = function (name) {
    var t = SL.tokens(SL.cleanTeam(String(name == null ? '' : name)));
    var k = t.filter(function (w) { return WOMEN.indexOf(w) < 0; }).join('');
    if (!k) return null;
    return own(COUNTRIES, k);
  };

  /** "flag:<LAND>", "club" of "" (cirkel met initialen). */
  G.teamArt = function (name, sport, competitionID) {
    if (G.TEAM_SPORTS.indexOf(sport) < 0) return '';
    var c = G.countryCode(name);
    if (c) return 'flag:' + c;
    return G.espnLeagues(sport, competitionID).length ? 'club' : '';
  };

  // MARK: adressen

  G.leagueURL = function (slug) { return 'https://maak-agenda.nl/images/leagues/' + String(slug).split('/')[0] + '.png'; };
  G.flagURL = function (code) { return 'https://maak-agenda.nl/images/national/' + String(code).toUpperCase() + '.png'; };
  G.faviconURL = function (domain, size) { return 'https://www.google.com/s2/favicons?domain=' + G.encode(domain) + '&sz=' + size; };
  G.espnTeamsURL = function (code) {
    return 'https://site.api.espn.com/apis/site/v2/sports/' + (code.indexOf('/') >= 0 ? code : 'soccer/' + code) + '/teams';
  };
  G.sportsDBSearchURL = function (name) {
    return 'https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=' + G.encode(SL.cleanTeam(name));
  };
  /** Procent-codering: alles behalve A-Z a-z 0-9 - . _ ~ (UTF-8, hoofdletters). */
  G.encode = function (s) {
    return encodeURIComponent(String(s)).replace(/[!'()*]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
  };

  // MARK: cache

  /** Mag een bewaard item gebruikt worden? kind = index | miss | image; age in seconden. Data besparen: alles wat er is. */
  G.usable = function (kind, age, saver) {
    if (saver) return true;
    var max = kind === 'index' ? G.INDEX_MAX_AGE : kind === 'miss' ? G.MISS_MAX_AGE : G.IMAGE_MAX_AGE;
    return age >= 0 && age < max;
  };

  /** Naam van een cachebestand: voorvoegsel + FNV-1a (8 hex) van de sleutel. */
  G.cacheName = function (prefix, key, ext) {
    var h = ('00000000' + SL.hash(key).toString(16)).slice(-8);
    return prefix + '-' + h + (ext ? '.' + ext : '');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);
