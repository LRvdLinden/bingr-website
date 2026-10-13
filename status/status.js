// Bingr-status: leest de openbare status van de functie `status` (geen sleutel nodig) en ververst elke 60 s.
(() => {
  "use strict";
  const CFG = window.BINGR_SUPABASE || {};
  const URL_ = `${CFG.url}/functions/v1/status?action=public`;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const lang = (window.BingrSite && BingrSite.lang) || "nl";
  const T = {
    nl: {
      loading: "Status laden…", updated: "Laatst bijgewerkt", refresh: "ververst elke minuut", cookies: "Cookie-instellingen",
      allUp: "Alle systemen werken", down: (n) => `Storing bij ${n}`, degraded: "Verminderde prestaties",
      allUpSub: "Accounts, website, webspeler en downloads werken zoals het hoort.",
      downSub: "We weten ervan en kijken ernaar. Deze pagina werkt zichzelf bij.",
      degradedSub: (n) => `${n} reageert trager dan normaal of gaf net een fout.`,
      up: "Werkt", deg: "Verminderd", dn: "Storing", none: "Geen gegevens",
      daysAgo: (n) => `${n} dagen geleden`, today: "Vandaag", uptime: "uptime", ms: "ms gemiddeld (24 uur)",
      incidents: "Storingen (laatste 30 dagen)", noInc: "Geen storingen in de afgelopen 30 dagen.", ongoing: "loopt nog",
      tipNone: "Geen gegevens", err: "De status kan nu niet worden geladen. We proberen het over een minuut opnieuw.",
      and: "en", dur: (s) => fmtDur(s, "nl"),
    },
    en: {
      loading: "Loading status…", updated: "Last updated", refresh: "refreshes every minute", cookies: "Cookie settings",
      allUp: "All systems operational", down: (n) => `Outage affecting ${n}`, degraded: "Degraded performance",
      allUpSub: "Accounts, website, web player and downloads are working as they should.",
      downSub: "We're aware of it and looking into it. This page updates itself.",
      degradedSub: (n) => `${n} is responding slower than usual or just returned an error.`,
      up: "Operational", deg: "Degraded", dn: "Outage", none: "No data",
      daysAgo: (n) => `${n} days ago`, today: "Today", uptime: "uptime", ms: "ms average (24 hours)",
      incidents: "Incidents (last 30 days)", noInc: "No incidents in the last 30 days.", ongoing: "ongoing",
      tipNone: "No data", err: "The status can't be loaded right now. We'll try again in a minute.",
      and: "and", dur: (s) => fmtDur(s, "en"),
    },
  }[lang];
  document.querySelectorAll("[data-t]").forEach((e) => { const v = T[e.dataset.t]; if (typeof v === "string") e.textContent = v; });

  const loc = lang === "nl" ? "nl-NL" : "en-GB";
  function fmtDur(s, l) {
    if (s < 60) return l === "nl" ? "minder dan een minuut" : "under a minute";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    const hs = l === "nl" ? `${h} uur` : `${h} h`;
    return r ? `${hs} ${r} min` : hs;
  }
  const pct = (v) => (v == null ? "—" : `${v.toLocaleString(loc, { minimumFractionDigits: v === 100 ? 0 : 2, maximumFractionDigits: 2 })}%`);
  const list = (names) => names.length <= 1 ? (names[0] || "") : `${names.slice(0, -1).join(", ")} ${T.and} ${names[names.length - 1]}`;
  const STATE = { up: T.up, degraded: T.deg, down: T.dn };
  const longDay = (d) => new Date(d + "T12:00:00").toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "long", year: "numeric" });

  let data = null;
  const narrow = () => window.matchMedia("(max-width:640px)").matches;

  function render() {
    if (!data) return;
    const name = (n) => (n && (n[lang] || n.nl)) || "";
    const byId = new Map();
    data.groups.forEach((g) => g.monitors.forEach((m) => byId.set(m.id, name(m.name))));

    // totaalbeeld
    const ov = data.overall || { state: "up", down: [], degraded: [] };
    const b = $("banner");
    b.className = `banner ${ov.state}`;
    const downNames = ov.down.map((id) => byId.get(id)).filter(Boolean);
    const degNames = ov.degraded.map((id) => byId.get(id)).filter(Boolean);
    $("bannerTitle").textContent = ov.state === "down" ? T.down(list(downNames)) : ov.state === "degraded" ? T.degraded : T.allUp;
    $("bannerSub").textContent = ov.state === "down" ? T.downSub : ov.state === "degraded" ? T.degradedSub(list(degNames)) : T.allUpSub;
    $("updated").textContent = new Date(data.generated_at || Date.now()).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });

    // groepen met de 90 (telefoon: 30) dagbalken
    const n = narrow() ? 30 : 90;
    $("groups").innerHTML = data.groups.map((g) => `<section class="group"><h2>${esc(name(g.name))}</h2><div class="mons">${
      g.monitors.map((m) => {
        const st = m.state || "none";
        const days = (m.days || []).slice(-n);
        const up = n === 30 ? m.uptime?.d30 : m.uptime?.d90;
        return `<div class="mon">
          <div class="mhead"><span class="dot ${st}" aria-hidden="true"></span><span class="mname">${esc(name(m.name))}</span>
            <span class="mstate ${st}">${esc(STATE[st] || T.none)}</span></div>
          <div class="bars" data-id="${esc(m.id)}" tabindex="0" aria-label="${esc(name(m.name))}: ${esc(pct(up))} ${esc(T.uptime)}">${
            days.map((d, i) => `<i class="${d.s}" data-i="${i}"></i>`).join("")}</div>
          <div class="mfoot"><span>${esc(T.daysAgo(n))}</span>
            <span class="mid"><b>${esc(pct(up))}</b> ${esc(T.uptime)}${m.ms24 != null ? ` · ${Number(m.ms24).toLocaleString(loc)} ${esc(T.ms)}` : ""}</span>
            <span>${esc(T.today)}</span></div>
        </div>`;
      }).join("")}</div></section>`).join("");
    const mons = new Map(); data.groups.forEach((g) => g.monitors.forEach((m) => mons.set(m.id, m)));
    document.querySelectorAll(".bars").forEach((el) => {
      const days = (mons.get(el.dataset.id)?.days || []).slice(-n);
      const show = (i) => {
        const d = days[i]; const bar = el.children[i];
        if (!d || !bar) return;
        el.querySelectorAll(".on").forEach((x) => x.classList.remove("on")); bar.classList.add("on");
        const r = bar.getBoundingClientRect();
        tip.innerHTML = `<b>${d.u == null ? esc(T.tipNone) : esc(pct(d.u))}</b>${esc(longDay(d.d))}${d.s === "down" || d.s === "degraded" ? ` · ${esc(STATE[d.s])}` : ""}`;
        tip.classList.remove("hidden");
        const w = tip.offsetWidth / 2 + 8;
        tip.style.left = `${Math.min(Math.max(r.left + r.width / 2, w), window.innerWidth - w)}px`;
        tip.style.top = `${r.top}px`;
      };
      el.addEventListener("pointermove", (e) => { const t = e.target.closest("i"); if (t) show(+t.dataset.i); });
      el.addEventListener("pointerdown", (e) => { const t = e.target.closest("i"); if (t) show(+t.dataset.i); });
      el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTip(); });
      let k = days.length - 1;
      el.addEventListener("focus", () => show(k));
      el.addEventListener("blur", hideTip);
      el.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") { k = Math.max(0, k - 1); show(k); e.preventDefault(); }
        if (e.key === "ArrowRight") { k = Math.min(days.length - 1, k + 1); show(k); e.preventDefault(); }
      });
    });

    // storingen
    const inc = data.incidents || [];
    $("incidents").innerHTML = inc.length ? inc.map((i) => {
      const open = !i.ended_at;
      const when = new Date(i.started_at).toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return `<div class="inc ${open ? "open" : ""}"><span class="when">${esc(when)}</span>
        <span class="what" data-open="${esc(T.ongoing)}">${esc(name(i.name))}</span><span class="dur">${esc(T.dur(i.duration_s || 0))}</span></div>`;
    }).join("") : `<p class="none-yet">${esc(T.noInc)}</p>`;
  }

  const tip = $("tip");
  function hideTip() { tip.classList.add("hidden"); document.querySelectorAll(".bars .on").forEach((x) => x.classList.remove("on")); }
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".bars")) hideTip(); });
  window.addEventListener("scroll", hideTip, { passive: true });

  async function load() {
    try {
      const res = await fetch(URL_, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
      $("error").classList.add("hidden");
      render();
    } catch (e) {
      $("error").textContent = T.err; $("error").classList.remove("hidden");
      if (!data) { $("bannerTitle").textContent = T.err; $("banner").className = "banner"; }
    }
  }
  let lastNarrow = narrow();
  window.addEventListener("resize", () => { if (narrow() !== lastNarrow) { lastNarrow = narrow(); render(); } });
  if (!CFG.url) { $("bannerTitle").textContent = T.err; return; }
  load();
  setInterval(() => { if (!document.hidden) load(); }, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
})();
