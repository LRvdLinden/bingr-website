// Versies bij de downloadknoppen op bingr.online: rode badges zoals "Live 1.0.2 (152)" en "TestFlight 1.0.3 (154)".
// Gegevens live uit de functie status (GET ?action=releases; app_settings.release_channels, in te stellen in het beheer;
// contract: docs/ACCOUNT.md "Versies bij de downloadknoppen" in iptv-ios-appletv). Geen data of een fout = geen badge;
// de pagina breekt nooit. Geen prijzen of koopknoppen.
// Knoppen: links naar de App Store en TestFlight (apple) en naar Google Play en de APK (android) met de klasse tf-badge
// of btn. Per groep knoppen (hetzelfde ouderelement) komt één rij badges direct onder de knoppen: per platform eerst
// live, dan de bèta. Gebruik: <script src="…/assets/js/releases.js" defer></script> (na de taalcode van de pagina).
(function () {
  "use strict";
  try {
    var CFG = window.BINGR_SUPABASE || {};
    var API = (CFG.url || "https://vjewsncmsxmhmhnoxwqx.supabase.co") + "/functions/v1/status?action=releases";
    var T = {
      nl: {
        apple: "Apple", android: "Android", live: "Live", list: "Versies",
        tLive: { apple: "Nu in de App Store", android: "Nu in Google Play" },
        tBeta: { apple: "Nieuwste bèta via TestFlight", android: "Nieuwste testversie" },
        v: "versie %v, build %b", on: "sinds %d", locale: "nl-NL",
      },
      en: {
        apple: "Apple", android: "Android", live: "Live", list: "Versions",
        tLive: { apple: "Now on the App Store", android: "Now on Google Play" },
        tBeta: { apple: "Latest beta on TestFlight", android: "Latest test version" },
        v: "version %v, build %b", on: "since %d", locale: "en-GB",
      },
    };
    var lang = (document.documentElement.lang || "nl").toLowerCase().indexOf("en") === 0 ? "en" : "nl";
    var t = T[lang];
    var KINDS = [
      [/^https:\/\/apps\.apple\.com\//, "apple"],
      [/^https:\/\/testflight\.apple\.com\//, "apple"],
      [/^https:\/\/play\.google\.com\/store\/apps\//, "android"],
      [/^https:\/\/beheer\.bingr\.online\/dl\.php\?app=android(&|$)/, "android"],
      [/^https:\/\/bingr\.online\/apk\/?$/, "android"],
    ];
    var VER = /^\d{1,3}(\.\d{1,3}){1,3}$/;

    function platformOf(a) {
      var h = a.getAttribute("href") || "";
      for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0].test(h)) return KINDS[i][1];
      return null;
    }
    function ok(c) { return c && typeof c === "object" && VER.test(String(c.version || "")) && /^\d{1,7}$/.test(String(c.build || "")); }
    function fmtDate(d) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ""))) return "";
      try { return new Date(d + "T12:00:00Z").toLocaleDateString(t.locale, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
    }
    function css() {
      if (document.getElementById("rel-badges-css")) return;
      var s = document.createElement("style");
      s.id = "rel-badges-css";
      s.textContent =
        ".rel-badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding:0;list-style:none}" +
        ".rel-badges li{display:inline-flex;align-items:center;gap:7px;padding:5px 12px 5px 10px;border-radius:999px;" +
        "border:1.5px solid var(--red,#E50914);background:#e5091424;color:#fff;font-size:13px;font-weight:700;line-height:1.2;" +
        "letter-spacing:.01em;font-variant-numeric:tabular-nums;white-space:nowrap;box-shadow:0 0 18px #e5091433}" +
        ".rel-badges li::before{content:\"\";width:7px;height:7px;border-radius:50%;background:var(--red,#E50914);flex:none;box-shadow:0 0 0 3px #e5091440}" +
        ".rel-badges li.beta{background:transparent;border-style:dashed}" +
        ".rel-badges li .p{color:#ffffffb3;font-weight:600}" +
        ".rel-badges li .n{opacity:.8;font-weight:600}";
      document.head.appendChild(s);
    }
    function badge(p, kind, c, prefix) {
      var li = document.createElement("li");
      li.className = kind;
      var label = kind === "live" ? t.live : (c.label === "Beta" || c.label === "TestFlight" ? c.label : p === "apple" ? "TestFlight" : "Beta");
      if (prefix) { var ps = document.createElement("span"); ps.className = "p"; ps.textContent = t[p] + " "; li.appendChild(ps); }
      li.appendChild(document.createTextNode(label + " " + c.version + " "));
      var n = document.createElement("span"); n.className = "n"; n.textContent = "(" + c.build + ")"; li.appendChild(n);
      var d = fmtDate(c.date);
      li.title = (kind === "live" ? t.tLive[p] : t.tBeta[p]) + ": " + t.v.replace("%v", c.version).replace("%b", c.build) + (d ? ", " + t.on.replace("%d", d) : "");
      return li;
    }
    function render(data) {
      if (!data || typeof data !== "object") return;
      var groups = [];
      [].forEach.call(document.querySelectorAll("a.tf-badge[href], a.btn[href]"), function (a) {
        var p = platformOf(a);
        if (!p || !a.parentElement) return;
        var g = null;
        for (var i = 0; i < groups.length; i++) if (groups[i].el === a.parentElement) g = groups[i];
        if (!g) { g = { el: a.parentElement, plats: [] }; groups.push(g); }
        if (g.plats.indexOf(p) < 0) g.plats.push(p);
      });
      if (!groups.length) return;
      var added = false;
      groups.forEach(function (g) {
        if (g.el.nextElementSibling && g.el.nextElementSibling.classList.contains("rel-badges")) return;
        var ul = document.createElement("ul");
        ul.className = "rel-badges";
        ul.setAttribute("aria-label", t.list);
        var prefix = g.plats.length > 1;
        g.plats.forEach(function (p) {
          var r = data[p] || {};
          if (ok(r.live)) ul.appendChild(badge(p, "live", r.live, prefix));
          if (ok(r.beta)) ul.appendChild(badge(p, "beta", r.beta, prefix));
        });
        if (!ul.children.length) return;
        if (!added) { css(); added = true; }
        g.el.parentNode.insertBefore(ul, g.el.nextSibling);
      });
    }
    if (!window.fetch) return;
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    fetch(API, { cache: "default", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        clearTimeout(timer);
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { try { render(d); } catch (e) { /* stil */ } });
        else render(d);
      })
      .catch(function () { clearTimeout(timer); });
  } catch (e) { /* nooit de pagina breken */ }
})();
