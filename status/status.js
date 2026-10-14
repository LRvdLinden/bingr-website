// Bingr-status: statuspagina, incidentgeschiedenis en meldingdetail (body[data-view] = home | history | incident).
// Leest de openbare status (geen sleutel nodig), ververst de hoofdpagina elke 60 s, en regelt abonneren/bevestigen/afmelden.
(() => {
  "use strict";
  const CFG = window.BINGR_SUPABASE || {};
  const API = `${CFG.url}/functions/v1/status`;
  const VIEW = document.body.dataset.view || "home";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lang = (window.BingrSite && BingrSite.lang) || "nl";
  const BASE = VIEW === "home" ? "" : "../";

  const T = {
    nl: {
      loading: "Status laden…", loadingShort: "Laden…", updated: "Laatst bijgewerkt", refresh: "ververst elke minuut", close: "Sluiten",
      banner: { operational: "Alle systemen werken", maintenance: "Onderhoud bezig", degraded: "Verminderde prestaties", partial: "Gedeeltelijke storing", major: "Grote storing" },
      bannerSub: {
        operational: "Accounts, website, webspeler en downloads werken zoals het hoort.",
        maintenance: (n) => `We voeren gepland onderhoud uit aan ${n}.`,
        degraded: (n) => `${n} reageert trager dan normaal of gaf net een fout.`,
        partial: (n) => `${n} werkt voor een deel niet. We weten ervan en werken eraan.`,
        major: (n) => `${n} werkt niet. We weten ervan en werken eraan. Deze pagina werkt zichzelf bij.`,
        incident: "We onderzoeken een probleem. Volg de updates hieronder.",
      },
      level: { operational: "Werkt", maintenance: "Onderhoud", degraded: "Verminderde prestaties", partial: "Gedeeltelijke storing", major: "Grote storing", none: "Geen gegevens" },
      status: {
        investigating: "Wordt onderzocht", identified: "Oorzaak bekend", monitoring: "Wordt gevolgd", resolved: "Opgelost",
        scheduled: "Gepland", in_progress: "Bezig", completed: "Afgerond", cancelled: "Geannuleerd",
      },
      impact: { none: "Geen impact", minor: "Kleine impact", major: "Grote impact", critical: "Kritieke impact", maintenance: "Onderhoud" },
      kind: { incident: "Storing", maintenance: "Gepland onderhoud" },
      active: "Lopende storingen", maint: "Gepland onderhoud", components: "Onderdelen", barsHint: "Uptime van de afgelopen 90 dagen",
      lgUp: "Werkt", lgMaint: "Onderhoud", lgDeg: "Verminderd", lgPartial: "Gedeeltelijke storing", lgDown: "Storing", lgNone: "Geen gegevens",
      past: "Afgelopen incidenten", noneDay: "Geen incidenten gemeld.", history: "Incidentgeschiedenis",
      daysAgo: (n) => `${n} dagen geleden`, today: "Vandaag", uptime: "uptime", ms: "ms gemiddeld (24 uur)",
      comps: (n) => (n === 1 ? "1 onderdeel" : `${n} onderdelen`),
      tipNone: "Geen gegevens", tipOk: "Geen storingen", tipDown: (m) => `${m} storing`, tipMaint: "Onderhoud",
      err: "De status kan nu niet worden geladen. We proberen het over een minuut opnieuw.",
      and: "en", affected: "Getroffen", allUpdates: "Alle updates bekijken", window: "Gepland", started: "Begonnen", resolved: "Opgelost", duration: "Duur",
      ongoingFor: (d) => `loopt al ${d}`, startsIn: (d) => `begint over ${d}`, endsIn: (d) => `nog ${d}`, lasted: (d) => `duurde ${d}`,
      backStatus: "Terug naar de status", historyTitle: "Incidentgeschiedenis",
      historyLead: "Alle afgesloten storingen en al het onderhoud van Bingr, nieuwste eerst.", noHistory: "Nog geen incidenten gemeld.",
      newer: "Nieuwer", older: "Ouder", pageOf: (a, b) => `Pagina ${a} van ${b}`, notFound: "Deze melding bestaat niet (meer).",
      timeline: "Tijdlijn", powered: "Bingr Status · eigen monitoring van Bingr, elke 5 minuten gecontroleerd",
      subOpen: "Abonneren op updates", subTitle: "Abonneren op updates",
      subText: "Krijg een e-mail als er een storing is bij Bingr, als die is opgelost, en als er onderhoud gepland staat.",
      subEmail: "E-mailadres", subBtn: "Abonneren", subFine: "Je krijgt eerst een mail om je aanmelding te bevestigen. Afmelden kan altijd, met de link onderaan elke mail.",
      subDoneTitle: "Check je inbox", subDoneText: "We hebben je een e-mail gestuurd. Klik op de link erin om je aanmelding te bevestigen.",
      subFeed: "Of volg via een feed:", subBad: "Vul een geldig e-mailadres in.", subMany: "Te veel pogingen. Probeer het later opnieuw.",
      subFail: "Aanmelden lukt nu niet. Probeer het later opnieuw.",
      confirmed: "Je aanmelding is bevestigd. Je krijgt voortaan een e-mail bij storingen en onderhoud.",
      confirmExpired: "Deze bevestigingslink is verlopen. Meld je opnieuw aan.", confirmBad: "Deze bevestigingslink klopt niet (meer).",
      unsubAsk: "Wil je je afmelden voor statusupdates van Bingr?", unsubYes: "Afmelden", unsubDone: "Je bent afgemeld. Je krijgt geen statusupdates meer.",
      unsubFail: "Afmelden lukte niet. Probeer het later opnieuw.",
    },
    en: {
      loading: "Loading status…", loadingShort: "Loading…", updated: "Last updated", refresh: "refreshes every minute", close: "Close",
      banner: { operational: "All systems operational", maintenance: "Maintenance in progress", degraded: "Degraded performance", partial: "Partial outage", major: "Major outage" },
      bannerSub: {
        operational: "Accounts, website, web player and downloads are working as they should.",
        maintenance: (n) => `We're carrying out scheduled maintenance on ${n}.`,
        degraded: (n) => `${n} is responding slower than usual or just returned an error.`,
        partial: (n) => `${n} is partly unavailable. We're aware and working on it.`,
        major: (n) => `${n} is unavailable. We're aware and working on it. This page updates itself.`,
        incident: "We're looking into an issue. Follow the updates below.",
      },
      level: { operational: "Operational", maintenance: "Under maintenance", degraded: "Degraded performance", partial: "Partial outage", major: "Major outage", none: "No data" },
      status: {
        investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved",
        scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled",
      },
      impact: { none: "No impact", minor: "Minor impact", major: "Major impact", critical: "Critical impact", maintenance: "Maintenance" },
      kind: { incident: "Incident", maintenance: "Scheduled maintenance" },
      active: "Ongoing incidents", maint: "Scheduled maintenance", components: "Components", barsHint: "Uptime over the past 90 days",
      lgUp: "Operational", lgMaint: "Maintenance", lgDeg: "Degraded", lgPartial: "Partial outage", lgDown: "Outage", lgNone: "No data",
      past: "Past incidents", noneDay: "No incidents reported.", history: "Incident history",
      daysAgo: (n) => `${n} days ago`, today: "Today", uptime: "uptime", ms: "ms average (24 hours)",
      comps: (n) => (n === 1 ? "1 component" : `${n} components`),
      tipNone: "No data", tipOk: "No downtime", tipDown: (m) => `${m} of downtime`, tipMaint: "Maintenance",
      err: "The status can't be loaded right now. We'll try again in a minute.",
      and: "and", affected: "Affected", allUpdates: "View all updates", window: "Scheduled", started: "Started", resolved: "Resolved", duration: "Duration",
      ongoingFor: (d) => `ongoing for ${d}`, startsIn: (d) => `starts in ${d}`, endsIn: (d) => `${d} left`, lasted: (d) => `lasted ${d}`,
      backStatus: "Back to status", historyTitle: "Incident history",
      historyLead: "All resolved incidents and completed maintenance for Bingr, newest first.", noHistory: "No incidents reported yet.",
      newer: "Newer", older: "Older", pageOf: (a, b) => `Page ${a} of ${b}`, notFound: "This notice doesn't exist (anymore).",
      timeline: "Timeline", powered: "Bingr Status · Bingr's own monitoring, checked every 5 minutes",
      subOpen: "Subscribe to updates", subTitle: "Subscribe to updates",
      subText: "Get an email when Bingr has an incident, when it's resolved, and when maintenance is scheduled.",
      subEmail: "Email address", subBtn: "Subscribe", subFine: "We'll first send you an email to confirm. You can unsubscribe at any time using the link at the bottom of every email.",
      subDoneTitle: "Check your inbox", subDoneText: "We've sent you an email. Click the link in it to confirm your subscription.",
      subFeed: "Or follow a feed:", subBad: "Enter a valid email address.", subMany: "Too many attempts. Please try again later.",
      subFail: "Subscribing isn't possible right now. Please try again later.",
      confirmed: "Your subscription is confirmed. You'll get an email for incidents and maintenance.",
      confirmExpired: "This confirmation link has expired. Please subscribe again.", confirmBad: "This confirmation link isn't valid (anymore).",
      unsubAsk: "Do you want to unsubscribe from Bingr status updates?", unsubYes: "Unsubscribe", unsubDone: "You've been unsubscribed. You won't receive status updates anymore.",
      unsubFail: "Unsubscribing didn't work. Please try again later.",
    },
  }[lang];
  document.querySelectorAll("[data-t]").forEach((e) => { const v = T[e.dataset.t]; if (typeof v === "string") e.textContent = v; });
  document.querySelectorAll("[data-ta]").forEach((e) => { const v = T[e.dataset.ta]; if (typeof v === "string") e.setAttribute("aria-label", v); });

  const loc = lang === "nl" ? "nl-NL" : "en-GB";
  const name = (n) => (n && (n[lang] || n.nl)) || "";
  const list = (names) => names.length <= 1 ? (names[0] || "") : `${names.slice(0, -1).join(", ")} ${T.and} ${names[names.length - 1]}`;
  function fmtDur(s) {
    s = Math.max(0, Math.round(s));
    if (s < 60) return lang === "nl" ? "minder dan een minuut" : "under a minute";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 48) { const hs = lang === "nl" ? `${h} uur` : `${h} h`; return r ? `${hs} ${r} min` : hs; }
    const d = Math.round(h / 24);
    return lang === "nl" ? `${d} dagen` : `${d} days`;
  }
  const fmtMin = (m) => (m < 60 ? `${m} min` : fmtDur(m * 60));
  const pct = (v) => (v == null ? "—" : `${v.toLocaleString(loc, { minimumFractionDigits: v === 100 ? 0 : 2, maximumFractionDigits: 2 })}%`);
  const longDay = (d) => new Date(d + "T12:00:00").toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  const dayKey = (t) => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const fmtTime = (iso) => new Date(iso).toLocaleString(loc, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  const fmtClock = (iso) => new Date(iso).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  const fmtWindow = (a, b) => {
    const A = new Date(a), B = new Date(b);
    const d1 = A.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short" });
    return dayKey(A) === dayKey(B)
      ? `${d1}, ${fmtClock(a)} – ${B.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`
      : `${d1}, ${fmtClock(a)} – ${B.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short" })}, ${B.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`;
  };
  const incUrl = (id) => `${BASE}incident/?id=${encodeURIComponent(id)}`;
  // kleur van een melding: onderhoud blauw, anders per impact
  const toneImpact = (n) => (n.kind === "maintenance" ? "maint" : ({ critical: "down", major: "partial", minor: "degraded", none: "info" })[n.impact] || "degraded");
  const tone = (n) => (n.kind !== "maintenance" && n.status === "resolved" ? "ok" : toneImpact(n));
  const chip = (st) => `<span class="schip st-${esc(st)}">${esc(T.status[st] || st)}</span>`;

  async function api(action, params = {}, post = false) {
    const res = post
      ? await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.anonKey || "" }, body: JSON.stringify({ action, ...params }) })
      : await fetch(`${API}?${new URLSearchParams({ action, ...params })}`, { cache: "no-store" });
    let body = {};
    try { body = await res.json(); } catch { /* leeg */ }
    if (!res.ok) throw Object.assign(new Error(body.error || String(res.status)), { code: body.error || String(res.status), status: res.status });
    return body;
  }

  // ---- toast ----
  let toastTimer;
  function toast(msg, bad = false, ms = 6000) {
    const t = $("stoast");
    t.textContent = msg; t.classList.toggle("bad", bad); t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ---- tijdlijn van een melding ----
  function timeline(n, max = Infinity) {
    const ups = (n.updates || []).slice(0, max);
    return `<ol class="tl">${ups.map((u) => `<li class="st-${esc(u.status)}"><div class="tlh"><b>${esc(T.status[u.status] || u.status)}</b><time datetime="${esc(u.at)}">${esc(fmtTime(u.at))}</time></div>
      <p>${esc(u.body?.[lang] || u.body?.nl || "").replace(/\n/g, "<br>")}</p></li>`).join("")}</ol>`;
  }
  function compChips(n, names) {
    if (!n.components?.length) return "";
    return `<div class="cchips"><span class="muted small">${esc(T.affected)}:</span>${n.components.map((c) =>
      `<span class="cchip"><i class="${n.kind === "maintenance" ? "maint" : c.impact === "major" ? "down" : c.impact}"></i>${esc(name(names.get(c.id)) || c.id)}</span>`).join("")}</div>`;
  }
  function noticeCard(n, names) {
    const now = Date.now();
    let when = "";
    if (n.kind === "maintenance" && n.window_start && n.window_end) {
      const a = Date.parse(n.window_start), b = Date.parse(n.window_end);
      when = `${esc(fmtWindow(n.window_start, n.window_end))} · ${esc(now < a ? T.startsIn(fmtDur((a - now) / 1000)) : T.endsIn(fmtDur((b - now) / 1000)))}`;
    } else when = `${esc(T.started)} ${esc(fmtTime(n.started_at))} · ${esc(T.ongoingFor(fmtDur((now - Date.parse(n.started_at)) / 1000)))}`;
    const more = (n.updates || []).length > 3;
    return `<article class="ncard t-${tone(n)}">
      <div class="nhead"><h3><a href="${incUrl(n.id)}">${esc(name(n.title))}</a></h3>${chip(n.status)}</div>
      <p class="nwhen muted small">${when}</p>
      ${timeline(n, 3)}
      ${more ? `<a class="nmore" href="${incUrl(n.id)}">${esc(T.allUpdates)} <span aria-hidden="true">→</span></a>` : ""}
      ${compChips(n, names)}
    </article>`;
  }

  // ---- hoofdpagina ----
  let data = null;
  const narrow = () => window.matchMedia("(max-width:640px)").matches;
  const OPEN_KEY = "bingr.status.groups";
  let openGroups = null;
  try { openGroups = JSON.parse(localStorage.getItem(OPEN_KEY) || "null"); } catch { /* privé-venster */ }
  const SEV = ["none", "up", "maint", "degraded", "partial", "down"];
  const LSEV = ["operational", "maintenance", "degraded", "partial", "major"];
  const worstBar = (a, b) => (SEV.indexOf(a) >= SEV.indexOf(b) ? a : b);
  const lvlClass = (l) => ({ operational: "up", maintenance: "maint", degraded: "degraded", partial: "partial", major: "down" })[l] || "none";

  function renderHome() {
    if (!data) return;
    const names = new Map();
    data.groups.forEach((g) => g.monitors.forEach((m) => names.set(m.id, m.name)));
    const notices = data.notices || { active: [], upcoming: [], recent: [] };
    const titles = data.titles || {};

    // totaalbeeld
    const ov = data.overall || { level: "operational" };
    const level = ov.level || ({ down: "major", degraded: "degraded" })[ov.state] || "operational";
    const b = $("banner");
    b.className = `banner ${lvlClass(level)}`;
    const ids = level === "major" ? ov.major : level === "partial" ? ov.partial : level === "degraded" ? ov.degraded : level === "maintenance" ? ov.maintenance : [];
    const who = list((ids || []).map((id) => name(names.get(id))).filter(Boolean));
    $("bannerTitle").textContent = T.banner[level];
    const sub = T.bannerSub[level];
    $("bannerSub").textContent = typeof sub === "function" ? (who ? sub(who) : T.bannerSub.incident) : sub;
    $("updated").textContent = new Date(data.generated_at || Date.now()).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });

    // lopende storingen en onderhoud
    const act = notices.active.filter((n) => n.kind === "incident");
    const mnt = [...notices.active.filter((n) => n.kind === "maintenance"), ...notices.upcoming];
    $("activeWrap").classList.toggle("hidden", !act.length);
    $("active").innerHTML = act.map((n) => noticeCard(n, names)).join("");
    $("maintWrap").classList.toggle("hidden", !mnt.length);
    $("maint").innerHTML = mnt.map((n) => noticeCard(n, names)).join("");

    // onderdelen per groep, inklapbaar, met 90 (telefoon: 30) dagbalken
    const nDays = narrow() ? 30 : 90;
    const mons = new Map();
    $("groups").innerHTML = data.groups.map((g) => {
      g.monitors.forEach((m) => mons.set(m.id, m));
      const worstLvl = g.monitors.reduce((a, m) => (LSEV.indexOf(m.status || "operational") > LSEV.indexOf(a) ? m.status : a), "operational");
      const open = openGroups ? openGroups.includes(g.id) : worstLvl !== "operational";
      // groepsbalk: per dag de slechtste van de onderdelen
      const gdays = [];
      g.monitors.forEach((m) => (m.days || []).slice(-nDays).forEach((d, i) => {
        const x = gdays[i] || (gdays[i] = { d: d.d, s: "none", dm: 0, i: [], u: [] });
        x.s = worstBar(x.s, d.s); x.dm = Math.max(x.dm, d.dm || 0); (d.i || []).forEach((id) => x.i.includes(id) || x.i.push(id)); if (d.u != null) x.u.push(d.u);
      }));
      gdays.forEach((x) => { x.u = x.u.length ? Math.min(...x.u) : null; });
      const ups = g.monitors.map((m) => (nDays === 30 ? m.uptime?.d30 : m.uptime?.d90)).filter((v) => v != null);
      const gUp = ups.length ? Math.floor((ups.reduce((a, v) => a + v, 0) / ups.length) * 100) / 100 : null;
      mons.set(`g:${g.id}`, { days: gdays });
      return `<section class="group${open ? " open" : ""}" data-g="${esc(g.id)}">
        <h3 class="ghead"><button type="button" class="gbtn" aria-expanded="${open}" aria-controls="gb-${esc(g.id)}">
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="gname">${esc(name(g.name))}</span><span class="gcount muted">${esc(T.comps(g.monitors.length))}</span>
          <span class="mstate ${lvlClass(worstLvl)}">${esc(T.level[worstLvl])}</span></button></h3>
        <div class="gsum">${barsHtml(`g:${g.id}`, gdays, `${name(g.name)}: ${pct(gUp)} ${T.uptime}`)}
          <div class="mfoot"><span>${esc(T.daysAgo(nDays))}</span><span class="mid"><b>${esc(pct(gUp))}</b> ${esc(T.uptime)}</span><span>${esc(T.today)}</span></div></div>
        <div class="mons" id="gb-${esc(g.id)}"${open ? "" : " hidden"}>${g.monitors.map((m) => {
          const st = m.status || (m.state ? "operational" : "none");
          const days = (m.days || []).slice(-nDays);
          const up = nDays === 30 ? m.uptime?.d30 : m.uptime?.d90;
          return `<div class="mon">
            <div class="mhead"><span class="dot ${lvlClass(st)}" aria-hidden="true"></span><span class="mname">${esc(name(m.name))}</span>
              <span class="mstate ${lvlClass(st)}">${esc(T.level[st] || T.level.none)}</span></div>
            ${barsHtml(m.id, days, `${name(m.name)}: ${pct(up)} ${T.uptime}`)}
            <div class="mfoot"><span>${esc(T.daysAgo(nDays))}</span>
              <span class="mid"><b>${esc(pct(up))}</b> ${esc(T.uptime)}${m.ms24 != null ? ` · ${Number(m.ms24).toLocaleString(loc)} ${esc(T.ms)}` : ""}</span>
              <span>${esc(T.today)}</span></div>
          </div>`;
        }).join("")}</div></section>`;
    }).join("");
    document.querySelectorAll(".gbtn").forEach((btn) => {
      btn.onclick = () => {
        const sec = btn.closest(".group"), on = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", String(on)); sec.classList.toggle("open", on); $(btn.getAttribute("aria-controls")).hidden = !on;
        openGroups = [...document.querySelectorAll(".group.open")].map((s) => s.dataset.g);
        try { localStorage.setItem(OPEN_KEY, JSON.stringify(openGroups)); } catch { /* */ }
      };
    });
    wireBars(mons, titles);

    // afgelopen incidenten: 14 dagen, per dag
    const past = [...notices.recent, ...notices.active.filter((n) => !notices.recent.some((r) => r.id === n.id))];
    const byDay = new Map();
    past.forEach((n) => {
      const k = dayKey(n.kind === "maintenance" && n.window_start ? n.window_start : n.started_at);
      (byDay.get(k) || byDay.set(k, []).get(k)).push(n);
    });
    const out = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
      const k = dayKey(d);
      const items = (byDay.get(k) || []).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
      out.push(`<div class="pday"><h3>${esc(d.toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" }))}</h3>${items.length ? items.map((n) => {
        const last = (n.updates || [])[0];
        const end = n.resolved_at ? Date.parse(n.resolved_at) : null;
        const start = Date.parse(n.kind === "maintenance" && n.window_start ? n.window_start : n.started_at);
        return `<article class="pinc t-${toneImpact(n)}">
          <div class="nhead"><h4><a href="${incUrl(n.id)}">${esc(name(n.title))}</a></h4>${chip(n.status)}</div>
          ${last ? `<p class="plast"><b>${esc(T.status[last.status] || last.status)}</b> – ${esc(last.body?.[lang] || last.body?.nl || "")}</p>` : ""}
          <p class="muted small">${esc(fmtTime(new Date(start).toISOString()))}${end ? ` · ${esc(T.lasted(fmtDur((end - start) / 1000)))}` : ""}</p></article>`;
      }).join("") : `<p class="pnone muted">${esc(T.noneDay)}</p>`}</div>`);
    }
    $("past").innerHTML = out.join("");
  }

  function barsHtml(key, days, label) {
    return `<div class="bars" data-id="${esc(key)}" tabindex="0" role="img" aria-label="${esc(label)}">${days.map((d, i) => `<i class="${esc(d.s)}" data-i="${i}"></i>`).join("")}</div>`;
  }

  // ---- tooltips van de dagbalken (muis, aanraken en pijltjestoetsen) ----
  const tip = $("tip");
  function hideTip() { tip.classList.add("hidden"); document.querySelectorAll(".bars .on").forEach((x) => x.classList.remove("on")); }
  function wireBars(mons, titles) {
    document.querySelectorAll(".bars").forEach((el) => {
      const nDays = el.children.length;
      const days = (mons.get(el.dataset.id)?.days || []).slice(-nDays);
      const show = (i) => {
        const d = days[i]; const bar = el.children[i];
        if (!d || !bar) return;
        el.querySelectorAll(".on").forEach((x) => x.classList.remove("on")); bar.classList.add("on");
        const r = bar.getBoundingClientRect();
        const incs = (d.i || []).map((id) => titles[id] ? `<li><a href="${incUrl(id)}">${esc(name(titles[id]))}</a></li>` : "").join("");
        const state = d.s === "maint" ? T.tipMaint : d.dm > 0 ? T.tipDown(fmtMin(d.dm)) : d.u == null ? T.tipNone : T.tipOk;
        tip.innerHTML = `<span class="td">${esc(longDay(d.d))}</span><b>${d.u == null ? esc(T.tipNone) : `${esc(pct(d.u))} ${esc(T.uptime)}`}</b>
          <span class="ts ${esc(d.s)}">${esc(state)}</span>${incs ? `<ul>${incs}</ul>` : ""}`;
        tip.classList.remove("hidden");
        const w = tip.offsetWidth / 2 + 8;
        tip.style.left = `${Math.min(Math.max(r.left + r.width / 2, w), window.innerWidth - w)}px`;
        tip.style.top = `${r.top}px`;
      };
      el.addEventListener("pointermove", (e) => { const t = e.target.closest("i"); if (t) show(+t.dataset.i); });
      el.addEventListener("pointerdown", (e) => { const t = e.target.closest("i"); if (t) show(+t.dataset.i); });
      el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !tip.matches(":hover")) hideTip(); });
      let k = days.length - 1;
      el.addEventListener("focus", () => show(k));
      el.addEventListener("blur", () => setTimeout(() => { if (!tip.contains(document.activeElement)) hideTip(); }, 0));
      el.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") { k = Math.max(0, k - 1); show(k); e.preventDefault(); }
        if (e.key === "ArrowRight") { k = Math.min(days.length - 1, k + 1); show(k); e.preventDefault(); }
        if (e.key === "Escape") hideTip();
      });
    });
  }
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".bars") && !e.target.closest("#tip")) hideTip(); });
  window.addEventListener("scroll", hideTip, { passive: true });
  tip.addEventListener("pointerleave", hideTip);

  async function loadHome() {
    try {
      data = await api("public");
      $("error").classList.add("hidden");
      renderHome();
    } catch {
      $("error").textContent = T.err; $("error").classList.remove("hidden");
      if (!data) { $("bannerTitle").textContent = T.err; $("banner").className = "banner"; }
    }
  }

  // ---- geschiedenis ----
  async function loadHistory() {
    const page = Math.max(1, Number(new URLSearchParams(location.search).get("page")) || 1);
    let h;
    try { h = await api("history", { page: String(page) }); } catch { $("hist").innerHTML = `<p class="err">${esc(T.err)}</p>`; return; }
    const names = new Map(Object.entries(h.names || {}));
    if (!h.items.length) { $("hist").innerHTML = `<div class="panel"><p class="pnone muted">${esc(T.noHistory)}</p></div>`; return; }
    const months = new Map();
    h.items.forEach((n) => {
      const t = new Date(n.kind === "maintenance" && n.window_start ? n.window_start : n.started_at);
      const k = t.toLocaleDateString(loc, { month: "long", year: "numeric" });
      (months.get(k) || months.set(k, []).get(k)).push(n);
    });
    $("hist").innerHTML = [...months].map(([m, items]) => `<section class="hmonth"><h2 class="sh">${esc(m.charAt(0).toUpperCase() + m.slice(1))}</h2><div class="panel hlist">${items.map((n) => {
      const start = Date.parse(n.kind === "maintenance" && n.window_start ? n.window_start : n.started_at);
      const end = n.resolved_at ? Date.parse(n.resolved_at) : null;
      const last = (n.updates || [])[0];
      return `<article class="hitem t-${toneImpact(n)}">
        <div class="nhead"><h3><a href="${incUrl(n.id)}">${esc(name(n.title))}</a></h3><span class="kind muted small">${esc(T.kind[n.kind])}</span></div>
        ${last ? `<p class="plast">${esc(last.body?.[lang] || last.body?.nl || "")}</p>` : ""}
        <p class="muted small">${esc(fmtTime(new Date(start).toISOString()))}${end ? ` – ${esc(fmtTime(new Date(end).toISOString()))} · ${esc(T.lasted(fmtDur((end - start) / 1000)))}` : ""}</p>
        ${compChips(n, names)}</article>`;
    }).join("")}</div></section>`).join("");
    if (h.pages > 1) {
      $("pager").classList.remove("hidden");
      $("pageInfo").textContent = T.pageOf(h.page, h.pages);
      const set = (el, p, on) => { el.href = on ? `?page=${p}` : "#"; el.classList.toggle("off", !on); el.setAttribute("aria-disabled", String(!on)); if (!on) el.tabIndex = -1; };
      set($("newer"), h.page - 1, h.page > 1); set($("older"), h.page + 1, h.page < h.pages);
    }
  }

  // ---- één melding ----
  async function loadIncident() {
    const id = new URLSearchParams(location.search).get("id");
    let r;
    try { r = id ? await api("notice", { id }) : Promise.reject(); } catch (e) {
      $("incTitle").textContent = e?.status === 404 || !id ? T.notFound : T.err;
      $("incBody").classList.add("hidden");
      return;
    }
    const n = r.notice, names = new Map(Object.entries(r.names || {}));
    document.title = `${name(n.title)} · Status · Bingr`;
    const can = document.querySelector('link[rel="canonical"]'); if (can) can.href = `https://bingr.online/status/incident/?id=${n.id}`;
    $("incKind").textContent = T.kind[n.kind];
    $("incTitle").textContent = name(n.title);
    const start = Date.parse(n.kind === "maintenance" && n.window_start ? n.window_start : n.started_at);
    const end = n.resolved_at ? Date.parse(n.resolved_at) : null;
    const meta = [chip(n.status)];
    if (n.kind === "incident") meta.push(`<span class="schip imp-${esc(n.impact)}">${esc(T.impact[n.impact] || n.impact)}</span>`);
    if (n.kind === "maintenance" && n.window_start && n.window_end) meta.push(`<span class="muted small">${esc(T.window)}: ${esc(fmtWindow(n.window_start, n.window_end))}</span>`);
    else meta.push(`<span class="muted small">${esc(T.started)} ${esc(fmtTime(new Date(start).toISOString()))}${end ? ` · ${esc(T.lasted(fmtDur((end - start) / 1000)))}` : ` · ${esc(T.ongoingFor(fmtDur((Date.now() - start) / 1000)))}`}</span>`);
    $("incMeta").innerHTML = meta.join("");
    $("incBody").className = `panel incbody t-${tone(n)}`;
    $("incBody").innerHTML = `<h2 class="sh">${esc(T.timeline)}</h2>${timeline(n)}${compChips(n, names)}`;
  }

  // ---- abonneren ----
  const modal = $("subModal");
  let lastFocus = null;
  function openModal() {
    lastFocus = document.activeElement;
    modal.classList.remove("hidden"); document.body.classList.add("noscroll");
    $("subForm").classList.remove("hidden"); $("subDone").classList.add("hidden"); $("subErr").textContent = "";
    setTimeout(() => $("subEmail").focus(), 30);
  }
  function closeModal() { modal.classList.add("hidden"); document.body.classList.remove("noscroll"); if (lastFocus) lastFocus.focus(); }
  modal.querySelectorAll("[data-close]").forEach((x) => { x.onclick = closeModal; });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    if (e.key === "Tab") { // focus binnen het venster houden
      const f = [...modal.querySelectorAll("button,input:not(.hp),a[href]")].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
    }
  });
  document.querySelectorAll("#subOpen").forEach((b) => { b.onclick = openModal; });
  if (lang === "en") { $("feedAtom").href = "https://bingr.online/status/feed.en.atom"; $("feedRss").href = "https://bingr.online/status/feed.en.rss"; }
  $("subForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("subEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { $("subErr").textContent = T.subBad; $("subEmail").focus(); return; }
    $("subBtn").disabled = true; $("subErr").textContent = "";
    try {
      await api("subscribe", { email, lang, website: $("subWebsite").value }, true);
      $("subForm").classList.add("hidden"); $("subDone").classList.remove("hidden");
    } catch (err) {
      $("subErr").textContent = err.code === "bad_email" ? T.subBad : err.code === "too_many" ? T.subMany : T.subFail;
    } finally { $("subBtn").disabled = false; }
  };

  // bevestigen of afmelden via de link uit de mail (?confirm= / ?unsubscribe=); daarna de token uit de adresbalk
  async function handleLink() {
    const q = new URLSearchParams(location.search);
    const c = q.get("confirm"), u = q.get("unsubscribe");
    if (!c && !u) return;
    try { history.replaceState(null, "", location.pathname); } catch { /* */ }
    if (c) {
      try { await api("confirm", { token: c }, true); toast(T.confirmed, false, 9000); }
      catch (e) { toast(e.code === "expired" ? T.confirmExpired : T.confirmBad, true, 9000); }
      return;
    }
    if (!confirm(T.unsubAsk)) return;
    try { await api("unsubscribe", { token: u }, true); toast(T.unsubDone, false, 9000); } catch { toast(T.unsubFail, true, 9000); }
  }

  if (!CFG.url) { $("error").textContent = T.err; $("error").classList.remove("hidden"); return; }
  if (VIEW === "home") {
    let lastNarrow = narrow();
    window.addEventListener("resize", () => { if (narrow() !== lastNarrow) { lastNarrow = narrow(); renderHome(); } });
    loadHome();
    setInterval(() => { if (!document.hidden) loadHome(); }, 60_000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) loadHome(); });
    handleLink();
  } else if (VIEW === "history") loadHistory();
  else loadIncident();
})();
