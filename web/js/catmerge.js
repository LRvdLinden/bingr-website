/*
 * Bingr web, build 172: categorieën slim samenvoegen (pure logica, geen DOM, geen opslag, geen netwerk).
 * Dezelfde regels als Apple (Shared/Providers/Build172.swift) en Android (Build172Logic.kt); vaste testgevallen in
 * docs/merge_cases.json van iptv-ios-appletv (kopie: tools/test/merge_cases.json).
 *
 *   B.catMerge.suggest({groups:[{name,count}], merged:{bron:doel}, renamed:{"group:<naam>":naam}, hidden:[naam],
 *                       ignored:[id]}) → [{id, kind:"brand"|"country"|"prefix", target, targetGroup, groups:[naam],
 *                                          counts:{naam:n}, total, on, renamed:[naam]}]
 *   B.catMerge.apply(custom, groups, targetGroup, name, cleanName) → nieuwe {merged, renamed, groupOrder}
 *   B.catMerge.detach(custom, target, sources|null, brandName?) → nieuwe {merged, renamed, groupOrder}
 *
 * Opslag: precies het bestaande formaat (merged = bron → doelgroep, renamed["group:<doel>"] = doelnaam, groupOrder).
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var M = B.catMerge = {};

  function set(s) { var o = Object.create(null); s.split(' ').forEach(function (w) { if (w) o[w] = true; }); return o; }

  // Merken en diensten (makkelijk uit te breiden). `!` = streng: alleen de hele naam of de naam + soortwoorden.
  var BRANDS = [
    ['netflix', 'Netflix', true, ['netflix']],
    ['disneyplus', 'Disney+', true, ['disney plus']],
    ['hulu', 'Hulu', true, ['hulu']],
    ['primevideo', 'Prime Video', true, ['prime video', 'amazon prime video', 'amazon prime', 'amazon video', 'amazon']],
    ['hbomax', 'HBO Max', true, ['hbo max', 'hbo', '!max']],
    ['appletvplus', 'Apple TV+', true, ['apple tv plus']],
    ['paramountplus', 'Paramount+', true, ['paramount plus']],
    ['peacock', 'Peacock', true, ['peacock']],
    ['videoland', 'Videoland', true, ['videoland']],
    ['viaplay', 'Viaplay', true, ['viaplay']],
    ['skyshowtime', 'SkyShowtime', true, ['skyshowtime']],
    ['nlziet', 'NLZIET', true, ['nlziet']],
    ['npo', 'NPO', true, ['npo start', 'npo plus', 'npo']],
    ['discoveryplus', 'Discovery+', true, ['discovery plus']],
    ['canalplus', 'Canal+', true, ['canal plus']],
    // Sky: wel als merk, maar standaard uit (Sky Sports, Sky Cinema en Sky News blijven vaak bewust apart)
    ['sky', 'Sky', false, ['sky']],
    ['bbciplayer', 'BBC iPlayer', true, ['bbc iplayer']],
    ['itvx', 'ITVX', true, ['itvx']],
    ['crunchyroll', 'Crunchyroll', true, ['crunchyroll']],
    ['starz', 'Starz', true, ['starz']],
    ['showtime', 'Showtime', true, ['showtime']],
    ['amcplus', 'AMC+', true, ['amc plus']],
    ['hallmark', 'Hallmark', true, ['hallmark']],
    ['pathethuis', 'Pathé Thuis', true, ['pathe thuis']],
    ['streamz', 'Streamz', true, ['streamz']],
    ['vtmgo', 'VTM GO', true, ['vtm go']],
    ['rtlplus', 'RTL+', true, ['rtl plus']],
    ['joyn', 'Joyn', true, ['joyn']]
  ];
  M.BRANDS = BRANDS;

  var PIPES = '¦│┃｜‖∣丨┆┇┊┋╎╏︱︳⏐⎮▏▕ǀ׀⼁∥❘❙❚￨';
  // land- en taalcodes die als voorvoegsel/achtervoegsel met scheidingsteken of haken wegvallen
  var CODES = set('nl be uk us en de fr es it tr pl pt ar gb nld dut eng deu ger fra fre ita spa esp tur pol por ara int eu ca au ' +
    'ie se no dk fi ch at in br mx ru gr ro al ma rs hr ba bg hu cz sk si ua il ir pk ph th vn jp kr cn hk za eg sa ae ' +
    'lu is nz lat latam exyu');
  // codes die ook zonder scheidingsteken gelden (vooraan bij het merk zoeken, of als laatste woord)
  var SPACED = set('nl be uk us en de fr es tr pl pt ar gb nld eng deu ger fra ita spa tur pol por ara');
  var CANON = { eng: 'en', gb: 'uk', nld: 'nl', dut: 'nl', deu: 'de', ger: 'de', fra: 'fr', fre: 'fr', ita: 'it', spa: 'es',
    esp: 'es', tur: 'tr', pol: 'pl', por: 'pt', ara: 'ar' };
  var QUALITY = set('4k 8k uhd fhd hd sd hevc h265 h264 x265 x264 60fps 50fps hdr hdr10 fullhd 1080p 720p 2160p');
  var TAGS = set('multi vip vod sub subs dub dubbed subbed');
  var TYPE = set('films film movies movie series serie documentaires documentaire documentaries documentary docs doc kids ' +
    'kinderen anime comedy drama action actie horror thriller romance sci fi scifi collection collectie originals specials ' +
    'nl en dubbed subbed gesproken ondertiteld');
  var SKIP = set('vod films film movies movie series serie tv shows top new nieuw all alle');
  var GENERIC = set('nl uk us en be de movies movie films film series serie kids new nieuw top best 4k vod live tv the het een ' +
    'a all alle hd');
  var LEAD = ' \t|:-–—*•·#~_=»>/.,';
  var OPEN = { '[': ']', '(': ')', '{': '}' }, CLOSE = { ']': '[', ')': '(', '}': '{' };

  function isAZ(c) { return c >= 'a' && c <= 'z'; }
  function isAN(c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); }
  function words(s) {
    var out = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (isAN(c)) cur += c; else if (cur) { out.push(cur); cur = ''; }
    }
    if (cur) out.push(cur);
    return out;
  }
  function tagLike(inner) {
    var w = words(inner);
    if (!w.length) return null;
    for (var i = 0; i < w.length; i++) if (!CODES[w[i]] && !TAGS[w[i]] && !QUALITY[w[i]]) return null;
    for (var j = 0; j < w.length; j++) if (CODES[w[j]]) return CANON[w[j]] || w[j];
    return '';
  }
  function trimLead(s) { var i = 0; while (i < s.length && LEAD.indexOf(s[i]) >= 0) i++; return s.slice(i); }
  function trimTail(s) { var i = s.length; while (i > 0 && LEAD.indexOf(s[i - 1]) >= 0) i--; return s.slice(0, i); }
  function isYear(t) { return t.length === 4 && /^(19|20)[0-9][0-9]$/.test(t); }
  function isDigits(t) { return /^[0-9]+$/.test(t); }

  /** Naam → {tokens, country}. Kleine letters, zonder accenten, pipes als "|", "+" als "plus", land-/taalvoorvoegsels
   *  en -achtervoegsels (met scheidingsteken of haken) en kwaliteitslabels weg. */
  function norm(raw) {
    var s = String(raw == null ? '' : raw), t = '';
    for (var i = 0; i < s.length; i++) t += PIPES.indexOf(s[i]) >= 0 ? '|' : s[i];
    s = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split('+').join(' plus ');
    var country = '';
    function note(c) { if (!country && c) country = c; }
    for (var n = 0; n < 6; n++) {
      s = trimLead(s);
      var c0 = s[0];
      if (OPEN[c0]) {
        var close = s.indexOf(OPEN[c0], 1);
        if (close > 0) {
          var tag = tagLike(s.slice(1, close));
          if (tag != null && trimLead(s.slice(close + 1)).length) { note(tag); s = s.slice(close + 1); continue; }
        }
        break;
      }
      var k = 0;
      while (k < s.length && isAN(s[k])) k++;
      var w = s.slice(0, k), r = k;
      while (r < s.length && s[r] === ' ') r++;
      var sep = s[r];
      if (k >= 2 && (sep === '|' || sep === ':' || sep === '-' || sep === '–' || sep === '—' || sep === ']' || sep === ')')
          && trimLead(s.slice(r + 1)).length) {
        if (k <= 3 && CODES[w] && isAZ(w[0])) { note(CANON[w] || w); s = s.slice(r + 1); continue; }
        if (TAGS[w] || QUALITY[w]) { s = s.slice(r + 1); continue; }
      }
      break;
    }
    for (var m = 0; m < 4; m++) {
      s = trimTail(s);
      var cl = s[s.length - 1];
      if (CLOSE[cl]) {
        var op = s.lastIndexOf(CLOSE[cl], s.length - 2);
        if (op >= 0) {
          var tg = tagLike(s.slice(op + 1, s.length - 1));
          if (tg != null && trimTail(s.slice(0, op)).length) { note(tg); s = s.slice(0, op); continue; }
        }
        break;
      }
      var e = s.length;
      while (e > 0 && isAN(s[e - 1])) e--;
      var tw = s.slice(e), q = e;
      while (q > 0 && s[q - 1] === ' ') q--;
      var sp = s[q - 1];
      if (tw.length >= 2 && (sp === '|' || sp === ':' || sp === '-' || sp === '–' || sp === '—') && trimTail(s.slice(0, q - 1)).length) {
        if (tw.length <= 3 && CODES[tw] && isAZ(tw[0])) { note(CANON[tw] || tw); s = s.slice(0, q - 1); continue; }
        if (TAGS[tw] || QUALITY[tw]) { s = s.slice(0, q - 1); continue; }
      }
      break;
    }
    var tokens = words(s).filter(function (x) { return !QUALITY[x]; });
    if (tokens.length > 1 && SPACED[tokens[tokens.length - 1]]) note(CANON[tokens[tokens.length - 1]] || tokens[tokens.length - 1]);
    return { tokens: tokens, country: country };
  }
  M.norm = norm;

  // aliassen voorbereiden: compact (zonder spaties) en streng
  var ALIASES = [];
  BRANDS.forEach(function (b, bi) {
    b[3].forEach(function (a) {
      var strict = a[0] === '!';
      ALIASES.push({ brand: bi, compact: words(strict ? a.slice(1) : a).join(''), strict: strict });
    });
  });

  function matchFrom(tokens, start) {
    var compact = '', ends = Object.create(null), endIdx = Object.create(null);
    for (var i = start; i < tokens.length; i++) { compact += tokens[i]; ends[compact.length] = true; endIdx[compact.length] = i + 1; }
    var best = null;
    for (var a = 0; a < ALIASES.length; a++) {
      var al = ALIASES[a], L = al.compact.length;
      if (!ends[L] || compact.slice(0, L) !== al.compact) continue;
      if (al.strict) {
        var ok = true;
        for (var j = endIdx[L]; j < tokens.length; j++) if (!TYPE[tokens[j]] && !SPACED[tokens[j]]) { ok = false; break; }
        if (!ok) continue;
      }
      if (!best || L > best.len) best = { brand: al.brand, len: L };
    }
    return best;
  }

  /** Merk van een genormaliseerde naam: index in BRANDS of -1, en het land van een overgeslagen code vooraan. */
  function brandOf(nm) {
    var t = nm.tokens;
    if (!t.length) return { brand: -1, country: '' };
    var hit = matchFrom(t, 0);
    if (hit) return { brand: hit.brand, country: '' };
    var s = 0, c = '';
    while (s < t.length - 1 && (SKIP[t[s]] || SPACED[t[s]])) { if (!c && SPACED[t[s]]) c = CANON[t[s]] || t[s]; s++; }
    if (s > 0) { hit = matchFrom(t, s); if (hit) return { brand: hit.brand, country: c }; }
    return { brand: -1, country: '' };
  }
  M.brandOf = function (raw) { var b = brandOf(norm(raw)); return b.brand < 0 ? null : BRANDS[b.brand][0]; };

  function stemOK(st) {
    if (!st.length || GENERIC[st[0]] || CODES[st[0]]) return false;
    for (var i = 0; i < st.length; i++) if (TYPE[st[i]] || isYear(st[i]) || isDigits(st[i])) return false;
    return true;
  }
  function titleCase(st) {
    return st.map(function (w) {
      if (w.length <= 3 && !/[aeiouy]/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  /** Voorstellen. Alleen het hoofdaccount; per server en per soort (Live TV / Films / Series) apart aanroepen. */
  M.suggest = function (input) {
    var groups = input.groups || [], merged = input.merged || {}, renamed = input.renamed || {};
    var hidden = Object.create(null), ignored = Object.create(null);
    (input.hidden || []).forEach(function (g) { hidden[g] = true; });
    (input.ignored || []).forEach(function (g) { ignored[g] = true; });
    var countOf = Object.create(null), isTarget = Object.create(null);
    groups.forEach(function (g) { countOf[g.name] = (countOf[g.name] || 0) + (g.count || 0); });
    var extra = Object.create(null);
    Object.keys(merged).forEach(function (src) {
      var tgt = merged[src];
      if (tgt == null || tgt === src) return;
      isTarget[tgt] = true;
      extra[tgt] = (extra[tgt] || 0) + (countOf[src] || 0);
    });
    // geschikte groepen in volgorde, elke naam één keer
    var list = [], seen = Object.create(null);
    groups.forEach(function (g) {
      var n = g.name;
      if (seen[n] || hidden[n] || (merged[n] != null && merged[n] !== n)) return;
      seen[n] = true;
      var nm = norm(n);
      if (!nm.tokens.length) return;
      list.push({ name: n, idx: list.length, nm: nm, count: (countOf[n] || 0) + (extra[n] || 0) });
    });
    var out = [], claimed = Object.create(null);
    function make(kind, id, target, gs, on, order) {
      var tg = gs[0].name;
      if (kind !== 'country') for (var i = 0; i < gs.length; i++) if (isTarget[gs[i].name]) { tg = gs[i].name; break; }
      var counts = {}, total = 0, ren = [];
      gs.forEach(function (g) {
        counts[g.name] = g.count; total += g.count;
        if (renamed['group:' + g.name] != null) ren.push(g.name);
      });
      return { id: id, kind: kind, target: target, targetGroup: tg, groups: gs.map(function (g) { return g.name; }),
        counts: counts, total: total, on: on, renamed: ren, _order: order };
    }
    // 1. merken
    var byBrand = Object.create(null), brandOrder = [];
    list.forEach(function (g) {
      var b = brandOf(g.nm);
      if (b.brand < 0) return;
      g.country = g.nm.country || b.country;
      if (!byBrand[b.brand]) { byBrand[b.brand] = []; brandOrder.push(b.brand); }
      byBrand[b.brand].push(g);
    });
    brandOrder.forEach(function (bi) {
      var gs = byBrand[bi], br = BRANDS[bi];
      if (gs.length < 2) return;
      gs.forEach(function (g) { claimed[g.name] = true; });
      var countries = [], per = Object.create(null);
      gs.forEach(function (g) { if (g.country) { if (!per[g.country]) { per[g.country] = 0; countries.push(g.country); } per[g.country]++; } });
      var sugg = [];
      if (countries.length <= 1) {
        sugg.push(make('brand', 'brand:' + br[0], br[1], gs, br[2], [gs[0].idx, 0]));
      } else {
        var dom = countries[0];
        countries.forEach(function (c) { if (per[c] > per[dom]) dom = c; });
        var main = gs.filter(function (g) { return !g.country || g.country === dom; });
        var rest = gs.filter(function (g) { return g.country && g.country !== dom; });
        if (main.length >= 2) {
          var ms = make('brand', 'brand:' + br[0], br[1], main, br[2], [main[0].idx, 0]);
          sugg.push(ms);
          var head = main.filter(function (g) { return g.name === ms.targetGroup; });
          sugg.push(make('country', 'country:' + br[0], br[1], head.concat(rest), false, [main[0].idx, 1]));
        } else {
          sugg.push(make('country', 'country:' + br[0], br[1], main.concat(rest), false, [gs[0].idx, 1]));
        }
      }
      sugg.forEach(function (s) { if (!ignored[s.id]) out.push(s); });
    });
    // 2. zelfde begin
    var buckets = Object.create(null), bucketList = [];
    list.forEach(function (g) {
      if (claimed[g.name]) return;
      var t = g.nm.tokens, cands = [];
      for (var k = 2; k >= 1; k--) if (t.length > k && TYPE[t[k]] && stemOK(t.slice(0, k))) cands.push({ st: t.slice(0, k), cont: true });
      if (t.length <= 2 && stemOK(t)) cands.push({ st: t, cont: false });
      cands.forEach(function (c) {
        var key = c.st.join(' ');
        var b = buckets[key];
        if (!b) { b = buckets[key] = { key: key, st: c.st, first: g.idx, items: [] }; bucketList.push(b); }
        if (!b.items.some(function (x) { return x.g === g; })) b.items.push({ g: g, cont: c.cont });
      });
    });
    bucketList.sort(function (a, b) { return (b.st.length - a.st.length) || (a.first - b.first); });
    var used = Object.create(null);
    bucketList.forEach(function (b) {
      var items = b.items.filter(function (x) { return !used[x.g.name]; });
      if (items.length < 2 || !items.some(function (x) { return x.cont; })) return;
      items.sort(function (x, y) { return x.g.idx - y.g.idx; });
      items.forEach(function (x) { used[x.g.name] = true; });
      var id = 'prefix:' + b.st.join('-');
      if (ignored[id]) return;
      var gs = items.map(function (x) { return x.g; });
      out.push(make('prefix', id, titleCase(b.st), gs, false, [gs[0].idx, 2]));
    });
    out.sort(function (a, b) { return (a._order[0] - b._order[0]) || (a._order[1] - b._order[1]); });
    out.forEach(function (s) { delete s._order; });
    return out;
  };

  function copy(c) {
    return { merged: Object.assign({}, (c && c.merged) || {}), renamed: Object.assign({}, (c && c.renamed) || {}),
      groupOrder: ((c && c.groupOrder) || []).slice() };
  }

  /** Samenvoegen in het bestaande formaat. `groups`: de aangevinkte groepen (volgorde van de lijst); doel = `targetGroup`
   *  als die aangevinkt is, anders de eerste. `cleanName`: hoe het doel zonder eigen naam heet (opgeschoond). */
  M.apply = function (custom, groups, targetGroup, name, cleanName) {
    var c = copy(custom);
    if (!groups || groups.length < 2) return c;
    var target = groups.indexOf(targetGroup) >= 0 ? targetGroup : groups[0];
    groups.forEach(function (g) {
      if (g === target) return;
      c.merged[g] = target;
      Object.keys(c.merged).forEach(function (x) { if (c.merged[x] === g) c.merged[x] = target; });
    });
    delete c.merged[target];
    var nm = String(name == null ? '' : name).trim(), key = 'group:' + target;
    if (nm && nm !== cleanName) c.renamed[key] = nm;
    else if (nm && nm === cleanName) delete c.renamed[key];
    if (c.groupOrder.length) {
      var pos = -1;
      groups.forEach(function (g) { var i = c.groupOrder.indexOf(g); if (i >= 0 && (pos < 0 || i < pos)) pos = i; });
      if (pos >= 0) {
        var ti = c.groupOrder.indexOf(target);
        if (ti !== pos) {
          if (ti >= 0) c.groupOrder.splice(ti, 1);
          c.groupOrder.splice(ti >= 0 && ti < pos ? pos - 1 : pos, 0, target);
        }
      }
    }
    return c;
  };

  /** Losmaken: `sources` = null → alle bronnen van `target`. Is er daarna geen bron meer en is de eigen naam van het
   *  doel een merknaam of `madeName` (door het opschonen gezet), dan gaat die eigen naam ook weg. */
  M.detach = function (custom, target, sources, madeName) {
    var c = copy(custom);
    Object.keys(c.merged).forEach(function (s) {
      if (c.merged[s] === target && (!sources || sources.indexOf(s) >= 0)) delete c.merged[s];
    });
    var left = Object.keys(c.merged).some(function (s) { return c.merged[s] === target; });
    var key = 'group:' + target, r = c.renamed[key];
    if (!left && r != null && (r === madeName || BRANDS.some(function (b) { return b[1] === r; }))) delete c.renamed[key];
    return c;
  };

  /** Doelgroepen met hun bronnen (voor "Samengevoegd"), in volgorde van `order` (de groepen van de server). */
  M.mergedTargets = function (merged, order) {
    var by = Object.create(null), keys = [];
    Object.keys(merged || {}).forEach(function (s) {
      var t = merged[s]; if (t == null || t === s) return;
      if (!by[t]) { by[t] = []; keys.push(t); }
      by[t].push(s);
    });
    var pos = Object.create(null);
    (order || []).forEach(function (g, i) { if (pos[g] == null) pos[g] = i; });
    function p(g) { return pos[g] == null ? 1e9 : pos[g]; }
    keys.sort(function (a, b) { return p(a) - p(b) || (a < b ? -1 : a > b ? 1 : 0); });
    return keys.map(function (t) { return { target: t, sources: by[t].sort(function (a, b) { return p(a) - p(b) || (a < b ? -1 : a > b ? 1 : 0); }) }; });
  };

  /** "12 categorieën worden 3": aantal unieke groepen en aantal unieke doelgroepen van de gekozen voorstellen. */
  M.summary = function (picks) {
    var all = Object.create(null), tg = Object.create(null), n = 0, t = 0;
    picks.forEach(function (p) {
      p.groups.forEach(function (g) { if (!all[g]) { all[g] = true; n++; } });
      if (!tg[p.targetGroup]) { tg[p.targetGroup] = true; t++; }
    });
    return { from: n, to: t };
  };
})(typeof window !== 'undefined' ? window : globalThis);
