// Gedeelde helpers voor bingr.online/tv en /reset (Supabase-accounts).
(function () {
  const params = new URLSearchParams(location.search);
  const lang = (params.get("lang") || localStorage.getItem("bingr.lang") || navigator.language || "en").toLowerCase().startsWith("nl") ? "nl" : "en";
  const cfg = window.BINGR_SUPABASE || {};
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" } });
  const $ = (id) => document.getElementById(id);
  function t(dict) {
    document.documentElement.lang = lang;
    if (dict[lang].docTitle) document.title = dict[lang].docTitle;
    document.querySelectorAll("[data-t]").forEach((el) => { const v = dict[lang][el.dataset.t]; if (v != null) el.innerHTML = v; });
    document.querySelectorAll("[data-ph]").forEach((el) => { const v = dict[lang][el.dataset.ph]; if (v != null) el.placeholder = v; });
    const sw = $("langSwitch");
    if (sw) { sw.textContent = lang === "nl" ? "English" : "Nederlands"; sw.onclick = (e) => { e.preventDefault(); localStorage.setItem("bingr.lang", lang === "nl" ? "en" : "nl"); location.reload(); }; }
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
  window.Bingr = { sb, lang, params, $, t, pwToggles, busy, cfg };
})();
