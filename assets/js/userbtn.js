// Poppetje rechtsboven → Mijn Bingr (bingr.online/account).
// Ingelogd: de afbeelding van het hoofdprofiel (eigen foto, figuurtje of icoon met kleur); anders de eerste letter.
(function () {
  var base = (document.currentScript && document.currentScript.dataset.base) || "";
  var CFG = window.BINGR_SUPABASE || { url: "https://vjewsncmsxmhmhnoxwqx.supabase.co", anonKey: "sb_publishable_lpIup6Omq5kW2k3oICGZ4g_HPGac5A3" };
  var SYM = { tv:"📺", globe:"🌐", sportscourt:"⚽", crown:"👑", flame:"🔥", film:"🎬", popcorn:"🍿", star:"⭐", gamecontroller:"🎮", "moon.stars":"🌙", bolt:"⚡", heart:"❤️",
    "waveform.path.ecg":"🎧", hare:"🐰", forward:"🚀", sparkle:"🌈", link:"🔗", "bubble.left":"💬", wifi:"📶", umbrella:"☂️", play:"▶️", "book.closed":"📕", person:"🧸", paintbrush:"🎭" };
  var PAL = [["#E50914","#7A0008"],["#2563EB","#1E1B4B"],["#10B981","#064E3B"],["#F59E0B","#9A3412"],["#A855F7","#3B0764"],["#EC4899","#831843"],["#14B8A6","#0C4A6E"],["#64748B","#0F172A"]];
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function session() {
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/^sb-.*-auth-token$/.test(k)) return JSON.parse(localStorage.getItem(k)); } } catch (e) {}
    return null;
  }
  // tekent de avatar in een element (rond, vult het element)
  // build 94: met DOM-elementen in plaats van innerHTML: emoji, figuurtje en foto komen uit profielgegevens die de
  // gebruiker zelf kan aanpassen, en mogen nooit als HTML gelezen worden
  function img(src) {
    var i = document.createElement("img"); i.src = src; i.alt = "";
    i.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%"; return i;
  }
  function paint(el, email) {
    var c = null; try { c = JSON.parse(ls("bingr.mainAvatar") || "null"); } catch (e) {}
    var letter = (email || "?").charAt(0).toUpperCase();
    var mine = c && typeof c === "object" && c.email === email;
    el.textContent = "";
    if (mine && typeof c.photo === "string" && /^(data:image\/(jpeg|png|webp);base64,|blob:)/.test(c.photo)) { el.appendChild(img(c.photo)); el.style.background = "#222"; return; }
    if (mine && typeof c.sym === "string" && /^kid\d{2}$/.test(c.sym)) { el.appendChild(img(base + "assets/img/" + c.sym + ".png")); el.style.background = grad(c.color); return; }
    if (mine && c.sym) {
      var sp = document.createElement("span"); sp.style.cssText = "font-size:.55em;line-height:1";
      sp.textContent = (typeof c.emoji === "string" && c.emoji.length <= 16 ? c.emoji : "") || SYM[c.sym] || "📺";
      el.appendChild(sp); el.style.background = grad(c.color); return;
    }
    el.textContent = letter; el.style.background = "linear-gradient(135deg,#E50914,#7A0008)";
  }
  function grad(i) { i = parseInt(i, 10) || 0; var p = PAL[(((i || 0) % PAL.length) + PAL.length) % PAL.length]; return "linear-gradient(135deg," + p[0] + "," + p[1] + ")"; }
  // hoofdprofiel ophalen en bewaren (alleen met een geldige sessie)
  function refresh(s, done) {
    if (!s || !s.access_token || (s.expires_at && s.expires_at * 1000 < Date.now())) return;
    var h = { apikey: CFG.anonKey, Authorization: "Bearer " + s.access_token };
    fetch(CFG.url + "/rest/v1/account_data?select=profiles", { headers: h }).then(function (r) { return r.json(); }).then(function (rows) {
      var list = ((rows && rows[0] && rows[0].profiles) || []).filter(function (p) { return p && !p.deleted; });
      var main = list.filter(function (p) { return p.isMain; })[0] || list[0];
      if (!main) return;
      var av = main.avatar || {}, rec = { email: s.user.email, sym: av.symbol || "tv", color: av.colorIndex || 0, emoji: av.emoji && !/^[a-z.]+$/.test(av.emoji) ? av.emoji : null };
      if (main.photo && main.photo.path) {
        var key = main.photo.path + "@" + (main.photo.updated || "");
        var old = null; try { old = JSON.parse(ls("bingr.mainAvatar") || "null"); } catch (e) {}
        if (old && old.key === key && old.photo) { rec.photo = old.photo; rec.key = key; ls("bingr.mainAvatar", JSON.stringify(rec)); done && done(); return; }
        return fetch(CFG.url + "/storage/v1/object/authenticated/avatars/" + main.photo.path, { headers: h }).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
          if (!b) { ls("bingr.mainAvatar", JSON.stringify(rec)); done && done(); return; }
          var img = new Image(); img.onload = function () {
            var cv = document.createElement("canvas"); cv.width = cv.height = 96; var x = cv.getContext("2d"), m = Math.min(img.width, img.height);
            x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, 96, 96);
            rec.photo = cv.toDataURL("image/jpeg", 0.85); rec.key = key; ls("bingr.mainAvatar", JSON.stringify(rec)); done && done();
          }; img.src = URL.createObjectURL(b);
        });
      }
      ls("bingr.mainAvatar", JSON.stringify(rec)); done && done();
    }).catch(function () {});
  }
  window.BingrAvatar = { paint: paint, refresh: refresh, session: session, clear: function () { ls("bingr.mainAvatar", null); } };

  var s = session(), email = s && s.user && s.user.email;
  var nl = (ls("bingr.lang") || navigator.language || "nl").toLowerCase().indexOf("nl") === 0;
  var a = document.createElement("a");
  a.href = base + "account/"; a.className = "userbtn"; a.title = nl ? "Mijn Bingr" : "My Bingr"; a.setAttribute("aria-label", a.title);
  var st = document.createElement("style");
  st.textContent = ".userbtn{display:inline-grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#ffffff1f;color:#fff;text-decoration:none;flex:none;transition:background .2s,transform .2s;overflow:hidden}" +
    ".userbtn:hover{transform:scale(1.06)}.userbtn .ini{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;font-weight:800;font-size:16px}";
  document.head.appendChild(st);
  if (email) {
    var ini = document.createElement("span"); ini.className = "ini"; a.appendChild(ini); paint(ini, email);
    refresh(s, function () { paint(ini, email); });
  } else {
    a.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.3-8 5.2V21h16v-1.8c0-2.9-3.6-5.2-8-5.2Z"/></svg>';
  }
  var slot = document.querySelector("[data-userbtn]");
  if (slot) slot.appendChild(a);
})();
