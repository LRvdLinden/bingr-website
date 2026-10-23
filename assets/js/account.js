// Gedeelde helpers voor bingr.online/koppelen en /reset (Supabase-accounts).
(function () {
  const params = new URLSearchParams(location.search);
  // taal: dezelfde keuze als de rest van de site (assets/js/site.js); ?lang= gaat voor
  const lang = (window.BingrSite && BingrSite.lang) || ((params.get("lang") || (function () { try { return localStorage.getItem("bingr.lang"); } catch (e) { return null; } })() || navigator.language || "en").toLowerCase().startsWith("nl") ? "nl" : "en");
  const cfg = window.BINGR_SUPABASE || {};
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" } });
  const $ = (id) => document.getElementById(id);
  function t(dict) {
    document.documentElement.lang = lang;
    if (dict[lang].docTitle) document.title = dict[lang].docTitle;
    document.querySelectorAll("[data-t]").forEach((el) => { const v = dict[lang][el.dataset.t]; if (v != null) el.innerHTML = v; });
    document.querySelectorAll("[data-ph]").forEach((el) => { const v = dict[lang][el.dataset.ph]; if (v != null) el.placeholder = v; });
    return (k) => dict[lang][k] || k;
  }
  function pwToggles(tr) {
    document.querySelectorAll(".pw button").forEach((b) => {
      b.textContent = tr("show");
      b.onclick = () => { const i = b.previousElementSibling; const s = i.type === "password"; i.type = s ? "text" : "password"; b.textContent = tr(s ? "hide" : "show"); };
    });
  }
  function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }
  // links die als knop werken (href="#" voor het toetsenbord): niet naar boven springen
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest('a[href="#"][role="button"]'); if (a) e.preventDefault(); });
  // Uitloggen in deze browser, altijd: hooguit 3 s wachten op de server (een al ingetrokken sessie of een vastgelopen
  // lock mag het uitloggen niet tegenhouden), daarna zelf de sessie (sb-…-auth-token) uit de opslag halen.
  async function hardSignOut() {
    try { await Promise.race([sb.auth.signOut({ scope: "local" }), new Promise((r) => setTimeout(r, 3000))]); } catch (e) {}
    try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token(-code-verifier)?$/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
    try { window.BingrAvatar && BingrAvatar.clear(); } catch (e) {}
  }
  // Build 141: wachtwoord minimaal 8 tekens (de server eist het ook; fout weak_password).
  const PW_MIN = 8;
  // Build 141: inloggen met e-mail en wachtwoord via de eigen functie login (blokkade per account, docs/ACCOUNT.md
  // "Inloggen via de functie login" in iptv-ios-appletv). 200 = hetzelfde antwoord als /auth/v1/token?grant_type=password;
  // de sessie gaat met setSession in supabase-js. Bestaat de functie (nog) niet (404), dan signInWithPassword.
  // Terug: { error } met error = null of { code, status, message, retry_after } (zoals de fouten van supabase-js).
  async function passwordLogin(email, password, platform) {
    let r;
    try {
      r = await fetch(cfg.url + "/functions/v1/login", {
        method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.anonKey },
        body: JSON.stringify({ email: String(email || "").trim(), password: password || "", platform: platform || "web" }),
      });
    } catch (e) { return { error: { code: "network", status: 0, message: "Failed to fetch", name: "TypeError" } }; }
    if (r.status === 404) {
      const x = await sb.auth.signInWithPassword({ email: String(email || "").trim(), password: password || "" });
      return { error: x.error || null };
    }
    let j = {};
    try { j = await r.json(); } catch (e) { j = {}; }
    if (r.ok && j && j.access_token && j.refresh_token) {
      const s = await sb.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
      return { error: s.error || null };
    }
    const code = j.error_code || j.code || j.error || (r.status === 429 ? "too_many_attempts" : "unexpected");
    return { error: { code: String(code), status: r.status, message: String(j.msg || j.message || code), retry_after: Number(j.retry_after) || 0 } };
  }
  // melding bij te veel pogingen (429): met minuten als de server retry_after (seconden) meegeeft
  function tooManyText(e) {
    const s = Number(e && e.retry_after) || 0;
    if (s > 0) {
      const m = Math.max(1, Math.ceil(s / 60));
      return lang === "nl" ? `Te veel pogingen. Probeer het over ${m} ${m === 1 ? "minuut" : "minuten"} opnieuw.` : `Too many attempts. Try again in ${m} ${m === 1 ? "minute" : "minutes"}.`;
    }
    return lang === "nl" ? "Te veel pogingen. Wacht een paar minuten en probeer het opnieuw." : "Too many attempts. Wait a few minutes and try again.";
  }
  const shortPwText = () => (lang === "nl" ? `Je wachtwoord moet minstens ${PW_MIN} tekens hebben.` : `Password must be at least ${PW_MIN} characters.`);
  window.Bingr = { sb, lang, params, $, t, pwToggles, busy, cfg, hardSignOut, PW_MIN, passwordLogin, tooManyText, shortPwText };
})();
