// Taalkeuze zoals op bingr.online (localStorage bingr.lang, anders de taal van de browser) en de download direct starten.
(function () {
  var lang = "nl";
  try { lang = localStorage.getItem("bingr.lang") || ""; } catch (e) {}
  if (!lang) lang = (navigator.language || "nl").slice(0, 2);
  lang = lang === "nl" ? "nl" : "en";
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-l]").forEach(function (el) { el.hidden = el.getAttribute("data-l") !== lang; });
  setTimeout(function () { location.replace("https://beheer.bingr.online/dl.php?app=android"); }, 50);
})();
