"""SEO-audit van bingr.online met de DataForSEO-API (workflow SEO-audit).
Inlog via de omgeving: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (GitHub-secrets, nooit loggen).
Schrijft seo-report/report.md (samenvatting) en seo-report/*.json (ruwe antwoorden) weg.
Alleen openbare gegevens over de eigen site; geen gebruikersgegevens."""
import base64, json, os, sys, time, urllib.request, pathlib

API = "https://api.dataforseo.com/v3/"
TARGET = os.environ.get("SEO_TARGET", "bingr.online")
OUT = pathlib.Path("seo-report"); OUT.mkdir(exist_ok=True)
auth = base64.b64encode(f"{os.environ['DATAFORSEO_LOGIN']}:{os.environ['DATAFORSEO_PASSWORD']}".encode()).decode()

def call(path, body=None):
    req = urllib.request.Request(API + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Basic " + auth, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    if d.get("status_code") != 20000:
        raise SystemExit(f"API-fout {path}: {d.get('status_code')} {d.get('status_message')}")
    global spent
    spent += d.get("cost") or 0
    t = (d.get("tasks") or [{}])[0]
    if t.get("status_code") not in (20000, 20100):
        print(f"::warning::{path}: {t.get('status_code')} {t.get('status_message')}")
    return t

def save(name, obj):
    (OUT / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False, indent=1))

def res(t):
    r = t.get("result") or []
    return r[0] if r else {}

