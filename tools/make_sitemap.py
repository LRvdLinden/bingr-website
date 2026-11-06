"""Maakt sitemap.xml van bingr.online opnieuw.

Alleen publieke, indexeerbare pagina's. Per pagina twee URL's: de schone URL (Nederlands, ook x-default) en ?lang=en,
met dezelfde hreflang-set als in de <head>. <lastmod> is de datum van de laatste commit die de pagina (of de data
waar hij op draait) echt veranderde; commits waarvan het bericht met "SEO:" begint (alleen meta-tags) tellen niet mee.
Geen <priority>/<changefreq>: Google negeert die.

Gebruik:  python3 tools/make_sitemap.py           (schrijft sitemap.xml)
          python3 tools/make_sitemap.py --check   (faalt als sitemap.xml niet klopt met de pagina's hieronder)
"""
import pathlib, re, subprocess, sys
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = "https://bingr.online/"
# pad op de site -> bronbestanden die de inhoud bepalen
PAGES = [
    ("", ["index.html", "assets/css/plans.css", "assets/js/plans.js"]),
    ("iptv-app/", ["iptv-app/index.html"]),
    ("m3u-xtream-toevoegen/", ["m3u-xtream-toevoegen/index.html"]),
    ("vergelijking/", ["vergelijking/index.html"]),
    ("changelog/", ["changelog/index.html", "assets/changelog.json"]),
    ("status/", ["status/index.html"]),
    ("status/history/", ["status/history/index.html"]),
    ("upgrade/", ["upgrade/index.html", "assets/js/plans.js"]),
    ("privacy.html", ["privacy.html"]),
    ("voorwaarden/", ["voorwaarden/index.html"]),
]


def lastmod(files):
    dates = []
    for f in files:
        if not (ROOT / f).exists():
            raise SystemExit(f"bestand ontbreekt: {f}")
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--invert-grep", "--grep=^SEO:", "--", f],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        if out:
            dates.append(out)
    return max(dates) if dates else None


def noindex(path):
    f = ROOT / (path + "index.html" if path == "" or path.endswith("/") else path)
    return re.search(r'<meta name="robots" content="[^"]*noindex', f.read_text(encoding="utf-8")) is not None


def build():
    L = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<!-- Gemaakt door tools/make_sitemap.py; niet met de hand wijzigen. Alleen publieke, indexeerbare pagina\'s:',
         '     per pagina de schone URL (Nederlands, ook x-default) en ?lang=en. Niet: account/, koppelen/, bevestigen/,',
         '     reset/, unsubscribe/, tv/, trailer/, status/incident/ (noindex) en web/ (de webspeler, een app achter een login). -->',
         '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for path, files in PAGES:
        if noindex(path):
            raise SystemExit(f"{path or '/'} heeft noindex en hoort niet in de sitemap")
        nl, en = BASE + path, BASE + path + "?lang=en"
        mod = lastmod(files)
        for loc in (nl, en):
            L.append("  <url>")
            L.append(f"    <loc>{escape(loc)}</loc>")
            if mod:
                L.append(f"    <lastmod>{mod}</lastmod>")
            for lang, href in (("nl", nl), ("en", en), ("x-default", nl)):
                L.append(f'    <xhtml:link rel="alternate" hreflang="{lang}" href="{escape(href)}"/>')
            L.append("  </url>")
    L.append("</urlset>")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    xml = build()
    target = ROOT / "sitemap.xml"
    if "--check" in sys.argv:
        if target.read_text(encoding="utf-8") != xml:
            raise SystemExit("sitemap.xml is niet bijgewerkt: draai python3 tools/make_sitemap.py")
        print("sitemap.xml klopt")
    else:
        target.write_text(xml, encoding="utf-8")
        print(f"sitemap.xml geschreven ({len(PAGES) * 2} URL's)")
