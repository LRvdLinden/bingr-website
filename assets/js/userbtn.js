// Poppetje rechtsboven: naar Mijn Bingr (bingr.online/account). Ingelogd = rode cirkel met de eerste letter.
(function () {
  var base = (document.currentScript && document.currentScript.dataset.base) || "";
  var email = null;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (/^sb-.*-auth-token$/.test(k)) { var s = JSON.parse(localStorage.getItem(k)); email = s && s.user && s.user.email; }
    }
  } catch (e) {}
  var nl = ((function () { try { return localStorage.getItem("bingr.lang"); } catch (e) { return null; } })() || navigator.language || "nl").toLowerCase().indexOf("nl") === 0;
  var a = document.createElement("a");
  a.href = base + "account/";
  a.className = "userbtn";
  a.title = nl ? "Mijn Bingr" : "My Bingr";
  a.setAttribute("aria-label", a.title);
  a.innerHTML = email
    ? '<span class="ini">' + email.charAt(0).toUpperCase() + "</span>"
    : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.3-8 5.2V21h16v-1.8c0-2.9-3.6-5.2-8-5.2Z"/></svg>';
  var st = document.createElement("style");
  st.textContent = ".userbtn{display:inline-grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#ffffff1f;color:#fff;text-decoration:none;flex:none;transition:background .2s,transform .2s}" +
    ".userbtn:hover{background:#ffffff33;transform:scale(1.06)}.userbtn .ini{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;background:linear-gradient(135deg,#E50914,#7A0008);font-weight:800;font-size:16px}";
  document.head.appendChild(st);
  var slot = document.querySelector("[data-userbtn]");
  if (slot) slot.appendChild(a);
})();
