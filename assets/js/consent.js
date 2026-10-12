// Cookiemelding (AVG/ePrivacy). Noodzakelijke opslag (inloggen, taal, deze keuze) staat altijd aan.
// Google Fonts (externe partij) laadt pas na "Accepteren". De keuze wordt 12 maanden onthouden.
(function () {
  var KEY = "bingr_consent", MAX = 365 * 24 * 3600;
  function read() {
    try { var v = localStorage.getItem(KEY); if (v) return JSON.parse(v); } catch (e) {}
    var m = document.cookie.match(/(?:^|; )bingr_consent=([^;]+)/);
    if (m) { try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) {} }
    return null;
  }
  function save(choice) {
    var v = { choice: choice, at: new Date().toISOString(), v: 1 };
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
    document.cookie = KEY + "=" + encodeURIComponent(JSON.stringify(v)) + "; Max-Age=" + MAX + "; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    return v;
  }
  function fonts() {
    if (document.getElementById("bingr-fonts")) return;
    var l = document.createElement("link"); l.id = "bingr-fonts"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap";
    document.head.appendChild(l);
  }
  var nl = (function () { try { return localStorage.getItem("bingr.lang"); } catch (e) { return null; } })();
  nl = (nl || navigator.language || "nl").toLowerCase().indexOf("nl") === 0;
  var T = nl
    ? { t: "Cookies en privacy", p: "Bingr gebruikt alleen opslag die nodig is: om je ingelogd te houden en je taal en deze keuze te onthouden. Met je toestemming laden we ook het lettertype van Google Fonts; daarbij ziet Google je IP-adres. Geen advertenties, geen tracking.", a: "Accepteren", r: "Alleen noodzakelijk", m: "Meer in de privacyverklaring" }
    : { t: "Cookies and privacy", p: "Bingr only uses storage that's needed: to keep you signed in and remember your language and this choice. With your consent we also load the Google Fonts typeface, which lets Google see your IP address. No ads, no tracking.", a: "Accept", r: "Necessary only", m: "More in the privacy policy" };
  var base = (document.currentScript && document.currentScript.dataset.base) || "";
  function banner() {
    if (document.getElementById("bingr-consent")) return;
    var st = document.createElement("style");
    st.textContent = "#bingr-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin:0 auto;background:#141414f2;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid #ffffff22;border-radius:14px;padding:20px 22px;color:#fff;font:15px/1.5 Inter,-apple-system,'Helvetica Neue',Arial,sans-serif;box-shadow:0 20px 60px #000a}" +
      "#bingr-consent h4{font-size:17px;margin:0 0 6px}#bingr-consent p{margin:0;color:#c8c8c8;font-size:14px}#bingr-consent a{color:#fff}" +
      "#bingr-consent .b{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}#bingr-consent button{font:inherit;font-weight:700;border:0;border-radius:6px;padding:11px 18px;cursor:pointer}" +
      "#bingr-consent .y{background:#E50914;color:#fff}#bingr-consent .n{background:#ffffff1f;color:#fff}";
    document.head.appendChild(st);
    var d = document.createElement("div"); d.id = "bingr-consent"; d.setAttribute("role", "dialog"); d.setAttribute("aria-live", "polite");
    d.innerHTML = "<h4>" + T.t + "</h4><p>" + T.p + ' <a href="' + base + 'privacy.html#cookies">' + T.m + '</a></p><div class="b"><button class="y">' + T.a + '</button><button class="n">' + T.r + "</button></div>";
    d.querySelector(".y").onclick = function () { save("all"); fonts(); d.remove(); };
    d.querySelector(".n").onclick = function () { save("necessary"); d.remove(); };
    (document.body || document.documentElement).appendChild(d);
  }
  window.BingrConsent = { open: function () { var x = document.getElementById("bingr-consent"); if (x) x.remove(); banner(); }, get: read };
  var c = read();
  if (c && c.choice === "all") fonts();
  if (!c) { if (document.body) banner(); else document.addEventListener("DOMContentLoaded", banner); }
})();
