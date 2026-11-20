// Build 181: Bingr Premium op bingr.online (docs/ACCOUNT.md van iptv-ios-appletv, "Build 181: Bingr Premium").
// Prijsblok in de stijl van een schakelaar Maand / Halfjaar / Jaar met een kaart Premium (jaar uitgelicht, badge "3 dagen
// gratis") en een kaart Lifetime, voor de homepage (#prijzen) en /upgrade/. Alleen zichtbaar als billing `config`
// premium.show_prices_web true is; anders blijft alles zoals het was (assets/js/plans.js en lifetime.js).
//   BingrPremium.parse(config)          -> premium-blok uit billing `config` (of null)
//   BingrPremium.pricing(p, lang, opts) -> HTML; opts {period, base, mode: "home"|"upgrade", disabled, appStore}
//   BingrPremium.euro(cents, lang), savings(prices, plan), perMonth(prices, plan), planName(plan, lang)
//   BingrPremium.screen(entitlements, now, offline) -> {blocked, paywall, trial_badge, manage} (gedeelde testgevallen, groep client)
//   BingrPremium.wire(root, onPeriod)   -> schakelaar en toetsenbord
window.BingrPremium = (function () {
  "use strict";
  var PLANS = ["month", "half", "year"];
  var MONTHS = { month: 1, half: 6, year: 12 };
  var DEFAULT_PRICES = { month: 499, half: 1999, year: 2999, lifetime: 4999 };
  var T = {
    nl: {
      title: "Kies je plan", sub: "Eén account voor al je apparaten. Begin met 3 dagen gratis, opzeggen kan altijd.",
      subNoTrial: "Eén account voor al je apparaten. Opzeggen kan altijd.",
      month: "Maand", half: "Halfjaar", year: "Jaar", period: "Betaalperiode",
      perMonth: "per maand", perHalf: "per 6 maanden", perYear: "per jaar", oneTime: "eenmalig",
      eqMonth: "%s per maand", trial: "%d dagen gratis", save: "%d% voordeliger", popular: "Meest gekozen",
      premium: "Premium", lifetime: "Lifetime", lifetimeSub: "Eén keer betalen, voor altijd Premium.",
      premiumSub: "Alles van Bingr, maandelijks opzegbaar.",
      start: "Probeer %d dagen gratis", choose: "Kies %s", buyLife: "Koop Lifetime", soon: "Binnenkort beschikbaar",
      afterTrial: "Daarna %s, tenzij je opzegt.", incl: "Prijzen incl. btw.",
      get: "Wat je krijgt", devices: "Op al je apparaten", devicesList: "iPhone, iPad, Apple TV, Mac, Android, Android TV, Google TV, Fire TV, Windows en je browser",
      f: ["Tot 3 schermen tegelijk*", "15 ingelogde apparaten", "Onbeperkt servers en afspeellijsten", "Verder kijken op elk apparaat",
          "Kinderprofielen met leeftijdsgrens", "Ondertitels via OpenSubtitles", "Statistieken en Nu aan het kijken", "Trakt-koppeling",
          "Thema's en accentkleuren"],
      fn: "* Hoeveel je tegelijk kunt kijken, hangt ook af van je IPTV-aanbieder.",
      appStore: "Op iPhone, iPad, Mac en Apple TV koop je Premium in de app, via de App Store.",
      names: { month: "Premium maandelijks", half: "Premium halfjaarlijks", year: "Premium jaarlijks", lifetime: "Lifetime" },
    },
    en: {
      title: "Choose your plan", sub: "One account for all your devices. Start with 3 days free, cancel any time.",
      subNoTrial: "One account for all your devices. Cancel any time.",
      month: "Month", half: "6 months", year: "Year", period: "Billing period",
      perMonth: "per month", perHalf: "every 6 months", perYear: "per year", oneTime: "one-time",
      eqMonth: "%s per month", trial: "%d days free", save: "Save %d%", popular: "Most popular",
      premium: "Premium", lifetime: "Lifetime", lifetimeSub: "Pay once, Premium forever.",
      premiumSub: "Everything in Bingr, cancel any month.",
      start: "Try %d days free", choose: "Choose %s", buyLife: "Buy Lifetime", soon: "Coming soon",
      afterTrial: "Then %s, unless you cancel.", incl: "Prices incl. VAT.",
      get: "What you get", devices: "On all your devices", devicesList: "iPhone, iPad, Apple TV, Mac, Android, Android TV, Google TV, Fire TV, Windows and your browser",
      f: ["Up to 3 screens at once*", "15 signed-in devices", "Unlimited servers and playlists", "Continue watching on any device",
          "Kids profiles with an age limit", "Subtitles via OpenSubtitles", "Statistics and Watching now", "Trakt integration",
          "Themes and accent colours"],
      fn: "* How many you can watch at once also depends on your IPTV provider.",
      appStore: "On iPhone, iPad, Mac and Apple TV you buy Premium in the app, through the App Store.",
      names: { month: "Premium monthly", half: "Premium every 6 months", year: "Premium yearly", lifetime: "Lifetime" },
    },
  };
  var CHECK = '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function tr(lang) { return T[lang === "en" ? "en" : "nl"]; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function int(v, d) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v) : d; }
  function prices(p) {
    var x = (p && p.prices) || {}, o = {};
    Object.keys(DEFAULT_PRICES).forEach(function (k) { o[k] = int(x[k], DEFAULT_PRICES[k]); });
    return o;
  }
  /** "€ 4,99" / "€4.99": altijd twee decimalen, zoals de rest van de site */
  function euro(cents, lang) {
    var v = (cents / 100).toFixed(2);
    return lang === "en" ? "€" + v : "€ " + v.replace(".", ",");
  }
  /** voordeel t.o.v. maandelijks betalen, in hele procenten (half 33, jaar 50); 0 voor maand en Lifetime */
  function savings(pr, plan) {
    if (!MONTHS[plan] || plan === "month") return 0;
    var full = pr.month * MONTHS[plan];
    return full > 0 ? Math.max(0, Math.round((1 - pr[plan] / full) * 100)) : 0;
  }
  function perMonth(pr, plan) { return MONTHS[plan] ? Math.round(pr[plan] / MONTHS[plan]) : null; }
  function planName(plan, lang) { return tr(lang).names[plan] || ""; }
  function parse(cfg) {
    var p = cfg && cfg.premium;
    if (!p || typeof p !== "object") return null;
    return {
      enabled: p.enabled === true, show: p.show_prices_web === true, trial_days: typeof p.trial_days === "number" ? p.trial_days : 0,
      stripe_ready: p.stripe_ready === true, existing_after: p.existing_after === true, existing_from: p.existing_from || null,
      prices: prices(p), view: p.view && typeof p.view === "object" ? p.view : null,
    };
  }
  function cleanPeriod(v) { return PLANS.indexOf(v) >= 0 ? v : "year"; }

  /** Prijsblok. opts.mode "home" = knoppen naar /upgrade/?plan=…; "upgrade" = knoppen met data-plan (de pagina koppelt ze). */
  function pricing(p, lang, opts) {
    var t = tr(lang), o = opts || {}, pr = prices(p), period = cleanPeriod(o.period), base = o.base || "";
    // proefbadge: op de homepage zodra er een proef is (voor nieuwe accounts); op /upgrade/ alleen als dit account hem krijgt
    var trialDays = o.trialDays != null ? o.trialDays : (p && p.trial_days) || 0;
    var per = { month: t.perMonth, half: t.perHalf, year: t.perYear }[period];
    var save = savings(pr, period);
    var toggle = '<div class="pp-toggle" role="radiogroup" aria-label="' + esc(t.period) + '">' + PLANS.map(function (k) {
      var s = savings(pr, k);
      return '<button type="button" role="radio" data-period="' + k + '" aria-checked="' + (k === period) + '" tabindex="' + (k === period ? 0 : -1) + '"' +
        (k === period ? ' class="on"' : "") + ">" + esc(t[k]) + (s ? ' <span class="pp-save">−' + s + "%</span>" : "") + "</button>";
    }).join("") + "</div>";
    var cta = function (plan, label, red) {
      if (o.disabled) return '<button type="button" class="btn ' + (red ? "red" : "ghost") + ' pp-cta" disabled aria-disabled="true">' + esc(t.soon) + "</button>";
      if (o.mode === "upgrade") return '<button type="button" class="btn ' + (red ? "red" : "ghost") + ' pp-cta" data-plan="' + plan + '">' + esc(label) + "</button>";
      return '<a class="btn ' + (red ? "red" : "ghost") + ' pp-cta" href="' + base + "upgrade/?plan=" + plan + '">' + esc(label) + "</a>";
    };
    var premLabel = trialDays > 0 ? t.start.replace("%d", trialDays) : t.choose.replace("%s", t.premium);
    var premium = '<article class="pp-card pp-prem' + (period === "year" ? " pp-hl" : "") + '">' +
      (period === "year" ? '<span class="pp-tag">' + esc(t.popular) + " · " + esc(t.save.replace("%d", save)) + "</span>" : save ? '<span class="pp-tag pp-tag-dim">' + esc(t.save.replace("%d", save)) + "</span>" : "") +
      '<h3 class="pp-name">' + esc(t.premium) + "</h3><p class=\"pp-desc\">" + esc(t.premiumSub) + "</p>" +
      '<div class="pp-price"><b>' + esc(euro(pr[period], lang)) + "</b><span>" + esc(per) + "</span></div>" +
      '<p class="pp-eq">' + (period === "month" ? "&nbsp;" : esc(t.eqMonth.replace("%s", euro(perMonth(pr, period), lang)))) + "</p>" +
      (trialDays > 0 ? '<p class="pp-trial"><span>' + esc(t.trial.replace("%d", trialDays)) + "</span></p>" : "") +
      cta(period, premLabel, true) +
      (trialDays > 0 ? '<p class="pp-after">' + esc(t.afterTrial.replace("%s", euro(pr[period], lang) + " " + per)) + "</p>" : "") +
      "</article>";
    var life = '<article class="pp-card pp-life"><h3 class="pp-name">' + esc(t.lifetime) + '</h3><p class="pp-desc">' + esc(t.lifetimeSub) + "</p>" +
      '<div class="pp-price"><b>' + esc(euro(pr.lifetime, lang)) + "</b><span>" + esc(t.oneTime) + '</span></div><p class="pp-eq">&nbsp;</p>' +
      cta("lifetime", t.buyLife, false) + (trialDays > 0 ? '<p class="pp-after" aria-hidden="true">&nbsp;</p>' : "") + "</article>";
    var feats = '<div class="pp-feats"><h3>' + esc(t.get) + "</h3><ul>" + t.f.map(function (f) { return "<li>" + CHECK + "<span>" + esc(f) + "</span></li>"; }).join("") +
      '</ul><p class="pp-dev"><b>' + esc(t.devices) + "</b> " + esc(t.devicesList) + "</p></div>";
    var foot = '<p class="pp-fn">' + esc(t.incl) + " " + esc(t.fn) + (o.appStore !== false ? " " + esc(t.appStore) : "") + "</p>";
    return '<div class="pp" data-period="' + period + '">' + toggle + '<div class="pp-grid">' + premium + life + "</div>" + feats + foot + "</div>";
  }
  /** schakelaar: klik en pijltjestoetsen; onPeriod(period) tekent opnieuw */
  function wire(root, onPeriod) {
    if (!root) return;
    var btns = root.querySelectorAll(".pp-toggle [data-period]");
    Array.prototype.forEach.call(btns, function (b, i) {
      b.onclick = function () { onPeriod(b.getAttribute("data-period")); };
      b.onkeydown = function (e) {
        var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var n = btns[(i + d + btns.length) % btns.length];
        onPeriod(n.getAttribute("data-period"), true);
      };
    });
  }
  /** Wat de apps tonen (gedeelde testgevallen, groep client; zelfde regels als premiumScreen op de server). */
  function screen(ent, now, offline) {
    var p = ent && ent.premium, activate = !!ent && ent.access === "activate";
    if (!p || !p.enabled) return { blocked: activate, paywall: activate ? "legacy" : null, trial_badge: false, manage: (p && p.manage) || null };
    var exp = p.expires_at ? Date.parse(p.expires_at) : NaN;
    var lapsed = !!offline && p.active === true && p.status !== "lifetime" && !p.will_renew && isFinite(exp) && exp <= (now == null ? Date.now() : now);
    var blocked = activate || lapsed;
    return { blocked: blocked, paywall: blocked ? (p.trial_eligible ? "trial" : "plans") : null, trial_badge: blocked && p.trial_eligible === true, manage: p.manage || null };
  }
  function fetchConfig() { return window.BingrLifetime ? window.BingrLifetime.fetchConfig() : Promise.resolve(null); }
  return { PLANS: PLANS, parse: parse, pricing: pricing, wire: wire, euro: euro, savings: savings, perMonth: perMonth, planName: planName,
    screen: screen, cleanPeriod: cleanPeriod, prices: prices, text: tr, fetchConfig: fetchConfig };
})();
