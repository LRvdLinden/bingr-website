/*
 * Bingr web: details van een film of serie (= DetailsService op iOS, build 90) en de pagina van een acteur/actrice
 * (= PersonView/PersonService).
 *
 * Bronnen, in deze volgorde:
 *  1. de afspeellijst zelf (Xtream get_vod_info / get_series_info: beschrijving, genres, regisseur, cast, duur);
 *  2. TMDB met de sleutel van de server (zelfde opzoeking als leeftijden en trailers): beschrijving in de app-taal,
 *     genres, regisseur, speelduur, cast met foto's en aanbevelingen.
 * Aanbevelingen die in je bibliotheek staan, openen de titel; de rest zoekt op titel. Profielen met een
 * leeftijdsgrens zien alleen aanbevelingen uit hun eigen (gefilterde) bibliotheek, zoals op iOS.
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, Lib = B.lib, S = B.screens, AR = B.ageRatings;
  var h = U.h, R = U.router;
  var L = function () { return B.L.apply(null, arguments); };
  var DT = B.details = {};

  // build 97: geldige TMDB-locales (en-EN en ar-AR bestaan niet)
  var TMDB_LANG = { en: 'en-US', nl: 'nl-NL', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', pl: 'pl-PL',
    tr: 'tr-TR', ar: 'ar-SA', 'zh-Hans': 'zh-CN' };
  function tmdbLang() {
    var l = B.lang || 'en';
    if (B.has(TMDB_LANG, l)) return TMDB_LANG[l];
    return l.length === 2 ? l + '-' + l.toUpperCase() : l;
  }
  function img(path, size) { return path ? 'https://image.tmdb.org/t/p/' + size + path : null; }
  function str(v) { v = v == null ? '' : String(v).trim(); return v || null; }
  function names(s) { return String(s || '').split(/[,/]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function ageLimited() { var p = B.app && B.app.profile; return !!(p && D.ageLimit(p) != null); }

  // MARK: TMDB

  var cache = {};   // "m|id|taal" → Promise
  function tmdbID(x, isShow, info) {
    var hint = info && B.int(isShow ? (info.tmdb || info.tmdb_id) : (info.tmdb_id || info.tmdb));
    if (hint) return Promise.resolve(hint);
    if (!AR.hasKey()) return Promise.resolve(null);
    return AR.lookup(x, isShow).then(function (r) { return r && r.found !== false && r.id != null ? r.id : null; }, function () { return null; });
  }
  function tmdbDetails(id, isShow) {
    var lang = tmdbLang(), k = (isShow ? 's|' : 'm|') + id + '|' + lang;
    if (!cache[k]) {
      cache[k] = AR.tmdb((isShow ? '/tv/' : '/movie/') + id, [['language', lang],
        ['append_to_response', isShow ? 'aggregate_credits,recommendations' : 'credits,recommendations']]).catch(function () { return null; });
      cache[k].then(function (r) { if (!r) delete cache[k]; });
    }
    return cache[k];
  }

  /**
   * build 141: cover (poster) van een film of serie uit TMDB, of null. Voor Verder kijken als de eigen afbeelding een still
   * van een aflevering is (M3U-series nemen de afbeelding van de aflevering) of ontbreekt.
   */
  var posterCache = {};
  DT.poster = function (x, isShow) {
    if (!x || !AR.hasKey()) return Promise.resolve(null);
    var k = (isShow ? 's|' : 'm|') + B.fold(x.rawTitle || x.title || '') + '|' + (x.year || '');
    if (!posterCache[k]) {
      posterCache[k] = tmdbID(x, isShow, { tmdb: x.tmdb, tmdb_id: x.tmdb }).then(function (id) {
        return id ? tmdbDetails(id, isShow).then(function (f) { return f && f.poster_path ? img(f.poster_path, 'w342') : null; }) : null;
      }).catch(function () { return null; });
    }
    return posterCache[k];
  };

  /**
   * Alles voor de detailpagina. `info` = wat de afspeellijst gaf (of null). Geeft altijd een object:
   * {overview, genres[], director, runtime, cast[{name, character, photo, personID}], recommendations[{title, year, poster, isShow}]}
   */
  DT.load = function (x, isShow, info) {
    info = info || {};
    var d = {
      overview: str(info.plot) || str(info.description) || str(x.plot),
      genres: names(info.genre || x.genres),
      director: str(info.director),
      runtime: null,
      cast: names(info.cast || info.actors).map(function (n) { return { name: n, character: null, photo: null, personID: null }; }),
      recommendations: []
    };
    var secs = B.int(info.duration_secs), ert = B.int(info.episode_run_time);
    if (secs > 0) d.runtime = L('%d min', Math.round(secs / 60)); else if (ert > 0) d.runtime = L('%d min', ert);
    return tmdbID(x, isShow, info).then(function (id) {
      if (!id) return d;
      return tmdbDetails(id, isShow).then(function (f) {
        if (!f) return d;
        d.tmdbID = id;
        if (B.titleLink && B.titleLink.note) B.titleLink.note(x, isShow, id);
        var o = str(f.overview);
        if (o && (B.lang !== 'en' || !d.overview)) d.overview = o;
        if (!d.genres.length) d.genres = (f.genres || []).map(function (g) { return g.name; }).filter(Boolean);
        if (!d.director && !isShow) {
          var dir = ((f.credits && f.credits.crew) || []).filter(function (c) { return c.job === 'Director'; }).map(function (c) { return c.name; });
          if (dir.length) d.director = dir.slice(0, 2).join(', ');
        }
        if (!d.runtime) {
          var rt = isShow ? (f.episode_run_time || [])[0] : f.runtime;
          if (rt > 0) d.runtime = L('%d min', rt);
        }
        var cast = ((isShow ? f.aggregate_credits : f.credits) || {}).cast || [];
        if (cast.length) d.cast = cast.slice(0, 20).map(function (c) {
          return { name: c.name, character: c.character || (c.roles && c.roles[0] && c.roles[0].character) || null, photo: img(c.profile_path, 'w185'), personID: c.id };
        });
        d.recommendations = ((f.recommendations && f.recommendations.results) || []).slice(0, 15).map(function (r) {
          var date = r.release_date || r.first_air_date || '';
          return { title: r.title || r.name || '?', original: r.original_title || r.original_name || null, year: B.int(date.slice(0, 4)) || null, poster: img(r.poster_path, 'w342'), isShow: isShow };
        });
        return d;
      });
    }).catch(function () { return d; });
  };

  // MARK: koppelen aan de bibliotheek (= matchRecommendations op iOS)

  /**
   * build 97: titelindex lui en in stukjes (B.chunked, zoals applyChunked), per bibliotheekversie (Lib.version) in
   * plaats van objectidentiteit; zonder prototype (titel "Constructor"). Tot hij klaar is, geeft DT.match null.
   */
  var idx = null, idxVer = -1, idxP = null, idxPVer = -1, idxJob = null;
  function norm(t) { var p = B.parseTitle(t); return B.fold((p && p.title) || t).replace(/[^a-z0-9]/g, ''); }
  function indexNow() { return idx && idxVer === Lib.version ? idx : null; }
  DT.indexReady = function () {
    if (indexNow()) return Promise.resolve(idx);
    var ver = Lib.version;
    if (idxP && idxPVer === ver) return idxP;
    if (idxJob) { idxJob.cancel(); idxJob = null; }
    var lib = Lib.lib || {};
    var next = { movie: Object.create(null), series: Object.create(null) };
    var p = idxP = Promise.resolve().then(function () {
      if (idxP !== p) throw new Error('cancelled');
      idxJob = B.chunked(lib.movies || [], function (m) { var n = norm(m.rawTitle || m.title); if (n) (next.movie[n] = next.movie[n] || []).push(m); });
      return idxJob;
    }).then(function () {
      if (idxP !== p) throw new Error('cancelled');
      idxJob = B.chunked(lib.series || [], function (s) { var n = norm(s.rawTitle || s.title); if (n && !next.series[n]) next.series[n] = [s]; });
      return idxJob;
    }).then(function () {
      if (idxP !== p) throw new Error('cancelled');
      idxJob = null;
      if (Lib.version === ver) { idx = next; idxVer = ver; }
      return next;
    });
    idxPVer = ver;
    p.catch(function () { if (idxP === p) { idxP = null; idxPVer = -1; } });
    return p;
  };
  /** build 111: titelindex al klaar voor deze bibliotheek? (rijen Binnenkort / Nieuw op streamingdiensten) */
  DT.indexReadyNow = function () { return !!indexNow(); };
  /** Titel uit je bibliotheek bij een TMDB-titel (titel in de app-taal of origineel, met hetzelfde jaar als dat bekend is). */
  DT.match = function (r) {
    var ix = indexNow();
    if (!ix) { DT.indexReady().catch(B.noop); return null; }
    var tab = r.isShow ? ix.series : ix.movie;
    var keys = [r.title, r.original].filter(Boolean).map(norm);
    for (var i = 0; i < keys.length; i++) {
      var list = tab[keys[i]];
      if (!list) continue;
      var hit = r.isShow ? list[0] : list.filter(function (m) { return !r.year || !m.year || m.year === r.year; })[0];
      if (hit) return hit;
    }
    return null;
  };

  /**
   * Alle goede kandidaten uit je bibliotheek (link uit de nieuwsbrief, #/titel): titel of originele titel, bij films met
   * hetzelfde jaar als dat bekend is (een film zonder jaar telt alleen als er geen met het jaar is). null = index nog niet klaar.
   */
  DT.matchAll = function (r) {
    var ix = indexNow();
    if (!ix) return null;
    var tab = r.isShow ? ix.series : ix.movie;
    var out = [], seen = Object.create(null);
    [r.title, r.original].filter(Boolean).map(norm).forEach(function (k) {
      (tab[k] || []).forEach(function (x) { if (!seen[x.id]) { seen[x.id] = true; out.push(x); } });
    });
    if (r.isShow || !r.year) return out;
    var exact = out.filter(function (m) { return m.year === r.year; });
    return exact.length ? exact : out.filter(function (m) { return !m.year; });
  };

  // MARK: blokken op de detailpagina

  function initials(n) { return String(n || '?').split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join(''); }
  DT.personLink = function (c) {
    return R.link(['person', String(c.personID || 0)]) + '?n=' + encodeURIComponent(c.name);
  };
  /** build 97: foto met terugval op initialen als hij niet laadt, zonder referrer. */
  function photoOrInitials(url, name, lazy) {
    if (!url) return h('span', initials(name));
    var im = h('img', { src: url, alt: '', loading: lazy ? 'lazy' : null, decoding: 'async', referrerpolicy: 'no-referrer' });
    im.onerror = function () { im.onerror = null; if (im.parentNode) im.parentNode.replaceChild(h('span', initials(name)), im); };
    return im;
  }
  function castCell(c, clickable) {
    var pic = h('span.cast-pic', [photoOrInitials(c.photo, c.name, true)]);
    var txt = h('span.cast-txt', [h('span.cast-name', c.name), c.character ? h('span.cast-role', c.character) : null]);
    return clickable ? h('a.cast-cell', { href: DT.personLink(c) }, [pic, txt]) : h('div.cast-cell', [pic, txt]);
  }
  function section(title, body) { return h('section.dt-sec', [h('h2.dt-sec-title', title), body]); }

  /** Genres en regisseur onder de beschrijving (creditsBlock op iOS). */
  DT.credits = function (d) {
    var lines = [];
    if (d.genres.length) lines.push(h('div.dt-credit', [h('span.k', L('Genres') + ': '), d.genres.join(', ')]));
    if (d.director) lines.push(h('div.dt-credit', [h('span.k', L('Director') + ': '), d.director]));
    return lines.length ? h('div.dt-credits', lines) : null;
  };
  /** Cast en aanbevelingen onderaan de pagina. */
  DT.sections = function (d) {
    var out = h('div.dt-extra');
    if (d.cast.length) {
      var can = AR.hasKey();
      out.appendChild(section(L('Actors'), h('div.cast-grid', d.cast.map(function (c) { return castCell(c, can); }))));
    }
    if (d.recommendations.length) {
      // build 97: met de titelindex koppelen; is die nog niet klaar, dan de rij invullen zodra hij er is
      if (indexNow()) { var row = recsRow(d); if (row) out.appendChild(row); }
      else {
        var slot = h('div.dt-recs-slot');
        out.appendChild(slot);
        DT.indexReady().then(function () { var r2 = recsRow(d); if (r2 && slot.isConnected !== false) slot.appendChild(r2); }, B.noop);
      }
    }
    return out.childNodes.length ? out : null;
  };
  function recsRow(d) {
    var recs = d.recommendations.map(function (r) { return { r: r, hit: DT.match(r) }; });
    if (ageLimited()) recs = recs.filter(function (x) { return x.hit; });
    if (!recs.length) return null;
    var cards = recs.map(function (x) {
      if (x.hit) return S.posterCard(x.hit, x.r.isShow ? 'series' : 'movie');
      var q = '#/search?q=' + encodeURIComponent(x.r.title);
      return h('a.card.rec-out', { href: q, 'aria-label': x.r.title + (x.r.year ? ' (' + x.r.year + ')' : '') },
        [h('div.card-img', [U.img(x.r.poster, 'poster', x.r.title)]), h('div.card-title', x.r.title)]);
    });
    return U.row(L('Recommendations'), cards, 'dt-recs');
  }

  // MARK: pagina van een acteur/actrice (#/person/<tmdb-id>?n=<naam>)

  function person(id) {
    var lang = tmdbLang(), k = 'p|' + id + '|' + lang;
    if (!cache[k]) {
      cache[k] = Promise.all([
        AR.tmdb('/person/' + id, [['language', lang]]),
        AR.tmdb('/person/' + id + '/combined_credits', [['language', lang]])
      ]).then(function (r) {
        var p = r[0], cr = r[1];
        if (!p) return null;
        var bio = str(p.biography);
        var enBio = bio || lang === 'en-US' ? Promise.resolve(bio) : AR.tmdb('/person/' + id, [['language', 'en-US']]).then(function (e) { return e && str(e.biography); }, function () { return null; });
        return enBio.then(function (b) { return { p: p, bio: b, credits: (cr && cr.cast) || [] }; });
      }).catch(function () { return null; });
      cache[k].then(function (r) { if (!r) delete cache[k]; });
    }
    return cache[k];
  }
  function resolveName(name) {
    return AR.tmdb('/search/person', [['query', name], ['include_adult', 'false'], ['language', tmdbLang()]]).then(function (r) {
      var list = (r && r.results) || [];
      var p = list.filter(function (x) { return x.known_for_department === 'Acting'; })[0] || list[0];
      return p ? p.id : null;
    }, function () { return null; });
  }
  // talkshows, nieuws en optredens als zichzelf weglaten (= PersonService.credits); populairste eerst
  var SKIP_GENRES = [10763, 10767, 99];
  function credits(list) {
    var seen = {}, out = [];
    list.forEach(function (c) {
      var isShow = c.media_type === 'tv';
      if (c.media_type !== 'tv' && c.media_type !== 'movie') return;
      var key = c.media_type + c.id;
      if (seen[key]) return;
      if ((c.genre_ids || []).some(function (g) { return SKIP_GENRES.indexOf(g) >= 0; })) return;
      if (/^(himself|herself|self|themselves)\b/i.test(c.character || '')) return;
      seen[key] = true;
      var date = c.release_date || c.first_air_date || '';
      out.push({ title: c.title || c.name || '?', original: c.original_title || c.original_name || null, year: B.int(date.slice(0, 4)) || null,
        poster: img(c.poster_path, 'w342'), isShow: isShow, character: c.character || null, pop: (c.popularity || 0) + (c.vote_count || 0) / 100 });
    });
    return out.sort(function (a, b) { return b.pop - a.pop; });
  }
  var DEPT = { Acting: 'Acting', Directing: 'Directing', Writing: 'Writing', Production: 'Production' };
  function fmtDate(s) {
    if (!s || s.length < 10) return null;
    try { return B.fmtDate(new Date(s + 'T12:00:00'), { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return s; }
  }

  // build 97: persoonspagina licht het tabblad op waar je vandaan kwam (anders Home)
  S.navOwner.person = function (r, last) { return last || 'home'; };
  S.pages.person = function (r) {
    var name = r.query.n || '';
    var box = h('div.person-box');
    var back = h('button.icon-btn.dt-back', { type: 'button', 'aria-label': L('Back'), title: L('Back') }, [U.icon('back')]);
    back.addEventListener('click', function () { if (history.length > 1) history.back(); else R.go('/home'); });
    var el = h('div.page.person', [back, box]);
    var pg = { el: el, title: name || L('Actors') };
    var alive = true;
    pg.destroy = function () { alive = false; };
    box.appendChild(h('div.state', [U.spinner()]));
    var id = B.int(r.parts[1]);
    (id ? Promise.resolve(id) : resolveName(name)).then(function (pid) { return pid ? person(pid) : null; }).then(function (res) {
      // build 97: eerst de titelindex (in stukjes), dan pas "Beschikbaar in Bingr" koppelen
      return DT.indexReady().then(function () { return res; }, function () { return res; });
    }).then(function (res) {
      if (!alive) return;
      U.clear(box);
      var p = res && res.p, nm = (p && p.name) || name;
      pg.title = nm; document.title = nm + ' · Bingr';
      var photo = p && img(p.profile_path, 'h632');
      box.appendChild(h('div.person-head', [
        h('div.person-pic', [photoOrInitials(photo, nm, false)]),
        h('h1.person-name', nm)
      ]));
      if (p) {
        var facts = [];
        if (p.known_for_department) facts.push(L('Known for') + ': ' + L(DEPT[p.known_for_department] || p.known_for_department));
        var born = fmtDate(p.birthday);
        if (born) facts.push(L('Born %@', born).replace('%@', born) + (p.place_of_birth ? ' · ' + p.place_of_birth : ''));
        else if (p.place_of_birth) facts.push(p.place_of_birth);
        var died = fmtDate(p.deathday);
        if (died) facts.push(L('Died %@', died).replace('%@', died));
        if (facts.length) box.appendChild(h('div.person-facts', facts.map(function (f) { return h('div', f); })));
        if (res.bio) {
          var bio = h('p.person-bio', res.bio);
          var more = h('button.btn.small.person-more', { type: 'button' }, L('Show more'));
          more.addEventListener('click', function () { more.textContent = L(bio.classList.toggle('open') ? 'Show less' : 'Show more'); });
          box.appendChild(h('div.person-biobox', [h('h2.dt-sec-title', L('Biography')), bio, res.bio.length > 420 ? more : null]));
        }
      }
      var list = res ? credits(res.credits) : [];
      var have = [], rest = [];
      list.forEach(function (c) { var hit = DT.match(c); if (hit) have.push({ c: c, hit: hit }); else rest.push(c); });
      if (have.length) box.appendChild(U.row(L('Available in Bingr'), have.map(function (x) { return S.posterCard(x.hit, x.c.isShow ? 'series' : 'movie'); })));
      if (rest.length && !ageLimited()) box.appendChild(U.row(L('Not in your playlists'), rest.slice(0, 40).map(function (c) {
        return h('a.card.rec-out', { href: '#/search?q=' + encodeURIComponent(c.title), 'aria-label': c.title + (c.year ? ' (' + c.year + ')' : '') },
          [h('div.card-img', [U.img(c.poster, 'poster', c.title)]), h('div.card-title', c.title)]);
      })));
      if (!p && !have.length) box.appendChild(h('p.muted.person-none', L('No information found for this person.')));
    }).catch(function (e) {
      // build 97: geen eindeloze spinner bij een fout
      B.log('persoon', e && e.message);
      if (!alive) return;
      U.clear(box);
      box.appendChild(h('div.state', [U.icon('warn', 'state-ic'), h('p.muted', L('Something went wrong. Please try again.')),
        U.button(L('Try again'), function () { R.fire(); }, { primary: true })]));
    });
    return pg;
  };
})();
