/*
 * Build 151: rij "Zenders" op Home (sleutel 'channels', standaard aan, direct na "Ontdek categorieën").
 * Logo's van de live zenders die de eigen server levert (stream_icon / tvg-logo / logo van de portal), zoals een rij
 * streamingdiensten. Eerst de recente zenders en favorieten (over alle servers, B.xs), aangevuld met zenders uit de
 * grootste zichtbare live-categorieën (Lib.lib = na verborgen categorieën en kinderfilter), zenders met een logo eerst;
 * hooguit 15, geen dubbele namen. Tegel: het logo op een neutrale achtergrond; zonder logo de opgeschoonde zendernaam
 * (zonder "NL |", "HD", …); eronder klein het programma van nu uit de gids. Klikken start de zender meteen.
 * Kinderprofiel: alleen zenders uit kindercategorieën (zelfde filter als Live TV). Geen inline stijl (CSP).
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, Lib = B.lib;
  var h = U.h;
  var L = function () { return B.L.apply(null, arguments); };
  var CR = B.channelRow = {};
  var MAX = 15, TOP_GROUPS = 6;

  /** Zendernaam zonder land-/taalvoorvoegsel en kwaliteitsaanduiding ("NL | NPO 1 HD" → "NPO 1"). */
  // build 153: één opschoning voor alle zendernamen (B.chanName in core.js)
  CR.cleanName = function (n) { return B.chanName(n); };
  function kidsOK(ch, kids) {
    if (!kids) return true;
    var PC = B.parental;
    return !!(PC && PC.isKidsCategory && PC.isKidsCategory(ch.rawGroup != null ? ch.rawGroup : ch.group));
  }
  function playable(ch) { return ch && !ch._key && !ch._noKey && (ch.streamURL || ch.id != null); }

  /**
   * Welke zenders: [ch] (hooguit 15). first = recente/favoriete zenders (items), lib = bibliotheek (channels, byGroup).
   * Puur (geen DOM), zodat de test hem kan draaien.
   */
  CR.pick = function (first, lib, kids, byGroup) {
    var out = [], seen = Object.create(null);
    function add(ch) {
      if (out.length >= MAX || !playable(ch) || !kidsOK(ch, kids)) return;
      // build 151: zelfde opgeschoonde naam = dezelfde zender (ook "NPO1" en "NPO 1"), zoals B.xs.dedupeHome
      var k = B.xs && B.xs.chanKey ? B.xs.chanKey(ch.name) : B.fold(CR.cleanName(ch.name));
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push(ch);
    }
    (first || []).forEach(add);
    if (out.length < MAX && lib && lib.channels && lib.channels.length) {
      var by = byGroup || {};
      var groups = (lib.channelGroups || Object.keys(by)).filter(function (g) { return by[g] && by[g].length; });
      groups.sort(function (a, b) { return by[b].length - by[a].length; });
      groups = groups.slice(0, TOP_GROUPS);
      // om en om uit de grootste categorieën; eerst zenders met een logo, daarna de rest
      [true, false].forEach(function (withLogo) {
        var pos = groups.map(function () { return 0; }), more = true;
        while (more && out.length < MAX) {
          more = false;
          for (var i = 0; i < groups.length && out.length < MAX; i++) {
            var list = by[groups[i]];
            while (pos[i] < list.length) {
              var ch = list[pos[i]++];
              if (!!ch.logo !== withLogo) continue;
              var before = out.length;
              add(ch);
              if (out.length > before) { more = true; break; }
            }
            if (pos[i] < list.length) more = true;
          }
        }
      });
    }
    return out;
  };

  function firstChannels() {
    if (!B.xs || !B.xs.listTiles) return [];
    var hits = [];
    try { hits = B.xs.listTiles('recentChannels', 'channel').concat(B.xs.listTiles('favorites', 'channel')); } catch (e) { hits = []; }
    // build 151: dezelfde zender op meer servers = één (bron in de audio-/app-taal, dan de actieve server)
    if (B.xs.dedupeHome) hits = B.xs.dedupeHome(hits); else if (B.xs.dedupe) hits = B.xs.dedupe(hits);
    return hits.map(function (x) { return x && x.item; }).filter(Boolean);
  }

  function tile(ch, list) {
    var name = CR.cleanName(ch.name);
    var nn = Lib.nowNext ? Lib.nowNext(ch) : { now: null };
    var now = nn && nn.now ? B.showName(nn.now.title) : '';
    var logo = h('div.zc-logo', [ch.logo ? U.img(ch.logo, 'zc-img', name) : h('span.zc-name', name)]);
    var b = h('button.zc-tile', { type: 'button', 'aria-label': now ? name + ', ' + now : name, title: name },
      [logo, h('div.zc-now', now || ' ')]);
    b.addEventListener('click', function () { B.player.playChannel(ch, list); });
    if (B.screens && B.screens.cardMenu) U.onMenu(b, function () { return B.screens.cardMenu(ch, 'channel', {}); }, name);
    return b;
  }
  function arrowNav(root) {
    root.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.documentElement.dir === 'rtl') d = -d;
      var cur = e.target && e.target.closest ? e.target.closest('.zc-tile') : null;
      if (!cur) return;
      var all = Array.prototype.slice.call(root.querySelectorAll('.zc-tile'));
      var next = all[all.indexOf(cur) + d];
      if (!next) return;
      e.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }
  /** De rij voor Home (of null). */
  CR.homeRow = function () {
    var p = B.app && B.app.profile, kids = !!(p && p.kids);
    var lib = Lib.lib;
    if (!lib || !lib.channels) return null;
    var chans = CR.pick(firstChannels(), lib, kids, Lib.byGroup('channel'));
    if (!chans.length) return null;
    var row = U.row(L('Channels'), chans.map(function (c) { return tile(c, chans); }), 'zc-row', '#/live');
    if (row) arrowNav(row);
    return row;
  };
})();
