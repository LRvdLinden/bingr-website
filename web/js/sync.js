/*
 * Gegevens van het account: profielen (account_data), servers (get_sources), instellingen (settings),
 * per profiel Mijn lijst, favorieten, voortgang, bekeken, recente zenders en geschiedenis (profile.<id>),
 * collecties (version 2, per profiel) en pincodes. Zelfde formaat en samenvoegregels als StateSync.kt:
 * per item wint de nieuwste tijd, verwijderingen komen door via `removed`, onbekende velden blijven staan.
 * Alles wordt lokaal bewaard (localStorage), zodat de app na een update of zonder internet direct werkt.
 */
(function () {
  'use strict';
  var B = window.B;
  var A = B.account;
  var L = function () { return B.L.apply(null, arguments); };
  var D = B.data = {};

  // build 128: hiddenCategories = categorieën die uit staan voor dit profiel ("<server-id>|<categorienaam>"), zoals myList
  var SET_FIELDS = ['myList', 'favorites', 'watched', 'recentChannels', 'hiddenCategories'];
  var REMOVED_DAYS = 90, MAX_RECENT = 20, MAX_PROGRESS = 300, MAX_HISTORY = 500;
  var lower = function (s) { return String(s || '').toLowerCase(); };

  // MARK: lokale kopieën

  D.profiles = B.store.get('profiles', []) || [];        // alleen actieve (geen tombstones), op volgorde
  D.sources = B.store.get('sources', []) || [];          // alleen actieve bronnen
  D.mainSourceID = B.store.get('mainSourceID', null);
  D.settings = B.store.get('settings', null);            // {data, updatedAt} zoals de server het gaf
  D.collections = B.store.get('collections', null);      // ruwe section-data
  // build 146: kleine letters profiel-id → pinHash ({alg, iter, salt, hash}); nooit de pincode zelf
  D.pins = B.store.get('pins', {}) || {};
  (function () {
    // oude opslag (≤ 145) had de pincode zelf: meteen hashen en alleen de hash bewaren
    var plain = Object.keys(D.pins).filter(function (k) { return typeof D.pins[k] === 'string'; });
    if (!plain.length || !B.pin) return;
    var tmp = {};
    plain.forEach(function (k) { tmp[k] = D.pins[k]; delete D.pins[k]; });
    B.store.set('pins', D.pins);
    plain.forEach(function (k) {
      if (!B.pin.valid(tmp[k])) return;
      B.pin.make(tmp[k]).then(function (h) { if (!D.pins[k]) { D.pins[k] = h; B.store.set('pins', D.pins); B.emit('profiles'); } }).catch(B.noop);
    });
  })();
  D.lastSync = B.store.get('lastSync', null);           // build 146 (diagnose): {at, ok} van de laatste account-sync
  // instellingen die op deze tv gewijzigd zijn maar nog niet geüpload (offline): {shared: {sleutel: waarde}, intro: {sleutel: markering}}
  var pendingSettings = B.store.get('settingsPending', null);

  function save() {
    B.store.set('profiles', D.profiles);
    B.store.set('sources', D.sources);
    B.store.set('mainSourceID', D.mainSourceID);
    B.store.set('settings', D.settings);
    B.store.set('collections', D.collections);
    B.store.set('pins', D.pins);
  }

  /** Ander account op deze tv: eerst alles van het vorige account wissen (zoals SourceSync.checkAccountSwitch). */
  D.checkAccountSwitch = function () {
    var uid = A.userId();
    if (!uid) return;
    var last = B.store.get('owner', null);
    if (last && lower(last) !== lower(uid)) D.wipe();
    B.store.set('owner', uid);
  };
  D.wipe = function () {
    D.profiles = []; D.sources = []; D.mainSourceID = null; D.settings = null; D.collections = null; D.pins = {};
    pendingSettings = null; B.store.del('settingsPending');
    pendingCollections = []; B.store.del('collectionsPending');
    save();
    B.store.keys('pstate.').forEach(function (k) { B.store.del(k); });
    B.store.keys('lastChannel.').forEach(function (k) { B.store.del(k); });
    B.store.del('lastProfile'); B.store.del('activeSource'); B.store.del('accentMigrated');
    // build 140: verborgen categorieën van het account
    AC = { hc: {}, base: null, dirty: false, rev: 0 }; B.store.del(ACC_KEY); B.store.del(ACC_MIG);
    B.idb.clear();
    // Trakt, OpenSubtitles en herinneringen van het vorige account
    B.emit('wipe');
  };

  // MARK: instellingen (settings.shared, gelijk op alle platforms)

  D.shared = function (key, def) {
    var s = D.settings && D.settings.data && D.settings.data.shared;
    return s && B.has(s, key) && s[key] != null ? s[key] : def;
  };
  /** Wijzigingen van deze tv op een settings-object toepassen (gedeelde sleutels en intro-markeringen). */
  function applyPending(data, pend) {
    data.shared = data.shared || {};
    Object.keys(pend.shared || {}).forEach(function (k) { data.shared[k] = pend.shared[k]; });
    var intro = pend.intro || {};
    var keys = Object.keys(intro);
    if (keys.length) {
      var out = B.assign({}, data.shared.introMarkers || {});
      keys.forEach(function (key) {
        // bestaande sleutel met andere hoofdletters hergebruiken (sleutels zijn hoofdletterongevoelig)
        var use = key;
        Object.keys(out).forEach(function (k) { if (lower(k) === lower(key)) use = k; });
        out[use] = intro[key];
      });
      data.shared.introMarkers = out;
    }
    return data;
  }
  /**
   * Openstaande wijzigingen uploaden: nieuwste settings van de server lezen, alleen onze sleutels aanpassen, het geheel
   * terugzetten (het geheel met de nieuwste updatedAt wint). Lukt het niet, dan blijven ze staan voor de volgende sync.
   */
  var settingsBusy = null;
  function uploadSettings(serverSection) {
    if (!pendingSettings) return Promise.resolve();
    if (settingsBusy) return settingsBusy;
    var pend = pendingSettings;
    var read = serverSection !== undefined ? Promise.resolve({ settings: serverSection }) : A.getState(['settings']);
    settingsBusy = read.then(function (all) {
      if (!all) return;
      var cur = all.settings && all.settings.data;
      var data = applyPending(cur && typeof cur === 'object' ? B.copy(cur) : {}, pend);
      data.updatedAt = B.iso();
      return A.putState('settings', data).then(function (at) {
        if (at == null) return;
        D.settings = { data: data, updatedAt: at || data.updatedAt };
        // alleen wissen wat we net verstuurd hebben (er kan intussen iets bij zijn gekomen)
        if (pendingSettings === pend) { pendingSettings = null; B.store.del('settingsPending'); }
        save();
      });
    }).catch(B.noop).then(function () {
      settingsBusy = null;
      // tijdens het versturen nog iets gewijzigd: dat ook versturen
      if (pendingSettings && pendingSettings !== pend) return uploadSettings();
    });
    return settingsBusy;
  }
  function addPending(kind, key, value) {
    var p = pendingSettings ? B.copy(pendingSettings) : { shared: {}, intro: {} };
    p[kind] = p[kind] || {};
    p[kind][key] = value;
    pendingSettings = p;
    B.store.set('settingsPending', p);
    var local = D.settings ? B.copy(D.settings) : { data: {} };
    local.data = applyPending(local.data || {}, p);
    local.data.updatedAt = B.iso();
    D.settings = local; save();
  }
  /** Gedeelde instelling wijzigen: lokaal meteen, daarna alleen dit veld in de nieuwste serverversie (uploadSettings). */
  D.setShared = function (key, value) {
    addPending('shared', key, value);
    B.emit('settings');
    return uploadSettings();
  };
  /** Lokale instellingen van deze tv (niet gesynchroniseerd). */
  D.local = function (key, def) { var v = B.store.get('local.' + key, null); return v == null ? def : v; };
  D.setLocal = function (key, v) { B.store.set('local.' + key, v); };

  // MARK: profielen

  var ACCENTS = { red: '#E50914', blue: '#2F7BF5', green: '#1DB954', purple: '#9B51E0', orange: '#F5821F', pink: '#E6448C' };
  D.accents = ACCENTS;
  D.accentKey = function (p) { var k = p && lower(p.accentColor); return ACCENTS[k] ? k : 'red'; };

  // iOS-symboolnaam → emoji (= AvatarMap.kt)
  var SF = {
    'tv': '📺', 'globe': '🌐', 'sportscourt': '⚽', 'crown': '👑', 'flame': '🔥', 'film': '🎬', 'popcorn': '🍿', 'star': '⭐',
    'gamecontroller': '🎮', 'moon.stars': '🌙', 'bolt': '⚡', 'heart': '❤️', 'waveform.path.ecg': '🎧', 'hare': '🐰',
    'forward': '🚀', 'sparkle': '🌈', 'link': '🔗', 'bubble.left': '💬', 'wifi': '📶', 'umbrella': '☂️', 'play': '▶️',
    'book.closed': '📕', 'person': '🧸', 'paintbrush': '🎭'
  };
  D.symbolEmoji = SF;
  // dezelfde volgorde als PlaylistAvatar.symbols op iOS; figuurtjes kid01…kid16
  D.symbols = ['link', 'bubble.left', 'globe', 'hare', 'waveform.path.ecg', 'sportscourt', 'wifi', 'crown', 'flame', 'umbrella', 'play',
    'heart', 'book.closed', 'person', 'film', 'forward', 'paintbrush', 'sparkle', 'tv', 'popcorn', 'star', 'bolt', 'moon.stars', 'gamecontroller'];
  D.illustrations = []; for (var ki = 1; ki <= 16; ki++) D.illustrations.push('kid' + (ki < 10 ? '0' : '') + ki);
  D.palettes = [['#E50914', '#7A0008'], ['#2563EB', '#1E1B4B'], ['#10B981', '#064E3B'], ['#F59E0B', '#9A3412'],
    ['#A855F7', '#3B0764'], ['#EC4899', '#831843'], ['#14B8A6', '#0C4A6E'], ['#64748B', '#0F172A']];
  /** Avatar uit het gedeelde formaat: {kind: 'kid'|'emoji', value, colorIndex}. */
  D.avatar = function (p) {
    var a = p && p.avatar, n = D.palettes.length;
    var color = 0, sym = null, emoji = null;
    if (a && typeof a === 'object') {
      sym = a.symbol || a.figure || null; emoji = a.emoji || null;
      color = B.int(a.colorIndex != null ? a.colorIndex : a.color) || 0;
    } else if (typeof a === 'string') sym = a;
    color = ((color % n) + n) % n;
    if (sym && /^kid\d\d$/.test(sym)) return { kind: 'kid', value: sym, colorIndex: color };
    var e = emoji || (sym && SF[sym]) || sym || (p && p.kids ? null : '📺');
    if (!e) return { kind: 'kid', value: 'kid01', colorIndex: color };
    return { kind: 'emoji', value: e, colorIndex: color };
  };
  /** Hoofdprofiel zoals in de apps (CloudStore.mainProfileID): het profiel met isMain, anders het eerste. */
  D.isMain = function (p) { var m = D.mainProfile(); return !!(p && m && lower(p.id) === lower(m.id)); };
  D.mainProfile = function () {
    for (var i = 0; i < D.profiles.length; i++) if (D.profiles[i].isMain) return D.profiles[i];
    return D.profiles[0] || null;
  };
  D.profileById = function (id) {
    for (var i = 0; i < D.profiles.length; i++) if (lower(D.profiles[i].id) === lower(id)) return D.profiles[i];
    return null;
  };
  /** Leeftijdsgrens die echt geldt (kinderprofiel zonder grens = t/m 12). */
  D.ageLimit = function (p) {
    if (!p) return null;
    var a = B.int(p.ageLimit);
    return a != null ? a : (p.kids ? 12 : null);
  };
  D.strict = function (p) { var a = D.ageLimit(p); return !!(p && p.kids) || (a != null && a <= 12); };
  /** pinHash van een profiel, of null (geen pincode). Alleen om te weten óf er een pincode is: controleren = D.checkPin. */
  D.pinFor = function (p) { return p ? (D.pins[lower(p.id)] || null) : null; };
  /** build 146: klopt de pincode? Promise<boolean> (PBKDF2, vaste-tijdvergelijking). */
  D.checkPin = function (p, pin) {
    var h = D.pinFor(p);
    if (!h) return Promise.resolve(false);
    return B.pin.verify(String(pin || ''), h);
  };

  function applyProfiles(list) {
    var active = (list || []).filter(function (p) { return p && p.id && p.deleted !== true; });
    active.sort(function (a, b) { return (B.int(a.order) || 0) - (B.int(b.order) || 0); });
    D.profiles = active;
    D.profilesSynced = true; // build 140: migratie van de categorieën pas met de profielen van de server
    save();
    B.emit('profiles');
  }

  /** Profielen lezen; leeg account → één hoofdprofiel aanmaken en uploaden (zoals de andere apps doen). */
  D.syncProfiles = function () {
    return A.readProfiles().then(function (list) {
      if (list == null) return false;
      var alive = list.filter(function (p) { return p && p.id && p.deleted !== true; });
      if (!alive.length) {
        var email = A.email() || '';
        var name = email ? email.split('@')[0] : 'Bingr';
        name = name.charAt(0).toUpperCase() + name.slice(1);
        var main = { id: B.uuid().toUpperCase(), name: name, avatar: { symbol: 'tv', colorIndex: 0, emoji: '📺' }, kids: false,
          ageLimit: null, isMain: true, order: 0, photo: null, updatedAt: B.iso() };
        list = list.concat([main]);
        // build 146: put_profiles geeft de samengevoegde lijst terug; die geldt
        return A.writeProfiles(list).then(function (merged) { applyProfiles(merged || list); return true; });
      }
      applyProfiles(list);
      return true;
    }, function () { return false; });
  };

  /** Accentkleur van een profiel wijzigen (build 54: per profiel in account_data, met updatedAt = nu). */
  D.setAccent = function (profileId, key) {
    if (!ACCENTS[key]) return Promise.resolve();
    var p = D.profileById(profileId);
    if (p) { p.accentColor = key; p.updatedAt = B.iso(); save(); B.emit('profiles'); }
    return A.readProfiles().then(function (list) {
      if (!list) return;
      var changed = false;
      list.forEach(function (o) {
        if (o && lower(o.id) === lower(profileId) && o.deleted !== true) { o.accentColor = key; o.updatedAt = B.iso(); changed = true; }
      });
      if (changed) return A.writeProfiles(list).then(function (merged) { if (merged) applyProfiles(merged); });
    }).catch(B.noop);
  };

  /**
   * Eenmalige migratie (build 54): oude settings.shared.accentColor naar alle profielen zonder eigen kleur.
   * Pas na het toepassen van de profielen van de server; daarna wordt settings.shared.accentColor niet meer gebruikt.
   */
  D.migrateAccent = function () {
    if (B.store.get('accentMigrated', false)) return Promise.resolve();
    var old = lower(D.shared('accentColor', ''));
    if (!ACCENTS[old]) { if (D.settings) B.store.set('accentMigrated', true); return Promise.resolve(); }
    return A.readProfiles().then(function (list) {
      if (!list) return;
      var changed = false, now = B.iso();
      list.forEach(function (o) {
        if (o && o.id && o.deleted !== true && !ACCENTS[lower(o.accentColor)]) { o.accentColor = old; o.updatedAt = now; changed = true; }
      });
      if (!changed) { B.store.set('accentMigrated', true); return; }
      return A.writeProfiles(list).then(function (merged) { if (merged) { B.store.set('accentMigrated', true); applyProfiles(merged); } });
    }).catch(B.noop);
  };

  // MARK: servers

  D.kinds = ['M3U / M3U8', 'Xtream Codes', 'Stalker / MAC-portal', 'Plex', 'Jellyfin', 'Emby', 'Stremio'];
  D.supportedKinds = D.kinds;
  D.syncSources = function () {
    return A.getSources().then(function (r) {
      if (!r) return false;
      applySources(r);
      return true;
    });
  };
  function applySources(r) {
    D.sources = r.sources.filter(function (s) { return s.deleted !== true; });
    D.mainSourceID = r.mainSourceID;
    D.sourcesSynced = true; // build 128: de lijst komt van de server (opruimen van categorieën van verwijderde servers mag)
    save();
    B.emit('sources');
  }

  /**
   * Bron toevoegen of wijzigen (alleen hoofdprofiel, zoals de andere apps). Eerst de nieuwste lijst van de server
   * lezen (met tombstones), dan alleen deze bron vervangen, updatedAt = nu, en de hele lijst terug (put_sources).
   * Onbekende velden, het apple/android-blok, catchupOffsets en ongewijzigde secrets blijven staan.
   * opts: {makeMain: true|false}
   */
  D.saveSource = function (src, opts) {
    opts = opts || {};
    return A.getSources().then(function (r) {
      if (!r) throw new Error(L('No internet connection.'));
      var list = r.sources.slice();
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (lower(list[i].id) === lower(src.id)) { idx = i; break; }
      var base = idx >= 0 && list[idx].deleted !== true ? list[idx] : {};
      var o = B.assign({}, base, src);
      o.secrets = B.assign({}, (base && base.secrets) || {}, src.secrets || {});
      Object.keys(o.secrets).forEach(function (k) { if (o.secrets[k] == null) delete o.secrets[k]; });
      ['m3uURL', 'epgURL', 'serverURL', 'username', 'macAddress'].forEach(function (k) { if (o[k] == null) o[k] = ''; });
      o.preferHLS = !!o.preferHLS;
      delete o.deleted; delete o.deletedAt;
      o.updatedAt = B.iso();
      if (idx >= 0) list[idx] = o; else list.push(o);
      var main = r.mainSourceID;
      var alive = list.filter(function (s) { return s.deleted !== true; });
      var mainValid = !!main && alive.some(function (s) { return lower(s.id) === lower(main); });
      if (opts.makeMain || !mainValid) main = o.id;
      return A.putSources(list, main).then(function (at) {
        applySources({ sources: list, mainSourceID: main, updatedAt: at });
        return o;
      });
    });
  };
  /** Bron verwijderen: tombstone {id, deleted, deletedAt, updatedAt}; hoofdserver schuift door naar de eerste die overblijft. */
  D.deleteSource = function (id) {
    return A.getSources().then(function (r) {
      if (!r) throw new Error(L('No internet connection.'));
      var now = B.iso();
      var list = r.sources.map(function (s) { return lower(s.id) === lower(id) ? { id: s.id, deleted: true, deletedAt: now, updatedAt: now } : s; });
      var main = r.mainSourceID;
      if (lower(main) === lower(id)) {
        var first = list.filter(function (s) { return s.deleted !== true; })[0];
        main = first ? first.id : null;
      }
      return A.putSources(list, main).then(function (at) {
        applySources({ sources: list, mainSourceID: main, updatedAt: at });
        if (lower(B.store.get('activeSource', '')) === lower(id)) B.store.del('activeSource');
        B.idb.delBig('lib:' + id); B.idb.delBig('epg:' + id); B.idb.del('chan:' + id);
      });
    });
  };
  /** Hoofdserver van het account wijzigen. */
  D.setMainSource = function (id) {
    return A.getSources().then(function (r) {
      if (!r) throw new Error(L('No internet connection.'));
      return A.putSources(r.sources, id).then(function (at) { applySources({ sources: r.sources, mainSourceID: id, updatedAt: at }); });
    });
  };
  /** Terugkijk-correctie per zender in minuten (−120…120, build 51), gedeeld veld catchupOffsets van de bron. */
  D.catchupOffset = function (src, channelID) {
    var o = src && src.catchupOffsets;
    var v = o && B.has(o, channelID) ? B.int(o[channelID]) : 0;
    return v || 0;
  };
  D.setCatchupOffset = function (src, channelID, minutes) {
    var m = B.clamp(Math.round(minutes || 0), -120, 120);
    var offsets = B.assign({}, (src && src.catchupOffsets) || {});
    if (m === 0) delete offsets[channelID]; else offsets[channelID] = m;
    var local = D.sourceById(src.id);
    if (local) { local.catchupOffsets = offsets; save(); }
    return A.getSources().then(function (r) {
      if (!r) return;
      var list = r.sources.map(function (s) {
        if (lower(s.id) !== lower(src.id) || s.deleted === true) return s;
        var c = B.assign({}, s);
        var cur = B.assign({}, s.catchupOffsets || {});
        if (m === 0) delete cur[channelID]; else cur[channelID] = m;
        c.catchupOffsets = cur;
        c.updatedAt = B.iso();
        return c;
      });
      return A.putSources(list, r.mainSourceID).then(function (at) { applySources({ sources: list, mainSourceID: r.mainSourceID, updatedAt: at }); });
    }).catch(B.noop);
  };
  D.sourceById = function (id) {
    for (var i = 0; i < D.sources.length; i++) if (lower(D.sources[i].id) === lower(id)) return D.sources[i];
    return null;
  };
  /** Actieve server: eigen keuze op deze tv, anders de hoofdserver van het account, anders de eerste die werkt. */
  D.activeSource = function () {
    var own = D.sourceById(B.store.get('activeSource', null));
    if (own) return own;
    var main = D.sourceById(D.mainSourceID);
    if (main && D.supportedKinds.indexOf(main.kind) >= 0) return main;
    for (var i = 0; i < D.sources.length; i++) if (D.supportedKinds.indexOf(D.sources[i].kind) >= 0) return D.sources[i];
    return main || D.sources[0] || null;
  };
  D.setActiveSource = function (id) { B.store.set('activeSource', id); };
  D.secret = function (src, name) { return (src && src.secrets && src.secrets[name]) || ''; };
  /** Eigen blok van Android (aanpassingen en vergrendelde groepen); wordt hier alleen gelezen. */
  D.customization = function (src) {
    var a = src && src.android;
    var c = (a && a.customization) || {};
    return {
      renamed: c.renamed || {}, hidden: c.hidden || [], groupOrder: c.groupOrder || [],
      channelOrder: c.channelOrder || {}, merged: c.merged || {}
    };
  };
  D.lockedGroups = function (src) { var a = src && src.android; return (a && a.lockedGroups) || []; };

  // MARK: per profiel (profile.<id>)

  // build 151: de pure functies (lezen, samenvoegen, opschonen, naar JSON) staan in syncmerge.js, zodat de Worker
  // (sync-worker.js) precies dezelfde code draait
  var SM = B.syncMerge;
  var time = SM.time, parseState = SM.parseState, mergeState = SM.mergeState, normalize = SM.normalize, toJSON = SM.toJSON,
    stateKey = SM.stateKey, hasAny = SM.hasAny, putNewer = SM.putNewer, parseSetField = SM.parseSetField, historyId = SM.historyId,
    mergeMaps = SM.mergeMaps;

  // Actief profiel: model + basis van de server
  var P = { id: null, st: null, base: null, names: [], dirty: false };
  function pkey(id) { return 'pstate.' + lower(id); }
  // build 151: bewaren van het actieve profiel. Na een lokale wijziging niet meer meteen (JSON.stringify van het hele
  // model op de hoofdthread bij elke klik), maar samengevoegd na 400 ms, met de tekst uit de Worker; bij verbergen of
  // sluiten van de pagina meteen. persistSeq: een oudere tekst overschrijft nooit een nieuwere.
  var persistSeq = 0, persistTimer = 0;
  function persistP() {
    if (!P.id) return;
    persistSeq++; clearTimeout(persistTimer); persistTimer = 0;
    B.store.set(pkey(P.id), { st: P.st, base: P.base, names: P.names, dirty: P.dirty });
  }
  function persistSoon() {
    if (!P.id || persistTimer) return;
    persistTimer = setTimeout(function () {
      persistTimer = 0;
      if (!P.id) return;
      var my = ++persistSeq, key = pkey(P.id);
      syncWorkerCall({ op: 'stringify', obj: { st: P.st, base: P.base, names: P.names, dirty: P.dirty } }).then(function (raw) {
        if (my === persistSeq && B.store.setRaw) B.store.setRaw(key, raw);
      }, function () { if (my === persistSeq) persistP(); });
    }, 400);
  }
  function persistNowIfPending() { if (persistTimer) persistP(); }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', persistNowIfPending);
    window.addEventListener('beforeunload', persistNowIfPending);
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') persistNowIfPending(); });
  /** Bewaren met teksten die al klaar zijn (uit de Worker of de stappen): geen JSON.stringify van het model hier. */
  function persistRaw(id, stStr, baseStr, names, dirty) {
    var raw = '{"st":' + stStr + ',"base":' + baseStr + ',"names":' + JSON.stringify(names || []) + ',"dirty":' + (dirty ? 'true' : 'false') + '}';
    if (B.store.setRaw) B.store.setRaw(pkey(id), raw); else B.store.set(pkey(id), JSON.parse(raw));
  }

  // MARK: Worker voor de sync (build 151)
  var sw = null, swBroken = false, swSeq = 0, swWait = {}, swIdle = 0;
  function syncWorker() {
    if (swBroken || typeof window.Worker !== 'function' || B.noSyncWorker) return null;
    if (sw) return sw;
    try {
      sw = new window.Worker('js/sync-worker.js?v=154');
      sw.onmessage = function (e) {
        var d = e.data || {}, w = swWait[d.id];
        if (!w) return;
        delete swWait[d.id]; clearTimeout(w.t);
        if (d.error) w.fail(); else w.ok(d.r);
        clearTimeout(swIdle);
        swIdle = setTimeout(function () { if (sw && !Object.keys(swWait).length) { try { sw.terminate(); } catch (x) { /* stil */ } sw = null; } }, 30000);
      };
      sw.onerror = function () {
        swBroken = true; sw = null;
        Object.keys(swWait).forEach(function (k) { var w = swWait[k]; delete swWait[k]; clearTimeout(w.t); w.fail(); });
      };
    } catch (e) { swBroken = true; sw = null; }
    return sw;
  }
  /** Promise met het antwoord van de Worker; zonder Worker (of fout, of na 15 s niets) een afwijzing: dan de terugval. */
  function syncWorkerCall(msg) {
    var w = syncWorker();
    if (!w) return Promise.reject(new Error('no_worker'));
    return new Promise(function (resolve, reject) {
      var id = ++swSeq;
      msg.id = id;
      swWait[id] = { ok: resolve, fail: function () { reject(new Error('worker')); }, t: setTimeout(function () { if (swWait[id]) { delete swWait[id]; reject(new Error('timeout')); } }, 15000) };
      try { w.postMessage(msg); } catch (e) { clearTimeout(swWait[id].t); delete swWait[id]; reject(e); }
    });
  }
  /** Samenvoegen: in de Worker, anders op de hoofdthread in stappen (elke stap een eigen macrotaak). */
  function computeMerge(inp) {
    function steps() {
      var r = {};
      return B.steps(SM.mergeSteps(inp, r)).then(function () { return r; });
    }
    return syncWorkerCall({ op: 'merge', inp: inp }).then(function (r) { return r && r.merged ? r : steps(); }, steps);
  }
  D._computeMerge = computeMerge;
  D.loadProfileState = function (id) {
    persistNowIfPending();
    // build 140 (Mijn lijst): wisselen terwijl het vorige profiel nog niet-geüploade wijzigingen had. D.flush() leest de
    // server pas ná het wisselen en voegde dan het nieuwe profiel samen: de toevoeging bleef lokaal en kwam nooit op het
    // andere apparaat aan. Nu gaat het vorige profiel apart naar de server.
    if (P.id && lower(P.id) !== lower(id) && P.dirty) {
      var prevId = P.id;
      persistP();
      clearTimeout(timer); timer = null;
      setTimeout(function () { uploadOther(prevId); }, 0);
    }
    var saved = B.store.get(pkey(id), null);
    P.id = id;
    P.st = (saved && saved.st) || { sets: { myList: {}, favorites: {}, watched: {}, recentChannels: {} }, progress: {}, history: {} };
    SET_FIELDS.forEach(function (f) { P.st.sets[f] = P.st.sets[f] || {}; });
    P.base = (saved && saved.base) || null;
    // build 146: lokaal nooit een pincode als tekst (oude kopie van ≤ 145): weg; de hash komt bij de volgende sync
    if (P.base && typeof P.base.pin === 'string') { delete P.base.pin; if (!B.has(P.base, 'pinHash')) delete P.base.pinUpdatedAt; }
    P.names = (saved && saved.names) || [];
    P.dirty = !!(saved && saved.dirty);
    // build 128: remap (catalogmeta) op dit profiel
    if (applyTransforms(P.st)) { P.st = normalize(P.st); P.dirty = true; persistP(); }
    B.emit('profileData');
  };
  /** build 128: haken op het model van het actieve profiel (xs.js: remap); true = er veranderde iets. */
  D.stateTransforms = D.stateTransforms || [];
  function applyTransforms(st) {
    var any = false;
    D.stateTransforms.forEach(function (fn) { try { if (fn(st)) any = true; } catch (e) { B.log('transform', e); } });
    return any;
  }
  /** build 128: remap meteen toepassen (na een nieuwe remap-regel) en uploaden. */
  D.applyRemapNow = function () {
    if (!P.st || !applyTransforms(P.st)) return false;
    P.st = normalize(P.st);
    changed(false);
    return true;
  };

  /**
   * Build 146: pincodes van alle profielen uit de state (profile.<id>: pinHash, pin en pinUpdatedAt zijn één geheel; het
   * geheel met de nieuwste pinUpdatedAt wint). Een geldige pinHash geldt altijd (pin negeren). Zonder pinHash maar met
   * een pincode als tekst (oude app): meteen hashen, pinHash zetten, pin = null, pinUpdatedAt NIET veranderen, en
   * uploaden. Past `sections` aan (zodat het samenvoegen van het actieve profiel de hash meeneemt).
   */
  function readPins(sections) {
    var mig = [];
    Object.keys(sections).forEach(function (name) {
      if (lower(name).indexOf('profile.') !== 0) return;
      var d = sections[name] && sections[name].data;
      if (!d || typeof d !== 'object' || B.pin.parse(d.pinHash)) return;
      var v = d.pin;
      if (v && typeof v === 'object') v = v.pin || v.value || v.code;
      if (v == null || !B.pin.valid(String(v))) return;
      mig.push({ name: name, d: d, pin: String(v) });
    });
    // build 147: als taak "pin migreren" (hang-detectie); het hashen zelf loopt nooit op de hoofdthread vast (pin.js)
    var tid = mig.length ? B.task.begin('pin_migrate') : 0;
    return Promise.all(mig.map(function (m) {
      return B.pin.make(m.pin).then(function (h) {
        m.d.pinHash = h; m.d.pin = null;
        return A.putState(m.name, m.d);
      }).catch(function (e) { B.log('pincode hashen', e && e.message); });
    })).then(function () {
      if (tid) B.task.end(tid);
      var pins = {};
      Object.keys(sections).forEach(function (name) {
        if (lower(name).indexOf('profile.') !== 0) return;
        var d = sections[name] && sections[name].data;
        if (!d || (!B.has(d, 'pinHash') && !B.has(d, 'pin'))) return;
        var id = lower(name.slice(8));
        var at = time(d.pinUpdatedAt) || 0;
        var cur = pins[id];
        if (!cur || at >= cur.at) pins[id] = { at: at, h: B.pin.parse(d.pinHash) };
      });
      var out = {};
      Object.keys(pins).forEach(function (k) { if (pins[k].h) out[k] = pins[k].h; });
      return out;
    });
  }

  var syncing = null, lastProgressUpload = 0, timer = null;

  /**
   * Alles van de server lezen en samenvoegen: instellingen, collecties, pincodes en het actieve profiel.
   * Upload als lokaal iets nieuwer is. Fouten zijn stil.
   */
  D.syncState = function () {
    if (syncing) return syncing;
    var stid = 0;
    syncing = A.getState().then(function (all) {
      stid = B.task.begin('sync_apply');
      if (!all) { D.lastSync = { at: B.iso(), ok: false }; B.store.set('lastSync', D.lastSync); return false; }
      // instellingen: het geheel van de server; wijzigingen van deze tv die nog niet geüpload zijn gaan erover en worden verstuurd
      if (all.settings) {
        D.settings = { data: all.settings.data || {}, updatedAt: all.settings.updatedAt };
        if (pendingSettings) { D.settings.data = applyPending(B.copy(D.settings.data), pendingSettings); uploadSettings(all.settings); }
      } else if (pendingSettings) uploadSettings(null);
      // collecties: die van de server; eigen wijzigingen die nog niet geüpload zijn gaan erover en worden verstuurd
      var colBefore = JSON.stringify(D.collections);
      if (all.collections) D.collections = all.collections.data || null;
      if (pendingCollections.length) { D.collections = applyCollectionChanges(D.collections, pendingCollections); uploadCollections(all.collections ? all.collections.data : null); }
      if (JSON.stringify(D.collections) !== colBefore) B.emit('collections');
      return readPins(all).then(function (pins) {
      var pinsChanged = JSON.stringify(pins) !== JSON.stringify(D.pins);
      D.pins = pins;
      D.lastSync = { at: B.iso(), ok: true }; B.store.set('lastSync', D.lastSync);
      save();
      if (pinsChanged) B.emit('profiles');
      B.emit('settings');
      // connections (Trakt/OpenSubtitles) en herinneringen voegen zelf samen
      B.emit('state', all);
      D.syncedOnce = true;
      // build 140: verborgen categorieën van het account (section `account`)
      mergeAccount(all, true);
      // build 140: andere profielen met niet-geüploade wijzigingen (wisselen terwijl offline) alsnog versturen
      setTimeout(uploadDirtyOthers, 0);
      if (!P.id) return true;
      editsAtMerge = edits;
      return mergeActive(all);
      });
    }).catch(function (e) { B.log('sync', e); D.lastSync = { at: B.iso(), ok: false }; B.store.set('lastSync', D.lastSync); return false; }).then(function (r) {
      if (stid) B.task.end(stid);
      syncing = null;
      // build 140 (Mijn lijst): een wijziging tijdens deze sync (na het lezen van de server) kwam niet mee; de timer
      // van die wijziging kreeg deze (lopende) sync terug en verstuurde dus niets. Nu meteen nog een ronde.
      if (P.id && P.dirty && edits !== editsAtMerge) { clearTimeout(timer); timer = setTimeout(function () { D.syncState(); }, 1000); }
      return r;
    });
    return syncing;
  };
  var edits = 0, editsAtMerge = 0;

  /** Profiel dat niet actief is: lokale niet-geüploade wijzigingen samenvoegen met de server en versturen. */
  var otherBusy = {};
  function uploadOther(id) {
    var lid = lower(id);
    if (!lid || otherBusy[lid] || (P.id && lower(P.id) === lid)) return Promise.resolve(false);
    var saved = B.store.get(pkey(id), null);
    if (!saved || !saved.dirty || !saved.st) return Promise.resolve(false);
    otherBusy[lid] = true;
    var C = { id: id, st: saved.st, base: saved.base || null, names: saved.names || [], dirty: true };
    SET_FIELDS.forEach(function (f) { C.st.sets[f] = C.st.sets[f] || {}; });
    return A.getState().then(function (all) {
      if (!all) return false;
      // intussen weer actief geworden: dan doet de gewone sync het
      if (P.id && lower(P.id) === lid) return false;
      return mergeProfile(all, C, false);
    }).catch(function (e) { B.log('sync ander profiel', e); return false; }).then(function (r) { delete otherBusy[lid]; return r; });
  }
  D._uploadOther = uploadOther;
  function uploadDirtyOthers() {
    B.store.keys('pstate.').forEach(function (k) {
      var id = k.slice(7);
      if (P.id && lower(P.id) === lower(id)) return;
      var s = B.store.get(k, null);
      if (s && s.dirty) uploadOther(id);
    });
  }
  /** build 140: heeft dit (niet-actieve) profiel lokale wijzigingen die nog naar de server moeten? (xs.js: niet overschrijven) */
  D.hasLocalChanges = function (id) {
    if (P.id && lower(P.id) === lower(id)) return !!P.dirty;
    var s = B.store.get(pkey(id), null);
    return !!(s && s.dirty) || !!otherBusy[lower(id)];
  };

  function mergeActive(all) { return mergeProfile(all, P, true); }
  function persistCtx(C, active) {
    if (active) { persistP(); return; }
    B.store.set(pkey(C.id), { st: C.st, base: C.base, names: C.names, dirty: C.dirty });
  }
  function mergeProfile(all, P, active) {
    var id = lower(P.id);
    var names = Object.keys(all).filter(function (n) { return lower(n) === 'profile.' + id; });
    var server = null, base = null;
    // build 151: lezen en samenvoegen in computeMerge (Worker of stappen); hier alleen welke secties
    var datas = [];
    names.forEach(function (n) {
      var d = all[n] && all[n].data;
      if (!d || typeof d !== 'object') return;
      if (!base || n === 'profile.' + P.id) base = d;
      datas.push(d);
    });
    // kijkvoorkeuren (prefs), startscherm (homeLayout) en pincode (pin): per onderdeel wint het geheel met de nieuwste
    // tijd; een nieuwere lokale versie blijft staan en gaat mee
    var prefsNewer = false, localBase = P.base;
    if (base) {
      var nb = null;
      WHOLE.forEach(function (o) {
        var lAt = localBase ? o.at(localBase) : 0;
        if (lAt && lAt > o.at(base)) {
          nb = nb || B.copy(base);
          o.fields.forEach(function (f) { if (B.has(localBase, f)) nb[f] = B.copy(localBase[f]); else delete nb[f]; });
          prefsNewer = true;
        }
      });
      if (nb) base = nb;
      P.base = base;
    } else if (localBase && WHOLE.some(function (o) { return o.at(localBase) > 0; })) prefsNewer = true;
    // build 91: kijkvoorkeuren van een ander apparaat → instellingen opnieuw tekenen
    if (active && JSON.stringify(localBase && localBase.prefs || null) !== JSON.stringify(P.base && P.base.prefs || null)) setTimeout(function () { B.emit('settings'); }, 0);
    if (names.length) P.names = names;
    var local = P.st, e0 = edits, base0 = P.base;
    return computeMerge({ datas: datas, local: local, base: base0, prefsNewer: prefsNewer }).then(function (r) {
      var merged = r.merged, late = active && (edits !== e0 || P.st !== local);
      // wijziging hier tijdens het samenvoegen (of remap-regels van xs.js): op de hoofdthread nog even bijwerken (zeldzaam)
      if (late) merged = normalize(mergeState(merged, P.st));
      var transformed = applyTransforms(merged);
      if (transformed) merged = normalize(merged);
      var exact = !late && !transformed && P.base === base0;
      var mk = exact ? r.mergedKey : stateKey(merged);
      var changed = mk !== r.localKey || late;
      P.st = merged;
      var needUpload = prefsNewer || (!r.hasSrv ? hasAny(merged) : mk !== r.srvKey);
      P.dirty = late;
      if (exact) { if (active) persistSeq++; persistRaw(P.id, r.stStr, r.baseStr, P.names, P.dirty); } else persistCtx(P, active);
      if (changed && active) B.emit('profileData');
      if (!needUpload) return true;
      var json = exact && r.json ? r.json : toJSON(P.base, merged), jsonStr = exact && r.json ? r.jsonStr : null;
      var stStr = exact ? r.stStr : null;
      var targets = P.names.length ? P.names : ['profile.' + P.id];
      return Promise.all(targets.map(function (n) { return A.putState(n, json); })).then(function (res) {
        if (res.some(function (x) { return x == null; })) { P.dirty = true; persistCtx(P, active); return false; }
        P.base = json;
        // nog steeds hetzelfde model: bewaren met de klare teksten
        if (stStr && jsonStr && P.st === merged && !P.dirty) { if (active) persistSeq++; persistRaw(P.id, stStr, jsonStr, P.names, false); } else persistCtx(P, active);
        return true;
      });
    });
  }
  /** Onderdelen van profile.<id> die als geheel samenvoegen (nieuwste tijd wint), met hun tijd. */
  var WHOLE = [
    { fields: ['prefs'], at: function (d) { var v = d && d.prefs; return v && typeof v === 'object' ? time(v.updatedAt) || time(d.prefsUpdatedAt) || 0 : 0; } },
    { fields: ['homeLayout'], at: function (d) { var v = d && d.homeLayout; return v && typeof v === 'object' ? time(v.updatedAt) || 0 : 0; } },
    // build 146: pinHash, pin en pinUpdatedAt samen
    { fields: ['pinHash', 'pin', 'pinUpdatedAt'], at: function (d) { return d && (B.has(d, 'pin') || B.has(d, 'pinHash')) ? time(d.pinUpdatedAt) || 0 : 0; } }
  ];
  /** Lokale wijziging: na ~3 s naar de server (voortgang tijdens afspelen hooguit eens per 30 s). */
  function changed(progressOnly) {
    edits++;
    // build 151: bewaren samengevoegd en met de tekst uit de Worker (persistSoon), niet bij elke klik op de hoofdthread
    P.dirty = true; persistSoon();
    B.emit('profileData');
    var wait = 3000;
    if (progressOnly) {
      var since = Date.now() - lastProgressUpload;
      if (since < 30000) wait = Math.max(3000, 30000 - since);
    }
    clearTimeout(timer);
    timer = setTimeout(function () { lastProgressUpload = Date.now(); D.syncState(); }, wait);
  }
  /** Meteen versturen (stoppen met afspelen, app naar de achtergrond). */
  D.flush = function () {
    if (!P.dirty) return Promise.resolve();
    clearTimeout(timer);
    lastProgressUpload = Date.now();
    return D.syncState();
  };

  // lezen
  function liveKeys(m) {
    return Object.keys(m || {}).filter(function (k) { return m[k].on; }).sort(function (a, b) { return m[b].at - m[a].at; });
  }
  D.key = function (playlist, item) { return playlist + '|' + item; };
  D.episodeKey = function (series, season, ep) { return 'ep:' + series + '|' + season + '-' + ep; };
  // Server-id in sleutels ("<server>|<item>") hoofdletterongevoelig: iOS schrijft hem met hoofdletters, web/Android/
  // Samsung TV soms met kleine letters (server daar aangemaakt). Opgeslagen sleutels blijven zoals ze zijn (oudere apps);
  // bij het lezen krijgt de server-id de schrijfwijze van de bekende bron, zodat `k.split('|')[0] === src` overal klopt.
  var UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function knownSource(id) {
    var l = lower(id);
    for (var i = 0; i < D.sources.length; i++) if (lower(D.sources[i].id) === l) return D.sources[i].id;
    return null;
  }
  /** Sleutel met de server-id zoals de bron hem heeft (anders ongewijzigd). */
  function canonKey(k) {
    var bar = k.indexOf('|');
    if (bar <= 0) return k;
    var s = knownSource(k.slice(0, bar));
    return s == null ? k : s + k.slice(bar);
  }
  /** Vergelijkingssleutel: server-id (bekende bron of UUID) in kleine letters, item-id exact. */
  function normKey(k) {
    var bar = k.indexOf('|');
    if (bar <= 0) return k;
    var p = k.slice(0, bar);
    return (knownSource(p) != null || UUIDISH.test(p)) ? lower(p) + k.slice(bar) : k;
  }
  /** Alle opgeslagen schrijfwijzen van sleutel k in m. */
  function variants(m, k) {
    var n = normKey(k);
    return Object.keys(m || {}).filter(function (x) { return x === k || normKey(x) === n; });
  }
  D.inSet = function (field, k) {
    var m = P.st && P.st.sets[field];
    if (!m) return false;
    if (m[k] && m[k].on) return true;
    return variants(m, k).some(function (x) { return m[x].on; });
  };
  D.setList = function (field) {
    if (!P.st) return [];
    var seen = {};
    return liveKeys(P.st.sets[field]).map(canonKey).filter(function (k) { var n = normKey(k); if (seen[n]) return false; seen[n] = true; return true; });
  };
  D.progress = function (k) { var it = P.st && P.st.progress[k]; return it && it.v ? it.v : null; };
  D.progressList = function () {
    if (!P.st) return [];
    var m = P.st.progress;
    return Object.keys(m).filter(function (k) { return m[k].v; }).map(function (k) { return { key: k, e: m[k].v }; })
      .sort(function (a, b) { return b.e.updated - a.e.updated; });
  };
  D.history = function () {
    if (!P.st) return [];
    var m = P.st.history;
    var seen = {};
    // dezelfde titel uit iOS (hoofdletters) én web/Samsung TV (kleine letters): één keer, de nieuwste
    return Object.keys(m).map(function (k) { return m[k].v; }).filter(Boolean).sort(function (a, b) { return b.date - a.date; })
      .filter(function (e) { var n = normKey(historyId(e)); if (seen[n]) return false; seen[n] = true; return true; });
  };
  D.isWatched = function (k) { return D.inSet('watched', k); };
  // MARK: build 140: verborgen categorieën voor het hele account (state-section `account`, contract in docs/ACCOUNT.md)
  //
  // {hiddenCategories: [{id: "<server-id kleine letters>|<categorienaam exact>", at}], removed: {hiddenCategories: {id: at}},
  //  updatedAt}; per sleutel wint de nieuwste `at` (zoals myList). Geldt voor alle profielen behalve kinderprofielen.
  // profile.<id>.hiddenCategories (build 128) wordt niet meer gelezen of gewijzigd (alleen eenmalig overgenomen).

  var ACC_KEY = 'acct', ACC_MIG = 'acct.catMigrated140', ACC_SECTION = 'account';
  var AC = B.store.get(ACC_KEY, null) || {};
  AC = { hc: AC.hc || {}, base: AC.base || null, dirty: !!AC.dirty, rev: 0 };
  function saveAC() { B.store.set(ACC_KEY, { hc: AC.hc, base: AC.base, dirty: AC.dirty }); }
  /** Sleutel met de server-id in kleine letters (categorienaam exact). */
  function accKey(k) { k = String(k); var bar = k.indexOf('|'); return bar > 0 ? lower(k.slice(0, bar)) + k.slice(bar) : k; }
  function parseAcc(d) {
    var raw = parseSetField(d && d.hiddenCategories, d && d.removed && typeof d.removed === 'object' ? d.removed.hiddenCategories : null);
    var out = {};
    Object.keys(raw).forEach(function (k) { putNewer(out, accKey(k), raw[k]); });
    return out;
  }
  function pruneAcc(m) {
    var cutoff = Date.now() - REMOVED_DAYS * 86400000, out = {};
    Object.keys(m).forEach(function (k) { if (m[k].on || m[k].at >= cutoff) out[k] = m[k]; });
    return out;
  }
  function accJSON(base, m) {
    var out = base && typeof base === 'object' ? B.copy(base) : {};
    out.hiddenCategories = Object.keys(m).filter(function (k) { return m[k].on; })
      .sort(function (x, y) { return (m[y].at - m[x].at) || (x < y ? -1 : x > y ? 1 : 0); })
      .map(function (k) { return { id: k, at: B.iso(m[k].at) }; });
    var removed = out.removed && typeof out.removed === 'object' && !Array.isArray(out.removed) ? out.removed : {};
    removed.hiddenCategories = {};
    Object.keys(m).filter(function (k) { return !m[k].on; }).sort().forEach(function (k) { removed.hiddenCategories[k] = B.iso(m[k].at); });
    out.removed = removed;
    out.updatedAt = B.iso();
    return out;
  }
  function accSig(m) { return JSON.stringify(Object.keys(m).sort().map(function (k) { return [k, m[k].on, m[k].at]; })); }
  function liveSig(m) { return Object.keys(m).filter(function (k) { return m[k].on; }).sort().join('\n'); }
  /** Categorieën van servers die niet meer bestaan: als verwijdering (gesynct). true = er veranderde iets. */
  function accTombstones(m) {
    if (!D.sourcesSynced) return false;
    var now = Date.now(), any = false;
    Object.keys(m).forEach(function (k) {
      var bar = k.indexOf('|');
      if (!m[k].on || bar <= 0 || knownSource(k.slice(0, bar))) return;
      m[k] = { at: Math.max(now, m[k].at + 1), on: false };
      any = true;
    });
    return any;
  }
  /**
   * Eenmalige migratie (per apparaat): de unie van hiddenCategories uit profile.<id> van alle niet-kinderprofielen, met
   * `at` = epoch, zodat elke keuze die al in `account` staat (ook een verwijdering) wint. Mag veilig vaker lopen.
   */
  function accMigrate(all, m) {
    if (B.store.get(ACC_MIG, false) || !D.profilesSynced || !D.profiles.length) return false;
    var any = false;
    Object.keys(all).forEach(function (name) {
      if (lower(name).indexOf('profile.') !== 0) return;
      var p = D.profileById(name.slice(8));
      if (!p || p.kids) return;
      var d = all[name] && all[name].data;
      if (!d || typeof d !== 'object') return;
      var set = parseSetField(d.hiddenCategories, d.removed && typeof d.removed === 'object' ? d.removed.hiddenCategories : null);
      Object.keys(set).forEach(function (k) {
        if (!set[k].on) return;
        var ak = accKey(k);
        if (!m[ak]) { m[ak] = { at: 0, on: true }; any = true; }
      });
    });
    return { changed: any };
  }
  /**
   * Section `account` van de server samenvoegen met de lokale set (full = volledige sync: ook de migratie).
   * Upload als lokaal iets nieuwer is of de server niets heeft.
   */
  var accBusy = null, accTimer = null, accEdits = 0;
  function mergeAccount(all, full) {
    var sec = all && all[ACC_SECTION];
    var srvData = sec && sec.data && typeof sec.data === 'object' ? sec.data : null;
    var sm = srvData ? parseAcc(srvData) : {};
    var before = liveSig(AC.hc);
    var merged = mergeMaps(AC.hc, sm);
    var mig = full ? accMigrate(all, merged) : false;
    accTombstones(merged);
    merged = pruneAcc(merged);
    AC.hc = merged;
    if (srvData) AC.base = srvData;
    AC.rev++;
    var need = srvData ? accSig(merged) !== accSig(pruneAcc(sm)) : Object.keys(merged).length > 0;
    saveAC();
    if (liveSig(merged) !== before) B.emit('accountCats');
    if (!need) {
      AC.dirty = false; saveAC();
      if (mig) B.store.set(ACC_MIG, B.iso());
      return Promise.resolve(true);
    }
    return putAccount(mig);
  }
  function putAccount(mig) {
    var sentEdits = accEdits;
    var json = accJSON(AC.base, AC.hc);
    return A.putState(ACC_SECTION, json).then(function (at) {
      if (at == null) { AC.dirty = true; saveAC(); return false; }
      AC.base = json;
      if (accEdits === sentEdits) AC.dirty = false;
      saveAC();
      if (mig) B.store.set(ACC_MIG, B.iso());
      return true;
    }, function () { AC.dirty = true; saveAC(); return false; });
  }
  /** Alleen de section `account` lezen, samenvoegen en (als nodig) versturen. */
  function syncAccount() {
    if (accBusy) return accBusy.then(function () { return AC.dirty ? syncAccount() : true; });
    accBusy = A.getState([ACC_SECTION]).then(function (all) {
      if (!all) return false;
      return mergeAccount(all, false);
    }).catch(function (e) { B.log('sync account', e); return false; }).then(function (r) { accBusy = null; return r; });
    return accBusy;
  }
  D.syncAccount = syncAccount;
  function accChanged() {
    accEdits++;
    AC.dirty = true; AC.rev++; saveAC();
    B.emit('accountCats');
    clearTimeout(accTimer);
    accTimer = setTimeout(syncAccount, 3000);
  }
  // nieuwe serverlijst: categorieën van verwijderde servers weg
  B.on('sources', function () { if (accTombstones(AC.hc)) accChanged(); });

  var catIdx = null, catIdxRev = -1;
  /** Namen (zoals de server ze levert) van de categorieën die voor het account uit staan op server sid. Kinderprofiel: geen. */
  D.hiddenCategoryNames = function (sid) {
    var p = B.app && B.app.profile;
    if (!sid || (p && p.kids)) return {};
    if (!catIdx || catIdxRev !== AC.rev) {
      catIdx = {};
      Object.keys(AC.hc).forEach(function (k) {
        if (!AC.hc[k].on) return;
        var bar = k.indexOf('|');
        if (bar <= 0) return;
        var s = k.slice(0, bar);
        (catIdx[s] = catIdx[s] || {})[k.slice(bar + 1)] = true;
      });
      catIdxRev = AC.rev;
    }
    return catIdx[lower(sid)] || {};
  };
  /** Eén categorie aan/uit voor het account. */
  D.setCategoryHidden = function (sid, name, hidden) { D.setCategoriesHidden([{ sid: sid, name: name, hidden: hidden }]); };
  /** Meerdere tegelijk (één upload, één keer opnieuw filteren). */
  D.setCategoriesHidden = function (list) {
    var any = false;
    (list || []).forEach(function (c) {
      if (!c || !c.sid || c.name == null) return;
      var k = lower(c.sid) + '|' + c.name, cur = AC.hc[k], on = !!c.hidden;
      if (!!(cur && cur.on) === on) return;
      var now = Date.now();
      if (cur && cur.at >= now) now = cur.at + 1;
      AC.hc[k] = { at: now, on: on };
      any = true;
    });
    if (any) accChanged();
  };
  D.categoriesRev = function () { return AC.rev; };
  D._AC = function () { return AC; };
  D._mergeAccount = mergeAccount;

  // schrijven
  D.toggleSet = function (field, k, on) {
    if (!P.st) return;
    var cur = D.inSet(field, k);
    if (on == null) on = !cur;
    if (on === cur) return;
    var m = P.st.sets[field];
    // build 140 (Mijn lijst): de nieuwe tijd ligt altijd ná wat we van dit item weten (ook een verwijdering van een
    // ander apparaat met een klok die voorloopt); anders won die oude verwijdering bij de volgende sync en verdween het
    var now = Date.now();
    variants(m, k).concat([k]).forEach(function (x) { if (m[x] && m[x].at >= now) now = m[x].at + 1; });
    if (on) m[k] = { at: now, on: true };
    // uit: alle schrijfwijzen (anders komt het via de andere terug)
    else variants(m, k).concat([k]).forEach(function (x) { if (x === k || (m[x] && m[x].on)) m[x] = { at: now, on: false }; });
    changed(false);
  };
  D.pushRecentChannel = function (playlist, channelID) {
    if (!P.st) return;
    P.st.sets.recentChannels[D.key(playlist, channelID)] = { at: Date.now(), on: true };
    P.st = normalize(P.st);
    changed(false);
  };
  D.setProgress = function (k, e) {
    if (!P.st) return;
    e.updated = Date.now();
    P.st.progress[k] = { at: e.updated, v: e };
    changed(true);
  };
  D.clearProgress = function (k) {
    if (!P.st || !P.st.progress[k] || !P.st.progress[k].v) return;
    P.st.progress[k] = { at: Date.now(), v: null };
    changed(false);
  };
  D.setWatched = function (k, on) { D.toggleSet('watched', k, on); };

  /**
   * Kijkvoorkeuren van het actieve profiel (profile.<id>.prefs, zoals Android): autoSubtitles, audioLanguage,
   * streamSubtitleLanguage (taal van ondertitels in de stream) en subtitleLanguage (OpenSubtitles). null = niet ingesteld.
   */
  D.profilePref = function (key) {
    var pr = P.base && P.base.prefs;
    if (!pr || typeof pr !== 'object' || !B.has(pr, key) || pr[key] == null) return null;
    return String(pr[key]);
  };
  D.setProfilePref = function (key, value) {
    if (!P.id) return;
    P.base = P.base ? B.copy(P.base) : {};
    var pr = B.assign({}, (P.base.prefs && typeof P.base.prefs === 'object') ? P.base.prefs : {});
    pr[key] = value;
    pr.updatedAt = B.iso();
    P.base.prefs = pr;
    changed(false);
  };
  D.addHistory = function (e) {
    if (!P.st) return;
    var id = historyId(e);
    P.st.history[id] = { at: e.date, v: e };
    changed(false);
  };

  // MARK: collecties (section `collections`, version 2: per profiel)

  /** Is dit het hoofdprofiel (hoofdletterongevoelig)? */
  function isMainId(profileId) { var m = D.mainProfile(); return !!(m && profileId && lower(m.id) === lower(profileId)); }
  /** Items van één profiel-emmer (alle sleutels die hoofdletterongevoelig gelijk zijn). */
  function bucketItems(c, profileId) {
    var list = [];
    if (!c || !c.profiles || typeof c.profiles !== 'object' || Array.isArray(c.profiles)) return list;
    Object.keys(c.profiles).forEach(function (k) {
      if (lower(k) !== lower(profileId)) return;
      var b = c.profiles[k];
      list = list.concat((b && Array.isArray(b.items) ? b.items : Array.isArray(b) ? b : []));
    });
    return list;
  }
  /**
   * Tijdstempels van de oude collecties (build 51–53, zonder profiel) en van die van het hoofdprofiel, per id
   * (zoals legacyStamps in StateSync op iOS, build 74): web-build 69–73 en iOS-build 54–73 kopieerden de oude
   * collecties naar élk profiel. Zo'n ongewijzigde kopie bij een ander profiel (zelfde id, updatedAt binnen 1 s)
   * hoort niet bij dat profiel.
   */
  function legacyStamps(c) {
    var st = {};
    function add(x) { if (x && x.id) { var t = colAt(x); (st[lower(x.id)] = st[lower(x.id)] || []).push(t); } }
    if (c && Array.isArray(c.items)) c.items.forEach(add);
    var m = D.mainProfile();
    if (m) bucketItems(c, m.id).forEach(add);
    return st;
  }
  function isLegacyCopy(x, stamps) {
    if (!x || !x.id || x.deleted === true) return false;
    var list = stamps[lower(x.id)], t = colAt(x);
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (Math.abs(list[i] - t) < 1000) return true;
    return false;
  }

  /**
   * Collecties van een profiel (zonder tombstones), op volgorde. Alleen de eigen emmer: een profiel ziet nooit de
   * collecties van een ander profiel. Oud formaat (zonder profiel) hoort alleen bij het hoofdprofiel (iOS build 74).
   */
  D.collectionsFor = function (profileId) {
    var c = D.collections;
    if (!c || typeof c !== 'object' || !profileId) return [];
    if (Array.isArray(c)) c = { items: c };
    var list = null;
    var main = isMainId(profileId);
    if (isMigrated(c)) {
      list = bucketItems(c, profileId);
      if (!main) { var stamps = legacyStamps(c); list = list.filter(function (x) { return !isLegacyCopy(x, stamps); }); }
    } else {
      // nog niet gemigreerd: de oude lijst alleen voor het hoofdprofiel, plus wat al in de eigen emmer staat
      list = bucketItems(c, profileId).concat(main && Array.isArray(c.items) ? c.items : []);
    }
    var byId = {};
    list.forEach(function (x) {
      if (!x || !x.id) return;
      var cur = byId[lower(x.id)];
      if (!cur || (time(x.updatedAt) || 0) > (time(cur.updatedAt) || 0)) byId[lower(x.id)] = x;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (x) { return x.deleted !== true; })
      .sort(function (a, b) { return ((B.int(a.order) || 0) - (B.int(b.order) || 0)) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0); });
  };

  // MARK: intro-markeringen (settings.shared.introMarkers, sleutel "<serverID>:<serieID>", hoofdletterongevoelig)

  D.introMarker = function (sourceId, seriesId) {
    var all = D.shared('introMarkers', {}) || {};
    var want = lower(sourceId + ':' + seriesId);
    for (var k in all) {
      if (B.has(all, k) && lower(k) === want) {
        var m = all[k] || {};
        var o = { introStart: B.num(m.introStart), introEnd: B.num(m.introEnd), creditsStart: B.num(m.creditsStart) };
        if (o.introStart == null && o.introEnd == null && o.creditsStart == null) return null;
        return o;
      }
    }
    return null;
  };

  /**
   * Intro-markering zetten of wissen (alle velden null = gewist; blijft staan zodat het wissen doorkomt).
   * Zoals setShared: nieuwste settings van de server, alleen deze serie aanpassen, het geheel uploaden.
   */
  D.setIntroMarker = function (sourceId, seriesId, marker) {
    function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }
    addPending('intro', sourceId + ':' + seriesId, { introStart: r1(marker.introStart), introEnd: r1(marker.introEnd), creditsStart: r1(marker.creditsStart) });
    return uploadSettings();
  };

  /** Startscherm-indeling van het actieve profiel (homeLayout in profile.<id>), of null. */
  D.homeLayout = function () {
    var h = P.base && P.base.homeLayout;
    return h && Array.isArray(h.rows) ? h.rows : null;
  };

  /** Startscherm-indeling van het actieve profiel opslaan (homeLayout {rows:[{key, visible}], updatedAt}); onbekende velden blijven. */
  D.setHomeLayout = function (rows) {
    if (!P.id) return;
    P.base = P.base ? B.copy(P.base) : {};
    var old = (P.base.homeLayout && typeof P.base.homeLayout === 'object') ? P.base.homeLayout : {};
    P.base.homeLayout = B.assign({}, old, { rows: rows.map(function (r) { return { key: r.key, visible: r.visible !== false }; }), updatedAt: B.iso() });
    changed(false);
  };

  // MARK: bekeken (lokaal, per profiel) en geschiedenis wissen

  var watchedCounts = null;
  B.on('profileData', function () { watchedCounts = null; });
  /** Aantal lokaal bekeken afleveringen van een serie (sleutels ep:<serie>|s-e), zoals localWatchedCount op iOS. */
  D.watchedCount = function (seriesId) {
    if (!P.st) return 0;
    if (!watchedCounts) {
      watchedCounts = {};
      var m = P.st.sets.watched;
      Object.keys(m).forEach(function (k) {
        if (!m[k].on || k.indexOf('ep:') !== 0) return;
        var i = k.lastIndexOf('|');
        if (i < 3) return;
        var sid = k.slice(3, i);
        watchedCounts[sid] = (watchedCounts[sid] || 0) + 1;
      });
    }
    return watchedCounts[seriesId] || 0;
  };
  var formCounts = null;
  B.on('profileData', function () { formCounts = null; });
  /** build 154: aantal gezien-afleveringen van een serie via de inhoudssleutels (w:e:<show>|s-e, ook van andere servers). */
  D.contentEpisodeCount = function (series) {
    if (!P.st || !series) return 0;
    if (!formCounts) {
      formCounts = Object.create(null);
      var m = P.st.sets.watched;
      Object.keys(m).forEach(function (k) {
        if (!m[k].on || k.indexOf('w:e:') !== 0) return;
        var i = k.lastIndexOf('|');
        if (i < 5) return;
        var f = k.slice(4, i);
        formCounts[f] = (formCounts[f] || 0) + 1;
      });
    }
    var best = 0;
    WK.lookupKeys(WK.showForms(series).map(function (f) { return 'w:s:' + f; })).forEach(function (k) {
      var n = formCounts[k.slice(4)] || 0;
      if (n > best) best = n;
    });
    return best;
  };
  // MARK: build 154: inhoudssleutels voor gezien over alle servers (watchkeys.js, contract docs/ACCOUNT.md, Build 154)
  //
  // Naast de id-sleutels (xv123, ep:<serie>|s-e) staan w:m:/w:e:/w:s:-sleutels in dezelfde set; ze gaan met de gewone
  // profiel-sync mee (onbekende id's bewaren oudere apps gewoon). Lezen: eigen id of één inhoudssleutel (jaar ±1).
  var WK = B.wk;
  function hasW(k) { var m = P.st && P.st.sets.watched; return !!(m && m[k] && m[k].on); }
  D.hasWatchedKey = hasW;
  function uniq(a) { var s = {}; return a.filter(function (k) { if (!k || s[k]) return false; s[k] = true; return true; }); }
  /** Tijd ná alles wat we van deze sleutels weten (zoals toggleSet). */
  function stampFor(m, keys) {
    var now = Date.now();
    keys.forEach(function (k) { if (m[k] && m[k].at >= now) now = m[k].at + 1; });
    return now;
  }
  /** Sleutels aan of uit met één tijd; true als er iets veranderde. Uit: alle sleutels in removed (ook nieuwe). */
  function writeW(keys, on, force) {
    var m = P.st.sets.watched;
    keys = uniq(keys);
    // force: alles opnieuw met een nieuwe tijd (de nieuwste gebeurtenis moet de toevoeging zijn)
    var todo = force ? keys : keys.filter(function (k) { return on ? !(m[k] && m[k].on) : !(m[k] && !m[k].on); });
    if (!todo.length) return false;
    var now = stampFor(m, keys);
    (on ? todo : keys).forEach(function (k) { m[k] = { at: now, on: !!on }; });
    return true;
  }
  /** Id-sleutel met alle opgeslagen schrijfwijzen (server-id met andere hoofdletters). */
  function idKeys(m, k) { return k ? variants(m, k).concat([k]) : []; }
  // contract (aangevuld): over alle kandidaatsleutels van het item (id-sleutels in alle schrijfwijzen en inhoudssleutels,
  // titel met jaar ±1) wint de nieuwste gebeurtenis; een toevoeging = gezien, een verwijdering = niet gezien
  function getW(k) { var m = P.st && P.st.sets.watched; return m && m[k] ? m[k] : null; }
  function idCands(ids) {
    var m = P.st && P.st.sets.watched, out = [];
    ids.forEach(function (k) {
      if (k == null || k === '') return;
      k = String(k);
      // alleen "<server>|<item>" heeft andere schrijfwijzen; anders niet de hele set doorlopen (snel voor elke poster)
      var bar = k.indexOf('|'), p = bar > 0 ? k.slice(0, bar) : null;
      out = out.concat(p != null && (knownSource(p) != null || UUIDISH.test(p)) ? idKeys(m, k) : [k]);
    });
    return out;
  }
  D.movieWatched = function (mv) { return !!mv && !!P.st && WK.latest(getW, idCands([mv.id]), WK.movieKeys(mv)); };
  D.episodeWatched = function (series, ep) {
    if (!ep || !P.st) return false;
    var ids = [ep.id];
    if (ep.seriesID != null && ep.season != null && ep.number != null) ids.push(D.episodeKey(ep.seriesID, ep.season, ep.number));
    return WK.latest(getW, idCands(ids), series ? WK.episodeKeys(series, ep.season, ep.number) : []);
  };
  D.seriesWatched = function (series) { return !!series && !!P.st && WK.latest(getW, [], WK.showKeys(series)); };
  /** Film (on)gezien: id-sleutel plus inhoudssleutels; uitvinken haalt ook de sleutels met jaar ±1 weg. */
  D.setMovieWatched = function (mv, on) {
    if (!P.st || !mv) return false;
    var m = P.st.sets.watched, own = WK.movieKeys(mv), ch;
    if (on) ch = !D.movieWatched(mv) && writeW([mv.id].concat(own), true, true);
    else ch = writeW(idKeys(m, mv.id).filter(function (k) { return k === mv.id || (m[k] && m[k].on); }).concat(own, WK.matching(hasW, own)), false);
    if (ch) changed(false);
    return ch;
  };
  function epKeysOf(series, ep, on) {
    var m = P.st.sets.watched, own = series ? WK.episodeKeys(series, ep.season, ep.number) : [];
    var ids = [ep.id];
    if (ep.seriesID != null && ep.season != null && ep.number != null) ids.push(D.episodeKey(ep.seriesID, ep.season, ep.number));
    if (on) return ids.concat(own);
    var all = [];
    ids.forEach(function (k) { idKeys(m, k).forEach(function (x) { if (x === k || (m[x] && m[x].on)) all.push(x); }); });
    return all.concat(own, WK.matching(hasW, own));
  }
  /**
   * Serie gezien (w:s:): alle uitgezonden afleveringen gezien. aired = aantal van Trakt (aired_episodes), anders het
   * aantal afleveringen op de server. Is er daarna een niet meer gezien, dan gaat w:s: naar removed. true = veranderd.
   */
  function updateSeries(series, eps, aired, watchedFn, addOnly) {
    if (!series || !eps || !eps.length) return false;
    var n = 0;
    eps.forEach(function (e) { if (watchedFn(e)) n++; });
    var total = aired > 0 ? aired : eps.length;
    var keys = WK.showKeys(series);
    if (!keys.length) return false;
    if (n >= total) return !WK.latest(getW, [], keys) && writeW(keys, true, true);
    if (addOnly) return false;
    return keys.some(hasW) ? writeW(keys.concat(WK.matching(hasW, keys)), false) : false;
  }
  /**
   * Afleveringen (on)gezien, met de serie voor de inhoudssleutels (zonder serie alleen de id-sleutels, zoals ≤ 153).
   * opts: {all: alle afleveringen van de serie (voor w:s:), aired: aantal van Trakt, extra: (ep) → ook gezien (Trakt)}.
   */
  D.setEpisodesWatched = function (eps, on, series, opts) {
    if (!P.st || !eps) return false;
    opts = opts || {};
    var ch = false;
    eps.forEach(function (ep) {
      if (!ep) return;
      if (on && D.episodeWatched(series, ep)) return;
      if (writeW(epKeysOf(series, ep, on), on, on)) ch = true;
    });
    var all = opts.all || (series && series.episodes) || null;
    if (series && all && all.length && updateSeries(series, all, opts.aired || 0, function (e) { return D.episodeWatched(series, e) || !!(opts.extra && opts.extra(e)); })) ch = true;
    if (ch) changed(false);
    return ch;
  };
  D.setEpisodeWatched = function (ep, on, series, opts) { return D.setEpisodesWatched([ep], on, series, opts); };
  /** w:s: zetten als alle uitgezonden afleveringen gezien zijn (de afleveringen zijn geladen); haalt hem nooit weg. */
  D.refreshSeriesWatched = function (series, all, aired) {
    if (!P.st || !series) return false;
    var ch = updateSeries(series, all || series.episodes, aired || 0, function (e) { return D.episodeWatched(series, e); }, true);
    if (ch) changed(false);
    return ch;
  };
  /**
   * Afgespeeld tot de gezien-grens (player.js): film of aflevering lokaal gezien. item = movieItem/episodeItem
   * ({type, id, title, year, tmdb, imdbID, seriesID, season, episode}). true = nieuw gezien (alleen dan naar Trakt).
   */
  D.markPlayedWatched = function (item, ctx) {
    if (!P.st || !item) return false;
    if (item.type === 'episode') {
      var show = { title: item.title, year: item.year, tmdb: item.tmdb, imdb: item.imdbID };
      var ep = { id: item.id, seriesID: item.seriesID, season: item.season, number: item.episode };
      var series = (ctx && ctx.series) || null;
      return D.setEpisodesWatched([ep], true, series ? { title: series.rawTitle || series.title, year: series.year, tmdb: series.tmdb, imdb: series.imdbID } : show,
        { all: ctx && ctx.episodes, aired: B.trakt && B.trakt.airedFor ? B.trakt.airedFor(series || show) : 0 });
    }
    return D.setMovieWatched({ id: item.id, title: item.title, year: item.year, tmdb: item.tmdb, imdb: item.imdbID }, true);
  };
  /**
   * Eenmalige migratie (per profiel en apparaat): id-sleutels die in een catalogus (of catalogmeta) bij een item horen
   * krijgen hun inhoudssleutels erbij, met dezelfde `at`. find(itemId) → [{type: 'movie'|'series', item}] over alle
   * servers. Niets gevonden of tegenstrijdig (twee verschillende titels zonder gedeelde sleutel): blijft zoals het is.
   * Geeft het aantal sleutels dat erbij kwam.
   */
  D.migrateWatchedKeys = function (find) {
    if (!P.st) return 0;
    var m = P.st.sets.watched, add = 0;
    // tegenstrijdig = dezelfde soort sleutel (tmdb, imdb of titel) met een andere waarde
    function kind(k) { return /^w:[mse]:(tmdb|imdb|t):/.exec(k)[1]; }
    function agree(lists) {
      var out = lists[0] || [];
      for (var i = 1; i < lists.length; i++) {
        var l = lists[i];
        var bad = l.some(function (k) { return out.indexOf(k) < 0 && out.some(function (o) { return kind(o) === kind(k); }); });
        if (bad) return null;
        out = uniq(out.concat(l));
      }
      return out;
    }
    Object.keys(m).forEach(function (k) {
      var it = m[k];
      if (!it || !it.on || WK.isContentKey(k)) return;
      var keys = null;
      if (k.indexOf('ep:') === 0) {
        var bar = k.lastIndexOf('|'), se = bar > 3 ? /^(\d+)-(\d+)$/.exec(k.slice(bar + 1)) : null;
        if (!se) return;
        var hits = (find(k.slice(3, bar)) || []).filter(function (h) { return h.type === 'series'; });
        keys = agree(hits.map(function (h) { return WK.episodeKeys(h.item, se[1], se[2]); }).filter(function (l) { return l.length; }));
      } else {
        var mh = (find(k) || []).filter(function (h) { return h.type === 'movie'; });
        keys = agree(mh.map(function (h) { return WK.movieKeys(h.item); }).filter(function (l) { return l.length; }));
      }
      (keys || []).forEach(function (nk) {
        var cur = m[nk];
        if (cur && (cur.on || cur.at >= it.at)) return;
        m[nk] = { at: it.at, on: true };
        add++;
      });
    });
    if (add) changed(false);
    return add;
  };
  D.removeHistory = function (e) {
    if (!P.st || !e) return;
    var now = Date.now(), id = historyId(e);
    // ook de andere schrijfwijze van de server-id (iOS: hoofdletters)
    variants(P.st.history, id).concat([id]).forEach(function (x) { P.st.history[x] = { at: now, v: null }; });
    changed(false);
  };
  /** Geschiedenis van deze server wissen (zoals clearHistory(playlist:) op iOS); items zonder server horen erbij. */
  D.clearHistory = function (sourceId) {
    if (!P.st) return;
    var now = Date.now();
    Object.keys(P.st.history).forEach(function (k) {
      var v = P.st.history[k].v;
      if (v && (!v.playlistID || !sourceId || lower(v.playlistID) === lower(sourceId))) P.st.history[k] = { at: now, v: null };
    });
    changed(false);
  };

  // MARK: collecties schrijven (contract build 54: {version:2, profiles:{<id>:{items, updatedAt}}, items:[oud], migratedAt, updatedAt})

  var pendingCollections = B.store.get('collectionsPending', []) || [];   // [{profile, item}] nog niet geüpload
  function colAt(x) { return (x && (time(x.updatedAt) || time(x.deletedAt))) || 0; }
  function isMigrated(c) {
    return !!c && ((B.int(c.version) || 0) >= 2 || c.migrated === true || (c.profiles != null && typeof c.profiles === 'object' && !Array.isArray(c.profiles)));
  }
  function bucketKey(d, pid) {
    var keys = Object.keys(d.profiles || {});
    for (var i = 0; i < keys.length; i++) if (lower(keys[i]) === lower(pid)) return keys[i];
    return null;
  }
  function newestISO(items) {
    var best = 0;
    items.forEach(function (c) { var t = colAt(c); if (t > best) best = t; });
    return B.iso(best || Date.now());
  }
  /** Per id wint de nieuwste updatedAt (ook een tombstone); tombstones ouder dan 90 dagen weg. */
  function mergeCollectionItems(a, b) {
    var byId = {}, order = [];
    (a || []).concat(b || []).forEach(function (c) {
      if (!c || !c.id) return;
      var k = lower(c.id), cur = byId[k];
      if (!cur) { order.push(k); byId[k] = c; } else if (colAt(c) >= colAt(cur)) byId[k] = c;
    });
    var cutoff = Date.now() - REMOVED_DAYS * 86400000;
    return order.map(function (k) { return byId[k]; }).filter(function (c) { return !(c.deleted === true && colAt(c) < cutoff); });
  }
  /**
   * Section in het nieuwe formaat (zoals mergeCollections op iOS, build 74). Nog niet gemigreerd: de oude
   * account-brede lijst gaat alleen naar het hoofdprofiel, met dezelfde id, order en updatedAt. Ongewijzigde kopieën
   * van oude collecties bij andere profielen (van build 54–73) worden tombstones, zodat ze overal verdwijnen.
   * Onbekende velden en de top-level `items` blijven staan.
   */
  function normalizeCollections(data) {
    var d;
    if (Array.isArray(data)) d = { items: B.copy(data) };
    else d = data && typeof data === 'object' ? B.copy(data) : {};
    var migrated = isMigrated(d);
    if (!d.profiles || typeof d.profiles !== 'object' || Array.isArray(d.profiles)) d.profiles = {};
    var main = D.mainProfile();
    if (!migrated && main) {
      var legacy = Array.isArray(d.items) ? d.items : [];
      var k = bucketKey(d, main.id) || main.id;
      var b = d.profiles[k] && typeof d.profiles[k] === 'object' ? d.profiles[k] : {};
      var items = mergeCollectionItems(Array.isArray(b.items) ? b.items : [], []);
      var have = {};
      items.forEach(function (x) { have[lower(x.id)] = true; });
      legacy.forEach(function (x) { if (x && x.id && !have[lower(x.id)]) { items.push(B.copy(x)); have[lower(x.id)] = true; } });
      d.profiles[k] = B.assign({}, b, { items: items, updatedAt: newestISO(items) });
      if (!d.migratedAt) d.migratedAt = B.iso();
    }
    if (main) {
      var stamps = legacyStamps(d), now = B.iso();
      Object.keys(d.profiles).forEach(function (key) {
        if (lower(key) === lower(main.id)) return;
        var bk = d.profiles[key];
        if (!bk || typeof bk !== 'object' || !Array.isArray(bk.items)) return;
        var changedAny = false;
        var list = bk.items.map(function (x) {
          if (!isLegacyCopy(x, stamps)) return x;
          changedAny = true;
          return B.assign({}, x, { deleted: true, deletedAt: now, updatedAt: now, items: [] });
        });
        if (changedAny) d.profiles[key] = B.assign({}, bk, { items: list, updatedAt: newestISO(list) });
      });
    }
    if (migrated || main) d.version = Math.max(2, B.int(d.version) || 0);
    return d;
  }
  /** Wijzigingen [{profile, item}] toepassen op section-data (nieuwste updatedAt per collectie wint). */
  function applyCollectionChanges(data, changes) {
    var d = normalizeCollections(data);
    changes.forEach(function (ch) {
      var k = bucketKey(d, ch.profile) || ch.profile;
      var b = d.profiles[k] && typeof d.profiles[k] === 'object' ? d.profiles[k] : {};
      var items = mergeCollectionItems(Array.isArray(b.items) ? b.items : [], [ch.item]);
      d.profiles[k] = B.assign({}, b, { items: items, updatedAt: newestISO(items) });
    });
    d.updatedAt = B.iso();
    return d;
  }
  var colBusy = null;
  /** Nieuwste versie van de server lezen, eigen wijzigingen erover, en terugzetten. Mislukt: blijft openstaan. */
  function uploadCollections(serverData) {
    if (!pendingCollections.length) return Promise.resolve(true);
    if (colBusy) return colBusy;
    var sent = pendingCollections.slice();
    var read = serverData !== undefined ? Promise.resolve({ collections: serverData == null ? null : { data: serverData } }) : A.getState(['collections']);
    colBusy = read.then(function (all) {
      if (!all) return false;
      var d = applyCollectionChanges(all.collections ? all.collections.data : null, sent);
      return A.putState('collections', d).then(function (at) {
        if (at == null) return false;
        pendingCollections = pendingCollections.filter(function (x) { return sent.indexOf(x) < 0; });
        B.store.set('collectionsPending', pendingCollections);
        D.collections = pendingCollections.length ? applyCollectionChanges(d, pendingCollections) : d;
        save();
        B.emit('collections');
        return true;
      });
    }).catch(function () { return false; }).then(function (ok) {
      colBusy = null;
      if (ok && pendingCollections.length) return uploadCollections();
      return ok;
    });
    return colBusy;
  }
  /** Collecties van een profiel wijzigen (volledige objecten met id en updatedAt): lokaal meteen, dan naar de server. */
  D.saveCollections = function (profileId, items) {
    var changes = items.map(function (it) { return { profile: profileId, item: it }; });
    pendingCollections = pendingCollections.concat(changes);
    B.store.set('collectionsPending', pendingCollections);
    D.collections = applyCollectionChanges(D.collections, changes);
    save();
    B.emit('collections');
    return uploadCollections();
  };
  /** Ruw object van een collectie (met onbekende velden), ook een tombstone. */
  function rawCollection(profileId, id) {
    var d = normalizeCollections(D.collections);
    var k = bucketKey(d, profileId);
    var items = (k && d.profiles[k] && d.profiles[k].items) || [];
    for (var i = 0; i < items.length; i++) if (items[i] && lower(items[i].id) === lower(id)) return B.copy(items[i]);
    return null;
  }
  D.collectionById = function (profileId, id) {
    var list = D.collectionsFor(profileId);
    for (var i = 0; i < list.length; i++) if (lower(list[i].id) === lower(id)) return list[i];
    return null;
  };
  /** Nieuw of gewijzigd (zoals collectionJSON op iOS): velden van het formulier over het bestaande object heen. */
  D.upsertCollection = function (profileId, c) {
    var base = c.id ? rawCollection(profileId, c.id) : null;
    var o = B.assign({}, base || {}, c);
    if (!o.id) o.id = B.uuid().toUpperCase();
    if (!base || base.deleted === true) {
      var max = -1;
      D.collectionsFor(profileId).forEach(function (x) { var n = B.int(x.order); if (n != null && n > max) max = n; });
      o.order = max + 1;
    }
    o.kind = o.kind === 'smart' ? 'smart' : 'manual';
    // build 128: optioneel sid (server van het item) blijft staan
    if (o.kind === 'manual') { o.query = ''; o.items = (o.items || []).map(function (x) { var it = { type: x.type, id: String(x.id) }; if (x.sid) it.sid = String(x.sid); return it; }); }
    else o.items = [];
    if (!Array.isArray(o.types) || !o.types.length) o.types = ['channel', 'movie', 'series'];
    if (!o.group) delete o.group;
    if (!o.sourceID) delete o.sourceID;
    if (!o.image || typeof o.image !== 'object') o.image = { symbol: 'star', colorIndex: 0 };
    delete o.deleted; delete o.deletedAt;
    o.updatedAt = B.iso();
    return D.saveCollections(profileId, [o]).then(function () { return o; });
  };
  /** Verwijderen = tombstone met lege items (zoals deleteCollection op iOS). */
  D.deleteCollection = function (profileId, id) {
    var base = rawCollection(profileId, id) || { id: id };
    var now = B.iso();
    var o = B.assign(base, { deleted: true, deletedAt: now, updatedAt: now, items: [] });
    return D.saveCollections(profileId, [o]);
  };
  /** Nieuwe volgorde (ids van boven naar beneden); alleen gewijzigde krijgen een nieuwe tijd. */
  D.reorderCollections = function (profileId, ids) {
    var now = B.iso(), out = [];
    ids.forEach(function (id, n) {
      var c = rawCollection(profileId, id);
      if (!c || c.deleted === true || B.int(c.order) === n) return;
      c.order = n; c.updatedAt = now;
      out.push(c);
    });
    return out.length ? D.saveCollections(profileId, out) : Promise.resolve(true);
  };
  /** Zelfde item: type en id, en (build 128) dezelfde server als beide een server hebben (sid, anders collection.sourceID). */
  function sameColItem(c, x, item) {
    if (!x || x.type !== item.type || String(x.id) !== String(item.id)) return false;
    var a = x.sid || c.sourceID, b = item.sid || c.sourceID;
    return !a || !b || lower(a) === lower(b);
  }
  D.collectionHas = function (c, item) {
    return (c.items || []).some(function (x) { return sameColItem(c, x, item); });
  };
  /** Item in een handmatige collectie zetten of eruit halen. */
  D.toggleInCollection = function (profileId, id, item) {
    var c = rawCollection(profileId, id);
    if (!c || c.deleted === true || c.kind === 'smart') return Promise.resolve(false);
    var has = D.collectionHas(c, item);
    var add = { type: item.type, id: String(item.id) };
    if (item.sid) add.sid = String(item.sid);
    c.items = has ? (c.items || []).filter(function (x) { return !sameColItem(c, x, item); })
      : (c.items || []).concat([add]);
    c.updatedAt = B.iso();
    return D.saveCollections(profileId, [c]).then(function () { return !has; });
  };

  // MARK: profielen beheren (alleen het hoofdprofiel; account_data.profiles, zelfde velden als ProfileSync op iOS)

  var PRIVATE = ['pin', 'pinCode', 'pin_code', 'photoData', 'customPhoto'];
  /** Profiel toevoegen of wijzigen: nieuwste lijst lezen, alleen dit profiel vervangen (onbekende velden blijven), updatedAt = nu. */
  D.saveProfile = function (prof) {
    return A.readProfiles().then(function (list) {
      if (list == null) throw new Error(L('No internet connection.'));
      list = list.slice();
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i] && lower(list[i].id) === lower(prof.id)) { idx = i; break; }
      var base = idx >= 0 && list[idx].deleted !== true ? list[idx] : null;
      var o = B.assign({}, base || {}, prof);
      PRIVATE.forEach(function (k) { delete o[k]; });
      delete o.deleted; delete o.deletedAt;
      if (!base) {
        o.isMain = false;
        o.order = list.filter(function (x) { return x && x.deleted !== true; }).length;
        if (!B.has(o, 'photo')) o.photo = null;
        if (!B.has(o, 'kids')) o.kids = false;
        if (!B.has(o, 'ageLimit')) o.ageLimit = null;
      }
      o.updatedAt = B.iso();
      if (idx >= 0) list[idx] = o; else list.push(o);
      return A.writeProfiles(list).then(function (merged) {
        if (!merged) throw new Error(L('Something went wrong. Please try again.'));
        applyProfiles(merged);
        return D.profileById(o.id) || o;
      });
    });
  };
  /** Profiel verwijderen: tombstone {id, deleted, deletedAt, updatedAt}; het hoofdprofiel blijft altijd bestaan. */
  D.deleteProfile = function (id) {
    var p = D.profileById(id);
    if (!p || D.isMain(p)) return Promise.reject(new Error(L('Something went wrong. Please try again.')));
    return A.readProfiles().then(function (list) {
      if (list == null) throw new Error(L('No internet connection.'));
      var now = B.iso(), photo = null;
      list = list.map(function (o) {
        if (!o || lower(o.id) !== lower(id)) return o;
        photo = o.photo && o.photo.path;
        return { id: o.id, deleted: true, deletedAt: now, updatedAt: now };
      });
      return A.writeProfiles(list).then(function (merged) {
        if (!merged) throw new Error(L('Something went wrong. Please try again.'));
        if (photo && A.deletePhoto) A.deletePhoto(photo);
        delete D.pins[lower(id)];
        B.store.del(pkey(id));
        applyProfiles(merged);
      });
    });
  };
  /** Ander profiel hoofdprofiel maken (build 89): precies één isMain, updatedAt = nu bij het nieuwe en het oude
   *  hoofdprofiel (zodat de apps het overnemen). Het oude hoofdprofiel wordt een gewoon profiel. */
  D.setMainProfile = function (id) {
    var p = D.profileById(id);
    if (!p || D.isMain(p)) return Promise.resolve(false);
    return A.readProfiles().then(function (list) {
      if (list == null) throw new Error(L('No internet connection.'));
      var now = B.iso(), found = false;
      list = list.map(function (o) {
        if (!o || !o.id || o.deleted === true) return o;
        var on = lower(o.id) === lower(id);
        if (on) found = true;
        if (!!o.isMain === on) return o;
        var c = Object.assign({}, o); c.isMain = on; c.updatedAt = now; return c;
      });
      if (!found) throw new Error(L('Something went wrong. Please try again.'));
      return A.writeProfiles(list).then(function (merged) {
        if (!merged) throw new Error(L('Something went wrong. Please try again.'));
        applyProfiles(merged);
        // build 97: het actieve profiel is een nieuw object (isMain veranderd): B.app.profile bijwerken en opnieuw
        // melden, zodat wat alleen het hoofdprofiel ziet meteen verdwijnt of verschijnt
        var cur = B.app && B.app.profile;
        var fresh = cur ? D.profileById(cur.id) : null;
        if (fresh) B.app.profile = fresh;
        B.emit('profiles');
        B.emit('settings');
        return true;
      });
    });
  };
  /** Eigen foto (JPEG-blob) of null = weg. In de lijst alleen {path, updated} (build 40). */
  D.setProfilePhoto = function (id, blob) {
    var p = D.profileById(id);
    if (!blob) {
      var path = p && p.photo && p.photo.path;
      if (path && A.deletePhoto) A.deletePhoto(path);
      return D.saveProfile({ id: id, photo: null });
    }
    return A.uploadPhoto(id, blob).then(function (path) {
      return D.saveProfile({ id: id, photo: { path: path, updated: B.iso() } });
    });
  };
  /**
   * Pincode van een profiel zetten of wissen (build 146, profile.<id>): instellen = nieuwe pinHash (nieuwe salt), pin null,
   * pinUpdatedAt = nu; verwijderen = pinHash null, pin null, pinUpdatedAt = nu. Het geheel met de nieuwste tijd wint.
   */
  D.setPin = function (profileId, pin) {
    var lid = lower(profileId);
    pin = pin ? String(pin) : null;
    var hp = pin ? B.pin.make(pin) : Promise.resolve(null);
    return hp.then(function (hash) {
      var now = B.iso();
      if (hash) D.pins[lid] = hash; else delete D.pins[lid];
      save();
      B.emit('profiles');
      if (P.id && lower(P.id) === lid) {
        P.base = P.base ? B.copy(P.base) : {};
        P.base.pinHash = hash; P.base.pin = null; P.base.pinUpdatedAt = now;
        changed(false);
        return D.flush();
      }
      var name = 'profile.' + profileId;
      return A.getState([name]).then(function (all) {
        if (!all) throw new Error(L('No internet connection.'));
        var key = Object.keys(all).filter(function (n) { return lower(n) === lower(name); })[0] || name;
        var d = all[key] && all[key].data && typeof all[key].data === 'object' ? B.copy(all[key].data) : {};
        d.pinHash = hash; d.pin = null; d.pinUpdatedAt = now; d.updatedAt = now;
        // lokale kopie van dat profiel (pstate) ook bijwerken, zodat een latere sync de oude pincode niet terugzet
        var saved = B.store.get(pkey(profileId), null);
        if (saved && saved.base) { saved.base.pinHash = hash; saved.base.pin = null; saved.base.pinUpdatedAt = now; B.store.set(pkey(profileId), saved); }
        return A.putState(key, d).then(function (at) { if (at == null) throw new Error(L('Something went wrong. Please try again.')); });
      });
    });
  };

  // test- en debug-hulp
  D._parseState = parseState; D._toJSON = toJSON; D._merge = mergeState; D._normalize = normalize;
  D._normalizeCollections = normalizeCollections; D._applyCollectionChanges = applyCollectionChanges; D._mergeActive = mergeActive;
  D._P = P;
  D._st = function () { return P.st; };
})();
