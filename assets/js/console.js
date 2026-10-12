// Mijn Bingr op de website: nu aan het kijken, kijkgeschiedenis (7 dagen), servers en collecties beheren.
// Gebruikt call() (device-auth), tr(), esc(), icons, loc en $ uit account/index.html.
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
      <div class="dev"><div class="ic">${icons[s.platform] || icons["Android TV"]}</div>
        <div class="info"><div class="nm">${esc(s.title || "—")}</div>
          <div class="meta">${esc(s.device_name || s.platform || "")} · ${esc(s.profile_name || "")} · ${tr("watchingFor").replace("%s", dur(Date.now() - Date.parse(s.started_at)))}${s.signed_in_at ? " · " + tr("signedInSince").replace("%s", new Date(s.signed_in_at).toLocaleDateString(loc, { day: "numeric", month: "short" }) + " " + fmtTime(new Date(s.signed_in_at))) : ""}</div></div>
        <span class="live">LIVE</span></div>`).join("") : `<p class="muted">${tr("nobodyWatching")}</p>`;
  }
  // ---- kijkgeschiedenis
  async function loadHistory() {
    const j = await call("watch_log", { days: 7 });
    if (!j.entries.length) { $("history").innerHTML = `<p class="muted">${tr("noHistory")}</p>`; return; }
    const groups = {};
    for (const e of j.entries) { const k = new Date(e.started_at).toDateString(); (groups[k] = groups[k] || []).push(e); }
    $("history").innerHTML = Object.keys(groups).map((k) => `<h3 class="day">${dayLabel(k)}</h3>` + groups[k].map((e) => `
      <div class="hrow"><div class="ht">${fmtTime(new Date(e.started_at))}</div>
        <div class="info"><div class="nm">${esc(e.title || "—")}</div>
          <div class="meta">${esc(e.profile_name || "")} · ${esc(e.device_name || e.platform || "")} · ${tr("minutes").replace("%d", e.minutes)}</div></div></div>`).join("")).join("");
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
      if (!name) { $("sfErr").textContent = tr("nameMissing"); return; }
      const o = s ? { ...s } : { id: uuid(), kind: k, avatar: { symbol: "tv", colorIndex: Math.floor(Math.random() * 8) }, m3uURL: "", epgURL: "", serverURL: "", username: "", macAddress: "", preferHLS: false, secrets: {} };
      o.name = name;
      if (editable) {
        const val = (id) => ($(id) ? $(id).value.trim() : "");
        if (k === KINDS.m3u) { o.m3uURL = val("sfM3u"); o.epgURL = val("sfEpg"); if (!/^https?:\/\//i.test(o.m3uURL)) { $("sfErr").textContent = tr("urlMissing"); return; } }
        else if (k === KINDS.xtream) {
          o.serverURL = val("sfServer"); o.username = val("sfUser"); o.preferHLS = $("sfHls").checked;
          const pw = $("sfPass").value; if (pw) o.secrets = { ...(o.secrets || {}), password: pw };
          if (!o.serverURL || !o.username || (!s && !pw)) { $("sfErr").textContent = tr("fieldsMissing"); return; }
        } else { o.serverURL = val("sfServer"); o.macAddress = val("sfMac"); if (!o.serverURL || !o.macAddress) { $("sfErr").textContent = tr("fieldsMissing"); return; } }
      }
      o.updatedAt = now();
      const list = s ? sources.map((x) => (x.id === s.id ? o : x)) : [...sources, o];
      const main = $("sfMain").checked ? o.id : (mainSourceID && String(mainSourceID).toLowerCase() !== String(o.id).toLowerCase() ? mainSourceID : (list.find((x) => !x.deleted) || {}).id || null);
      await save(list, main); f.classList.add("hidden");
    };
    if (s) $("sfDel").onclick = async () => {
      if (!confirm(tr("deleteServerConfirm").replace("%s", s.name))) return;
      const tomb = { id: s.id, deleted: true, deletedAt: now(), updatedAt: now() };
      const list = sources.map((x) => (x.id === s.id ? tomb : x));
      const main = String(mainSourceID || "").toLowerCase() === String(s.id).toLowerCase() ? ((list.find((x) => !x.deleted) || {}).id || null) : mainSourceID;
      await save(list, main); f.classList.add("hidden");
    };
  }
  async function save(list, main) {
    try { await call("put_sources", { sources: list, mainSourceID: main }); await loadSources(); $("srcMsg").innerHTML = `<span class="ok">${tr("savedSync")}</span>`; }
    catch (e) { $("srcMsg").textContent = tr("generic"); }
  }

  // ---- collecties
  async function loadCollections() {
    const j = await call("get_state", { sections: ["collections"] });
    const sec = j.sections && j.sections.collections;
    collections = (sec && sec.data && sec.data.items) || [];
    renderCollections();
  }
  function renderCollections() {
    const act = collections.filter((c) => !c.deleted).sort((a, b) => (a.order || 0) - (b.order || 0));
    $("collections").innerHTML = act.length ? act.map((c) => `
      <div class="dev"><div class="ic" style="font-size:20px">${c.kind === "smart" ? "✨" : "📚"}</div>
        <div class="info"><div class="nm">${esc(c.name)}</div>
          <div class="meta">${c.kind === "smart" ? tr("smart") + ": " + esc(c.query || "") : tr("manual").replace("%d", (c.items || []).length)}</div></div>
        <button class="rm" data-cren="${esc(c.id)}">${tr("rename")}</button><button class="rm" data-cdel="${esc(c.id)}">${tr("remove")}</button></div>`).join("") : `<p class="muted">${tr("noCollections")}</p>`;
    document.querySelectorAll("[data-cren]").forEach((b) => b.onclick = async () => {
      const c = collections.find((x) => x.id === b.dataset.cren); const n = prompt(tr("name"), c.name);
      if (!n || !n.trim()) return; c.name = n.trim(); c.updatedAt = now(); await saveCollections();
    });
    document.querySelectorAll("[data-cdel]").forEach((b) => b.onclick = async () => {
      const c = collections.find((x) => x.id === b.dataset.cdel); if (!confirm(tr("deleteCollection").replace("%s", c.name))) return;
      collections = collections.map((x) => (x.id === c.id ? { id: c.id, deleted: true, deletedAt: now(), updatedAt: now() } : x)); await saveCollections();
    });
  }
  async function addSmart() {
    const name = $("colName").value.trim(), q = $("colQuery").value.trim();
    if (!name || !q) { $("colMsg").textContent = tr("fieldsMissing"); return; }
    const types = ["channel", "movie", "series"].filter((t) => $("colT_" + t).checked);
    collections.push({ id: uuid(), name, kind: "smart", query: q, types: types.length ? types : ["channel", "movie", "series"], image: { symbol: "sparkle", colorIndex: Math.floor(Math.random() * 8) }, order: collections.length, updatedAt: now() });
    $("colName").value = ""; $("colQuery").value = ""; await saveCollections();
  }
  async function saveCollections() {
    try { await call("put_state", { section: "collections", data: { items: collections, updatedAt: now() } }); renderCollections(); $("colMsg").innerHTML = `<span class="ok">${tr("savedSync")}</span>`; }
    catch (e) { $("colMsg").textContent = tr("generic"); }
  }

  let timer = null;
  async function loadAll() {
    $("addSource").onclick = () => openSource(null);
    $("colAdd").onclick = addSmart;
    await Promise.all([loadStreams(), loadHistory(), loadSources(), loadCollections()].map((p) => p.catch(() => {})));
    clearInterval(timer); timer = setInterval(() => { if (!document.hidden) loadStreams().catch(() => {}); }, 30000);
  }
  return { loadAll };
})();