spent = 0.0
def main():
    global spent
    cost = 0.0
    spent = 0.0
    # 1. on-page crawl
    # zonder JavaScript/browserweergave: de site is gewone HTML, en dat is vele malen goedkoper
    t = call("on_page/task_post", [{"target": TARGET, "max_crawl_pages": int(os.environ.get("SEO_MAX_PAGES", "120")),
                                     "load_resources": True, "store_raw_html": False, "check_spell": False}])
    if t.get("status_code") != 20100:
        raise SystemExit(f"on-page taak niet gestart: {t.get('status_code')} {t.get('status_message')}")
    cost += t.get("cost") or 0
    tid = t["id"]
    print("::notice::on-page taak gestart")
    summary = {}
    for _ in range(120):
        time.sleep(20)
        s = call(f"on_page/summary/{tid}")
        if s.get("status_code") == 40401:
            continue  # taak nog niet zichtbaar
        summary = res(s)
        if summary.get("crawl_progress") == "finished":
            break
    save("summary", summary)
    pages = res(call("on_page/pages", [{"id": tid, "limit": 300}]))
    save("pages", pages)
    nonidx = res(call("on_page/non_indexable", [{"id": tid, "limit": 300}]))
    save("non_indexable", nonidx)
    dup_title = res(call("on_page/duplicate_tags", [{"id": tid, "type": "duplicate_title", "limit": 100}]))
    dup_desc = res(call("on_page/duplicate_tags", [{"id": tid, "type": "duplicate_description", "limit": 100}]))
    save("duplicate_tags", {"title": dup_title, "description": dup_desc})
    broken_links = res(call("on_page/links", [{"id": tid, "filters": [["is_broken", "=", True]], "limit": 200}]))
    save("broken_links", broken_links)
    broken_res = res(call("on_page/resources", [{"id": tid, "filters": [["status_code", ">=", 400]], "limit": 200}]))
    save("broken_resources", broken_res)

    # 2. Lighthouse (mobiel en desktop) voor de belangrijkste pagina's
    lh = {}
    for url in [f"https://{TARGET}/", f"https://{TARGET}/web/"]:
        for mobile in (True, False):
            if url.endswith("/web/") and not mobile:
                continue
            try:
                r = res(call("on_page/lighthouse/live/json", [{"url": url, "for_mobile": mobile}]))
                cats = {k: round((v or {}).get("score", 0) * 100) for k, v in (r.get("categories") or {}).items()}
                fails = sorted([(a.get("title"), a.get("score")) for a in (r.get("audits") or {}).values()
                                if isinstance(a, dict) and a.get("score") is not None and a.get("score") < 0.9
                                and a.get("scoreDisplayMode") in ("binary", "numeric")], key=lambda x: x[1])[:25]
                lh[f"{url} {'mobiel' if mobile else 'desktop'}"] = {"scores": cats, "fails": fails}
            except SystemExit as e:
                lh[f"{url} {'mobiel' if mobile else 'desktop'}"] = {"error": str(e)}
    save("lighthouse", lh)

    # 3. zoekwoorden (Nederland, Nederlands) en of bingr.online al gevonden wordt
    seeds = ["iptv speler", "iptv app", "iptv apple tv", "iptv samsung tv", "m3u speler", "xtream codes app", "iptv player"]
    ideas = res(call("dataforseo_labs/google/keyword_ideas/live", [{"keywords": seeds, "location_code": 2528, "language_code": "nl",
                                                                     "limit": 150, "order_by": ["keyword_info.search_volume,desc"]}]))
    save("keyword_ideas", ideas)
    ranked = res(call("dataforseo_labs/google/ranked_keywords/live", [{"target": TARGET, "location_code": 2528, "language_code": "nl", "limit": 100}]))
    save("ranked_keywords", ranked)
    serp = {}
    for q in ["bingr", "bingr iptv", "bingr app"]:
        r = res(call("serp/google/organic/live/regular", [{"keyword": q, "location_code": 2528, "language_code": "nl", "depth": 20}]))
        serp[q] = [(i.get("rank_absolute"), i.get("domain"), i.get("title")) for i in (r.get("items") or []) if i.get("type") == "organic"][:20]
    save("serp", serp)

    # 4. samenvatting
    L = [f"# SEO-audit {TARGET}", "", f"Crawl: {summary.get('crawl_progress')} · pagina's: {(summary.get('crawl_status') or {}).get('pages_crawled')}", ""]
    di = summary.get("domain_info") or {}
    L += ["## Domein", f"- SSL: {(di.get('ssl_info') or {}).get('valid_certificate')} · sitemap: {(di.get('checks') or {}).get('sitemap')} · robots.txt: {(di.get('checks') or {}).get('robots_txt')}", ""]
    pm = summary.get("page_metrics") or {}
    L += ["## Controles (aantal pagina's met probleem)", f"- onpage-score: {pm.get('onpage_score')}", f"- kapotte links: {pm.get('broken_links')} · kapotte bronnen: {pm.get('broken_resources')}",
          f"- dubbele titels: {pm.get('duplicate_title')} · dubbele omschrijvingen: {pm.get('duplicate_description')} · dubbele inhoud: {pm.get('duplicate_content')}", f"- niet indexeerbaar: {pm.get('non_indexable')}"]
    for k, v in sorted((pm.get("checks") or {}).items(), key=lambda kv: -kv[1]):
        if v:
            L.append(f"  - {k}: {v}")
    L += ["", "## Pagina's"]
    for p in (pages.get("items") or []):
        meta = p.get("meta") or {}
        bad = [k for k, v in (p.get("checks") or {}).items() if v is True and k.startswith(("no_", "is_", "has_", "high_", "low_", "large_", "small_", "duplicate", "title_too", "irrelevant", "deprecated", "seo_friendly_url")) and k not in ("is_https", "is_www", "has_html_doctype", "seo_friendly_url", "has_meta_title")]
        L.append(f"- {p.get('url')} [{p.get('status_code')}] score {p.get('onpage_score')} · title {len(meta.get('title') or '')} tekens · descr {len(meta.get('description') or '')} · h1 {len((meta.get('htags') or {}).get('h1') or [])} · {', '.join(bad[:12])}")
    L += ["", "## Niet indexeerbaar"] + [f"- {i.get('url')} ({i.get('reason')})" for i in (nonidx.get("items") or [])]
    L += ["", "## Kapotte links"] + [f"- {i.get('link_from')} → {i.get('link_to')} ({i.get('page_to_status_code')})" for i in (broken_links.get("items") or [])]
    L += ["", "## Kapotte bronnen"] + [f"- {i.get('url')} ({i.get('status_code')})" for i in (broken_res.get("items") or [])]
    L += ["", "## Lighthouse"]
    for k, v in lh.items():
        L.append(f"- {k}: {v.get('scores') or v.get('error')}")
        for f in v.get("fails") or []:
            L.append(f"  - {f[0]} ({f[1]})")
    L += ["", "## Wordt bingr.online gevonden (Google NL)"]
    for q, items in serp.items():
        pos = [r for r, d, _ in items if d and TARGET in d]
        L.append(f"- '{q}': {'positie ' + str(pos[0]) if pos else 'niet in top 20'}")
    L += ["", f"## Zoekwoorden waarop bingr.online al rankt: {ranked.get('total_count', 0)}"]
    L += ["", "## Zoekwoordideeën NL (volume/maand · concurrentie)"]
    for i in (ideas.get("items") or [])[:80]:
        ki = i.get("keyword_info") or {}
        L.append(f"- {i.get('keyword')}: {ki.get('search_volume')} · {ki.get('competition_level')}")
    (OUT / "report.md").write_text("\n".join(L) + "\n")
    print(f"::notice::rapport klaar (kosten DataForSEO: ${spent:.3f})")


if __name__ == "__main__":
    import traceback
    try:
        main()
    except SystemExit as e:
        print(f"::error::{e}"); raise
    except Exception as e:
        tb = traceback.extract_tb(e.__traceback__)[-1]
        print(f"::error::{type(e).__name__} op regel {tb.lineno}: {str(e)[:300]}"); raise SystemExit(1)
