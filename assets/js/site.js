// Gedeeld voor de subpagina's van bingr.online (niet de homepage, niet /web):
// taal (NL/EN, localStorage 'bingr.lang', of ?lang=), de NL/EN-knop, navigatie en footer vertalen,
// nav donker bij scrollen, jaartal en het buildnummer in de footer.
// Gebruik: <script src="…/assets/js/site.js" data-base="../"></script> direct na de footer, vóór de paginascripts.
(function () {
  var base = (document.currentScript && document.currentScript.dataset.base) || "";
  var q = null; try { q = new URLSearchParams(location.search).get("lang"); } catch (e) {}
  var saved = null; try { saved = localStorage.getItem("bingr.lang"); } catch (e) {}
  var lang = (q || saved || navigator.language || "nl").toLowerCase().indexOf("nl") === 0 ? "nl" : "en";
  document.documentElement.lang = lang;

  // gedeelde teksten (nav en footer); NL staat in de HTML
  var EN = {
    "nav.features": "Features", "nav.start": "What you need", "nav.platforms": "Devices", "nav.web": "Watch in your browser",
    "foot.tag": "IPTV, done right.", "foot.pair": "Link a TV", "foot.account": "My Bingr", "foot.web": "Web player",
    "foot.privacy": "Privacy", "foot.cookies": "Cookie settings", "foot.version": "version",
    "foot.disc": "Bingr is a media player and does not provide, sell or host any channels, movies or series. You are responsible for the content you play and your right to watch it. Apple, iPhone, iPad, Apple TV, Mac and AirPlay are trademarks of Apple Inc. Android, Google TV and Android TV are trademarks of Google LLC, Fire TV of Amazon.com, Inc. and Samsung and Tizen of Samsung Electronics Co., Ltd."
  };
  function apply() {
    if (lang === "en") document.querySelectorAll("[data-s]").forEach(function (el) { var v = EN[el.dataset.s]; if (v) el.innerHTML = v; });
    // pagina's met losse NL/EN-blokken (support, privacy)
    document.querySelectorAll("[data-l]").forEach(function (el) { el.hidden = el.getAttribute("data-l") !== lang; });
    document.querySelectorAll(".lang button").forEach(function (b) {
      var on = b.dataset.lang === lang; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
      b.onclick = function () {
        if (b.dataset.lang === lang) return;
        try { localStorage.setItem("bingr.lang", b.dataset.lang); } catch (e) {}
        // ?lang= in de link zou de keuze overrulen: weghalen
        // (zelfde URL met een #anker zou niet herladen: dan gewoon reload)
        var u = null; try { u = new URL(location.href); } catch (e) {}
        if (u && u.searchParams.has("lang")) { u.searchParams.delete("lang"); location.replace(u.toString()); } else location.reload();
      };
    });
    var yr = document.getElementById("yr"); if (yr) yr.textContent = new Date().getFullYear();
    // zonder cookiemelding op deze pagina (afmelden): geen link naar cookie-instellingen
    if (!window.BingrConsent) document.querySelectorAll("[data-consent-link]").forEach(function (a) { a.hidden = true; });
    var nav = document.getElementById("nav");
    if (nav) { var f = function () { nav.classList.toggle("scrolled", scrollY > 8); }; addEventListener("scroll", f, { passive: true }); f(); }
    // buildnummer: dezelfde regel als tools/sync_website.py (nieuwste build met een punt voor de website)
    var bs = [].filter.call(document.querySelectorAll("[data-build]"), function (el) { return !el.textContent.trim(); });
    if (bs.length) fetch(base + "assets/changelog.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      var e = d.filter(function (x) { return (x.items || []).some(function (i) { return (i.platforms || []).indexOf("web") >= 0; }); })[0] || d[0];
      if (e) bs.forEach(function (el) { el.textContent = (e.version || "1.0.0") + " (build " + e.build + ")"; });
    }).catch(function () {});
  }
  window.BingrSite = { lang: lang, base: base };
  apply();
})();
