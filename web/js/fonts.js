// Webspeler: geen cookiemelding. Alleen noodzakelijke opslag (inloggen, taal). Het lettertype van Google Fonts laadt hier
// alleen als de bezoeker dat eerder op bingr.online heeft geaccepteerd (keuze "bingr_consent" van assets/js/consent.js);
// anders systeemlettertypen. Zo gaat er zonder toestemming niets naar een externe partij.
(function () {
  var v = null;
  try { v = JSON.parse(localStorage.getItem("bingr_consent") || "null"); } catch (e) { /* geen opslag */ }
  if (!v) {
    var m = document.cookie.match(/(?:^|; )bingr_consent=([^;]+)/);
    if (m) { try { v = JSON.parse(decodeURIComponent(m[1])); } catch (e) { /* ongeldig */ } }
  }
  if (!v || v.choice !== "all") return;
  var l = document.createElement("link");
  l.id = "bingr-fonts"; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap";
  document.head.appendChild(l);
})();
