// Mijn Bingr op de website: nu aan het kijken, kijkgeschiedenis (7 dagen), statistieken, servers en collecties beheren.
// Gebruikt call() (device-auth), tr(), esc(), icons, devIcon, platLabel, loc en $ uit account/index.html.
// Abonnementen: bij Gratis (features.stats / features.now_watching false, of 403 feature_locked) een slotje met Upgrade.
window.BingrConsole = (function () {
  const KINDS = { m3u: "M3U / M3U8", xtream: "Xtream Codes", stalker: "Stalker / MAC-portal" };
  const EDITABLE = Object.values(KINDS);
  let sources = [], mainSourceID = null, collections = [];
  const now = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); })).toUpperCase();
  const fmtTime = (d) => d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  function dur(ms) { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? tr("minutes").replace("%d", m) : tr("hours").replace("%d", Math.floor(m / 60)).replace("%m", String(m % 60).padStart(2, "0")); }
  function dayLabel(d) {
    const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0);
    const diff = Math.round((t - x) / 864e5);
    if (diff === 0) return tr("today"); if (diff === 1) return tr("yesterday");
    return x.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });
  }

  // ---- nu aan het kijken
  async function loadStreams() {
    const j = await call("list_streams");
    $("streamCount").textContent = tr("watchingCount").replace("%d", j.streams.length).replace("%d", j.limit);
    $("streams").innerHTML = j.streams.length ? j.streams.map((s) => `
      <div class="dev"><div class="ic">${devIcon(s.platform)}</div>
        <div class="info"><div class="nm">${esc(s.title || "—")}</div>
          <div class="meta who">${profileAvatar(s.profile_id, s.profile_name)}<span>${esc(s.profile_name || "")} · ${esc(s.device_name || platLabel(s.platform))} · ${tr("watchingFor").replace("%s", dur(Date.now() - Date.parse(s.started_at)))}${s.signed_in_at ? " · " + tr("signedInSince").replace("%s", new Date(s.signed_in_at).toLocaleDateString(loc, { day: "numeric", month: "short" }) + " " + fmtTime(new Date(s.signed_in_at))) : ""}</span></div></div>
        <span class="live">LIVE</span></div>`).join("") : `<p class="muted">${tr("nobodyWatching")}</p>`;
  }
  // ---- kijkgeschiedenis
  async function loadHistory() {
    const j = await call("watch_log", { days: 7 });
    if (!j.entries.length) { $("history").innerHTML = `<p class="muted">${tr("noHistory")}</p>`; return; }
    const groups = {};
    for (const e of j.entries) { const k = new Date(e.started_at).toDateString(); (groups[k] = groups[k] || []).push(e); }
    $("history").innerHTML = Object.keys(groups).map((k) => `<h3 class="day">${dayLabel(k)}</h3>` + groups[k].map((e) => `
      <div class="hrow"><div class="ht">${fmtTime(new Date(e.started_at))}</div>${profileAvatar(e.profile_id, e.profile_name)}
        <div class="info"><div class="nm">${esc(e.title || "—")}</div>
          <div class="meta">${esc(e.profile_name || "")} · ${esc(e.device_name || platLabel(e.platform))} · ${tr("minutes").replace("%d", e.minutes)}</div></div></div>`).join("")).join("");
  }

  // ---- servers (webconsole)
  async function loadSources() {
    const j = await call("get_sources");
    sources = j.sources || []; mainSourceID = j.mainSourceID || null;
    renderSources();
  }
  function renderSources() {
    const act = sources.filter((s) => !s.deleted);
    $("sources").innerHTML = act.length ? act.map((s) => `
      <div class="dev"><div class="ic">${icons["Android TV"]}</div>
        <div class="info"><div class="nm">${esc(s.name)}${String(s.id).toLowerCase() === String(mainSourceID || "").toLowerCase() ? ` <span class="badge">${tr("mainSrv")}</span>` : ""}</div>
          <div class="meta">${esc(s.kind)}${s.serverURL || s.m3uURL ? " · " + esc(host(s.serverURL || s.m3uURL)) : ""}</div></div>
        <button class="rm" data-edit="${esc(s.id)}">${tr("edit")}</button></div>`).join("") : `<p class="muted">${tr("noSources")}</p>`;
    document.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openSource(b.dataset.edit));
  }
  const host = (u) => { try { return new URL(u).host; } catch (e) { return ""; } };
  function openSource(id) {
    const s = id ? sources.find((x) => x.id === id) : null;
    const kind = s ? s.kind : KINDS.xtream;
    const editable = !s || EDITABLE.includes(kind);
    const f = $("srcForm");
    f.innerHTML = `
      <h3>${s ? tr("editServer") : tr("addServer")}</h3>
      ${s ? "" : `<label>${tr("type")}<select id="sfKind">${Object.values(KINDS).map((k) => `<option ${k === kind ? "selected" : ""}>${k}</option>`).join("")}</select></label>`}
      <label>${tr("name")}<input id="sfName" value="${esc(s ? s.name : "")}"></label>
      <div id="sfFields"></div>
      ${s && !editable ? `<p class="muted">${tr("appOnly")}</p>` : ""}
      <label class="chk"><input type="checkbox" id="sfMain" ${!s || String(s.id).toLowerCase() === String(mainSourceID || "").toLowerCase() ? "checked" : ""}> ${tr("makeMain")}</label>
      <div class="row">
        <button class="btn" id="sfSave">${tr("save")}</button>
        <button class="btn ghost" id="sfCancel">${tr("cancel")}</button>
        ${s ? `<button class="btn danger" id="sfDel">${tr("deleteServer")}</button>` : ""}
      </div><div class="err" id="sfErr"></div>`;
    f.classList.remove("hidden"); f.scrollIntoView({ behavior: "smooth", block: "center" });
    const fields = () => {
      const k = s ? kind : $("sfKind").value;
      const v = (key) => esc(s ? (s[key] || "") : "");
      $("sfFields").innerHTML = !editable ? "" : k === KINDS.m3u
        ? `<label>${tr("m3uUrl")}<input id="sfM3u" value="${v("m3uURL")}" placeholder="https://…"></label><label>${tr("epgUrl")}<input id="sfEpg" value="${v("epgURL")}" placeholder="https://… (${tr("optional")})"></label>`
        : k === KINDS.xtream
        ? `<label>${tr("server")}<input id="sfServer" value="${v("serverURL")}" placeholder="http://server:8080"></label><label>${tr("username")}<input id="sfUser" value="${v("username")}" autocomplete="off"></label><label>${tr("password")}<input id="sfPass" type="password" autocomplete="new-password" placeholder="${s ? tr("unchanged") : ""}"></label><label class="chk"><input type="checkbox" id="sfHls" ${s && s.preferHLS ? "checked" : ""}> ${tr("hls")}</label>`
        : `<label>${tr("portal")}<input id="sfServer" value="${v("serverURL")}" placeholder="http://portal:8080/c/"></label><label>${tr("mac")}<input id="sfMac" value="${v("macAddress")}" placeholder="00:1A:79:…"></label>`;
    };
    fields(); if (!s) $("sfKind").onchange = fields;
    $("sfCancel").onclick = () => f.classList.add("hidden");
    $("sfSave").onclick = async () => {
      const k = s ? kind : $("sfKind").value;
      const name = $("sfName").value.trim();
      let newPw = "";
      if (!name) { $("sfErr").textContent = tr("nameMissing"); return; }
      const o = s ? { ...s } : { id: uuid(), kind: k, avatar: { symbol: "tv", colorIndex: Math.floor(Math.random() * 8) }, m3uURL: "", epgURL: "", serverURL: "", username: "", macAddress: "", preferHLS: false, secrets: {} };
      o.name = name;
      if (editable) {
        const val = (id) => ($(id) ? $(id).value.trim() : "");
        if (k === KINDS.m3u) { o.m3uURL = val("sfM3u"); o.epgURL = val("sfEpg"); if (!/^https?:\/\//i.test(o.m3uURL)) { $("sfErr").textContent = tr("urlMissing"); return; } }
        else if (k === KINDS.xtream) {
          o.serverURL = val("sfServer"); o.username = val("sfUser"); o.preferHLS = $("sfHls").checked;
          newPw = $("sfPass").value; if (newPw) o.secrets = { ...(o.secrets || {}), password: newPw };
          if (!o.serverURL || !o.username || (!s && !newPw)) { $("sfErr").textContent = tr("fieldsMissing"); return; }
        } else { o.serverURL = val("sfServer"); o.macAddress = val("sfMac"); if (!o.serverURL || !o.macAddress) { $("sfErr").textContent = tr("fieldsMissing"); return; } }
      }
      o.updatedAt = now();
      const makeMain = $("sfMain").checked;
      // op de nieuwste serverlijst toepassen: alleen de velden uit dit formulier, de rest (ook van andere apparaten) blijft staan
      const ok = await save((fresh, curMain) => {
        const cur = s ? fresh.find((x) => same(x.id, s.id)) : null;
        // bestaande bron: alleen de formuliervelden; secrets van de server houden, alleen een nieuw wachtwoord erin
        const item = cur && !cur.deleted ? Object.assign({}, cur, pick(o), { secrets: newPw ? { ...(cur.secrets || {}), password: newPw } : (cur.secrets || {}) }) : o;
        const list = cur ? fresh.map((x) => (same(x.id, s.id) ? item : x)) : [...fresh, item];
        const main = makeMain ? item.id : (curMain && !same(curMain, item.id) ? curMain : (list.find((x) => !x.deleted) || {}).id || null);
        return { list, main };
      });
      if (ok) f.classList.add("hidden");
    };
    if (s) $("sfDel").onclick = async () => {
      if (!confirm(tr("deleteServerConfirm").replace("%s", s.name))) return;
      const t = now(), tomb = { id: s.id, deleted: true, deletedAt: t, updatedAt: t };
      const ok = await save((fresh, curMain) => {
        const list = fresh.some((x) => same(x.id, s.id)) ? fresh.map((x) => (same(x.id, s.id) ? tomb : x)) : [...fresh, tomb];
        const main = same(curMain, s.id) ? ((list.find((x) => !x.deleted) || {}).id || null) : curMain;
        return { list, main };
      });
      if (ok) f.classList.add("hidden");
    };
  }
  const same = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();
  // velden die het formulier wijzigt (onbekende velden, apple/android-blok, catchupOffsets en andere secrets blijven staan)
  const pick = (o) => { const out = {}; ["name", "m3uURL", "epgURL", "serverURL", "username", "macAddress", "preferHLS", "updatedAt"].forEach((k) => { if (k in o) out[k] = o[k]; }); return out; };
  // altijd eerst de nieuwste lijst ophalen (een app kan intussen iets gewijzigd hebben), dan de wijziging toepassen
  async function save(mutate) {
    $("srcMsg").textContent = "";
    try {
      const j = await call("get_sources");
      const { list, main } = mutate(j.sources || [], j.mainSourceID || null);
      await call("put_sources", { sources: list, mainSourceID: main });
      await loadSources(); $("srcMsg").innerHTML = `<span class="ok">${tr("savedSync")}</span>`;
      return true;
    } catch (e) { $("srcMsg").textContent = e.message === "too_large" ? tr("tooLarge") : tr("generic"); return false; }
  }

  // ---- collecties: per profiel (build 54). Sectie = {version:2, profiles:{<id>:{items,updatedAt}}, items:[oud], migratedAt, updatedAt}
  let colSec = {}, colProfiles = [], colProfile = null;
  const newest = (a, b) => ((a && a.updatedAt) || "") >= ((b && b.updatedAt) || "") ? a : b;
  function mergeItems(x, y) {
    const m = new Map();
    for (const c of [...(x || []), ...(y || [])]) { if (c && c.id) m.set(c.id, m.has(c.id) ? newest(m.get(c.id), c) : c); }
    const cut = Date.now() - 90 * 864e5;
    return [...m.values()].filter((c) => !(c.deleted && Date.parse(c.deletedAt || c.updatedAt || 0) < cut));
  }
  // zelfde migratie als de apps (iOS build 74): de oude account-brede lijst gaat alleen naar het hoofdprofiel, met
  // dezelfde id/order/updatedAt; een profiel ziet nooit de collecties van een ander profiel. Ongewijzigde kopieën
  // van oude collecties bij andere profielen (van vroegere builds) worden tombstones.
  const lc = (s) => String(s || "").toLowerCase();
  const tms = (c) => Date.parse((c && (c.updatedAt || c.deletedAt)) || "") || 0;
  const mainProfile = (profiles) => profiles.find((p) => p.isMain) || profiles[0] || null;
  // sleutel van de emmer van een profiel (hoofdletterongevoelig, zoals de apps)
  const keyFor = (d, pid) => Object.keys(d.profiles || {}).find((k) => lc(k) === lc(pid)) || null;
  function normalize(data, profiles) {
    const d = Array.isArray(data) ? { items: data.slice() } : Object.assign({}, data || {});
    const migrated = d.version >= 2 || d.migrated === true || !!(d.profiles && typeof d.profiles === "object" && !Array.isArray(d.profiles));
    d.profiles = Object.assign({}, d.profiles && !Array.isArray(d.profiles) ? d.profiles : {});
    const main = mainProfile(profiles);
    if (!main) return d;
    const mk = keyFor(d, main.id) || main.id;
    if (!migrated) {
      const cur = (d.profiles[mk] && d.profiles[mk].items) || [];
      const have = new Set(cur.map((c) => lc(c.id)));
      const items = cur.concat((d.items || []).filter((c) => c && c.id && !have.has(lc(c.id))));
      d.profiles[mk] = Object.assign({}, d.profiles[mk] || {}, { items, updatedAt: items.reduce((t, c) => (c.updatedAt > t ? c.updatedAt : t), "") || now() });
      d.migratedAt = d.migratedAt || now();
    }
    // tijdstempels van de oude collecties en die van het hoofdprofiel, per id
    const stamps = new Map();
    for (const c of [...(d.items || []), ...((d.profiles[mk] && d.profiles[mk].items) || [])]) {
      if (c && c.id) { const k = lc(c.id); if (!stamps.has(k)) stamps.set(k, []); stamps.get(k).push(tms(c)); }
    }
    const t = now();
    for (const k of Object.keys(d.profiles)) {
      if (lc(k) === lc(main.id)) continue;
      const b = d.profiles[k];
      if (!b || !Array.isArray(b.items)) continue;
      let changed = false;
      const items = b.items.map((c) => {
        if (!c || !c.id || c.deleted || !(stamps.get(lc(c.id)) || []).some((s) => Math.abs(s - tms(c)) < 1000)) return c;
        changed = true;
        return Object.assign({}, c, { deleted: true, deletedAt: t, updatedAt: t, items: [] });
      });
      if (changed) d.profiles[k] = Object.assign({}, b, { items });
    }
    d.version = Math.max(2, d.version || 0);
    return d;
  }
  async function fetchCollections() {
    const j = await call("get_state", { sections: ["collections"] });
    const sec = j.sections && j.sections.collections;
    return normalize(sec && sec.data, colProfiles);
  }
  async function loadCollections() {
    // build 146: profielen via device-auth get_profiles (account/index.html, BingrProfiles)
    const list = window.BingrProfiles ? await window.BingrProfiles.get() : [];
    colProfiles = (list || []).filter((p) => p && !p.deleted && p.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    colSec = await fetchCollections();
    if (!colProfiles.some((p) => p.id === colProfile)) colProfile = colProfiles.length ? colProfiles[0].id : null;
    $("colProfile").innerHTML = colProfiles.map((p) => `<option value="${esc(p.id)}"${p.id === colProfile ? " selected" : ""}>${esc(p.name || "")}</option>`).join("");
    $("colProfile").onchange = () => { colProfile = $("colProfile").value; renderCollections(); };
    $("colProfileWrap").style.display = colProfiles.length > 1 ? "" : "none";
    $("colForm").style.display = colProfile ? "" : "none";
    renderCollections();
  }
  const bucket = () => { const k = keyFor(colSec, colProfile); return ((k && colSec.profiles[k]) || { items: [] }).items || []; };
  function renderCollections() {
    if (!colProfile) { $("collections").innerHTML = `<p class="muted">${tr("noProfiles")}</p>`; return; }
    const act = bucket().filter((c) => !c.deleted).sort((a, b) => (a.order || 0) - (b.order || 0));
    $("collections").innerHTML = act.length ? act.map((c) => `
      <div class="dev"><div class="ic">${c.kind === "smart" ? icSmart : icList}</div>
        <div class="info"><div class="nm">${esc(c.name)}</div>
          <div class="meta">${c.kind === "smart" ? tr("smart") + ": " + esc(c.query || "") : tr("manual").replace("%d", (c.items || []).length)}</div>
          <div class="acts"><button class="rm" data-cren="${esc(c.id)}">${tr("rename")}</button><button class="rm" data-cdel="${esc(c.id)}">${tr("remove")}</button></div></div></div>`).join("") : `<p class="muted">${tr("noCollections")}</p>`;
    document.querySelectorAll("[data-cren]").forEach((b) => b.onclick = async () => {
      const c = bucket().find((x) => x.id === b.dataset.cren); const n = prompt(tr("name"), c.name);
      if (!n || !n.trim()) return; await saveChange(Object.assign({}, c, { name: n.trim(), updatedAt: now() }));
    });
    document.querySelectorAll("[data-cdel]").forEach((b) => b.onclick = async () => {
      const c = bucket().find((x) => x.id === b.dataset.cdel); if (!confirm(tr("deleteCollection").replace("%s", c.name))) return;
      const t = now(); await saveChange({ id: c.id, deleted: true, deletedAt: t, updatedAt: t });
    });
  }
  const icSmart = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l1.8 4.9L19 9.7l-4.9 1.8L12 16.5l-1.8-4.9L5 9.7l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>`;
  const icList = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>`;
  async function addSmart() {
    const name = $("colName").value.trim(), q = $("colQuery").value.trim();
    if (!name || !q) { $("colMsg").textContent = tr("fieldsMissing"); return; }
    const types = ["channel", "movie", "series"].filter((t) => $("colT_" + t).checked);
    const order = bucket().filter((c) => !c.deleted).length;
    await saveChange({ id: uuid(), name, kind: "smart", query: q, types: types.length ? types : ["channel", "movie", "series"], image: { symbol: "sparkle", colorIndex: Math.floor(Math.random() * 8) }, order, updatedAt: now() });
    $("colName").value = ""; $("colQuery").value = "";
  }
  // altijd eerst de nieuwste versie ophalen en alleen de lijst van dit profiel aanpassen; de rest blijft precies staan
  async function saveChange(item) {
    try {
      const fresh = await fetchCollections();
      const k = keyFor(fresh, colProfile) || colProfile;
      const b = (fresh.profiles[k] && fresh.profiles[k].items) || [];
      const items = mergeItems(b, [item]);
      fresh.profiles[k] = { ...(fresh.profiles[k] || {}), items, updatedAt: items.reduce((t, c) => (c.updatedAt > t ? c.updatedAt : t), "") || now() };
      fresh.updatedAt = now();
      await call("put_state", { section: "collections", data: fresh });
      colSec = fresh; renderCollections(); $("colMsg").innerHTML = `<span class="ok">${tr("savedSync")}</span>`;
    } catch (e) { $("colMsg").textContent = tr("generic"); }
  }

  // ---- statistieken (build 68): hoofdaccount, alle profielen + filter per profiel
  let stats = null;
  function loadStats() {
    if (stats) { stats.setProfiles(PROF.list); stats.reload(); return; }
    stats = BingrStats.mount($("stats"), { call, lang: loc === "nl-NL" ? "nl" : "en", profiles: PROF.list, filter: true,
      avatar: (p) => profileAvatar(p.id, p.name) });
  }

  // ---- slotje voor Lifetime-functies (Gratis)
  const LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
  function lock(id, key) {
    $(id).innerHTML = `<div class="locked"><span class="lk">${LOCK}</span><div><b>${tr(key)}</b><p>${tr("lockedText")}</p>
      <a class="btn red sm" href="../upgrade/">${tr("upgradeCta")}</a></div></div>`;
  }
  const lockStreams = () => { $("streamCount").textContent = ""; lock("streams", "lockedWatching"); };

  let timer = null;
  // features: {stats, now_watching} uit `entitlements` (null = onbekend: gewoon laden; de server geeft dan feature_locked)
  async function loadAll(features) {
    $("addSource").onclick = () => openSource(null);
    $("colAdd").onclick = addSmart;
    const f = features || {};
    if (f.stats === false) lock("stats", "lockedStats");
    else { try { loadStats(); } catch (e) { $("stats").innerHTML = `<p class="muted">${tr("loadFailed")}</p>`; } }
    const fail = (id, locked) => (e) => {
      if (e && e.message === "signed_out") return;
      if (e && e.message === "feature_locked" && locked) { locked(); return; }
      $(id).innerHTML = `<p class="muted">${tr("loadFailed")}</p>`;
    };
    const watching = f.now_watching !== false;
    if (!watching) { lockStreams(); lock("history", "lockedHistory"); }
    await Promise.all([
      watching ? loadStreams().catch(fail("streams", lockStreams)) : null,
      watching ? loadHistory().catch(fail("history", () => lock("history", "lockedHistory"))) : null,
      loadSources().catch(fail("sources")), loadCollections().catch(fail("collections"))]);
    clearInterval(timer);
    if (watching) timer = setInterval(() => { if (!document.hidden) loadStreams().catch(() => {}); }, 30000);
  }
  return { loadAll };
})();
