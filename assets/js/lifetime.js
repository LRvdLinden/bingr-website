// Build 167: Bingr wordt alleen Lifetime, op bingr.online (homepage, /upgrade/, voorwaarden en privacy).
// Contract: docs/ACCOUNT.md in iptv-ios-appletv, "Build 167: alleen Lifetime". De site volgt de server:
//  - billing `config` (openbaar) → lifetime_only {enabled, cutover_at, after_cutover, trial_days, (announced | announce_at)?,
//    discount_pct?}; ingelogd ook code, code_valid_until en discounted_price_cents. Ontbreekt het of is enabled false, dan
//    blijft alles zoals het was.
//  - AANVULLING 1 (eerst betalen, dan het account): /upgrade/?guest=1 (gastaankoop) en /upgrade/klaar/ (claim).
//  - device-auth `entitlements` (ingelogd) → access ('full' | 'activate') en lifetime_only (zelfde vorm).
// Fases: 'off' (niets anders), 'before' (aangekondigd, vóór cutover_at: banner en "Gratis (tot …)"),
// 'after' (vanaf cutover_at: alleen Lifetime).
window.BingrLifetime = (function () {
  "use strict";

  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // DATUM-D: de dag waarop Léon alles live zet (de nieuwe versie van de voorwaarden en de privacyverklaring).
  // Vul hier de datum in als "JJJJ-MM-DD" (bijv. "2026-11-20"). Zolang er "DATUM-D" staat, toont de pagina dat letterlijk.
  // Wordt gebruikt op /voorwaarden/ en /privacy.html ([data-terms-date]).
  var TERMS_DATE = "2026-11-07";
  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

  var TZ = "Europe/Amsterdam";
  // AANVULLING 2: vaste overgangsdatum. Terugval als de server geen cutover_at meestuurt (de server gaat altijd voor).
  var CUTOVER_DEFAULT = "2026-12-01T00:00:00+01:00";
  var T = {
    nl: {
      banner: "Bingr wordt Lifetime op %s.", bannerP: "Daarna werkt Bingr alleen nog met Lifetime: één keer betalen, voor altijd. Bestaande gratis accounts kregen een persoonlijke kortingscode per e-mail. Je gegevens blijven bewaard.",
      bannerBtn: "Meer over Lifetime", freeUntil: "Gratis (tot %s)",
    },
    en: {
      banner: "Bingr is going Lifetime on %s.", bannerP: "After that, Bingr only works with Lifetime: pay once, keep it forever. Existing free accounts received a personal discount code by email. Your data stays safe.",
      bannerBtn: "More about Lifetime", freeUntil: "Free (until %s)",
    },
  };
  // Homepage na cutover_at: teksten die "gratis account" beloven (data-i18n-sleutels van index.html)
  var HOME_AFTER = {
    nl: {
      "hero.signup": "Maak een account",
      "s2.t": "Een Bingr-account met Lifetime",
      "s2.p": "Met je e-mailadres en een wachtwoord, en één keer Lifetime. Daarmee log je op al je apparaten in. <a href=\"koppelen/?mode=signup\">Maak een account</a>",
      "plans.title": "Bingr Lifetime",
      "plans.sub": "Eén keer € 4,99, voor altijd. Geen abonnement, geen reclame, voor je hele account op al je apparaten.",
      "final.p": "Maak een account, activeer Lifetime, voeg je server toe en kijk op al je schermen.",
      "q7": "Wat kost Bingr?",
      "a7": "Bingr werkt met <a href=\"#prijzen\">Lifetime</a>: je betaalt eenmalig € 4,99 voor tot 3 schermen tegelijk, 15 apparaten, onbeperkt servers, statistieken, Nu aan het kijken, de Trakt-koppeling, thema's, Verder kijken, kinderprofielen en ondertitels via OpenSubtitles. Een gratis abonnement is er niet meer. Je IPTV-abonnement regel en betaal je zelf bij je eigen aanbieder: Bingr verkoopt geen zenderpakketten. Hoeveel je tegelijk kunt kijken, hangt ook af van je IPTV-aanbieder.",
      "a4": "Nee. Je logt overal in met je Bingr-account: je profielen, servers, Mijn lijst, voortgang en instellingen staan dan op al je apparaten, ook op Android en Windows. Met Lifetime werkt je account op 15 apparaten en kijk je op tot 3 schermen tegelijk. Hoeveel je tegelijk kunt kijken, hangt ook af van je IPTV-aanbieder.",
      "a12": "Ja. Op <a href=\"web/\">bingr.online/web</a> kijk je zonder iets te installeren, in Chrome, Safari, Edge of Firefox. Je logt in met je Bingr-account en ziet dezelfde profielen, servers en Mijn lijst als in de apps. In de browser werken alleen servers en streams via https. <a href=\"https://support.bingr.online/hulp/browser/\">Wat werkt er in de browser?</a>",
    },
    en: {
      "hero.signup": "Create an account",
      "s2.t": "A Bingr account with Lifetime",
      "s2.p": "With your email address and a password, and Lifetime once. You use it to sign in on all your devices. <a href=\"koppelen/?mode=signup\">Create an account</a>",
      "plans.title": "Bingr Lifetime",
      "plans.sub": "Pay €4.99 once, keep it forever. No subscription, no ads, for your whole account on all your devices.",
      "final.p": "Create an account, activate Lifetime, add your server and watch on all your screens.",
      "q7": "What does Bingr cost?",
      "a7": "Bingr works with <a href=\"#prijzen\">Lifetime</a>: you pay €4.99 once for up to 3 screens at the same time, 15 devices, unlimited servers, statistics, Watching now, the Trakt integration, themes, Continue watching, kids profiles and OpenSubtitles subtitles. There is no free plan anymore. You arrange and pay for your IPTV subscription with your own provider: Bingr does not sell channel packages. How many you can watch at once also depends on your IPTV provider.",
      "a4": "No. You sign in everywhere with your Bingr account, so your profiles, servers, My List, progress and settings are on all your devices, including Android and Windows. With Lifetime your account works on 15 devices and up to 3 screens at the same time. How many you can watch at once also depends on your IPTV provider.",
      "a12": "Yes. At <a href=\"web/\">bingr.online/web</a> you watch without installing anything, in Chrome, Safari, Edge or Firefox. You sign in with your Bingr account and see the same profiles, servers and My List as in the apps. Only servers and streams over https work in the browser. <a href=\"https://support.bingr.online/hulp/browser/\">What works in the browser?</a>",
    },
  };
  // vóór de overgang: alleen de plans-ondertitel (de rest blijft; nieuwe accounts zijn tot de overgang nog gratis)
  var HOME_BEFORE = {
    nl: { "plans.sub": "Bingr wordt binnenkort alleen Lifetime: eenmalig € 4,99, en het blijft van jou. Tot de overgang kun je Bingr nog gratis gebruiken." },
    en: { "plans.sub": "Bingr is going Lifetime only soon: a one-time €4.99 that stays yours. Until the switch you can still use Bingr for free." },
  };

  function tr(lang) { return T[lang === "en" ? "en" : "nl"]; }
  function date(v) { if (!v) return null; var d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d; }
  function str(v) { return typeof v === "string" && v ? v : null; }
  function int(v) { var n = typeof v === "number" ? v : parseInt(v, 10); return isFinite(n) ? Math.round(n) : null; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /** Kortingscode netjes maken (hoofdletters, alleen A-Z, 0-9 en -); ongeldig = "". */
  function cleanCode(v) {
    var s = String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, "");
    return /^[A-Z0-9-]{4,40}$/.test(s) ? s : "";
  }

  /** Antwoord van de server (billing `config` of `entitlements`) → lifetime_only in vaste vorm, of null (ontbreekt,
   *  enabled false of ongeldig). Let op: `enabled` bovenaan billing `config` gaat over Stripe, niet hierover. */
  function parse(raw) {
    var lo = raw && typeof raw === "object" && raw.lifetime_only && typeof raw.lifetime_only === "object" ? raw.lifetime_only : null;
    if (!lo || lo.enabled !== true) return null;
    var pct = int(lo.discount_pct);
    // de publieke billing `config` (zonder inloggen) kent geen `announced`: dan announce_at, anders aangekondigd
    var ann = typeof lo.announced === "boolean" ? lo.announced : date(lo.announce_at) ? Date.now() >= date(lo.announce_at).getTime() : true;
    return {
      enabled: true, announced: ann, cutover_at: str(lo.cutover_at) || CUTOVER_DEFAULT,
      after_cutover: typeof lo.after_cutover === "boolean" ? lo.after_cutover : null,
      code: cleanCode(lo.code) || null, code_valid_until: str(lo.code_valid_until),
      discount_pct: pct != null && pct > 0 && pct < 100 ? pct : null,
      discounted_price_cents: int(lo.discounted_price_cents != null ? lo.discounted_price_cents : raw.discounted_price_cents),
    };
  }

  /** 'off' | 'before' | 'after'. 'before' alleen als het al aangekondigd is (announce_at voorbij). */
  function phase(lo, now) {
    if (!lo || !lo.enabled) return "off";
    var cut = date(lo.cutover_at), t = (date(now) || new Date()).getTime();
    // after_cutover van de server gaat voor (klok van de bezoeker kan afwijken); zonder `now` ook de eigen klok
    if (lo.after_cutover === true || (cut && t >= cut.getTime() && (lo.after_cutover !== false || now))) return "after";
    return lo.announced && cut ? "before" : "off";
  }

  function locale(lang) { return lang === "en" ? "en-GB" : "nl-NL"; }
  function fmtDate(v, lang) {
    var d = date(v); if (!d) return "";
    try { return d.toLocaleDateString(locale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: TZ }); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }
  /** € 4,99 (nl) of €4.99 (en). */
  function euro(cents, lang) {
    var v = (Math.max(0, cents) / 100).toFixed(2);
    return lang === "en" ? "€" + v : "€ " + v.replace(".", ",");
  }
  /** Prijs na korting in centen: van de server, anders zelf (Stripe rondt de korting af op hele centen). */
  function discounted(priceCents, lo) {
    if (!lo || priceCents == null) return null;
    if (lo.discounted_price_cents != null && lo.discounted_price_cents > 0 && lo.discounted_price_cents < priceCents) return lo.discounted_price_cents;
    if (lo.discount_pct == null) return null;
    return priceCents - Math.round(priceCents * lo.discount_pct / 100);
  }
  /** Code nog geldig (code_valid_until in de toekomst, of geen einddatum)? */
  function codeValid(lo, now) {
    if (!lo || !lo.code) return false;
    var u = date(lo.code_valid_until);
    return !u || (date(now) || new Date()).getTime() < u.getTime();
  }

  /** Naam van Gratis in de vergelijking: "Gratis (tot 7 december 2026)" vóór de overgang, anders null (= standaard). */
  function freeName(lo, lang, now) {
    return phase(lo, now) === "before" ? tr(lang).freeUntil.replace("%s", fmtDate(lo.cutover_at, lang)) : null;
  }

  /** Banner voor de homepage (alleen vóór cutover_at, aangekondigd); anders "". */
  function banner(lo, lang, opts) {
    if (phase(lo, opts && opts.now) !== "before") return "";
    var t = tr(lang), href = (opts && opts.href) || "#prijzen";
    return '<div class="lt-banner" role="status"><div class="lt-banner-t"><b>' + esc(t.banner.replace("%s", fmtDate(lo.cutover_at, lang))) + "</b> " +
      esc(t.bannerP) + '</div><a class="btn red sm" href="' + esc(href) + '">' + esc(t.bannerBtn) + "</a></div>";
  }

  /** Teksten van de homepage voor deze fase ({data-i18n-sleutel: html}); leeg bij 'off'. */
  function homeTexts(lo, lang, now) {
    var ph = phase(lo, now), k = lang === "en" ? "en" : "nl";
    return ph === "after" ? HOME_AFTER[k] : ph === "before" ? HOME_BEFORE[k] : {};
  }

  /** billing `config` ophalen (met de sessie als die er is, dan staat de eigen code erbij). null bij een fout. */
  function fetchConfig() {
    var cfg = window.BINGR_SUPABASE;
    if (!cfg || !cfg.url || typeof fetch !== "function") return Promise.resolve(null);
    var sess = window.Bingr && window.Bingr.sb ? window.Bingr.sb.auth.getSession().then(function (r) { return r && r.data && r.data.session; }, function () { return null; }) : Promise.resolve(null);
    return sess.then(function (s) {
      var h = { "Content-Type": "application/json", apikey: cfg.anonKey };
      if (s && s.access_token) h.Authorization = "Bearer " + s.access_token;
      return fetch(cfg.url + "/functions/v1/billing/config", { method: "POST", headers: h, body: "{}" });
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  /** Datum van de nieuwe voorwaarden/privacy (DATUM-D) in de taal van de pagina; zolang hij niet is ingevuld: "DATUM-D". */
  function termsDate(lang) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(TERMS_DATE)) return TERMS_DATE;
    return fmtDate(TERMS_DATE + "T12:00:00Z", lang);
  }
  function fillTermsDate() {
    if (typeof document === "undefined") return;
    Array.prototype.forEach.call(document.querySelectorAll("[data-terms-date]"), function (el) {
      el.textContent = termsDate(el.getAttribute("data-terms-date") === "en" ? "en" : "nl");
    });
  }

  return { TERMS_DATE: TERMS_DATE, CUTOVER_DEFAULT: CUTOVER_DEFAULT, parse: parse, phase: phase, fmtDate: fmtDate, euro: euro, discounted: discounted, codeValid: codeValid,
    cleanCode: cleanCode, freeName: freeName, banner: banner, homeTexts: homeTexts, fetchConfig: fetchConfig, termsDate: termsDate,
    fillTermsDate: fillTermsDate, text: tr };
})();
