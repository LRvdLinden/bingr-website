// Gedeelde inlog- en "wachtwoord vergeten"-logica voor /account, /upgrade en /koppelen.
// Niet in account.js: dat bestand wordt naar bingr-support gekopieerd. Laden ná assets/js/account.js (window.Bingr).
// Gebruik:
//   if (await BingrAuth.signIn({ email, password, btn, label, errEl, tr, onBanned })) …ingelogd…
//   BingrAuth.sendReset({ email, errEl, tr, sentKey, trigger, focusEl })
//   BingrAuth.errText(err, tr) en BingrAuth.esc(s)
// `tr` is de vertaalfunctie van de pagina (Bingr.t); sleutels die de pagina niet heeft vallen terug op de teksten hieronder.
(function () {
  var B = window.Bingr || {};
  var lang = B.lang === "en" ? "en" : "nl";
  var M = {
    nl: {
      rateLimit: "Even wachten: er zijn te veel pogingen gedaan. Probeer het over een paar minuten opnieuw.",
      offline: "Geen verbinding. Controleer je internetverbinding en probeer het opnieuw.",
      generic: "Er ging iets mis. Probeer het opnieuw.",
      badEmail: "Vul een geldig e-mailadres in.",
      badCreds: "Onjuist e-mailadres of wachtwoord.",
      notConfirmed: "Bevestig eerst je e-mailadres. Kijk in je inbox.",
      waiting: "Even geduld…"
    },
    en: {
      rateLimit: "Please wait: there have been too many attempts. Try again in a few minutes.",
      offline: "No connection. Check your internet connection and try again.",
      generic: "Something went wrong. Please try again.",
      badEmail: "Enter a valid email address.",
      badCreds: "Incorrect email or password.",
      notConfirmed: "Confirm your email address first. Check your inbox.",
      waiting: "One moment…"
    }
  };
  // tekst van de pagina als die er is, anders de eigen tekst
  function txt(tr, k) { var v = tr ? tr(k) : null; return v && v !== k ? v : (M[lang][k] || M.nl[k] || k); }
  // HTML-escape, ook voor attributen (" en ')
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function isEmail(s) { return /^\S+@\S+\.\S+$/.test(s || ""); }
  // Voor- of achternaam bij het aanmaken van een account (user_metadata first_name / last_name):
  // stuurtekens en < > weg, witruimte samengevoegd en getrimd, max. 50 tekens. Gelijk aan personName() in de functies.
  var NAME_MAX = 50;
  function cleanName(s) {
    var v = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
    return Array.from(v).slice(0, NAME_MAX).join("").trim();
  }
  function isBanned(e) { return !!e && (e.code === "user_banned" || e.error === "user_banned" || /banned/i.test(e.message || "")); }
  function kind(e) {
    var c = (e && (e.code || e.error_code)) || "", m = ((e && e.message) || "").toLowerCase(), st = e && e.status;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    // fetch zonder antwoord (status 0) of een netwerkfout van de browser
    if (st === 0 || (e && e.name === "TypeError") || /failed to fetch|networkerror|load failed|network request failed/.test(m)) return "offline";
    if (st === 429 || /rate_limit|rate limit|too many/.test(c + " " + m)) return "rateLimit";
    if (isBanned(e)) return "banned";
    if (c === "invalid_credentials" || m.indexOf("invalid login") >= 0) return "badCreds";
    if (c === "email_not_confirmed" || m.indexOf("not confirmed") >= 0) return "notConfirmed";
    if (c === "user_already_exists" || m.indexOf("already registered") >= 0) return "exists";
    if (c === "weak_password") return "shortPw";
    return "generic";
  }
  function errText(e, tr) { return txt(tr, kind(e)); }
  function busy(btn, on, label) {
    if (!btn) return;
    if (B.busy && btn.tagName === "BUTTON") return B.busy(btn, on, label);
    // links die als knop werken (Wachtwoord vergeten?): niet dubbel laten klikken
    if (on) { btn.setAttribute("aria-disabled", "true"); btn.style.pointerEvents = "none"; btn.style.opacity = ".6"; }
    else { btn.removeAttribute("aria-disabled"); btn.style.pointerEvents = ""; btn.style.opacity = ""; }
  }
  // Inloggen met e-mail en wachtwoord. Geeft true bij succes; de knop staat daarna altijd weer aan.
  async function signIn(o) {
    var tr = o.tr;
    if (o.errEl) o.errEl.textContent = "";
    busy(o.btn, true, txt(tr, "waiting"));
    try {
      var r = await B.sb.auth.signInWithPassword({ email: String(o.email || "").trim(), password: o.password || "" });
      if (r && r.error) throw r.error;
      return true;
    } catch (err) {
      if (isBanned(err) && o.onBanned) o.onBanned(err);
      else if (o.errEl) o.errEl.textContent = errText(err, tr);
      return false;
    } finally { busy(o.btn, false, o.label); }
  }
  // E-mail om het wachtwoord opnieuw in te stellen. Bestaat het adres niet, dan meldt de server geen fout (geen lek).
  async function sendReset(o) {
    var tr = o.tr, email = String(o.email || "").trim(), el = o.errEl;
    if (!isEmail(email)) { if (el) el.textContent = txt(tr, "badEmail"); if (o.focusEl) o.focusEl.focus(); return false; }
    if (o.trigger && o.trigger.getAttribute("aria-disabled") === "true") return false;
    if (el) el.textContent = "";
    var label = o.trigger && o.trigger.tagName === "BUTTON" ? o.trigger.textContent : null;
    busy(o.trigger, true, label ? txt(tr, "waiting") : null);
    try {
      var r = await B.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/reset/" });
      if (r && r.error) throw r.error;
      if (el) el.innerHTML = '<span class="ok">' + esc(txt(tr, o.sentKey || "resetSent")) + "</span>";
      return true;
    } catch (err) {
      if (el) el.textContent = errText(err, tr);
      return false;
    } finally { busy(o.trigger, false, label); }
  }
  window.BingrAuth = { esc: esc, isEmail: isEmail, cleanName: cleanName, NAME_MAX: NAME_MAX, isBanned: isBanned, errKind: kind, errText: errText, signIn: signIn, sendReset: sendReset, text: function (k) { return txt(null, k); } };
})();
