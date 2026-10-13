// Bingr kijkstatistieken (build 68): gedeeld door Mijn Bingr (account/) en de webspeler (web/, Instellingen → Statistieken).
// Leest device-auth `watch_stats` en wist met `delete_watch_stats` (zie docs/ACCOUNT.md in de app-repo, "Build 68").
// BingrStats.mount(el, {call, lang, profiles, avatar, filter, profileId, onError}) -> {reload, destroy}
//   call(action, body) -> Promise<json>   profiles: [{id, name, …}]   avatar(p) -> Node|string (rond)
//   filter: true = "Alle profielen" + per profiel (hoofdaccount); profileId: vast profiel (geen filter)
window.BingrStats = (function () {
  "use strict";
  const COLORS = { movie: "#E50914", episode: "#3B82F6", live: "#F59E0B" };
  const T = {
    nl: {
      week: "Week", month: "Maand", year: "Jaar", prev: "Vorige periode", next: "Volgende periode", periodLbl: "Periode",
      thisWeek: "Deze week", thisMonth: "Deze maand", thisYear: "Dit jaar", allProfiles: "Alle profielen", profileLbl: "Profiel",
      hoursWatched: "Uren gekeken", movies: "Films", series: "Series", live: "Live TV",
      nMovies: ["%d film", "%d films"], nShows: ["%d serie", "%d series"], nEps: ["%d aflevering", "%d afleveringen"], nChannels: ["%d zender", "%d zenders"],
      topSeries: "Meest gekeken series", topMovies: "Meest gekeken films", topChannels: "Meest gekeken zenders", perProfile: "Per profiel",
      chartTitle: "Kijktijd per dag", chartTitleYear: "Kijktijd per maand", none: "Nog niets", nothing: "Geen kijktijd in deze periode.",
      emptyTitle: "Statistieken worden bijgehouden vanaf 13 oktober 2026", emptyBody: "Kijk iets in Bingr en je ziet hier hoeveel je kijkt: per dag, per profiel en je meest gekeken titels.",
      clear: "Statistieken wissen", clearAll: "Alle statistieken van alle profielen wissen? Dit kan niet ongedaan worden gemaakt.",
      clearOne: "Statistieken van %s wissen? Dit kan niet ongedaan worden gemaakt.", clearOwn: "Je statistieken wissen? Dit kan niet ongedaan worden gemaakt.",
      cleared: "Statistieken gewist.", loading: "Laden…", failed: "Laden mislukt. Probeer het opnieuw.", retry: "Opnieuw", generic: "Er ging iets mis. Probeer het opnieuw.",
      since: "Bijgehouden sinds %s", table: "Tabel", day: "Dag", monthCol: "Maand", total: "Totaal", min: "%d min", h: "%s u", hm: "%d u %d min", unknown: "Onbekend profiel",
      tapHint: "Tik op een staaf voor details.", perDay: "gem. %s per dag", eps: "%d afl.",
    },
    en: {
      week: "Week", month: "Month", year: "Year", prev: "Previous period", next: "Next period", periodLbl: "Period",
      thisWeek: "This week", thisMonth: "This month", thisYear: "This year", allProfiles: "All profiles", profileLbl: "Profile",
      hoursWatched: "Hours watched", movies: "Movies", series: "Series", live: "Live TV",
      nMovies: ["%d movie", "%d movies"], nShows: ["%d series", "%d series"], nEps: ["%d episode", "%d episodes"], nChannels: ["%d channel", "%d channels"],
      topSeries: "Most watched series", topMovies: "Most watched movies", topChannels: "Most watched channels", perProfile: "By profile",
      chartTitle: "Watch time per day", chartTitleYear: "Watch time per month", none: "Nothing yet", nothing: "No watch time in this period.",
      emptyTitle: "Statistics are being kept since 13 October 2026", emptyBody: "Watch something in Bingr and you'll see how much you watch here: per day, per profile and your most watched titles.",
      clear: "Clear statistics", clearAll: "Clear all statistics for all profiles? This can't be undone.",
      clearOne: "Clear the statistics of %s? This can't be undone.", clearOwn: "Clear your statistics? This can't be undone.",
      cleared: "Statistics cleared.", loading: "Loading…", failed: "Couldn't load this. Please try again.", retry: "Try again", generic: "Something went wrong. Please try again.",
      since: "Kept since %s", table: "Table", day: "Day", monthCol: "Month", total: "Total", min: "%d min", h: "%s h", hm: "%d h %d min", unknown: "Unknown profile",
      tapHint: "Tap a bar for details.", perDay: "avg. %s per day", eps: "%d ep.",
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stil */ } } };

  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const s = document.createElement("style");
    s.textContent = `
.bst{container-type:inline-size;--bst-sec:#a3a3a3;--bst-line:#ffffff1f;--bst-card:#ffffff0b;--bst-grid:#ffffff14;color:#fff;font-size:15px}
.bst *{box-sizing:border-box}
.bst-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}
.bst-seg{display:inline-flex;background:#ffffff12;border-radius:999px;padding:3px}
.bst-seg button{all:unset;cursor:pointer;padding:7px 16px;border-radius:999px;font-weight:700;font-size:14px;color:var(--bst-sec)}
.bst-seg button[aria-pressed=true]{background:#fff;color:#000}
.bst-nav{display:flex;align-items:center;gap:6px;min-width:0}
.bst-nav button{all:unset;cursor:pointer;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#ffffff12;color:#fff;flex:none}
.bst-nav button:disabled{opacity:.3;cursor:default}
.bst-nav .bst-lbl{min-width:0;text-align:center;padding:0 6px}
.bst-lbl b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bst-lbl span{display:block;font-size:12px;color:var(--bst-sec)}
.bst button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.bst-prof{display:flex;gap:8px;overflow-x:auto;margin-top:14px;padding-bottom:4px;scrollbar-width:none}
.bst-prof::-webkit-scrollbar{display:none}
.bst-prof button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:4px 14px 4px 4px;border-radius:999px;border:1px solid var(--bst-line);font-size:14px;white-space:nowrap;flex:none;color:#ddd}
.bst-prof button.all{padding-left:14px}
.bst-prof button[aria-pressed=true]{background:#fff;color:#000;border-color:#fff}
.bst-av{width:28px;height:28px;border-radius:50%;overflow:hidden;display:grid;place-items:center;flex:none;font-size:14px}
.bst-av>*{width:100%!important;height:100%!important;margin:0!important;border-radius:50%;font-size:14px!important}
.bst-av img{width:100%;height:100%;object-fit:cover}
.bst-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}
@container (min-width:640px){.bst-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
.bst-kpi{background:var(--bst-card);border:1px solid var(--bst-line);border-radius:12px;padding:14px;min-width:0}
.bst-kpi .k{display:flex;align-items:center;gap:7px;color:var(--bst-sec);font-size:13px;font-weight:600}
.bst-kpi .k i{width:10px;height:10px;border-radius:3px;flex:none}
.bst-kpi .v{font-size:28px;font-weight:800;margin-top:6px;letter-spacing:-.02em;line-height:1.1}
.bst-kpi .s{color:var(--bst-sec);font-size:13px;margin-top:4px;line-height:1.4}
.bst-card{background:var(--bst-card);border:1px solid var(--bst-line);border-radius:12px;padding:14px 14px 10px;margin-top:12px}
.bst-card h3{font-size:15px;font-weight:700;margin:0}
.bst-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.bst-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--bst-sec)}
.bst-legend span{display:inline-flex;align-items:center;gap:6px}.bst-legend i{width:10px;height:10px;border-radius:3px}
.bst-chart{position:relative;margin-top:10px}
.bst-chart svg{display:block;width:100%;height:auto;overflow:visible}
.bst-chart .ax{fill:var(--bst-sec);font-size:11px}
.bst-chart .hit{fill:transparent;cursor:pointer}
.bst-chart g.col:hover .hl,.bst-chart g.col.sel .hl{fill:#ffffff10}
.bst-tip{min-height:20px;color:var(--bst-sec);font-size:13px;margin-top:6px}
.bst-tip b{color:#fff}
.bst-tbl{margin-top:8px}.bst-tbl summary{cursor:pointer;color:var(--bst-sec);font-size:13px}
.bst-tbl table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
.bst-tbl th,.bst-tbl td{text-align:right;padding:4px 6px;border-bottom:1px solid var(--bst-grid);white-space:nowrap}
.bst-tbl th:first-child,.bst-tbl td:first-child{text-align:left}
.bst-tops{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin-top:12px}
@container (min-width:820px){.bst-tops{grid-template-columns:repeat(3,minmax(0,1fr))}}
.bst-tops .bst-card{margin-top:0}
.bst-list{list-style:none;margin:8px 0 0;padding:0}
.bst-list li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:2px 8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--bst-grid)}
.bst-list li:last-child{border-bottom:0}
.bst-list .n{color:var(--bst-sec);font-size:13px;font-weight:700}
.bst-list .t{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bst-list .m{color:var(--bst-sec);font-size:13px;text-align:right;white-space:nowrap}
.bst-list .x{grid-column:2/4;color:var(--bst-sec);font-size:12px;margin-top:-2px}
.bst-list .b{grid-column:2/4;height:4px;border-radius:2px;background:var(--bst-grid);overflow:hidden}
.bst-list .b i{display:block;height:100%;border-radius:2px}
.bst-list.pp li{grid-template-columns:32px minmax(0,1fr) auto}
.bst-muted{color:var(--bst-sec);font-size:14px}
.bst-empty{text-align:center;padding:30px 16px;margin-top:16px;background:var(--bst-card);border:1px dashed var(--bst-line);border-radius:12px}
.bst-empty svg{color:var(--bst-sec)}.bst-empty h3{font-size:17px;margin:10px 0 6px}.bst-empty p{color:var(--bst-sec);font-size:14px;margin:0 auto;max-width:440px;line-height:1.5}
.bst-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:16px}
.bst-clear{all:unset;cursor:pointer;border:1px solid #ff4d4d66;color:#ff8080;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600}
.bst-msg{font-size:14px;color:var(--bst-sec)}
.bst.busy .bst-body{opacity:.55;transition:opacity .2s}
`;
    document.head.appendChild(s);
  }

  const chevL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
  const chevR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const icChart = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 20h16"/><rect x="6" y="11" width="3" height="6" rx="1"/><rect x="11" y="6" width="3" height="11" rx="1"/><rect x="16" y="13" width="3" height="4" rx="1"/></svg>';

  function mount(root, opts) {
    css();
    const lang = opts.lang === "en" ? "en" : "nl";
    const L = T[lang], loc = lang === "nl" ? "nl-NL" : "en-GB";
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam"; } catch (e) { return "Europe/Amsterdam"; } })();
    const plural = (pair, n) => (n === 1 ? pair[0] : pair[1]).replace("%d", n.toLocaleString(loc));
    const dur = (m) => { m = Math.round(m || 0); if (m < 60) return L.min.replace("%d", m); const h = Math.floor(m / 60), r = m % 60; return r ? L.hm.replace("%d", h).replace("%d", r) : L.h.replace("%s", h); };
    const hours = (m) => { const h = (m || 0) / 60; return h < 10 ? h.toLocaleString(loc, { maximumFractionDigits: 1 }) : Math.round(h).toLocaleString(loc); };
    const D = (s) => new Date(s + (s.length === 7 ? "-01" : "") + "T12:00:00Z");
    const fmt = (s, o) => D(s).toLocaleDateString(loc, Object.assign({ timeZone: "UTC" }, o));
    const fixed = opts.profileId != null;
    let period = ["week", "month", "year"].includes(store.get("bingr.stats.period")) ? store.get("bingr.stats.period") : "month";
    let offset = 0, profileId = fixed ? opts.profileId : (store.get("bingr.stats.profile") || null), data = null, seq = 0, selKey = null, alive = true;
    const profiles = () => (opts.profiles || []).filter((p) => p && p.id && !p.deleted);
    if (profileId && !profiles().some((p) => p.id === profileId)) profileId = null;

    root.classList.add("bst");
    root.innerHTML = `<div class="bst-bar">
        <div class="bst-seg" role="group" aria-label="${esc(L.periodLbl)}">${["week", "month", "year"].map((p) => `<button type="button" data-p="${p}">${esc(L[p])}</button>`).join("")}</div>
        <div class="bst-nav"><button type="button" class="prev" aria-label="${esc(L.prev)}">${chevL}</button><div class="bst-lbl" aria-live="polite"></div><button type="button" class="next" aria-label="${esc(L.next)}">${chevR}</button></div>
      </div>
      <div class="bst-prof" role="group" aria-label="${esc(L.profileLbl)}"${opts.filter && !fixed ? "" : " hidden"}></div>
      <div class="bst-body"><p class="bst-muted" style="margin-top:16px">${esc(L.loading)}</p></div>`;
    const q = (s) => root.querySelector(s);
    root.querySelectorAll(".bst-seg button").forEach((b) => b.onclick = () => { if (period === b.dataset.p) return; period = b.dataset.p; offset = 0; store.set("bingr.stats.period", period); load(); });
    q(".prev").onclick = () => { offset = Math.max(-600, offset - 1); load(); };
    q(".next").onclick = () => { if (offset < 0) { offset++; load(); } };

    function drawProfiles() {
      const box = q(".bst-prof");
      if (!opts.filter || fixed) return;
      const list = profiles();
      box.hidden = list.length < 2;
      box.innerHTML = `<button type="button" class="all" data-id="" aria-pressed="${profileId == null}">${esc(L.allProfiles)}</button>` +
        list.map((p) => `<button type="button" data-id="${esc(p.id)}" aria-pressed="${p.id === profileId}"><span class="bst-av" data-av="${esc(p.id)}"></span>${esc(p.name || "")}</button>`).join("");
      box.querySelectorAll("[data-av]").forEach((el) => putAvatar(el, list.find((p) => p.id === el.dataset.av)));
      box.querySelectorAll("button").forEach((b) => b.onclick = () => {
        profileId = b.dataset.id || null; store.set("bingr.stats.profile", profileId || "");
        box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        load();
      });
    }
    function putAvatar(el, p) {
      if (!p || !opts.avatar) { el.textContent = (p && p.name ? p.name.charAt(0) : "?").toUpperCase(); el.style.background = "#444"; return; }
      const a = opts.avatar(p);
      if (typeof a === "string") el.innerHTML = a; else if (a) el.appendChild(a);
    }
    function drawHead() {
      root.querySelectorAll(".bst-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === period)));
      q(".next").disabled = offset >= 0;
      const lbl = q(".bst-lbl");
      if (!data) { lbl.innerHTML = ""; return; }
      let main;
      if (period === "week") {
        const a = D(data.from), b = D(data.to), sameM = a.getUTCMonth() === b.getUTCMonth();
        main = fmt(data.from, sameM ? { day: "numeric" } : { day: "numeric", month: "short" }) + " – " + fmt(data.to, { day: "numeric", month: "short", year: "numeric" });
      } else if (period === "month") main = fmt(data.from, { month: "long", year: "numeric" });
      else main = data.from.slice(0, 4);
      const sub = offset === 0 ? L[period === "week" ? "thisWeek" : period === "month" ? "thisMonth" : "thisYear"] : "";
      lbl.innerHTML = `<b>${esc(main)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}`;
    }

    async function load() {
      const my = ++seq;
      drawHead(); root.classList.add("busy");
      try {
        const body = { period, offset, tz };
        if (profileId) body.profile_id = profileId;
        const j = await opts.call("watch_stats", body);
        if (!alive || my !== seq) return;
        data = j; selKey = null; render();
      } catch (e) {
        if (!alive || my !== seq) return;
        if (e && e.message === "signed_out") return;
        q(".bst-body").innerHTML = `<p class="bst-muted" style="margin-top:16px">${esc(L.failed)} <button type="button" class="bst-clear" style="border-color:var(--bst-line);color:#fff;margin-left:8px">${esc(L.retry)}</button></p>`;
        q(".bst-body button").onclick = load;
      } finally { if (my === seq) root.classList.remove("busy"); drawHead(); }
    }

    function render() {
      const d = data, t = d.totals;
      const body = q(".bst-body");
      if (!d.since) {
        body.innerHTML = `<div class="bst-empty">${icChart}<h3>${esc(L.emptyTitle)}</h3><p>${esc(L.emptyBody)}</p></div>`;
        return;
      }
      const kpi = (k, color, v, s) => `<div class="bst-kpi"><div class="k">${color ? `<i style="background:${color}"></i>` : ""}${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${s}</div></div>`;
      const hm = (m) => `${hours(m)} ${lang === "nl" ? "u" : "h"}`;
      // gemiddelde per dag over de dagen van de periode tot en met vandaag
      const today = new Date(), todayKey = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
      const end = d.to < todayKey ? d.to : todayKey, days = Math.max(1, Math.round((D(end) - D(d.from)) / 864e5) + 1);
      body.innerHTML = `<div class="bst-kpis">
          ${kpi(L.hoursWatched, null, hm(t.minutes), esc(L.perDay.replace("%s", dur(t.minutes / days))))}
          ${kpi(L.movies, COLORS.movie, hm(t.movies.minutes), esc(plural(L.nMovies, t.movies.count)))}
          ${kpi(L.series, COLORS.episode, hm(t.series.minutes), esc(plural(L.nShows, t.series.shows)) + " · " + esc(plural(L.nEps, t.series.episodes)))}
          ${kpi(L.live, COLORS.live, hm(t.live.minutes), esc(plural(L.nChannels, t.live.channels)))}
        </div>
        <div class="bst-card"><div class="bst-head"><h3>${esc(period === "year" ? L.chartTitleYear : L.chartTitle)}</h3>
          <div class="bst-legend"><span><i style="background:${COLORS.movie}"></i>${esc(L.movies)}</span><span><i style="background:${COLORS.episode}"></i>${esc(L.series)}</span><span><i style="background:${COLORS.live}"></i>${esc(L.live)}</span></div></div>
          <div class="bst-chart"></div><div class="bst-tip" aria-live="polite"></div>
          <details class="bst-tbl"><summary>${esc(L.table)}</summary>${table()}</details></div>
        <div class="bst-tops">
          ${topList(L.topSeries, d.top.series, COLORS.episode, (x) => plural(L.nEps, x.episodes))}
          ${topList(L.topMovies, d.top.movies, COLORS.movie)}
          ${topList(L.topChannels, d.top.channels, COLORS.live)}
        </div>
        ${profileBlock()}
        <div class="bst-foot"><span class="bst-msg">${esc(L.since.replace("%s", fmt(d.since, { day: "numeric", month: "long", year: "numeric" })))}</span><button type="button" class="bst-clear">${esc(L.clear)}</button></div>`;
      drawChart();
      body.querySelectorAll("[data-av]").forEach((el) => putAvatar(el, profiles().find((p) => p.id === el.dataset.av)));
      q(".bst-clear").onclick = clear;
      tip(null);
    }
    function bucketLabel(k, long) {
      if (k.length === 7) return fmt(k, long ? { month: "long", year: "numeric" } : { month: "short" });
      return fmt(k, long ? { weekday: "long", day: "numeric", month: "long" } : period === "week" ? { weekday: "short" } : { day: "numeric" });
    }
    function table() {
      const rows = data.by_bucket.filter((b) => b.minutes > 0);
      if (!rows.length) return `<p class="bst-muted">${esc(L.nothing)}</p>`;
      return `<table><thead><tr><th>${esc(period === "year" ? L.monthCol : L.day)}</th><th>${esc(L.movies)}</th><th>${esc(L.series)}</th><th>${esc(L.live)}</th><th>${esc(L.total)}</th></tr></thead><tbody>` +
        rows.map((b) => `<tr><td>${esc(bucketLabel(b.key, true))}</td><td>${esc(dur(b.movie_minutes))}</td><td>${esc(dur(b.episode_minutes))}</td><td>${esc(dur(b.live_minutes))}</td><td>${esc(dur(b.minutes))}</td></tr>`).join("") + "</tbody></table>";
    }
    function topList(title, list, color, extra) {
      const max = Math.max(1, ...list.map((x) => x.minutes));
      return `<div class="bst-card"><h3>${esc(title)}</h3>${list.length ? `<ol class="bst-list">${list.map((x, i) => `<li><span class="n">${i + 1}</span><span class="t" title="${esc(x.title)}">${esc(x.title || "—")}</span><span class="m">${esc(dur(x.minutes))}</span>${extra ? `<span class="x">${esc(extra(x))}</span>` : ""}<span class="b" aria-hidden="true"><i style="width:${Math.max(2, Math.round(x.minutes / max * 100))}%;background:${color}"></i></span></li>`).join("")}</ol>` : `<p class="bst-muted" style="margin:8px 0 6px">${esc(L.none)}</p>`}</div>`;
    }
    function profileBlock() {
      if (profileId != null || fixed || !opts.filter || (data.profiles || []).length < 2) return "";
      const max = Math.max(1, ...data.profiles.map((p) => p.minutes));
      return `<div class="bst-card"><h3>${esc(L.perProfile)}</h3><ol class="bst-list pp">${data.profiles.map((p) => `<li><span class="bst-av" data-av="${esc(p.profile_id || "")}"></span><span class="t">${esc(p.profile_name || L.unknown)}</span><span class="m">${esc(dur(p.minutes))}</span><span class="b" aria-hidden="true"><i style="width:${Math.max(2, Math.round(p.minutes / max * 100))}%;background:#fff"></i></span></li>`).join("")}</ol></div>`;
    }

    // gestapelde staven (films, series, live), schaal in uren, waarde 0 = geen staaf
    function drawChart() {
      const box = q(".bst-chart");
      if (!box) return;
      const W = Math.max(280, Math.round(box.clientWidth || 600)), H = W < 500 ? 170 : 200;
      const padL = 30, padB = 22, padT = 8, iw = W - padL - 4, ih = H - padB - padT;
      const bs = data.by_bucket, n = bs.length;
      const maxH = Math.max(...bs.map((b) => b.minutes)) / 60;
      const step = maxH <= 1 ? 0.25 : maxH <= 2 ? 0.5 : maxH <= 5 ? 1 : maxH <= 10 ? 2 : maxH <= 25 ? 5 : maxH <= 50 ? 10 : Math.ceil(maxH / 5 / 10) * 10;
      const top = Math.max(step, Math.ceil(maxH / step) * step), sy = (h) => padT + ih - (h / top) * ih;
      const slot = iw / n, bw = Math.max(3, Math.min(28, slot * 0.62)), gap = 2;
      let g = "";
      for (let v = 0; v <= top + 1e-9; v += step) {
        const y = sy(v);
        g += `<line x1="${padL}" x2="${W - 4}" y1="${y}" y2="${y}" stroke="${v === 0 ? "#ffffff40" : "#ffffff14"}" stroke-width="1"/>` +
          `<text class="ax" x="${padL - 6}" y="${y + 3.5}" text-anchor="end">${v === 0 ? "0" : top <= 1 ? Math.round(v * 60) + "m" : v.toLocaleString(loc, { maximumFractionDigits: 1 }) + (lang === "nl" ? "u" : "h")}</text>`;
      }
      const every = period === "month" ? (W < 520 ? 5 : 2) : 1;
      bs.forEach((b, i) => {
        const x = padL + slot * i + (slot - bw) / 2, cx = padL + slot * i + slot / 2;
        let y = sy(0), parts = "";
        [["movie_minutes", COLORS.movie], ["episode_minutes", COLORS.episode], ["live_minutes", COLORS.live]].forEach(([k, c]) => {
          const hgt = (b[k] / 60 / top) * ih;
          if (hgt <= 0) return;
          const h2 = Math.max(1, hgt - (parts ? gap : 0));
          parts += `<rect x="${x}" y="${y - hgt}" width="${bw}" height="${h2}" rx="${Math.min(3, bw / 3)}" fill="${c}"/>`;
          y -= hgt;
        });
        const label = (period !== "month" || (every === 2 ? i % 2 === 0 : i === 0 || (i + 1) % every === 0)) ? `<text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(period === "year" && W < 420 ? bucketLabel(b.key).charAt(0).toUpperCase() : bucketLabel(b.key))}</text>` : "";
        g += `<g class="col${b.key === selKey ? " sel" : ""}" data-k="${b.key}"><rect class="hl" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${ih}" fill="transparent"/>${parts}${label}` +
          `<rect class="hit" x="${padL + slot * i}" y="0" width="${slot}" height="${H}"><title>${esc(bucketLabel(b.key, true) + ": " + dur(b.minutes))}</title></rect></g>`;
      });
      const total = data.totals.minutes;
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc((period === "year" ? L.chartTitleYear : L.chartTitle) + ": " + dur(total))}">${g}</svg>`;
      box.querySelectorAll("g.col").forEach((el) => {
        const show = () => { selKey = el.dataset.k; box.querySelectorAll("g.col").forEach((x) => x.classList.toggle("sel", x === el)); tip(selKey); };
        el.addEventListener("mouseenter", show); el.addEventListener("click", show);
      });
      box.onmouseleave = () => { if (matchMedia("(hover:hover)").matches) { selKey = null; box.querySelectorAll("g.col").forEach((x) => x.classList.remove("sel")); tip(null); } };
    }
    function tip(k) {
      const el = q(".bst-tip"); if (!el) return;
      const b = k && data.by_bucket.find((x) => x.key === k);
      if (!b) { el.innerHTML = data.totals.minutes ? esc(L.tapHint) : esc(L.nothing); return; }
      const parts = [[L.movies, b.movie_minutes], [L.series, b.episode_minutes], [L.live, b.live_minutes]].filter((p) => p[1] > 0).map((p) => esc(p[0] + " " + dur(p[1])));
      el.innerHTML = `<b>${esc(bucketLabel(b.key, true))}</b> · ${esc(dur(b.minutes))}${parts.length ? " — " + parts.join(" · ") : ""}`;
    }
    async function clear() {
      const p = profiles().find((x) => x.id === profileId);
      const msg = fixed ? L.clearOwn : profileId ? L.clearOne.replace("%s", p ? p.name : "") : L.clearAll;
      if (!confirm(msg)) return;
      const b = q(".bst-clear"); b.disabled = true;
      try {
        await opts.call("delete_watch_stats", profileId ? { profile_id: profileId } : {});
        await load();
        const m = q(".bst-msg"); if (m) m.textContent = L.cleared;
      } catch (e) { b.disabled = false; const m = q(".bst-msg"); if (m) m.textContent = L.generic; }
    }

    let rw = 0;
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { const w = root.clientWidth; if (data && data.since && Math.abs(w - rw) > 8) { rw = w; drawChart(); } }) : null;
    if (ro) ro.observe(root);
    drawProfiles(); drawHead(); load();
    return {
      reload: load,
      setProfiles(list) { opts.profiles = list; drawProfiles(); },
      destroy() { alive = false; if (ro) ro.disconnect(); },
    };
  }
  return { mount };
})();
