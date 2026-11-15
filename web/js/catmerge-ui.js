/*
 * Bingr web, build 172: Instellingen > Servers > "Categorieën opschonen" (route #/cleanup). Zoekt in de browser naar
 * categorieën die bij elkaar horen (web/js/catmerge.js) en voegt ze pas samen na akkoord, in het bestaande formaat van
 * het android-blok van de server (customization.merged / renamed / groupOrder; de webspeler volgt dat blok).
 * Overgeslagen voorstellen: android.ignoredMergeSuggestions (oudere apps laten die sleutel staan). Alleen het hoofdprofiel.
 */
(function () {
  'use strict';
  var B = window.B, S = B.screens, U = B.ui, D = B.data, L = B.L, h = U.h, M = B.catMerge, Lib = B.lib;
  var KEY = 'ignoredMergeSuggestions';
  var SECTIONS = [['live', 'Live TV'], ['movie', 'Movies'], ['series', 'Series']];
  var madeKey = 'cleanup172.made';

  function made() { var m = B.store.get(madeKey, null); return m && typeof m === 'object' ? m : {}; }
  function setMade(sid, target, name) {
    var m = made(), k = String(sid).toLowerCase() + '|' + target;
    if (name) m[k] = name; else delete m[k];
    B.store.set(madeKey, m);
  }

  function groupCounts(section) {
    var raw = Lib.raw || {}, arr = section === 'live' ? raw.channels : section === 'movie' ? raw.movies : raw.series;
    var counts = Object.create(null), order = [];
    (arr || []).forEach(function (x) {
      var g = x.group == null ? '' : String(x.group);
      if (!(g in counts)) { counts[g] = 0; order.push(g); }
      counts[g]++;
    });
    return order.map(function (g) { return { name: g, count: counts[g] }; });
  }

  S.navOwner = S.navOwner || {};
  S.navOwner.cleanup = 'mybingr';

  S.pages.cleanup = function () {
    var src = Lib.source;
    var back = h('a.st-back', { href: '#/settings/servers' }, [U.icon('chevron', 'st-back-ic'), L('Settings')]);
    var list = h('div.st-list');
    var el = h('div.page.settings.cleanup-page', [h('div.page-head', [back, h('h1', L('Clean up categories'))]), list]);
    var pg = { el: el, title: L('Clean up categories') };
    var section = 'movie', suggestions = [], searched = false, searching = false;
    var picked = {}, unchecked = {}, names = {}, undo = null, gen = 0;

    function custom() { return D.customization(Lib.source); }
    function nameOf(s) { return names[s.id] != null ? names[s.id] : s.target; }
    function checkedOf(s) { return s.groups.filter(function (g) { return !unchecked[s.id + '|' + g]; }); }
    function isPicked(s) { return picked[s.id] != null ? picked[s.id] : s.on; }
    function pickedList() { return suggestions.filter(function (s) { return isPicked(s) && checkedOf(s).length >= 2; }); }
    function countText(n) { return section === 'live' ? L('%d channels', n) : L('%d titles', n); }
    function display(g) { var c = custom(); return (c.renamed && c.renamed['group:' + g]) || B.catName(g) || g; }
    function ignoredFor(s) {
      var a = (Lib.source && Lib.source.android) || {}, list0 = Array.isArray(a[KEY]) ? a[KEY] : [], p = section + '|';
      return list0.filter(function (k) { return typeof k === 'string' && k.indexOf(p) === 0; }).map(function (k) { return k.slice(p.length); });
    }

    function search() {
      src = Lib.source;
      if (!src) { suggestions = []; searched = true; draw(); return; }
      var my = ++gen;
      searching = true; draw();
      setTimeout(function () {
        if (my !== gen) return;
        var c = custom(), ctx = Lib.contextFor ? Lib.contextFor(src) : {};
        var hc = ctx.hiddenCats || {}, hidden = Object.keys(hc).filter(function (k) { return hc[k]; });
        suggestions = M.suggest({ groups: groupCounts(section), merged: c.merged, renamed: c.renamed, hidden: hidden, ignored: ignoredFor() });
        picked = {}; unchecked = {}; names = {};
        searching = false; searched = true;
        draw();
      }, 30);
    }

    function save(fn) {
      if (!Lib.source) return Promise.resolve();
      return D.updateAndroidBlock(Lib.source.id, fn).then(function () {
        if (Lib.applyFilters) Lib.applyFilters(true);
      }, function (e) { U.toast((e && e.message) || L('No internet connection.')); throw e; });
    }
    function withCustom(fn) {
      return save(function (a) {
        var c = B.assign({}, a.customization || {});
        var r = fn({ merged: c.merged || {}, renamed: c.renamed || {}, groupOrder: c.groupOrder || [] });
        c.merged = r.merged; c.renamed = r.renamed; if (r.groupOrder) c.groupOrder = r.groupOrder;
        a.customization = c;
        return a;
      });
    }

    function apply(picks) {
      var before = JSON.parse(JSON.stringify((Lib.source && Lib.source.android && Lib.source.android.customization) || {}));
      var live = section === 'live', done = {}, made0 = [];
      var p = withCustom(function (c) {
        var cur = { merged: c.merged, renamed: c.renamed, groupOrder: live ? c.groupOrder : [] };
        picks.forEach(function (s) {
          var gs = checkedOf(s);
          if (gs.length < 2) return;
          var target = gs.indexOf(s.targetGroup) >= 0 ? s.targetGroup : gs[0];
          var nm = String(nameOf(s)).trim(), clean = B.catName(target) || target;
          cur = M.apply(cur, gs, target, nm, clean);
          made0.push([target, nm && nm !== clean ? nm : null]);
          done[s.id] = true;
        });
        return { merged: cur.merged, renamed: cur.renamed, groupOrder: live ? cur.groupOrder : c.groupOrder };
      });
      p.then(function () {
        var sid = Lib.source && Lib.source.id;
        made0.forEach(function (x) { setMade(sid, x[0], x[1]); });
        suggestions = suggestions.filter(function (s) { return !done[s.id]; });
        var token = {};
        undo = { before: before, token: token };
        setTimeout(function () { if (undo && undo.token === token) { undo = null; draw(); } }, 10000);
        draw();
      }, B.noop);
    }

    function restore() {
      if (!undo) return;
      var before = undo.before;
      undo = null;
      save(function (a) { a.customization = before; return a; }).then(search, B.noop);
    }

    function setIgnored(fn) {
      return save(function (a) {
        var list0 = Array.isArray(a[KEY]) ? a[KEY].slice() : [];
        var next = fn(list0).filter(function (x, i, arr) { return arr.indexOf(x) === i; }).sort();
        if (next.length) a[KEY] = next; else delete a[KEY];
        return a;
      });
    }
    function skip(s) {
      suggestions = suggestions.filter(function (x) { return x.id !== s.id; });
      draw();
      setIgnored(function (l) { return l.concat([section + '|' + s.id]); }).catch(B.noop);
    }
    function searchAgain() {
      var p = section + '|';
      setIgnored(function (l) { return l.filter(function (k) { return k.indexOf(p) !== 0; }); }).then(search, search);
    }

    function detach(target, sources) {
      var sid = Lib.source && Lib.source.id, mn = made()[String(sid).toLowerCase() + '|' + target] || null;
      withCustom(function (c) { return M.detach(c, target, sources, mn); }).then(function () {
        var still = Object.keys(custom().merged || {}).some(function (k) { return custom().merged[k] === target; });
        if (!still) setMade(sid, target, null);
        draw();
      }, B.noop);
    }

    function rename(s) {
      var input = h('input.cleanup-input', { type: 'text', 'aria-label': L('Change target name') });
      input.value = nameOf(s);
      var dlg = U.modal({ title: L('Change target name'), body: h('div', [input, h('p.muted.small', L('Leave empty to restore the original name.'))]), buttons: [
        { label: L('Save'), primary: true, fn: function () { var v = input.value.trim(); if (v) names[s.id] = v; else delete names[s.id]; draw(); } },
        { label: L('Cancel'), primary: false }
      ] });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = input.value.trim(); if (v) names[s.id] = v; else delete names[s.id]; dlg.close(); draw(); } });
    }

    function confirm(picks) {
      var sum = M.summary(picks.map(function (s) { return B.assign({}, s, { groups: checkedOf(s) }); }));
      U.confirm(L('Merge categories?'), L('%d categories become %d. You can always undo this.', sum.from, sum.to), L('Merge'), function () { apply(picks); });
    }

    function draw() {
      U.clear(list);
      var nav = h('nav.st-tabs.cleanup-tabs', { 'aria-label': L('Categories') });
      SECTIONS.forEach(function (x) {
        var b = h('button.st-tab' + (x[0] === section ? '.active' : ''), { type: 'button' }, [h('span', L(x[1]))]);
        if (x[0] === section) b.setAttribute('aria-current', 'page');
        b.addEventListener('click', function () { if (section !== x[0]) { section = x[0]; search(); } });
        nav.appendChild(b);
      });
      list.appendChild(nav);
      if (!src) { S.stRow(S.stSection(list, null), L('No servers yet'), null, null); return; }
      if (undo) {
        var us = S.stSection(list, null);
        S.stRow(us, L('Categories merged.'), h('span.st-value', L('Undo')), restore, { icon: 'check' });
      }
      var sec = S.stSection(list, null, L('Bingr looks for categories that belong together, such as Netflix, Netflix Movies and Netflix Documentaries. Nothing changes until you tap Merge. Brands are selected by default; country variants and same-beginning suggestions are not.'));
      if (searching) S.stRow(sec, L('Searching for categories that belong together…'), null, null);
      else if (searched && !suggestions.length) S.stRow(sec, L('No suggestions. Your categories look tidy.'), null, null);
      if (suggestions.length) {
        var pl = pickedList();
        var all = S.stRow(sec, L('Apply all (%d)', pl.length), null, pl.length ? function () { confirm(pl); } : null, { icon: 'check' });
        if (!pl.length) all.setAttribute('aria-disabled', 'true');
      }
      S.stRow(sec, L('Search again'), null, searching ? null : searchAgain, { icon: 'search' });

      suggestions.forEach(function (s) {
        var chosen = checkedOf(s), on = isPicked(s);
        var kindText = s.kind === 'brand' ? L('Brand') : s.kind === 'country' ? L('Country variants') : L('Same beginning');
        var ss = S.stSection(list, nameOf(s));
        var total = chosen.reduce(function (n, g) { return n + (s.counts[g] || 0); }, 0);
        S.stRow(ss, nameOf(s), kindText, function () { picked[s.id] = !on; draw(); },
          { toggle: on, sub: L('%d categories', chosen.length) + ' · ' + countText(total) });
        s.groups.forEach(function (g) {
          var key = s.id + '|' + g, isOn = !unchecked[key];
          var warn = s.renamed.indexOf(g) >= 0 ? '⚠ ' + L('You renamed this category yourself (%@)', (custom().renamed || {})['group:' + g] || '') : null;
          S.stRow(ss, g, countText(s.counts[g] || 0), function () { if (isOn) unchecked[key] = true; else delete unchecked[key]; draw(); },
            { toggle: isOn, sub: warn });
        });
        var actions = h('div.cleanup-actions', [
          U.button(L('Merge'), chosen.length >= 2 ? function () { confirm([s]); } : null, { primary: true, icon: 'check' }),
          U.button(L('Change target name'), function () { rename(s); }, { icon: 'edit' }),
          U.button(L('Skip'), function () { skip(s); }, { icon: 'close' })
        ]);
        if (chosen.length < 2) actions.firstChild.disabled = true;
        ss.appendChild(actions);
      });

      var groups = groupCounts(section).map(function (g) { return g.name; }), here = Object.create(null);
      groups.forEach(function (g) { here[g] = true; });
      var targets = M.mergedTargets(custom().merged || {}, groups).filter(function (t) {
        return here[t.target] || t.sources.some(function (x) { return here[x]; });
      });
      if (targets.length) {
        targets.forEach(function (t, i) {
          var ms = S.stSection(list, i === 0 ? L('Merged') : null);
          S.stRow(ms, display(t.target), h('span.st-value', L('Detach all')), function () { detach(t.target, null); },
            { sub: L('%d categories', t.sources.length + 1) });
          t.sources.forEach(function (x) {
            S.stRow(ms, '↳ ' + x, h('span.st-value', L('Take out')), function () { detach(t.target, [x]); });
          });
        });
      }
    }

    var off = B.on('library', function () { if (!searching && Lib.source !== src) search(); });
    pg.destroy = function () { gen++; off(); };
    search();
    return pg;
  };
})();
