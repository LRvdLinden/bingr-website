// Uitlegpagina's van bingr.online (iptv-app/, m3u-xtream-toevoegen/, vergelijking/).
// Na assets/js/site.js laden. De JSON-LD in de HTML is Nederlands; in het Engels bouwt dit script hem opnieuw op uit de
// zichtbare Engelse tekst (FAQ uit .faq details, HowTo uit ol.g-steps, kruimelpad uit .crumbs; dezelfde regels waarmee
// de Nederlandse JSON-LD uit de Nederlandse tekst is gemaakt), zodat de structured data gelijk is aan wat je ziet.
(function () {
  var lang = (window.BingrSite && window.BingrSite.lang) || "nl";
  if (lang !== "en") return;
  var box = document.querySelector('[data-l="en"]');
  if (!box) return;
  var txt = function (el) { return (el && el.textContent || "").replace(/\s+/g, " ").trim(); };
  function put(id, obj) { var s = document.getElementById(id); if (s) s.textContent = JSON.stringify(obj); }
  function read(id) { try { return JSON.parse(document.getElementById(id).textContent); } catch (e) { return null; } }
  var url = (document.querySelector('link[rel="alternate"][hreflang="en"]') || {}).href || location.href;

  var faq = read("ld-faq");
  if (faq) {
    faq.inLanguage = "en"; faq.url = url;
    faq.mainEntity = [].map.call(box.querySelectorAll(".faq details"), function (d) {
      return { "@type": "Question", name: txt(d.querySelector("summary")), acceptedAnswer: { "@type": "Answer", text: txt(d.querySelector(".a")) } };
    });
    put("ld-faq", faq);
  }
  var how = read("ld-howto");
  if (how) {
    var h = box.querySelector("[data-howto]");
    how.inLanguage = "en"; how.url = url;
    if (h) { how.name = h.getAttribute("data-howto"); }
    how.step = [].map.call(box.querySelectorAll("ol.g-steps > li"), function (li, i) {
      return { "@type": "HowToStep", position: i + 1, name: txt(li.querySelector("h3")), text: txt(li.querySelector("p")) };
    });
    put("ld-howto", how);
  }
  var bc = read("ld-crumbs");
  if (bc) {
    var a = box.querySelectorAll(".crumbs a, .crumbs [aria-current]");
    bc.itemListElement = [].map.call(a, function (el, i) {
      return { "@type": "ListItem", position: i + 1, name: txt(el), item: i === a.length - 1 ? url : el.href + (el.href.indexOf("?") < 0 ? "?lang=en" : "") };
    });
    put("ld-crumbs", bc);
  }
})();
