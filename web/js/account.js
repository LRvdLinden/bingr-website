/*
 * Bingr-account in de browser, volgens docs/ACCOUNT.md van de iOS-repo. Zelfde aanroepen als de Samsung TV-app
 * (tizen/js/account.js), maar de sessie komt van supabase-js met dezelfde client en opslagsleutel als de rest van
 * bingr.online (assets/js/account.js): wie al op bingr.online is ingelogd, is dat hier ook.
 * Apparaat: platform "browser", naam zoals "Chrome op Mac", een vaste device_id in localStorage (bingr.web.deviceId).
 */
(function () {
  'use strict';
  var B = window.B;
  var L = function () { return B.L.apply(null, arguments); };

  function AccountError(msg, code) { this.message = msg; this.code = code || null; }
  AccountError.prototype = Object.create(Error.prototype);
  B.AccountError = AccountError;

  var A = B.account = {};
  var sb = (window.Bingr && window.Bingr.sb) || (window.supabase && window.supabase.createClient(B.config.supabaseUrl, B.config.supabaseKey,
    { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'implicit' } }));
  A.client = sb;
  var session = null;  // {access_token, refresh_token, expires_at, user}
  var refreshing = null;

  /** Sessie van supabase-js inlezen (bij het starten) en daarna volgen. */
  A.init = function () {
    if (!sb) return Promise.resolve(false);
    sb.auth.onAuthStateChange(function (event, s) {
      var had = !!session;
      session = s || null;
      if (had && !session && event === 'SIGNED_OUT') { B.store.set('deviceRegistered', false); B.emit('signedOut'); }
    });
    return sb.auth.getSession().then(function (r) {
      session = (r && r.data && r.data.session) || null;
      return !!session;
    }, function () { return false; });
  };

  A.isSignedIn = function () { return !!(session && session.refresh_token); };
  A.email = function () { return session && session.user ? session.user.email : null; };
  A.userId = function () { return session && session.user ? session.user.id : null; };

  function generic() { return new AccountError(L('Something went wrong. Please try again.')); }
  function offline() { return new AccountError(L('No internet connection.'), 'offline'); }

  // MARK: geblokkeerd account (user_banned; contract in docs/ACCOUNT.md van iptv-ios-appletv)
  var blocked = false;
  A.bannedMessage = function () {
    return L('Your account has been blocked. You received an email with the reason and until when. Questions? Go to support.bingr.online.');
  };
  /** Antwoord (B.http: {status, json}) of fout van supabase-js ({code, message}) van een geblokkeerd account? */
  A.isBanned = function (r) {
    if (!r) return false;
    var j = r.json || r;
    if (j.banned === true) return true;
    var codes = [j.error_code, j.error, j.code, j.reason];
    for (var i = 0; i < codes.length; i++) {
      var c = typeof codes[i] === 'string' ? codes[i].toLowerCase() : '';
      if (c === 'user_banned' || c === 'banned' || c === 'account_blocked') return true;
    }
    return /banned/i.test(String(j.msg || j.message || j.error_description || ''));
  };
  /** Na uitloggen door een blokkade: true (één keer), zodat het inlogscherm de melding toont. */
  A.takeBlocked = function () { var b = blocked; blocked = false; return b; };
  function bannedOut() {
    blocked = true;
    hardSignOut();
    clear();
  }

  function clear() {
    session = null;
    B.store.set('deviceRegistered', false);
    B.emit('signedOut');
  }

  /** Sessie vernieuwen: 'ok' | 'invalid' (uitgelogd) | 'offline'. */
  A.refresh = function () {
    if (refreshing) return refreshing;
    if (!sb || !session) return Promise.resolve('invalid');
    refreshing = sb.auth.refreshSession().then(function (r) {
      if (r && r.data && r.data.session) { session = r.data.session; return 'ok'; }
      var e = r && r.error;
      var st = e && e.status;
      if (e && A.isBanned(e)) { bannedOut(); return 'invalid'; }
      if (st === 400 || st === 401 || st === 403 || (e && /refresh/i.test(e.code || '') && st !== 0)) { clear(); return 'invalid'; }
      return 'offline';
    }, function () { return 'offline'; }).then(function (res) { refreshing = null; return res; });
    return refreshing;
  };

  A.validAccessToken = function () {
    var now = Date.now() / 1000;
    if (session && session.access_token && (session.expires_at || 0) - now > 60) return Promise.resolve(session.access_token);
    return A.refresh().then(function (res) {
      if (res === 'invalid') throw generic();
      if (!session || !session.access_token) throw offline();
      return session.access_token;
    });
  };

  function post(path, body, bearer) {
    var h = { 'apikey': B.config.supabaseKey, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (bearer) h.Authorization = 'Bearer ' + bearer;
    return B.http(B.config.supabaseUrl + path, { method: 'POST', headers: h, body: body || {}, timeout: 20000 })
      .then(function (r) {
        var j = r.json || {};
        r.ok = r.status >= 200 && r.status < 300;
        r.errorCode = j.error_code || (typeof j.code === 'string' ? j.code : null) || j.error || null;
        return r;
      }, function () { throw offline(); });
  }

  /** device-auth met een geldige sessie; bij 401 één keer vernieuwen. null = netwerkfout of geen sessie. */
  function authed(body) {
    if (!A.isSignedIn()) return Promise.resolve(null);
    var attempt = 0;
    function go(token) {
      return post('/functions/v1/device-auth', body, token).then(function (r) {
        if (r.status >= 400 && A.isBanned(r)) { bannedOut(); return null; }
        if (r.status !== 401 || attempt > 0) return r;
        attempt++;
        return A.refresh().then(function (res) {
          if (res === 'ok') return go(session.access_token);
          if (res === 'invalid') B.emit('sessionInvalid');
          return null;
        });
      }, function () { return null; });
    }
    return A.validAccessToken().then(go, function () { return null; });
  }
  A.authed = authed;

  // MARK: inloggen met e-mail (telefoon) en met een QR-code (tablet, computer)

  A.signIn = function (email, password) {
    return sb.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
      if (r.data && r.data.session) { session = r.data.session; return 'ok'; }
      var e = r.error || {};
      if (e.status === 0 || /fetch/i.test(e.name || '')) throw offline();
      if (e.code === 'email_not_confirmed' || /confirm/i.test(e.message || '')) throw new AccountError(L('Confirm your email address first. Check your inbox.'));
      // geblokkeerd account (user_banned, ook status 400): eigen melding, vóór "onjuist wachtwoord"
      if (A.isBanned(e)) throw new AccountError(A.bannedMessage(), 'banned');
      if (e.code === 'invalid_credentials' || e.status === 400) throw new AccountError(L('Incorrect email or password.'));
      throw generic();
    }, function () { throw offline(); });
  };
  /** Account maken: 'ok' (meteen ingelogd) of 'confirm' (eerst de e-mail bevestigen). */
  A.signUp = function (email, password) {
    return sb.auth.signUp({ email: email, password: password, options: { data: { lang: B.lang }, emailRedirectTo: 'https://bingr.online/web/' } }).then(function (r) {
      if (r.error) {
        var e = r.error;
        if (e.status === 0) throw offline();
        if (e.code === 'user_already_exists' || /already/i.test(e.message || '')) throw new AccountError(L('An account with this email already exists.'));
        if (e.code === 'weak_password') throw new AccountError(L('Password must be at least 6 characters.'));
        throw generic();
      }
      var d = r.data || {};
      if (d.session) { session = d.session; return 'ok'; }
      // bestaand adres: Supabase geeft een user zonder identiteiten terug
      if (d.user && Array.isArray(d.user.identities) && d.user.identities.length === 0) throw new AccountError(L('An account with this email already exists.'));
      return 'confirm';
    }, function () { throw offline(); });
  };
  A.recover = function (email) {
    return sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://bingr.online/reset' }).then(function () { return true; }, function () { throw offline(); });
  };

  A.normalizeCode = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  A.displayCode = function (c) { return c && c.length === 6 ? c.slice(0, 3) + '-' + c.slice(3) : c; };

  A.startTv = function () {
    return post('/functions/v1/device-auth', { action: 'start', device: A.deviceDisplayName() }).then(function (r) {
      var j = r.json || {};
      if (!r.ok || !j.code) throw generic();
      return {
        code: j.code, pollSecret: j.poll_secret || '', url: j.url || ('https://bingr.online/koppelen?code=' + j.code),
        expiresIn: j.expires_in || 600, interval: Math.max(1, j.interval || 3)
      };
    });
  };
  A.pollTv = function (c) {
    return post('/functions/v1/device-auth', { action: 'poll', code: c.code, poll_secret: c.pollSecret }).then(function (r) {
      if (A.isBanned(r) || (r.json && r.json.status === 'banned')) throw new AccountError(A.bannedMessage(), 'banned');
      if (!r.ok) throw generic();
      var j = r.json || {};
      if (j.status === 'approved') return j.token_hash ? { status: 'approved', tokenHash: j.token_hash, email: j.email } : { status: 'expired' };
      return { status: j.status === 'expired' ? 'expired' : 'pending' };
    });
  };
  A.verifyTv = function (tokenHash) {
    return sb.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash }).then(function (r) {
      if (r.error && A.isBanned(r.error)) throw new AccountError(A.bannedMessage(), 'banned');
      if (!r.data || !r.data.session) throw generic();
      session = r.data.session;
    });
  };

  /** Zelfde flow als op tv: code starten, pollen om de `interval` seconden, bij verlopen een nieuwe code. */
  A.runTvFlow = function (handlers) {
    var cancelled = false;
    var p = new Promise(function (resolve) {
      function startLoop() {
        if (cancelled) return;
        A.startTv().then(function (c) {
          if (cancelled) return;
          handlers.onError(null); handlers.onCode(c);
          var deadline = Date.now() + c.expiresIn * 1000;
          function tick() {
            if (cancelled) return;
            if (Date.now() > deadline) { handlers.onCode(null); startLoop(); return; }
            // tabblad op de achtergrond: niet pollen, wel blijven wachten
            if (document.hidden) { setTimeout(tick, c.interval * 1000); return; }
            A.pollTv(c).then(function (res) {
              if (cancelled) return;
              handlers.onError(null);
              if (res.status === 'pending') setTimeout(tick, c.interval * 1000);
              else if (res.status === 'expired') { handlers.onCode(null); startLoop(); }
              else {
                A.verifyTv(res.tokenHash).then(function () { if (!cancelled) resolve(); },
                  function (e) { handlers.onError(e.message); handlers.onCode(null); startLoop(); });
              }
            }, function (e) { handlers.onError(e.message); setTimeout(tick, c.interval * 1000); });
          }
          setTimeout(tick, c.interval * 1000);
        }, function (e) {
          handlers.onError(e.message);
          setTimeout(startLoop, 5000);
        });
      }
      startLoop();
    });
    return { promise: p, cancel: function () { cancelled = true; } };
  };

  // MARK: apparaat (platform "browser")

  A.deviceId = function () {
    var id = B.store.get('deviceId', null);
    if (!id) { id = B.uuid(); B.store.set('deviceId', id); }
    return id;
  };
  /** Browser en systeem uit de user agent: {browser, os, osVersion}. */
  A.agent = function () {
    var ua = navigator.userAgent || '';
    var browser = 'Browser';
    if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
    else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet';
    else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
    else if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    var os = '', ver = '', m;
    var iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
    if (/iPad/.test(ua) || iPadOS) { os = 'iPad'; m = /OS (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua); ver = m ? 'iPadOS ' + m[1].replace(/_/g, '.') : 'iPadOS'; }
    else if (/iPhone|iPod/.test(ua)) { os = 'iPhone'; m = /OS (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua); ver = m ? 'iOS ' + m[1].replace(/_/g, '.') : 'iOS'; }
    else if (/Android/.test(ua)) { os = /Mobile/.test(ua) ? 'Android' : 'Android-tablet'; m = /Android (\d+(?:\.\d+)*)/.exec(ua); ver = m ? 'Android ' + m[1] : 'Android'; }
    else if (/CrOS/.test(ua)) { os = 'Chromebook'; ver = 'ChromeOS'; }
    else if (/Windows/.test(ua)) { os = 'Windows'; m = /Windows NT (\d+\.\d+)/.exec(ua); ver = m ? (m[1] === '10.0' ? 'Windows 10/11' : 'Windows NT ' + m[1]) : 'Windows'; }
    else if (/Macintosh|Mac OS X/.test(ua)) { os = 'Mac'; m = /Mac OS X (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua); ver = m ? 'macOS ' + m[1].replace(/_/g, '.') : 'macOS'; }
    else if (/Linux/.test(ua)) { os = 'Linux'; ver = 'Linux'; }
    if (os === 'Android-tablet') os = B.lang === 'nl' ? 'Android-tablet' : 'Android tablet';
    return { browser: browser, os: os, osVersion: ver };
  };
  /** Naam in de apparatenlijst: "Chrome op Mac", "Safari op iPad". */
  A.deviceDisplayName = function () {
    var a = A.agent();
    if (!a.os) return a.browser;
    return a.browser + (B.lang === 'nl' ? ' op ' : ' on ') + a.os;
  };
  A.appVersion = function () { return B.config.version + (B.config.build ? ' (' + B.config.build + ')' : ''); };
  A.isRegistered = function () { return !!B.store.get('deviceRegistered', false); };

  function parseDevices(list) {
    var own = A.deviceId();
    return (list || []).filter(function (d) { return d && d.device_id; }).map(function (d) {
      return {
        id: d.device_id, name: d.name || d.platform || '?', platform: d.platform || '',
        createdAt: B.parseISO(d.created_at), lastSeenAt: B.parseISO(d.last_seen_at),
        current: d.current === true || d.device_id === own
      };
    });
  }
  function deviceCall(action, id, extra) {
    var body = { action: action, device_id: id };
    if (extra) B.assign(body, extra);
    return authed(body);
  }
  /** register_device → 'ok' | {limit, devices} (te veel apparaten) | 'failed'. */
  A.registerDevice = function () {
    return deviceCall('register_device', A.deviceId(), {
      name: A.deviceDisplayName(), platform: B.config.platform, app_version: A.appVersion(), os_version: A.agent().osVersion
    }).then(function (r) {
      if (!r) return 'failed';
      var j = r.json || {};
      if (r.status === 403 && (r.errorCode === 'device_limit' || j.devices)) return { limit: j.limit || 15, devices: parseDevices(j.devices), plan: j.plan || null };
      if (!r.ok) return 'failed';
      B.store.set('deviceRegistered', true);
      return 'ok';
    });
  };
  A.heartbeat = function () {
    return deviceCall('heartbeat', A.deviceId()).then(function (r) {
      if (!r) return true;
      if (r.json && r.json.revoked === true) return false;
      // abonnement (Gratis/Lifetime): zit het in het antwoord, dan dat; anders apart ophalen
      if (B.plan && !(r.ok && r.json && r.json.entitlements && B.plan.apply(r.json.entitlements))) B.plan.fetch();
      return true;
    });
  };
  A.listDevices = function () {
    return deviceCall('list_devices', A.deviceId()).then(function (r) {
      if (!r || !r.ok) throw generic();
      return { limit: r.json.limit || 15, devices: parseDevices(r.json.devices) };
    });
  };
  A.removeDevice = function (id) {
    return deviceCall('remove_device', id).then(function (r) { if (!r || !r.ok) throw generic(); });
  };
  /** Platformnaam voor mensen. */
  A.platformLabel = function (p) {
    var s = String(p || '').toLowerCase();
    if (s === 'tizen') return L('Samsung TV');
    if (s === 'browser') return L('Browser');
    return String(p || '');
  };

  /** Altijd lokaal uitloggen: hooguit 3 s wachten op de server (ingetrokken sessie of vastgelopen lock), dan zelf
   *  de sessie (sb-…-auth-token) uit de opslag halen, zodat ook bingr.online niet meer ingelogd is. */
  function hardSignOut() {
    var srv = sb ? Promise.resolve().then(function () { return sb.auth.signOut({ scope: 'local' }); }).catch(B.noop) : Promise.resolve();
    return Promise.race([srv, new Promise(function (r) { setTimeout(r, 3000); })]).then(function () {
      try { Object.keys(localStorage).filter(function (k) { return /^sb-.*-auth-token(-code-verifier)?$/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* stil */ }
      try { localStorage.removeItem('bingr.mainAvatar'); } catch (e) { /* stil */ }
    });
  }
  /** Uitloggen: eerst remove_device voor deze browser, dan uitloggen op dit apparaat (niet overal). */
  A.signOut = function () {
    var p = A.isSignedIn() ? A.removeDevice(A.deviceId()).catch(B.noop) : Promise.resolve();
    return p.then(function () { return hardSignOut(); }).then(function () { clear(); });
  };
  /** Op een ander apparaat verwijderd (heartbeat: revoked): lokaal uitloggen. */
  A.revokedSignOut = function () {
    hardSignOut();
    clear();
  };

  // MARK: app-sleutels van de server (TMDB enz.), alleen lokaal bewaard

  A.fetchConfig = function () {
    return authed({ action: 'config' }).then(function (r) {
      if (!r || !r.ok || !r.json) return false;
      if (r.json.entitlements && B.plan) B.plan.apply(r.json.entitlements);
      B.store.set('serverKeys', r.json);
      return true;
    });
  };
  A.serverKey = function (name) { var k = B.store.get('serverKeys', {}) || {}; return k[name] || ''; };

  // MARK: profielen (PostgREST account_data)

  function rest(method, path, body, extra) {
    return A.validAccessToken().then(function (token) {
      var h = { 'apikey': B.config.supabaseKey, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Accept': 'application/json' };
      if (extra) B.assign(h, extra);
      return B.http(B.config.supabaseUrl + path, { method: method, headers: h, body: body, timeout: 20000 });
    });
  }
  A.readProfiles = function () {
    return rest('GET', '/rest/v1/account_data?select=profiles,updated_at').then(function (r) {
      if (r.status === 401) return A.refresh().then(function () { return null; });
      if (r.status < 200 || r.status >= 300 || !Array.isArray(r.json)) return null;
      var row = r.json[0];
      return row && Array.isArray(row.profiles) ? row.profiles : [];
    }, function () { return null; });
  };
  A.writeProfiles = function (profiles) {
    var uid = A.userId();
    if (!uid) return Promise.resolve(false);
    return rest('POST', '/rest/v1/account_data', { user_id: uid, profiles: profiles, updated_at: B.iso() },
      { 'Prefer': 'resolution=merge-duplicates,return=minimal' }).then(function (r) {
      return r.status >= 200 && r.status < 300;
    }, function () { return false; });
  };
  /** Profielfoto (Storage-bucket avatars) als object-URL; null bij een fout. */
  A.photoURL = function (path) {
    return A.validAccessToken().then(function (token) {
      var url = B.config.supabaseUrl + '/storage/v1/object/authenticated/avatars/' +
        String(path).split('/').map(encodeURIComponent).join('/');
      return B.http(url, { headers: { 'apikey': B.config.supabaseKey, 'Authorization': 'Bearer ' + token }, binary: true, timeout: 20000 });
    }).then(function (r) {
      if (r.status < 200 || r.status >= 300 || !r.buffer || !r.buffer.byteLength) return null;
      return URL.createObjectURL(new Blob([r.buffer], { type: 'image/jpeg' }));
    }, function () { return null; });
  };

  /** Pad van een profielfoto in de bucket (zelfde als AccountService.photoPath op iOS): <user-id>/<profiel-id>.jpg */
  A.photoPath = function (profileId) { var uid = A.userId(); return uid ? uid + '/' + profileId + '.jpg' : null; };
  function photoObjectURL(path) {
    var parts = String(path).split('/');
    if (!parts.length || parts.some(function (x) { return !x || x === '.' || x === '..'; })) return null;
    return B.config.supabaseUrl + '/storage/v1/object/avatars/' + parts.map(encodeURIComponent).join('/');
  }
  /** Foto uploaden of vervangen (x-upsert); geeft het pad terug. */
  A.uploadPhoto = function (profileId, blob) {
    var path = A.photoPath(profileId), url = path && photoObjectURL(path);
    if (!url) return Promise.reject(generic());
    return A.validAccessToken().then(function (token) {
      return B.http(url, { method: 'POST', body: blob, timeout: 30000,
        headers: { 'apikey': B.config.supabaseKey, 'Authorization': 'Bearer ' + token, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' } });
    }).then(function (r) {
      if (r.status < 200 || r.status >= 300) throw generic();
      return path;
    });
  };
  A.deletePhoto = function (path) {
    var url = photoObjectURL(path);
    if (!url) return Promise.resolve();
    return A.validAccessToken().then(function (token) {
      return B.http(url, { method: 'DELETE', timeout: 20000, headers: { 'apikey': B.config.supabaseKey, 'Authorization': 'Bearer ' + token } });
    }).catch(B.noop);
  };

  // MARK: servers en state-onderdelen

  A.getSources = function () {
    return authed({ action: 'get_sources' }).then(function (r) {
      if (!r || !r.ok || !r.json) return null;
      var j = r.json;
      return {
        sources: (Array.isArray(j.sources) ? j.sources : []).filter(function (s) { return s && s.id; }),
        mainSourceID: j.mainSourceID || null, updatedAt: j.updatedAt || null
      };
    });
  };
  A.putSources = function (sources, mainSourceID) {
    var cut = Date.now() - 90 * 86400000;
    sources = sources.filter(function (s) { return !(s && s.deleted === true && (B.parseISO(s.deletedAt || s.updatedAt) || 0) < cut); });
    return authed({ action: 'put_sources', sources: sources, mainSourceID: mainSourceID || null }).then(function (r) {
      if (!r) throw offline();
      if (!r.ok || (r.json && r.json.ok === false)) throw generic();
      return (r.json && r.json.updatedAt) || B.iso();
    });
  };
  A.getState = function (sections) {
    var body = { action: 'get_state' };
    if (sections && sections.length) body.sections = sections;
    return authed(body).then(function (r) {
      if (!r || !r.ok || !r.json) return null;
      return r.json.sections || {};
    });
  };
  A.putState = function (section, data) {
    return authed({ action: 'put_state', section: section, data: data }).then(function (r) {
      if (!r || !r.ok || (r.json && r.json.ok === false)) return null;
      return (r.json && r.json.updatedAt) || '';
    });
  };

  // MARK: tegelijk kijken (limiet van het abonnement: Gratis 1, Lifetime 3, of een eigen limiet)

  function parseStreams(list) {
    return (list || []).filter(function (s) { return s && s.device_id; }).map(function (s) {
      return {
        deviceId: s.device_id, deviceName: s.device_name || s.platform || '?', platform: s.platform || '',
        profileId: s.profile_id || '', profileName: s.profile_name || '', title: s.title || '', kind: s.kind || '',
        startedAt: B.parseISO(s.started_at), current: s.device_id === A.deviceId()
      };
    });
  }
  /** Tijdzone van de browser (build 68: op welke dag de kijktijd in de statistieken valt). */
  A.timeZone = function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam'; } catch (e) { return 'Europe/Amsterdam'; } };
  /** extra (build 68): {series_id, series_title} bij een aflevering. */
  A.streamStart = function (profileId, profileName, title, kind, contentId, extra) {
    var body = {
      action: 'stream_start', device_id: A.deviceId(), profile_id: profileId, profile_name: profileName,
      title: title, kind: kind, content_id: contentId, tz: A.timeZone()
    };
    if (extra && extra.series_id) body.series_id = String(extra.series_id);
    if (extra && extra.series_title) body.series_title = String(extra.series_title);
    return authed(body).then(function (r) {
      if (!r) return { failed: true };
      var j = r.json || {};
      if (r.status === 403 && (r.errorCode === 'stream_limit' || j.streams)) return { limit: j.limit || 3, streams: parseStreams(j.streams), plan: j.plan || null };
      return r.ok ? { ok: true } : { failed: true };
    });
  };
  A.streamPing = function (title) {
    var body = { action: 'stream_ping', device_id: A.deviceId() };
    if (title) body.title = title;
    return authed(body).then(function (r) {
      if (!r) return null;
      if (r.json && r.json.stopped === true) return false;
      return r.ok ? true : null;
    });
  };
  /** Wie kijkt er nu (list_streams): {limit, streams} | {locked: true} (Gratis) | null (fout). */
  A.listStreams = function () {
    return authed({ action: 'list_streams' }).then(function (r) {
      if (!r) return null;
      if (B.plan && B.plan.isLockedResponse(r)) return { locked: true };
      if (!r.ok || !r.json) return null;
      return { limit: r.json.limit || 3, streams: parseStreams(r.json.streams) };
    });
  };
  A.streamStop = function () { return authed({ action: 'stream_stop', device_id: A.deviceId() }).catch(B.noop); };
  /** Bij het sluiten van het tabblad: stream_stop met keepalive (fetch overleeft het wegnavigeren). */
  A.streamStopBeacon = function () {
    if (!session || !session.access_token) return;
    try {
      fetch(B.config.supabaseUrl + '/functions/v1/device-auth', {
        method: 'POST', keepalive: true,
        headers: { 'apikey': B.config.supabaseKey, 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stream_stop', device_id: A.deviceId() })
      }).catch(B.noop);
    } catch (e) { /* stil */ }
  };
})();
