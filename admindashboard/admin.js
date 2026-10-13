// Bingr-beheer: praat alleen met de Edge Function `admin`. Token (12 uur) in sessionStorage.
(() => {
  "use strict";
  const CFG = window.BINGR_SUPABASE || {};
  const FN = `${CFG.url}/functions/v1/admin`;
  const KEY = "bingrAdmin";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("nl-NL");
  const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const fmtDateTime = (v) => (v ? new Date(v).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  function ago(v) {
    if (!v) return "nooit";
    const m = Math.round((Date.now() - Date.parse(v)) / 60000);
    if (m < 2) return "zojuist";
    if (m < 60) return `${m} min geleden`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} uur geleden`;
    const d = Math.round(h / 24);
    if (d === 1) return "gisteren";
    if (d < 30) return `${d} dagen geleden`;
    return fmtDate(v);
  }
  const PLATFORM = { browser: "Webbrowser", tizen: "Samsung TV", "?": "Onbekend" };
  const pname = (p) => PLATFORM[p] || p || "Onbekend";

  // ---- sessie ----
  function session() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
      return s && Date.parse(s.expires_at) > Date.now() ? s : null;
    } catch { return null; }
  }
  function setSession(s) { try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* privé-venster */ } }
  let mem = null; // als sessionStorage niet werkt
  const token = () => (session() || mem || {}).token;

  async function call(action, data = {}, withToken = true) {
    let res;
    try {
      res = await fetch(FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.anonKey || "" },
        body: JSON.stringify({ action, ...(withToken ? { token: token() } : {}), ...data }),
      });
    } catch { throw Object.assign(new Error("network"), { code: "network" }); }
    let body = {};
    try { body = await res.json(); } catch { /* leeg */ }
    if (res.status === 401 && withToken) { logout("Je sessie is verlopen. Log opnieuw in."); throw Object.assign(new Error("auth"), { code: "auth" }); }
    if (!res.ok) throw Object.assign(new Error(body.error || "server_error"), { code: body.error || "server_error", body });
    return body;
  }
  const ERR = {
    network: "Geen verbinding met de server.", server_error: "Er ging iets mis op de server.", not_found: "Niet gevonden.",
    too_soon: "Er is net al een reset-mail gestuurd. Probeer het over een minuut opnieuw.", reset_failed: "De reset-mail kon niet worden verstuurd.",
    smtp_not_configured: "E-mail is niet ingesteld op de server.", text_missing: "Vul een Nederlandse titel en tekst in.",
    bad_expires_at: "De verloopdatum moet in de toekomst liggen.",
  };
  const errText = (e) => ERR[e.code] || ERR.server_error;

  let toastTimer;
  function toast(msg, bad = false) {
    const t = $("toast");
    t.textContent = msg; t.classList.toggle("bad", bad); t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
  }

  // ---- inloggen ----
  function showLogin(msg) {
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
    $("loginErr").textContent = msg || "";
    $("lu").focus();
  }
  function logout(msg) { setSession(null); mem = null; closeDrawer(); showLogin(msg); }
  $("logout").onclick = () => logout();
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const user = $("lu").value.trim(), password = $("lp").value;
    if (!user || !password) { $("loginErr").textContent = "Vul gebruikersnaam en wachtwoord in."; return; }
    $("loginBtn").disabled = true; $("loginErr").textContent = "";
    try {
      const r = await call("login", { user, password }, false);
      mem = r; setSession(r); $("lp").value = "";
      start();
    } catch (err) {
      const c = err.code;
      $("loginErr").textContent = c === "invalid_credentials" ? "Onjuiste gebruikersnaam of wachtwoord."
        : c === "locked" ? `Te veel pogingen. Probeer het over ${Math.ceil((err.body?.retry_after || 900) / 60)} minuten opnieuw.`
        : c === "not_configured" ? "Beheer is nog niet ingesteld (BINGR_ADMIN_USER / BINGR_ADMIN_PASSWORD)."
        : errText(err);
    } finally { $("loginBtn").disabled = false; }
  };

  // ---- tabs ----
  const loaded = {};
  function showTab(name) {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== `tab-${name}`));
    try { sessionStorage.setItem(KEY + ".tab", name); } catch { /* */ }
    if (!loaded[name]) { loaded[name] = true; ({ overview: loadStats, users: loadUsers, messages: loadAnnouncements })[name](); }
  }
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

  function start() {
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    Object.keys(loaded).forEach((k) => delete loaded[k]);
    let tab = "overview";
    try { tab = sessionStorage.getItem(KEY + ".tab") || tab; } catch { /* */ }
    showTab(["overview", "users", "messages"].includes(tab) ? tab : "overview");
  }

  // ---- overzicht ----
  $("refresh").onclick = () => loadStats();
  async function loadStats() {
    let s;
    try { s = await call("stats"); } catch (e) { if (e.code !== "auth") toast(errText(e), true); return; }
    smtpOk = !!s.smtp; applySmtp();
    const k = [
      ["Gebruikers", s.total_users, `${nf.format(s.confirmed_users ?? 0)} bevestigd`],
      ["Nieuw (7 dagen)", s.new_users_7d, ""],
      ["Actief vandaag", s.active_today, "accounts"],
      ["Actief (30 dagen)", s.active_30d, "accounts"],
      ["Apparaten", s.devices_total, "gekoppeld"],
      ["Kijkt nu", s.watching_now, "streams", "live"],
    ];
    $("kpis").innerHTML = k.map(([l, v, h, cls]) =>
      `<div class="kpi ${cls || ""}"><div class="l">${esc(l)}</div><div class="v">${nf.format(v ?? 0)}</div><div class="h">${esc(h)}</div></div>`).join("");
    const days = s.days || [];
    const audit = s.signins_source === "audit";
    lastCharts = () => {
      barChart($("chartNew"), days.map((d) => ({ x: d.day, y: d.new_users })), "nieuwe gebruikers");
      barChart($("chartSign"), days.map((d) => ({ x: d.day, y: d.signins })), audit ? "inlogs" : "actieve accounts");
    };
    $("signinTitle").textContent = audit ? "Inloggen per dag" : "Actieve accounts per dag";
    $("signinSub").textContent = audit ? "Laatste 30 dagen, uit het inloglogboek" : "Laatste 30 dagen, accounts met app-activiteit (inloglogboek leeg)";
    lastCharts();
    hbars($("platforms"), (s.platforms || []).map((p) => ({ label: esc(pname(p.platform)), n: p.devices })));
    hbars($("versions"), (s.versions || []).map((v) => ({ label: `${esc(v.app_version === "?" ? "onbekend" : v.app_version)} <small>${esc(pname(v.platform))}</small>`, n: v.devices })));
  }

  let lastCharts = null, resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => lastCharts && !$("tab-overview").classList.contains("hidden") && lastCharts(), 150); });
  // Staafdiagram (één reeks) met hover-tooltip; inline SVG.
  function barChart(el, data, unit) {
    if (!data.length) { el.innerHTML = '<p class="empty">Nog geen gegevens.</p>'; return; }
    const W = Math.max(280, Math.round(el.clientWidth || 560)), H = 190, L = 28, R = 4, T = 8, B = 22;
    const max = Math.max(1, ...data.map((d) => d.y));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const iw = W - L - R, ih = H - T - B, bw = iw / data.length, gap = Math.min(2, bw * 0.25);
    const y = (v) => T + ih - (v / top) * ih;
    let g = '<g class="grid axis">';
    for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    g += "</g>";
    let bars = "", ticks = '<g class="axis">';
    data.forEach((d, i) => {
      const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap), h = Math.max(d.y ? 2 : 1.5, (d.y / top) * ih);
      const r = Math.min(4, w / 2, h);
      // afgeronde bovenkant, platte voet op de basislijn
      const path = `M${x},${T + ih} V${T + ih - h + r} Q${x},${T + ih - h} ${x + r},${T + ih - h} H${x + w - r} Q${x + w},${T + ih - h} ${x + w},${T + ih - h + r} V${T + ih} Z`;
      bars += `<g data-i="${i}"><path class="bar ${d.y ? "" : "zero"}" d="${path}" fill="${d.y ? "var(--red)" : "#ffffff1f"}"/><rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}"/></g>`;
      if ((data.length - 1 - i) % 7 === 0) ticks += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${shortDay(d.x)}</text>`;
    });
    ticks += "</g>";
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit)} per dag">${g}${bars}${ticks}</svg><div class="tip hidden"></div>`;
    const svg = el.querySelector("svg"), tip = el.querySelector(".tip");
    svg.querySelectorAll("g[data-i]").forEach((gr) => {
      const i = Number(gr.dataset.i), d = data[i];
      const show = () => {
        svg.querySelectorAll(".bar").forEach((b) => b.setAttribute("fill", b.classList.contains("zero") ? "#ffffff1f" : "var(--red)"));
        const b = gr.querySelector(".bar"); if (d.y) b.setAttribute("fill", "#ff4d55");
        const sx = svg.getBoundingClientRect().width / W;
        tip.innerHTML = `<b>${nf.format(d.y)}</b> ${esc(unit)}<br><span class="sub">${esc(longDay(d.x))}</span>`;
        tip.style.left = `${(L + (i + 0.5) * bw) * sx}px`; tip.style.top = `${y(d.y) * sx}px`;
        tip.classList.remove("hidden");
      };
      gr.addEventListener("mouseenter", show); gr.addEventListener("touchstart", show, { passive: true });
    });
    svg.addEventListener("mouseleave", () => { tip.classList.add("hidden"); svg.querySelectorAll(".bar").forEach((b) => b.setAttribute("fill", b.classList.contains("zero") ? "#ffffff1f" : "var(--red)")); });
  }
  function niceStep(max) {
    const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return Math.max(1, m * p);
    return Math.max(1, 10 * p);
  }
  const shortDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  const longDay = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  function hbars(el, rows) {
    if (!rows.length) { el.innerHTML = '<p class="empty">Nog geen gegevens.</p>'; return; }
    const max = Math.max(...rows.map((r) => r.n), 1);
    el.innerHTML = rows.slice(0, 14).map((r) =>
      `<div class="hbar"><span class="n">${r.label}</span><span class="t"><span style="width:${Math.max(2, (r.n / max) * 100)}%"></span></span><span class="c">${nf.format(r.n)}</span></div>`).join("") +
      (rows.length > 14 ? `<p class="sub">+ ${rows.length - 14} meer</p>` : "");
  }

  // ---- gebruikers ----
  let page = 0, total = 0, searchTimer;
  const PAGE = 25;
  $("search").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 0; loadUsers(); }, 300); };
  $("prev").onclick = () => { if (page > 0) { page--; loadUsers(); } };
  $("next").onclick = () => { if ((page + 1) * PAGE < total) { page++; loadUsers(); } };
  async function loadUsers() {
    let r;
    try { r = await call("users", { q: $("search").value.trim(), page, page_size: PAGE }); } catch (e) { if (e.code !== "auth") toast(errText(e), true); return; }
    total = r.total || 0;
    $("userCount").textContent = `${nf.format(total)} ${total === 1 ? "account" : "accounts"}`;
    $("userRows").innerHTML = (r.items || []).map((u) => `<tr data-id="${esc(u.id)}" tabindex="0">
      <td class="em">${esc(u.email)}${u.confirmed ? "" : ' <span class="chip warn">onbevestigd</span>'}</td>
      <td data-l="Aangemaakt">${esc(fmtDate(u.created_at))}</td>
      <td data-l="Laatst ingelogd">${esc(ago(u.last_sign_in_at))}</td>
      <td data-l="Apparaten">${nf.format(u.device_count || 0)} ${(u.platforms || []).map((p) => `<span class="chip">${esc(pname(p))}</span>`).join("")}</td>
      <td data-l="Profielen">${nf.format(u.profile_count || 0)}</td>
      <td data-l="Versies">${(u.app_versions || []).map((v) => `<span class="chip">${esc(v)}</span>`).join("") || '<span class="sub">—</span>'}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="empty">Geen accounts gevonden.</td></tr>`;
    $("userRows").querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.onclick = () => openUser(tr.dataset.id);
      tr.onkeydown = (e) => { if (e.key === "Enter") openUser(tr.dataset.id); };
    });
    const pages = Math.max(1, Math.ceil(total / PAGE));
    $("pageInfo").textContent = `Pagina ${page + 1} van ${pages}`;
    $("prev").disabled = page === 0; $("next").disabled = page + 1 >= pages;
  }

  const ICON = {
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
    mac: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M2 20h20"/>',
    tv: '<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  };
  function icon(p) {
    const k = /iphone|^android$/i.test(p) ? "phone" : /ipad|tablet/i.test(p) ? "tablet" : /mac/i.test(p) ? "mac" : p === "browser" ? "globe" : "tv";
    return `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
  }
  async function openUser(id) {
    $("drawerBody").innerHTML = '<p class="sub">Laden…</p>';
    openDrawer();
    let u;
    try { u = await call("user_detail", { id }); } catch (e) { if (e.code !== "auth") $("drawerBody").innerHTML = `<p class="err">${esc(errText(e))}</p>`; return; }
    $("drawerBody").innerHTML = `
      <h2 id="dTitle">${esc(u.email)}</h2>
      <dl class="dl">
        <dt>Aangemaakt</dt><dd>${esc(fmtDateTime(u.created_at))}</dd>
        <dt>Laatst ingelogd</dt><dd>${esc(u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : "nooit")}</dd>
        <dt>Bevestigd</dt><dd>${u.confirmed ? "Ja" : "Nee"}</dd>
        <dt>Taal</dt><dd>${esc(u.lang || "—")}</dd>
        <dt>Profielen</dt><dd>${nf.format(u.profile_count || 0)}</dd>
        <dt>Actief (30 d)</dt><dd>${nf.format(u.active_days_30d || 0)} dagen</dd>
        <dt>Kijkt nu</dt><dd>${nf.format(u.watching_now || 0)}</dd>
        <dt>Berichten per e-mail</dt><dd>${u.email_opt_out ? "Afgemeld" : "Aan"}</dd>
      </dl>
      <h3>Apparaten (${(u.devices || []).length})</h3>
      ${(u.devices || []).map((d) => `<div class="dev"><div class="ic">${icon(d.platform)}</div><div>
        <div class="nm">${esc(d.name || pname(d.platform))}</div>
        <div class="meta">${esc(pname(d.platform))}${d.app_version ? " · Bingr " + esc(d.app_version) : ""}${d.os_version ? " · " + esc(d.os_version) : ""}</div>
        <div class="meta">Laatst gezien ${esc(ago(d.last_seen_at))} · gekoppeld ${esc(fmtDate(d.created_at))}</div></div></div>`).join("") || '<p class="empty">Geen apparaten.</p>'}
      <div class="actions">
        <button id="resetBtn" class="btn ghost">Stuur wachtwoord-reset</button>
        <p class="sub">De gebruiker krijgt de standaard reset-mail van Bingr en kiest zelf een nieuw wachtwoord. Je ziet of wijzigt nooit een wachtwoord.</p>
      </div>`;
    $("resetBtn").onclick = async () => {
      if (!confirm(`Een wachtwoord-reset-mail sturen naar ${u.email}?`)) return;
      $("resetBtn").disabled = true;
      try { await call("send_reset", { user_id: u.id }); toast("Reset-mail verstuurd."); }
      catch (e) { if (e.code !== "auth") toast(errText(e), true); }
      finally { $("resetBtn").disabled = false; }
    };
  }
  function openDrawer() { $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false"); }
  function closeDrawer() { $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true"); }
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeDrawer));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  // ---- berichten ----
  let smtpOk = true, pvLang = "nl", sending = false;
  function applySmtp() {
    $("mail").disabled = !smtpOk; if (!smtpOk) $("mail").checked = false;
    $("smtpHint").classList.toggle("hidden", smtpOk);
  }
  function preview() {
    const en = pvLang === "en" && $("tEn").value.trim() && $("bEn").value.trim();
    $("pvTitle").textContent = (en ? $("tEn") : $("tNl")).value.trim() || "Titel";
    $("pvBody").textContent = (en ? $("bEn") : $("bNl")).value.trim() || "Tekst van het bericht";
  }
  ["tNl", "bNl", "tEn", "bEn"].forEach((id) => $(id).addEventListener("input", preview));
  document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => {
    pvLang = b.dataset.lang; document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b)); preview();
  }));
  $("mail").onchange = () => { $("sendBtn").textContent = $("mail").checked ? "Plaatsen en e-mailen" : "Plaatsen"; };
  $("composeForm").onsubmit = async (e) => {
    e.preventDefault();
    if (sending) return;
    const data = {
      title_nl: $("tNl").value.trim(), body_nl: $("bNl").value.trim(), title_en: $("tEn").value.trim(), body_en: $("bEn").value.trim(),
      email: $("mail").checked, expires_at: $("exp").value ? new Date($("exp").value + "T23:59:59").toISOString() : null,
    };
    $("composeErr").textContent = "";
    if (!data.title_nl || !data.body_nl) { $("composeErr").textContent = ERR.text_missing; return; }
    if ((data.title_en && !data.body_en) || (!data.title_en && data.body_en)) { $("composeErr").textContent = "Vul bij Engels zowel titel als tekst in (of laat beide leeg)."; return; }
    if (!confirm(data.email ? "Dit bericht plaatsen in de apps én e-mailen naar alle gebruikers?" : "Dit bericht plaatsen in de apps?")) return;
    sending = true; $("sendBtn").disabled = true;
    try {
      const r = await call("announce", data);
      ["tNl", "bNl", "tEn", "bEn", "exp"].forEach((id) => ($(id).value = ""));
      preview();
      if (data.email) await sendMails(r.id, r.email_total);
      else toast("Bericht geplaatst.");
      loadAnnouncements();
    } catch (err) { if (err.code !== "auth") $("composeErr").textContent = errText(err); }
    finally { sending = false; $("sendBtn").disabled = false; }
  };
  async function sendMails(id, totalHint) {
    const box = $("progress"), bar = box.querySelector(".bar span"), txt = box.querySelector(".sub");
    box.classList.remove("hidden");
    const show = (r) => {
      const tot = r.email_total ?? totalHint ?? 0, done = (r.email_sent || 0) + (r.email_failed || 0);
      bar.style.width = `${tot ? Math.min(100, (done / tot) * 100) : 100}%`;
      txt.textContent = `${nf.format(r.email_sent || 0)} verstuurd${r.email_failed ? `, ${nf.format(r.email_failed)} mislukt` : ""} van ${nf.format(tot)}${r.done ? " · klaar" : "…"}`;
    };
    show({ email_total: totalHint });
    let r = {};
    for (let i = 0; i < 2000; i++) {
      try { r = await call("announce_send", { id }); }
      catch (e) { if (e.code !== "auth") toast(`${errText(e)} Je kunt later verder verzenden.`, true); loadAnnouncements(); return; }
      show(r);
      if (r.done) break;
      await new Promise((ok) => setTimeout(ok, 800));
    }
    toast(`E-mail klaar: ${nf.format(r.email_sent || 0)} verstuurd${r.email_failed ? `, ${nf.format(r.email_failed)} mislukt` : ""}.`, !!r.email_failed);
  }
  async function loadAnnouncements() {
    let r;
    try { r = await call("announcements_list"); } catch (e) { if (e.code !== "auth") toast(errText(e), true); return; }
    smtpOk = r.smtp !== false; applySmtp();
    const items = r.items || [];
    $("annList").innerHTML = items.map((a) => {
      const mail = a.email
        ? `<span>· e-mail: ${nf.format(a.email_sent)} / ${nf.format(a.email_total)}${a.email_failed ? `, ${nf.format(a.email_failed)} mislukt` : ""}${a.email_done_at ? "" : " (niet afgerond)"}</span>` : "";
      return `<div class="ann" data-id="${esc(a.id)}"><div class="main">
        <div class="tt">${esc(a.title_nl)}${a.title_en ? ` <span class="sub">/ ${esc(a.title_en)}</span>` : ""}</div>
        <div class="bd">${esc(a.body_nl)}</div>
        <div class="meta"><span class="badge ${a.active ? "on" : "off"}">${a.active ? "Actief" : "Verlopen"}</span>
          <span>${esc(fmtDateTime(a.created_at))}</span>${a.expires_at ? `<span>· tot ${esc(fmtDate(a.expires_at))}</span>` : ""}${mail}</div></div>
        <div class="btns">${a.email && !a.email_done_at ? '<button class="btn ghost small" data-act="resume">Verder verzenden</button>' : ""}
          <button class="btn danger small" data-act="del">Verwijderen</button></div></div>`;
    }).join("") || '<p class="empty">Nog geen berichten.</p>';
    $("annList").querySelectorAll(".ann").forEach((row) => {
      const id = row.dataset.id, a = items.find((x) => x.id === id);
      row.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm(`"${a.title_nl}" verwijderen? Apps tonen het dan niet meer.`)) return;
        try { await call("announcement_delete", { id }); toast("Bericht verwijderd."); loadAnnouncements(); }
        catch (e) { if (e.code !== "auth") toast(errText(e), true); }
      };
      const res = row.querySelector('[data-act="resume"]');
      if (res) res.onclick = async () => {
        if (sending) return;
        sending = true; res.disabled = true;
        try { await sendMails(id, a.email_total); } finally { sending = false; loadAnnouncements(); }
      };
    });
  }

  preview();
  if (!CFG.url) { showLogin("Supabase-instellingen ontbreken (assets/config.js)."); return; }
  if (session()) start(); else showLogin();
})();
