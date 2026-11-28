// Build 193: de betaaltrechter meten (docs/ACCOUNT.md van iptv-ios-appletv, "Build 193"). Alleen tellen, geen
// gebruikersgegevens: POST /functions/v1/billing {action:"funnel", step, platform, build, product?, error?}.
// Zonder inloggen, het antwoord wordt genegeerd, nooit opnieuw proberen en nooit de pagina laten wachten of breken.
//   step     paywall_shown | purchase_started | purchase_ok | purchase_failed | purchase_cancelled
//   platform web | windows (of het platform van de app die naar /upgrade/ doorstuurde: ?from=app&platform=…)
//   build    de nieuwste build met een punt voor de website (assets/changelog.json, dezelfde regel als de voet)
//   product  month | half | year | lifetime
//   error    korte code, [a-z0-9_], hooguit 40 tekens (nooit vrije tekst of id's)
// Gebruikt door /upgrade/, /upgrade/klaar/ en de webspeler (web/js/premium.js en lifetime.js; ook de Windows-app).
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BingrFunnel = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";
  var STEPS = ["paywall_shown", "purchase_started", "purchase_ok", "purchase_failed", "purchase_cancelled"];
  var PLATFORMS = ["web", "windows", "android", "androidtv", "ios", "ipados", "tvos", "macos"];
  var PRODUCTS = ["month", "half", "year", "lifetime"];
  var KEY = "bingr.funnel", MAX_AGE = 2 * 3600 * 1000;

  function platform(v) { return PLATFORMS.indexOf(v) >= 0 ? v : "web"; }
  function product(v) { return PRODUCTS.indexOf(v) >= 0 ? v : null; }
  /** Foutcode in vaste vorm: kleine letters, cijfers en _, hooguit 40 tekens; anders null. */
  function code(v) {
    if (typeof v !== "string") return null;
    var s = v.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    return s || null;
  }
  /** Pure logica: de body voor de server, of null als de stap of de build niet klopt. */
  function payload(step, o) {
    o = o || {};
    if (STEPS.indexOf(step) < 0) return null;
    var b = Number(o.build);
    if (!(b > 0 && b < 100000 && Math.floor(b) === b)) return null;
    var out = { action: "funnel", step: step, platform: platform(o.platform), build: b };
    var p = product(o.product); if (p) out.product = p;
    if (step === "purchase_failed") out.error = code(o.error) || "unknown";
    return out;
  }
  /** Antwoord van billing `checkout` (of een netwerkfout) naar een korte code. */
  function errorCode(status, j, thrown) {
    if (thrown) return thrown === "signed_out" || thrown === "banned" ? thrown : "network";
    var e = j && typeof j.error === "string" ? code(j.error) : null;
    if (e) return e;
    if (status === 429) return "rate_limited";
    if (status === 503 || status === 502) return "checkout_unavailable";
    if (status === 200) return "bad_checkout_url";
    return status >= 500 ? "server_error" : "http_" + (Number(status) || 0);
  }
  /** Nieuwste build met een punt voor de website (dezelfde regel als assets/js/site.js en tools/sync_website.py). */
  function webBuild(list) {
    if (!Array.isArray(list)) return null;
    var e = list.filter(function (x) { return x && (x.items || []).some(function (i) { return (i.platforms || []).indexOf("web") >= 0; }); })[0] || list[0];
    var n = e ? Number(e.build) : NaN;
    return n > 0 ? n : null;
  }
  /** Platform voor /upgrade/: de app die doorstuurde (?from=app&platform=…), anders web. */
  function platformFromQuery(q) {
    try {
      if (q && q.get("from") === "app") { var p = q.get("platform"); return p === "browser" ? "web" : platform(p); }
    } catch (e) {}
    return "web";
  }

  // ---------------- browser ----------------
  var doc = root.document, src = "";
  try { src = doc && doc.currentScript ? doc.currentScript.src : ""; } catch (e) { src = ""; }
  var buildP = null;
  function build() {
    if (buildP) return buildP;
    buildP = new Promise(function (resolve) {
      var done = false, fin = function (v) { if (!done) { done = true; resolve(v); } };
      try {
        var url = new URL("../changelog.json", src || root.location.href).href;
        root.fetch(url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { fin(webBuild(d)); }, function () { fin(null); });
      } catch (e) { fin(null); }
      root.setTimeout(function () { fin(null); }, 4000);
    });
    return buildP;
  }
  function config() {
    var c = root.BINGR_SUPABASE || {};
    return c.url && c.anonKey ? c : null;
  }
  /** Versturen en vergeten: geen antwoord, geen fout naar buiten. */
  function send(step, o) {
    try {
      var c = config();
      if (!c || typeof root.fetch !== "function") return;
      build().then(function (b) {
        var body = payload(step, Object.assign({}, o || {}, { build: b }));
        if (!body) return;
        try {
          root.fetch(c.url + "/functions/v1/billing", { method: "POST", keepalive: true, credentials: "omit",
            headers: { "Content-Type": "application/json", apikey: c.anonKey }, body: JSON.stringify(body) }).catch(function () {});
        } catch (e) {}
      }).catch(function () {});
    } catch (e) {}
  }
  var seen = {};
  /** Eén keer per paginaweergave per sleutel (bv. het betaalscherm dat opnieuw getekend wordt). */
  function once(key, step, o) { if (seen[key]) return; seen[key] = true; send(step, o); }
  /** Voor de terugkeer van Stripe: platform en product van de gestarte aankoop (alleen in dit tabblad). */
  function remember(o) {
    try { root.sessionStorage.setItem(KEY, JSON.stringify({ platform: platform(o && o.platform), product: product(o && o.product), at: Date.now() })); } catch (e) {}
  }
  function recall(keep) {
    try {
      var v = JSON.parse(root.sessionStorage.getItem(KEY) || "null");
      if (!keep) root.sessionStorage.removeItem(KEY);
      if (v && Date.now() - v.at < MAX_AGE) return { platform: platform(v.platform), product: product(v.product) };
    } catch (e) {}
    return null;
  }
  if (doc && typeof root.fetch === "function") build();
  return { STEPS: STEPS, PRODUCTS: PRODUCTS, payload: payload, errorCode: errorCode, code: code, webBuild: webBuild,
    platformFromQuery: platformFromQuery, send: send, once: once, remember: remember, recall: recall };
});
