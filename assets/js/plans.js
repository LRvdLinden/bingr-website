// Bingr-abonnementen op bingr.online: vergelijkingstabel Gratis / Lifetime (homepage en /upgrade/) en teksten voor
// Mijn Bingr. De getallen zijn die van de server (docs/ACCOUNT.md in iptv-ios-appletv, "Abonnementen" en
// "Build 157": Gratis 2 apparaten; Verder kijken, kinderprofielen en OpenSubtitles bij Lifetime).
// BingrPlans.table(lang, {current?: "free"|"lifetime", ctas?: true, base?: ""}) -> HTML
// BingrPlans.text(lang) -> teksten (naam, prijs, …)
// Onder de tabel staat altijd de voetnoot dat ook de IPTV-aanbieder bepaalt hoeveel streams er tegelijk kunnen.
window.BingrPlans = (function () {
  "use strict";
  var T = {
    nl: {
      caption: "Vergelijk Gratis en Lifetime", feature: "Functie",
      free: "Gratis", lifetime: "Lifetime", freePrice: "€ 0", lifePrice: "€ 4,99", freeNote: "voor altijd", lifeNote: "eenmalig",
      best: "Beste keuze", upTo: "tot %d", yours: "Jouw abonnement", yes: "Ja", no: "Nee", unlimited: "Onbeperkt",
      streams: "Tegelijk kijken", streamsHint: "schermen tegelijk", streamsDep: "hangt ook af van je IPTV-aanbieder*",
      streamsNote: "* Hoeveel je tegelijk kunt kijken, hangt ook af van je IPTV-aanbieder: Bingr laat er zoveel toe als je abonnement bij Bingr, maar je aanbieder bepaalt hoeveel verbindingen jouw abonnement daar heeft.",
      devices: "Ingelogde apparaten", servers: "Servers en afspeellijsten",
      stats: "Statistieken", statsHint: "hoeveel je kijkt, per profiel",
      watching: "Nu aan het kijken", watchingHint: "wie kijkt er nu, en kijkgeschiedenis van 7 dagen",
      trakt: "Trakt-koppeling", themes: "Thema's en accentkleuren",
      continueW: "Verder kijken", continueHint: "kijk verder waar je was, op elk apparaat",
      kids: "Kinderprofielen", kidsHint: "alleen kinderinhoud, met leeftijdsgrens",
      subs: "OpenSubtitles-ondertitels", subsHint: "ondertitels zoeken en downloaden",
      allDevices: "Alle apparaten", allDevicesHint: "iPhone, iPad, Apple TV, Mac, Android, Windows, tv en browser",
      profiles: "Profielen", myList: "Mijn lijst", guide: "Live tv met tv-gids", library: "Films en series",
      sync: "Alles synchroon via je account",
      signup: "Maak gratis een account", upgrade: "Upgrade naar Lifetime",
    },
    en: {
      caption: "Compare Free and Lifetime", feature: "Feature",
      free: "Free", lifetime: "Lifetime", freePrice: "€0", lifePrice: "€4.99", freeNote: "forever", lifeNote: "one-time",
      best: "Best value", upTo: "up to %d", yours: "Your plan", yes: "Yes", no: "No", unlimited: "Unlimited",
      streams: "Watch at the same time", streamsHint: "screens at once", streamsDep: "also depends on your IPTV provider*",
      streamsNote: "* How many you can watch at once also depends on your IPTV provider: Bingr allows as many as your Bingr plan, but your provider decides how many connections your subscription has there.",
      devices: "Signed-in devices", servers: "Servers and playlists",
      stats: "Statistics", statsHint: "how much you watch, per profile",
      watching: "Watching now", watchingHint: "who's watching now, and 7-day watch history",
      trakt: "Trakt integration", themes: "Themes and accent colours",
      continueW: "Continue watching", continueHint: "pick up where you left off, on any device",
      kids: "Kids profiles", kidsHint: "kids content only, with an age limit",
      subs: "OpenSubtitles subtitles", subsHint: "search and download subtitles",
      allDevices: "All devices", allDevicesHint: "iPhone, iPad, Apple TV, Mac, Android, Windows, TV and browser",
      profiles: "Profiles", myList: "My List", guide: "Live TV with TV guide", library: "Movies and series",
      sync: "Everything in sync with your account",
      signup: "Create a free account", upgrade: "Upgrade to Lifetime",
    },
  };
  var CHECK = '<svg class="pl-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var DASH = '<svg class="pl-ic no" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 12h10"/></svg>';
  function L(lang) { return T[lang === "en" ? "en" : "nl"]; }
  function yes(t) { return CHECK + '<span class="sr">' + t.yes + "</span>"; }
  function no(t) { return DASH + '<span class="sr">' + t.no + "</span>"; }
  // [label, hint, gratis, lifetime] — getallen als tekst, true/false als vinkje/streepje. Eerst wat alleen bij Lifetime hoort
  // (SPLIT rijen), daarna wat bij beide hoort; build 157: Gratis 2 apparaten
  var SPLIT = 10;
  function rows(t) {
    return [
      [t.streams, t.streamsDep, "1", t.upTo.replace("%d", "3")],
      [t.devices, "", "2", "15"],
      [t.servers, "", "1", t.unlimited],
      [t.stats, t.statsHint, false, true],
      [t.watching, t.watchingHint, false, true],
      [t.trakt, "", false, true],
      [t.themes, "", false, true],
      [t.continueW, t.continueHint, false, true],
      [t.kids, t.kidsHint, false, true],
      [t.subs, t.subsHint, false, true],
      [t.allDevices, t.allDevicesHint, true, true],
      [t.profiles, "", true, true],
      [t.myList, "", true, true],
      [t.guide, "", true, true],
      [t.library, "", true, true],
      [t.sync, "", true, true],
    ];
  }
  function cell(v, t) { return v === true ? yes(t) : v === false ? no(t) : '<b class="pl-num">' + v + "</b>"; }
  function table(lang, opts) {
    opts = opts || {};
    var t = L(lang), base = opts.base || "", cur = opts.current;
    var head = function (k) {
      var life = k === "lifetime";
      var tag = cur === k ? '<span class="pl-tag yours">' + t.yours + "</span>" : life ? '<span class="pl-tag">' + t.best + "</span>" : "";
      return '<th scope="col" class="pl-plan' + (life ? " life" : "") + (cur === k ? " cur" : "") + '">' + tag +
        '<span class="pl-name">' + t[k] + '</span><span class="pl-price">' + (life ? t.lifePrice : t.freePrice) + "</span>" +
        '<span class="pl-note">' + (life ? t.lifeNote : t.freeNote) + "</span></th>";
    };
    var body = rows(t).map(function (r, i) {
      return '<tr class="' + (i === SPLIT ? "pl-split" : "") + '"><th scope="row"><span class="pl-l">' + r[0] + "</span>" + (r[1] ? '<span class="pl-h">' + r[1] + "</span>" : "") +
        '</th><td>' + cell(r[2], t) + '</td><td class="life">' + cell(r[3], t) + "</td></tr>";
    }).join("");
    var foot = opts.ctas === false ? "" : '<tfoot><tr><td></td>' +
      '<td><a class="btn ghost sm pl-cta" href="' + base + 'koppelen/?mode=signup">' + t.signup + "</a></td>" +
      '<td class="life"><a class="btn red sm pl-cta" href="' + base + 'upgrade/">' + t.upgrade + "</a></td></tr></tfoot>";
    return '<div class="pl-wrap"><table class="pl-table"><caption class="sr">' + t.caption + "</caption><thead><tr>" +
      '<td class="pl-corner"></td>' + head("free") + head("lifetime") + "</tr></thead><tbody>" + body + "</tbody>" + foot + '</table><p class="pl-fn">' + t.streamsNote + "</p></div>";
  }
  return { table: table, text: L };
})();
