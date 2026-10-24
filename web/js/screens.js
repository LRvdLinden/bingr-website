/*
 * Bingr web: schermen. Inloggen (telefoon: e-mail zoals de apps; tablet en computer: QR-code zoals Apple TV),
 * te veel apparaten, "Wie kijkt er?", en de app zelf: Home, Live TV met tv-gids, Films, Series, Zoeken, Mijn lijst,
 * Instellingen en detailpagina's. Navigatie via #/… (de terugknop van de browser werkt overal).
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, A = B.account, Lib = B.lib, PC = B.parental;
  var h = U.h, R = U.router;
  var L = function () { return B.L.apply(null, arguments); };
  var S = B.screens = { pages: {}, navOwner: {} };

  // MARK: inloggen

  // Achtergrond zoals AuthBackdrop in de apps: gedimde, licht vervaagde en gekantelde collage van covers uit je bibliotheek
  function loginBackdrop() {
    var bg = h('div.login-bg');
    var posters = (B.store.get('splashPosters', []) || []).filter(function (u) { return /^https?:/.test(u); });
    if (posters.length) {
      var w = window.innerWidth || 1280, cols = Math.max(4, Math.round(w / 110)), rows = Math.ceil((window.innerHeight || 800) * 1.4 / (w * 1.35 / cols * 1.5)) + 2;
      var grid = h('div.login-collage', { style: 'grid-template-columns:repeat(' + cols + ',1fr)' });
      for (var i = 0; i < cols * rows; i++) grid.appendChild(h('div.lc', [U.img(posters[i % posters.length], 'lc-img')]));
      bg.appendChild(grid);
      bg.classList.add('has-posters');
    }
    return bg;
  }
  function loginShell(card) {
    return h('div.login', [loginBackdrop(), h('header.login-top', [h('a.logo', { href: '../' }, 'BINGR')]), card]);
  }

  /** Inlogscherm: telefoon → e-mailformulier; tablet en computer → QR-code met "Inloggen met e-mail" ernaast. */
  S.login = function (onDone) {
    var flow = null;
    var holder = h('div.login-holder');
    var el = loginShell(holder);
    function finish() {
      if (flow) { flow.cancel(); flow = null; }
      U.toast(L('Signed in as %@', A.email() || ''));
      onDone();
    }
    function showEmail(fromQR) {
      if (flow) { flow.cancel(); flow = null; }
      U.clear(holder);
      holder.appendChild(S.emailForm(finish, fromQR ? showQR : null));
    }
    function showQR() {
      U.clear(holder);
      // zelfde opbouw als op Apple TV (AuthView.tvLayout): links inloggen met je telefoon, midden OF, rechts e-mail
      var qrBox = h('div.qr-box', [U.spinner()]);
      var code = h('div.qr-code', '–––-–––');
      var err = h('span.tv-wait-text', L('Waiting for confirmation…'));
      var left = h('div.tv-phone', [
        h('h1.tv-title', L('Sign in with your phone')),
        h('p.tv-sub', L("Scan the QR code with your phone's camera")),
        qrBox,
        h('p.tv-orgo', [L('Or go to'), ' ', h('a', { href: '../koppelen/', target: '_blank', rel: 'noopener' }, 'bingr.online/koppelen'), ' ', L('and enter this code:')]),
        code,
        h('div.tv-wait', [U.spinner(), err])
      ]);
      var orCol = h('div.tv-or', [h('i'), h('b', L('OR')), h('i')]);
      var right = h('div.tv-mail', [
        U.icon('mail', 'tv-mail-ic'),
        U.button(L('Sign in with email'), function () { showEmail(true); }, { cls: 'primary tv-mail-btn' })
      ]);
      holder.appendChild(h('div.tv-login', [left, orCol, right]));
      function drawQR(url) {
        U.clear(qrBox);
        if (!url) { qrBox.appendChild(U.spinner()); return; }
        try {
          var q = window.qrcode(0, 'M');
          q.addData(url); q.make();
          var n = q.getModuleCount(), cell = 8;
          var canvas = h('canvas', { role: 'img', 'aria-label': url });
          canvas.width = canvas.height = cell * (n + 4);
          var g = canvas.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
          g.fillStyle = '#000';
          for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + 2) * cell, (r + 2) * cell, cell, cell);
          qrBox.appendChild(canvas);
        } catch (e) { qrBox.appendChild(h('div', url)); }
      }
      flow = A.runTvFlow({
        onCode: function (c) { code.textContent = c ? A.displayCode(c.code) : '···-···'; drawQR(c ? c.url : null); },
        onError: function (m) { err.textContent = m || L('Waiting for confirmation…'); err.classList.toggle('bad', !!m); }
      });
      flow.promise.then(finish);
    }
    if (U.isPhone()) showEmail(false); else showQR();
    return { el: el, destroy: function () { if (flow) flow.cancel(); } };
  };

  /** E-mail en wachtwoord (Netflix-stijl): inloggen, account maken, wachtwoord vergeten. */
  S.emailForm = function (onDone, onQR) {
    var signup = false, busy = false;
    var title = h('h1');
    // account maken: voor- en achternaam (verplicht; user_metadata first_name / last_name, voor de aanhef in de e-mails)
    var first = h('input', { type: 'text', autocomplete: 'given-name', autocapitalize: 'words', spellcheck: 'false', maxlength: '50', placeholder: L('First name'), 'aria-label': L('First name') });
    var last = h('input', { type: 'text', autocomplete: 'family-name', autocapitalize: 'words', spellcheck: 'false', maxlength: '50', placeholder: L('Last name'), 'aria-label': L('Last name') });
    var nameFields = h('div.name-fields', [h('label.field', [first]), h('label.field', [last])]);
    var email = h('input', { type: 'email', autocomplete: 'email', placeholder: L('Email'), 'aria-label': L('Email'), required: true });
    var pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: L('Password'), 'aria-label': L('Password'), required: true });
    var show = h('button.pw-toggle', { type: 'button' }, L('Show'));
    show.addEventListener('click', function () { var s = pw.type === 'password'; pw.type = s ? 'text' : 'password'; show.textContent = s ? L('Hide') : L('Show'); });
    var err = h('div.login-err', { role: 'alert' });
    var submit = h('button.btn.primary.wide', { type: 'submit' });
    var forgot = h('button.linkbtn', { type: 'button' }, L('Forgot password?'));
    var switchLine = h('div.login-switch');
    // build 138: honeypot tegen bots bij account maken: verborgen veld "website" (buiten beeld via .hp-field in web.css, niet
    // focusbaar, geen autofill, verborgen voor schermlezers) en de tijd sinds het tonen van "account maken" (fill_ms).
    // Gevuld of sneller dan 1,5 s = geweigerd door de hook bingr_before_user_created. Na een fout weer leeg.
    var nl = /^nl/i.test(String(B.lang || ''));
    var hpInput = h('input#hp-website', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', 'data-lpignore': 'true', 'data-1p-ignore': '' });
    var hpField = h('div.hp-field', { 'aria-hidden': 'true' }, [h('label', { 'for': 'hp-website' }, nl ? 'Laat dit veld leeg' : 'Leave this field empty'), hpInput]);
    var shownAt = 0;
    function nowMs() { return window.performance && performance.now ? performance.now() : Date.now(); }
    function guard() {
      var g = { fill_ms: Math.max(0, Math.round(nowMs() - shownAt)) };
      if (String(hpInput.value || '').trim()) g.hp = hpInput.value;
      return g;
    }
    var form = h('form.login-form', { novalidate: true }, [hpField, title, nameFields, h('label.field', [email]), h('label.field.pw', [pw, show]), err, submit]);
    var card = h('div.login-card.email', [form, h('div.login-links', [forgot, switchLine,
      onQR ? h('button.linkbtn.qrback', { type: 'button', onclick: onQR }, [U.icon('back'), L('Sign in with your phone')]) : null])]);
    function draw() {
      title.textContent = signup ? L('Create account') : L('Sign In');
      submit.textContent = signup ? L('Create account') : L('Sign In');
      pw.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
      forgot.style.display = signup ? 'none' : '';
      nameFields.style.display = signup ? '' : 'none';
      U.clear(switchLine);
      switchLine.appendChild(h('span.muted', (signup ? L('Already have an account?') : L('New to Bingr?')) + ' '));
      var a = h('button.linkbtn.strong', { type: 'button' }, signup ? L('Sign in.') : L('Sign up now.'));
      a.addEventListener('click', function () { signup = !signup; err.textContent = ''; if (signup) shownAt = nowMs(); draw(); });
      switchLine.appendChild(a);
    }
    function validEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var em = email.value.trim(), p = pw.value;
      var fn = A.cleanName(first.value), ln = A.cleanName(last.value);
      if (signup && !fn) { err.textContent = L('Enter your first name.'); first.focus(); return; }
      if (signup && !ln) { err.textContent = L('Enter your last name.'); last.focus(); return; }
      if (!validEmail(em)) { err.textContent = L('Enter a valid email address.'); email.focus(); return; }
      if (signup ? p.length < 8 : !p) { err.textContent = L('Password must be at least 8 characters.'); pw.focus(); return; } // build 141: 8 bij een nieuw account; inloggen met een ouder, korter wachtwoord blijft kunnen
      busy = true; err.textContent = '';
      submit.disabled = true; U.clear(submit); submit.appendChild(U.spinner());
      var req = signup ? A.signUp(em, p, fn, ln, guard()) : A.signIn(em, p);
      req.then(function (r) {
        if (r === 'confirm') {
          err.textContent = ''; signup = false; draw();
          U.modal({ title: L('Create account'), text: L('Check your inbox to confirm your email address, then sign in.'), buttons: [{ label: L('OK') }] });
          return;
        }
        onDone();
      }, function (e2) { hpInput.value = ''; err.textContent = e2.message || L('Something went wrong. Please try again.'); })
        .then(function () { busy = false; submit.disabled = false; draw(); });
    });
    forgot.addEventListener('click', function () {
      var em = email.value.trim();
      var input = h('input', { type: 'email', value: em, placeholder: L('Email'), 'aria-label': L('Email') });
      var msg = h('div.login-err');
      var dlg = U.modal({ title: L('Reset password'), body: h('div.field-dlg', [input, msg]), buttons: [] });
      var send = U.button(L('Send reset link'), function () {
        var v = input.value.trim();
        if (!validEmail(v)) { msg.textContent = L('Enter a valid email address.'); return; }
        send.disabled = true;
        A.recover(v).then(function () {
          dlg.close();
          U.modal({ title: L('Reset password'), text: L("If an account exists, you'll receive an email to reset your password."), buttons: [{ label: L('OK') }] });
        }, function (e3) { send.disabled = false; msg.textContent = e3.message; });
      }, { primary: true });
      dlg.el.appendChild(h('div.dlg-buttons', [send, U.button(L('Cancel'), function () { dlg.close(); })]));
    });
    draw();
    setTimeout(function () { if (!U.isTouch()) email.focus(); }, 60);
    return card;
  };

  // MARK: te veel apparaten

  var DEV_ICONS = {
    phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
    tablet: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
    laptop: 'M4 5h16v10H4zM2 19h20',
    tv: 'M3 5h18v12H3zM8 21h8',
    browser: 'M3 4h18v16H3zM3 9h18M6 6.5h.01M9 6.5h.01'
  };
  var APPLETV = '<path d="M5.20687 19.4314L14.2907 19.4314C15.949 19.4314 17.3557 19.2815 18.3579 18.2793C19.3476 17.2792 19.4976 15.8974 19.4976 14.2246L19.4976 5.22355C19.4976 3.55067 19.3476 2.1668 18.3579 1.16882C17.3536 0.176964 15.949 0.0166814 14.2907 0.0166814L5.18577 0.0166814C3.55067 0.0166814 2.14188 0.179074 1.14179 1.17093C0.149932 2.17102 0 3.55489 0 5.1921L0 14.2246C0 15.8974 0.147822 17.2917 1.13968 18.2793C2.14188 19.2815 3.5361 19.4314 5.20687 19.4314ZM4.93695 17.8607C3.93656 17.8607 2.87758 17.7212 2.2877 17.1313C1.69781 16.5414 1.57069 15.497 1.57069 14.4945L1.57069 4.98508C1.57069 3.95535 1.69781 2.90461 2.28559 2.31473C2.87547 1.72274 3.94078 1.58737 4.9684 1.58737L14.5606 1.58737C15.561 1.58737 16.6179 1.72696 17.2078 2.31684C17.7997 2.90672 17.9269 3.95113 17.9269 4.95363L17.9269 14.4945C17.9269 15.497 17.7976 16.5414 17.2078 17.1313C16.6179 17.7233 15.561 17.8607 14.5606 17.8607Z"/><path d="M4.85163 12.6004C5.26284 12.6004 5.4373 12.3138 5.94819 12.3138C6.47155 12.3138 6.59616 12.6004 7.04476 12.6004C7.49335 12.6004 7.79241 12.1768 8.09148 11.7655C8.39054 11.3045 8.54007 10.8434 8.54007 10.8185C8.52761 10.8185 7.64288 10.4571 7.64288 9.46027C7.64288 8.61293 8.32823 8.22664 8.36562 8.18925C7.92948 7.56621 7.23167 7.54128 7.04476 7.54128C6.53386 7.54128 6.12265 7.82789 5.86097 7.82789C5.58683 7.82789 5.22546 7.56621 4.77687 7.56621C3.95444 7.56621 3.1071 8.2391 3.1071 9.53503C3.1071 10.345 3.40616 11.1923 3.79245 11.7406C4.14136 12.2141 4.42796 12.6004 4.85163 12.6004ZM5.89835 7.45406C6.5214 7.45406 7.16937 6.78117 7.15691 6.04597C7.16937 6.00859 7.15691 5.95875 7.14444 5.92136C6.48402 5.94628 5.81112 6.60671 5.81112 7.32945C5.81112 7.36683 5.81112 7.42914 5.82359 7.4416C5.83605 7.45406 5.86097 7.45406 5.89835 7.45406ZM11.0073 12.5755C11.2192 12.5755 11.4435 12.563 11.5556 12.5381L11.5805 12.5257L11.5805 11.7157L11.5432 11.7157C11.4809 11.7282 11.3313 11.7406 11.2316 11.7406C10.8578 11.7406 10.6958 11.5662 10.6958 11.1799L10.6958 8.60046L11.593 8.60046L11.593 7.77804L10.6958 7.77804L10.6958 6.65656L9.68648 6.65656L9.68648 7.77804L9.00112 7.77804L9.00112 8.60046L9.68648 8.60046L9.68648 11.292C9.68648 12.2017 10.0728 12.5755 11.0073 12.5755ZM13.6864 12.5381L14.7332 12.5381L16.4029 7.77804L15.3562 7.77804L14.2223 11.4914L13.0759 7.77804L11.9917 7.77804Z"/>';
  S.platformIcon = function (p) {
    var s = String(p || '');
    // build 146: de Windows-app (platform "windows")
    if (/^windows$/i.test(s.trim())) return U.icon('windows');
    // build 147: LG TV (platform "webos") valt hieronder op het tv-icoon, net als de Samsung TV
    var k = /^(apple ?tv|tvos)$/i.test(s.trim()) ? 'appletv' : /iPhone|^Android$/.test(s) ? 'phone' : /iPad|tablet/i.test(s) ? 'tablet' : /^Mac$/.test(s) ? 'laptop' : /browser/i.test(s) ? 'browser' : 'tv';
    var svg = U.icon('tv');
    if (k === 'appletv') {
      // Apple TV: het symbool "appletv" zoals in de iOS-app; gevuld (de andere iconen zijn lijnen), zelfde formaat
      svg.setAttribute('viewBox', '-2.5 -2.53 24.5 24.5');
      svg.setAttribute('fill', 'currentColor');
      svg.setAttribute('stroke', 'none');
      svg.innerHTML = APPLETV;
      return svg;
    }
    svg.innerHTML = '<path d="' + DEV_ICONS[k] + '"/>';
    return svg;
  };
  /** Bij te veel apparaten/streams met Gratis: de limiet van Lifetime en een knop om te upgraden (Lifetime: niets). */
  S.limitUpsell = function (kind, info) {
    var P = B.plan;
    P.noteLimitError(info);
    var plan = String((info && info.plan) || P.get().plan).toLowerCase();
    if (plan !== 'free') return null;
    var limit = (info && info.limit) || P.limit(kind);
    var text = kind === 'devices' ? L('Free: up to %d devices. Lifetime: %d.', limit, P.LIFETIME.devices)
      : limit === 1 ? L('Free: 1 screen at a time. Lifetime: %d.', P.LIFETIME.streams)
      : L('Free: up to %d screens at the same time. Lifetime: %d.', limit, P.LIFETIME.streams);
    return h('div.plan-upsell', [P.badge(), h('span.plan-upsell-t', text),
      U.button(L('Upgrade to Lifetime'), function () { P.sheet(kind); }, { cls: 'small', icon: 'lifetime' })]);
  };
  S.deviceLimit = function (info, onRetry, onCancel) {
    var list = h('div.dev-list');
    info.devices.forEach(function (d) {
      var rm = U.button(L('Remove'), function () {
        rm.disabled = true;
        A.removeDevice(d.id).then(onRetry, function (e) { rm.disabled = false; U.toast(e.message); });
      }, { cls: 'small' });
      list.appendChild(h('div.dev', [h('div.dev-ic', [S.platformIcon(d.platform)]),
        h('div.dev-info', [h('div.dev-name', d.name), h('div.muted.small', A.platformLabel(d.platform))]), rm]));
    });
    var card = h('div.login-card.limit', [
      h('h1', L('Too many devices')),
      h('p.muted', L('Your account can be used on up to %d devices. Remove a device to sign in on this one.', info.limit)),
      S.limitUpsell('devices', info),
      list,
      h('div.dlg-buttons', [U.button(L('Cancel'), onCancel)])
    ]);
    return { el: loginShell(card) };
  };

  // MARK: avatars en "Wie kijkt er?"

  var photos = {};
  function photoURL(p) {
    var k = p.photo.path + '|' + (p.photo.updated || '');
    if (!photos[k]) photos[k] = A.photoURL(p.photo.path);
    return photos[k];
  }
  /** Avatar van een profiel: eigen foto, getekend figuurtje of emoji op een verloop in de profielkleur. */
  S.avatar = function (p, cls) {
    var av = D.avatar(p);
    var pal = D.palettes[av.colorIndex] || D.palettes[0];
    var box = h('div.avatar' + (cls ? '.' + cls : ''), { style: { background: 'linear-gradient(135deg,' + pal[0] + ',' + pal[1] + ')' } });
    if (av.kind === 'kid') box.appendChild(h('img', { src: '../assets/img/' + av.value + '.png', alt: '' }));
    else box.appendChild(h('span.emoji', av.value));
    if (p && p.photo && p.photo.path) {
      photoURL(p).then(function (url) {
        if (!url) return;
        U.clear(box);
        box.style.background = '#222';
        box.appendChild(h('img.photo', { src: url, alt: '' }));
      });
    }
    return box;
  };

  S.profiles = function (onPick) {
    var grid = h('div.pf-grid');
    // profielen beheren kan alleen vanuit het hoofdprofiel (zoals canAdmin op iOS): eerst de pincode daarvan
    var manage = U.button(L('Manage profiles'), function () {
      var m = D.mainProfile();
      if (!m) return;
      var go = function () { history.replaceState(null, '', location.pathname + location.search + '#/profiles'); onPick(m); };
      var pin = D.pinFor(m);
      if (pin) U.askPIN(L('Enter PIN'), function (x) { return D.checkPin(m, x); }, go, S.avatar(m, 'pinav')); else go();
    }, { cls: 'ghost pf-manage' });
    var el = h('div.profiles-screen', [h('header.login-top', [h('a.logo', { href: '../' }, 'BINGR')]),
      h('div.pf-wrap', [h('h1.pf-title', L("Who's watching?")), grid, manage])]);
    function draw() {
      U.clear(grid);
      D.profiles.forEach(function (p) {
        var pin = D.pinFor(p);
        var acc = D.accents[D.accentKey(p)];
        var tile = h('button.pf', { type: 'button', style: { '--pf-accent': acc } }, [
          S.avatar(p, 'big'),
          h('div.pf-name', [p.name, pin ? U.icon('lock', 'pf-lock') : null]),
          p.kids ? h('div.pf-kids', L('Kids')) : null
        ]);
        tile.addEventListener('click', function () {
          // build 147 (diagnose): het pincodescherm is wachten op de gebruiker
          if (pin) {
            if (B.diag) { B.diag.waitStart('pin'); B.diag.mark('pin_screen'); }
            U.askPIN(L('Enter PIN'), function (x) { return D.checkPin(p, x); }, function () { if (B.diag) B.diag.mark('pin_ok'); onPick(p); }, S.avatar(p, 'pinav'));
          } else onPick(p);
        });
        grid.appendChild(tile);
      });
      if (!D.profiles.length) grid.appendChild(U.spinner());
    }
    draw();
    var off = B.on('profiles', draw);
    var off2 = B.on('state', draw);
    return { el: el, destroy: function () { off(); off2(); } };
  };

  // MARK: kaarten

  function langBadge(x, isShow) {
    var t = B.clang.badge(B.clang.forItem(x, isShow));
    return t ? h('div.lang-strip', t) : null;
  }
  /** build 128: item van een andere server → ?s=<server>; tegel uit catalogmeta → #/item (zoeken op je servers). */
  S.titleLink = function (type, x) {
    if (x && x._key) return '#/item?k=' + encodeURIComponent(x._key) + '&t=' + encodeURIComponent(type) + (x._field ? '&f=' + encodeURIComponent(x._field) : '');
    var l = R.link(['title', type, x.id]);
    return x && x._src && !(B.xs && B.xs.isActive(x._src.id)) ? l + '?s=' + encodeURIComponent(x._src.id) : l;
  };
  /** Klik op een tegel uit catalogmeta: niet de link volgen, maar zoeken/openen (met de melding als hij nergens staat). */
  function phClick(el, x, type) {
    if (!x || (!x._key && !x._noKey)) return;
    el.addEventListener('click', function (e) { e.preventDefault(); B.xs.open({ type: type, item: x }); });
  }
  /** Film bekeken (lokaal of op Trakt), zoals Playables.isWatched op iOS. */
  S.movieWatched = function (m) { return D.isWatched(m.id) || B.trakt.isMovieWatched(m); };
  /**
   * Aantal bekeken afleveringen van een serie, zoals seriesRow op iOS: het hoogste van Trakt, de lokale sleutels
   * ep:<serie>|s-e en (als de afleveringen al geladen zijn) de afleveringen met een eigen bekeken-vinkje.
   */
  S.seriesWatchedCount = function (s) {
    var own = 0;
    (s.episodes || []).forEach(function (e) { if (e && D.isWatched(e.id)) own++; });
    return Math.max(B.trakt.watchedCount(s), D.watchedCount(s.id), own);
  };
  /** Vinkje, "N BEKEKEN" en voortgang op een poster; opnieuw te tekenen zonder de kaart te vervangen (S.refreshMarks). */
  function cardMarks(x, type, opts) {
    var isShow = type === 'series';
    var pr = opts.progress;
    // voortgang van een film ook buiten Verder kijken (zoals PosterCard op iOS)
    if (pr == null && !isShow) { var pe = D.progress(x.id); pr = pe && pe.fraction > 0 ? pe.fraction : null; }
    var watched = !isShow && !opts.continueKeys && S.movieWatched(x);
    var wc = isShow ? S.seriesWatchedCount(x) : 0;
    // label linksboven: Serie/Film (Voor jou) of, build 112, een eigen tekst (opts.badge, bv. de datum bij Binnenkort op Bingr)
    var top = opts.kindBadge ? (isShow ? L('SERIES') : L('MOVIE')) : (opts.badge || null);
    return { watched: watched, nodes: [
      watched ? h('div.card-watched.mark', { title: L('Watched') }, [U.icon('check')]) : null,
      top ? h('div.card-badge.card-kind', top) : null,
      wc > 0 ? h('div.card-badge.mark' + (top ? '.card-badge-below' : ''), L('%d WATCHED', wc)) : null,
      pr ? h('div.card-progress.mark', [h('div', { style: { width: Math.round(B.clamp(pr, 0, 1) * 100) + '%' } })]) : null] };
  }
  function cardLabel(x, watched) { return x.title + (x.year ? ' (' + x.year + ')' : '') + (watched ? ', ' + L('Watched') : ''); }
  function posterCard(x, type, opts) {
    opts = opts || {};
    var isShow = type === 'series';
    var m = cardMarks(x, type, opts);
    var img = h('div.card-img', [U.img(x.poster, 'poster', x.title), langBadge(x, isShow)].concat(m.nodes));
    var card = h('a.card', { href: S.titleLink(type, x), 'aria-label': cardLabel(x, m.watched) }, [img, h('div.card-title', x.title)]);
    card._marks = function () {
      var n = cardMarks(x, type, opts);
      Array.prototype.slice.call(img.querySelectorAll('.mark')).forEach(function (e) { e.remove(); });
      n.nodes.forEach(function (e) { if (e && e.classList.contains('mark')) img.appendChild(e); });
      card.setAttribute('aria-label', cardLabel(x, n.watched));
    };
    if (S.cardMenu) U.onMenu(card, function () { return S.cardMenu(x, type, opts); }, x.title);
    phClick(card, x, type);
    return card;
  }
  /** Bekeken-vinkjes en voortgang op alle zichtbare posters bijwerken (na Trakt-sync of (on)bekeken markeren). */
  S.refreshMarks = function (root) {
    Array.prototype.slice.call((root || document).querySelectorAll('a.card')).forEach(function (c) { if (c._marks) c._marks(); });
  };
  S.posterCard = posterCard;
  /** [{type, item}] alfabetisch op titel (taalgevoelig, hoofdletters en accenten tellen niet; bij gelijke titel op id). */
  S.sortByTitle = function (list) {
    var col = null;
    try { col = new Intl.Collator(B.lang === 'zh-Hans' ? 'zh-CN' : (B.lang || undefined), { sensitivity: 'base', numeric: true }); } catch (e) { col = null; }
    function cmp(a, b) { return col ? col.compare(a, b) : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true }); }
    return list.slice().sort(function (a, b) {
      var r = cmp(String(a.item.title || '').trim(), String(b.item.title || '').trim());
      return r || (String(a.item.id) < String(b.item.id) ? -1 : String(a.item.id) > String(b.item.id) ? 1 : 0);
    });
  };
  function top10Card(x, type, i) {
    var card = h('a.card.top10', { href: S.titleLink(type, x), 'aria-label': (i + 1) + '. ' + x.title }, [
      h('div.top10-num', String(i + 1)), h('div.card-img', [U.img(x.poster, 'poster', x.title), langBadge(x, type === 'series')])]);
    if (S.cardMenu) U.onMenu(card, function () { return S.cardMenu(x, type, {}); }, x.title);
    return card;
  }
  function pct(p) { return Math.round(B.clamp((Date.now() - p.start) / (p.end - p.start), 0, 1) * 100) + '%'; }
  function channelCard(ch, list, opts) {
    var nn = Lib.nowNext(ch);
    var b = h('button.ccard', { type: 'button', 'aria-label': ch.name }, [
      h('div.ccard-logo', [U.img(ch.logo, 'logo', ch.name)]),
      h('div.ccard-info', [h('div.ccard-name', ch.name), h('div.ccard-now.muted', nn.now ? nn.now.title : (ch.group || '')),
        nn.now ? h('div.card-progress.inline', [h('div', { style: { width: pct(nn.now) } })]) : null])
    ]);
    if (ch._key || ch._noKey) phClick(b, ch, 'channel');
    else b.addEventListener('click', function () { B.player.playChannel(ch, (list || [ch]).filter(function (c) { return !c._key && !c._noKey; })); });
    if (S.cardMenu) U.onMenu(b, function () { return S.cardMenu(ch, 'channel', opts || {}); }, ch.name);
    return b;
  }
  S.channelCard = channelCard;

  function itemCard(hit, chans) {
    return hit.type === 'channel' ? channelCard(hit.item, chans) : posterCard(hit.item, hit.type);
  }

  // MARK: hoofdscherm (navigatie bovenaan of onderaan, pagina's via de router)

  // [sleutel, tekst, icoon, waar]: 'top' = alleen bovenin (computer), 'tab' = alleen in de onderbalk (telefoon)
  // build 140: "Categorieën" (#/categorie: Live TV, Films en Series) staat weer in de navigatie, op de plek van Mijn Bingr;
  // Mijn Bingr blijft bereikbaar via het profiel (avatar) bovenin
  var NAV = [['home', 'Home', 'home'], ['live', 'Live TV', 'tv'], ['movies', 'Movies', 'film'], ['series', 'Series', 'series'],
    ['mylist', 'My List', 'bookmark', 'top'], ['categorie', 'Categories', 'grid']];
  // build 140: pagina's waarmee je een kinderprofiel verlaat (instellingen, account, Mijn Bingr): eerst de ouderpoort
  var KIDS_GATED = { settings: 1, support: 1, mybingr: 1, profiles: 1, homelayout: 1, catprefs: 1, stats: 1 };

  S.main = function () {
    var content = h('main.content', { id: 'content', tabindex: '-1' });
    var links = h('nav.top-links', { 'aria-label': 'Bingr' });
    var tabs = h('nav.tabbar', { 'aria-label': 'Bingr' });
    var profBtn = h('button.prof-btn', { type: 'button', 'aria-label': L('Profile'), 'aria-haspopup': 'menu' });
    var searchBtn = h('a.icon-btn', { href: '#/search', 'aria-label': L('Search'), title: L('Search') + ' (/)' }, [U.icon('search')]);
    var header = h('header.topbar', [h('a.logo', { href: '#/home', 'aria-label': 'Bingr Home' }, 'BINGR'), links, h('div.top-right', [searchBtn, profBtn])]);
    var hidden = D.shared('hiddenTabs', []) || [];
    NAV.forEach(function (n) {
      if (hidden.indexOf(n[0]) >= 0) return;
      if (n[3] !== 'tab') links.appendChild(h('a.top-link', { href: '#/' + n[0], 'data-k': n[0] }, L(n[1])));
      if (n[3] !== 'top') tabs.appendChild(h('a.tab', { href: '#/' + n[0], 'data-k': n[0] }, [U.icon(n[2]), h('span', L(n[1]))]));
    });
    var el = h('div.app', [header, content, tabs]);
    var page = null, pageKey = null, scrolls = {}, lastNav = null;
    function drawProf() {
      U.clear(profBtn);
      var p = B.app.profile;
      if (p) profBtn.appendChild(S.avatar(p, 'small'));
      profBtn.appendChild(U.icon('down', 'caret'));
      // build 146: ongelezen antwoorden van support (Instellingen opent via dit menu)
      var bd = B.support && B.support.badge('on-prof');
      if (bd) profBtn.appendChild(bd);
    }
    drawProf();
    profBtn.addEventListener('click', function (e) { e.stopPropagation(); profileMenu(profBtn); });

    function onScroll() { header.classList.toggle('solid', window.scrollY > 10); }
    window.addEventListener('scroll', onScroll, { passive: true });

    var gateFrom = null, gateOpen = false;
    function render(r) {
      if (B.player.current) return;
      var key = r.parts[0] || 'home';
      if (!S.pages[key]) { R.go('/home', true); return; }
      // build 140: vanuit een kinderprofiel naar instellingen/Mijn Bingr: eerst de rekensom (binnen die pagina's niet opnieuw)
      if (KIDS_GATED[key] && B.app.isKids && B.app.isKids() && gateFrom !== 'in') {
        if (gateOpen) return;
        gateOpen = true;
        var back = pageKey;
        U.mathGate(function () { gateOpen = false; gateFrom = 'in'; render(r); }, function () {
          gateOpen = false;
          if (back && back !== r.hash) history.replaceState(history.state, '', back); else history.replaceState(history.state, '', '#/home');
          R.fire();
        });
        return;
      }
      gateFrom = KIDS_GATED[key] ? 'in' : null;
      if (page && pageKey) scrolls[pageKey] = window.scrollY;
      if (page && page.destroy) { try { page.destroy(); } catch (e) { B.log('destroy', e); } }
      U.clear(content);
      pageKey = r.hash;
      page = S.pages[key](r);
      content.appendChild(page.el);
      el.setAttribute('data-page', key);
      // build 97: navOwner mag een functie zijn (titel- en persoonspagina: het tabblad waar je vandaan kwam)
      var own = S.navOwner[key];
      var lastTab = NAV.some(function (n) { return n[0] === lastNav; }) ? lastNav : null;
      var navKey = (typeof own === 'function' ? own(r, lastTab) : own) || key;
      lastNav = navKey;
      [links, tabs].forEach(function (box) {
        Array.prototype.forEach.call(box.children, function (a) {
          var on = a.getAttribute('data-k') === navKey;
          a.classList.toggle('active', on);
          if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
      });
      var y = scrolls[pageKey] || 0;
      window.scrollTo(0, y);
      if (y) setTimeout(function () { window.scrollTo(0, y); }, 60);
      onScroll();
      document.title = (page.title ? page.title + ' · ' : '') + 'Bingr';
    }
    /** Huidige pagina opnieuw opbouwen (nieuwe bibliotheek, andere taal), op dezelfde plek. */
    function rerender() {
      if (!page) return;
      if (B.player.current) { deferred.lib = true; return; } // build 97: na het sluiten van de speler één keer
      deferred.lib = false;
      var y = window.scrollY;
      if (page.refresh) { page.refresh(); return; }
      if (page.destroy) { try { page.destroy(); } catch (e) { /* stil */ } }
      U.clear(content);
      page = S.pages[R.current.parts[0] || 'home'](R.current);
      content.appendChild(page.el);
      window.scrollTo(0, y);
    }
    var pending = {};
    function soon(kind, fn, ms) { clearTimeout(pending[kind]); pending[kind] = setTimeout(fn, ms || 250); }
    // build 97: zolang de speler open is de verborgen pagina niet bijwerken (voortgang en vinkjes komen elke paar
    // seconden binnen); onthouden wat er nog moet en dat één keer doen als de speler sluit
    var deferred = { lib: false, data: false, epg: false, coll: false, marks: false };
    function hook(kind, fn) {
      return function () {
        if (B.player.current) { deferred[kind] = true; return; }
        deferred[kind] = false;
        fn();
      };
    }
    var doData = hook('data', function () { if (page && page.onData) page.onData(); });
    var doEpg = hook('epg', function () { if (page && page.onEpg) page.onEpg(); });
    var doColl = hook('coll', function () { if (page && page.onCollections) page.onCollections(); });
    var doMarks = hook('marks', function () { S.refreshMarks(content); });
    function flushDeferred() {
      var d = deferred;
      if (d.lib) { d.lib = d.data = d.epg = d.coll = false; rerender(); }
      if (d.coll) doColl();
      if (d.data) doData();
      if (d.epg) doEpg();
      if (d.marks) doMarks();
    }
    var offs = [
      B.on('library', function () { clearTimeout(pending.data); clearTimeout(pending.epg); soon('lib', rerender, 200); }),
      B.on('loading', function () { if (page && page.onLoading) page.onLoading(); }),
      B.on('profileData', function () { if (page && page.onData) soon('data', doData, 300); }),
      B.on('epg', function () { if (page && page.onEpg) soon('epg', doEpg, 300); }),
      B.on('profiles', drawProf),
      B.on('support', drawProf),
      B.on('collections', function () { if (page && page.onCollections) soon('coll', doColl, 150); }),
      B.on('trakt', function () { if (page && page.onData) soon('data', doData, 300); }),
      // vinkjes op álle posters (ook Films, Series, zoeken en categorie-rijen, die geen onData hebben)
      B.on('trakt', function () { soon('marks', doMarks, 350); }),
      B.on('profileData', function () { soon('marks', doMarks, 350); }),
      B.on('playerClosed', function () { soon('flush', flushDeferred, 50); })
    ];
    R.handlers = [render];
    var screen = {
      el: el,
      rerender: rerender,
      start: function () {
        var cur = R.parse();
        if (!cur.parts.length || !S.pages[cur.parts[0]]) R.go('/' + B.app.startPage(), true); else R.fire();
      },
      destroy: function () {
        Object.keys(pending).forEach(function (k) { clearTimeout(pending[k]); });
        offs.forEach(function (f) { f(); });
        window.removeEventListener('scroll', onScroll);
        if (page && page.destroy) { try { page.destroy(); } catch (e) { /* stil */ } }
        // build 140: alleen de eigen router-handler weg. Bij wisselen via het profielmenu maakt pickProfile eerst het nieuwe
        // hoofdscherm (dat zijn handler al zette) en ruimt show() daarna het oude op: R.handlers = [] maakte de pagina leeg.
        R.handlers = R.handlers.filter(function (f) { return f !== render; });
      }
    };
    return screen;
  };

  function profileMenu(anchor) {
    var cur = B.app.profile;
    var menu = h('div.menu', { role: 'menu' });
    D.profiles.forEach(function (p) {
      if (cur && p.id === cur.id) return;
      var it = h('button.menu-it', { type: 'button', role: 'menuitem' }, [S.avatar(p, 'tiny'), h('span', p.name)]);
      it.addEventListener('click', function () { close(); B.app.pickProfileWithPin(p); });
      menu.appendChild(it);
    });
    function item(icon, label, fn, href, ext) {
      var attrs = { href: href, role: 'menuitem' };
      if (ext) { attrs.target = '_blank'; attrs.rel = 'noopener'; }
      var it = href ? h('a.menu-it', attrs, [U.icon(icon), h('span', label)]) : h('button.menu-it', { type: 'button', role: 'menuitem' }, [U.icon(icon), h('span', label)]);
      it.addEventListener('click', function () { close(); if (fn) fn(); });
      menu.appendChild(it);
    }
    if (menu.children.length) menu.appendChild(h('div.menu-sep'));
    // build 146: alle servers één voor één vernieuwen (zoals de knop Vernieuwen), direct boven Wissel profiel; niet bij een
    // kinderprofiel
    if (cur && !cur.kids && D.sources.length && B.xs) item('refresh', L('Refresh servers'), function () { B.xs.refreshAll(); });
    item('users', L('Switch profile'), function () { B.app.switchProfile(); });
    if (D.isMain(cur)) item('edit', L('Manage profiles'), null, '#/profiles');
    item('user', L('My Bingr'), null, '#/mybingr');
    item('gear', L('Settings'), null, '#/settings');
    var stIt = menu.lastChild, bd = B.support && B.support.badge();
    if (bd) stIt.appendChild(bd);
    // build 140: kinderprofiel: naar het account pas na de rekensom
    if (cur && cur.kids) item('account', L('Account and devices'), function () { B.app.leaveKids(function () { location.href = '../account/'; }); });
    else item('account', L('Account and devices'), null, '../account/');
    item('help', L('Support'), null, '#/support');
    var spIt = menu.lastChild, bd2 = B.support && B.support.badge();
    if (bd2) spIt.appendChild(bd2);
    menu.appendChild(h('div.menu-sep'));
    item('logout', L('Sign out'), function () { confirmSignOut(); });
    var r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + 'px';
    menu.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
    var veil = h('div.menu-veil');
    function close() { veil.remove(); menu.remove(); document.removeEventListener('keydown', onKey, true); anchor.focus(); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    veil.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(veil);
    document.body.appendChild(menu);
    var f = menu.querySelector('.menu-it');
    if (f) f.focus();
  }
  function confirmSignOut() {
    U.modal({ title: L('Sign out'), text: L('Sign out of Bingr on this device?'), buttons: [
      { label: L('Sign out'), fn: function () { B.app.signOut(); }, primary: true }, { label: L('Cancel') }] });
  }

  /** Laden, fout of geen server: een melding in plaats van de pagina. */
  function stateBox() {
    var lib = Lib.lib;
    var empty = !lib.channels.length && !lib.movies.length && !lib.series.length;
    if (!Lib.source) {
      return h('div.state', [U.icon('tv', 'state-ic'), h('h2', L('No servers yet')),
        h('p.muted', L('Add a server in the Bingr app or on bingr.online/account. It appears here automatically.')),
        h('a.btn.primary', { href: '../account/' }, L('My Bingr'))]);
    }
    if (Lib.loading && empty) return h('div.state', [U.spinner(), h('p.muted', L('Loading %@…', Lib.source.name))]);
    if (Lib.error && empty) {
      var insecure = Lib.error === B.insecureMessage();
      var kids = [U.icon(insecure ? 'lock' : 'warn', 'state-ic'), h('h2', insecure ? L('Not available in the browser') : L("Couldn't load the server")), h('p.muted', Lib.error)];
      var row = h('div.state-btns');
      if (!insecure) row.appendChild(U.button(L('Try again'), function () { Lib.select(Lib.source, true); }, { primary: true }));
      if (D.sources.length > 1) row.appendChild(U.button(L('Choose another server'), chooseServer, { icon: 'layers' }));
      kids.push(row);
      return h('div.state', kids);
    }
    return null;
  }
  function chooseServer() {
    var src = Lib.source;
    U.choose(L('Active server'), D.sources.map(function (s) {
      return { value: s.id, label: s.name, sub: s.kind };
    }), src ? src.id : null, function (id) {
      var s2 = D.sourceById(id);
      if (!s2) return;
      D.setActiveSource(id); Lib.select(s2);
    });
  }
  S.chooseServer = chooseServer;
  S.stateBox = stateBox;

  // MARK: Home

  S.pages.home = function () {
    var el = h('div.page.home');
    var pg = { el: el, title: L('Home') };
    var keysBuilt = {};
    /**
     * build 140: uitgelicht = vaste selectie van max. 8 titels, om en om uit Voor jou en Nieuw op Bingr (dubbele weg),
     * die om de 8 s vanzelf wisselt; de start schuift elke dag één plek op (dagnummer modulo het aantal). Geen willekeur
     * per opening. Kinderprofiel: alleen kinderinhoud (de lijsten komen uit de gefilterde bibliotheken).
     */
    function heroList() {
      var fy = S.forYou ? S.forYou().items : [];
      var nb = B.discover && B.discover.newOnBingr ? B.discover.newOnBingr(16) : [];
      var out = [], seen = Object.create(null);
      function add(e) {
        if (!e || !e.item || !e.item.poster || out.length >= 8) return;
        var k = (B.xs && B.xs.workKey(e.type, e.item)) || (e.type + '|' + e.item.id);
        if (seen[k]) return;
        seen[k] = true;
        out.push({ item: e.item, type: e.type });
      }
      for (var i = 0; i < Math.max(fy.length, nb.length) && out.length < 8; i++) { add(fy[i]); add(nb[i]); }
      if (!out.length) { var one = heroFor(); if (one) out.push(one); }
      return out;
    }
    function heroFor() {
      var lib = Lib.lib;
      return Lib.memo('hero', function () {
        var cands = lib.movies.filter(function (m) { return m.poster; }).slice(0, 400);
        if (!cands.length) cands = lib.series.filter(function (s) { return s.poster; }).slice(0, 400);
        if (!cands.length) return null;
        // build 140: geen willekeur meer: de best scorende titel (Top 10), anders de eerste met een cover
        var top = Lib.top10(lib.movies.length ? lib.movies : lib.series);
        var pick = top.length ? top[0] : cands[0];
        return { item: pick, type: lib.movies.indexOf(pick) >= 0 ? 'movie' : 'series' };
      });
    }
    function hero(hf) {
      var x = hf.item;
      var meta = [];
      if (x.year) meta.push(String(x.year));
      if (x.rating) meta.push('★ ' + (Math.round(x.rating * 10) / 10));
      if (x.group) meta.push(x.group);
      var play = U.button(L('Play'), function () {
        if (hf.type === 'movie') B.player.playVOD(B.player.movieItem(x));
        else R.go(S.titleLink('series', x).slice(1));
      }, { primary: true, icon: 'play' });
      var info = h('a.btn.ghost', { href: S.titleLink(hf.type, x) }, [U.icon('info'), h('span', L('More info'))]);
      return h('section.hero', [
        h('div.hero-bg', [U.img(x.poster, 'hero-img')]), h('div.hero-shade'),
        h('div.hero-info', [
          h('div.hero-kind', hf.type === 'series' ? L('SERIES') : L('FILM')),
          h('h1.hero-title', x.title), h('div.hero-meta', meta.join('  ·  ')),
          x.plot ? h('p.hero-plot', x.plot) : null,
          h('div.hero-btns', [play, info])
        ]),
        h('div.hero-poster', [U.img(x.poster, 'poster', x.title)]),
        // telefoon: grote portretkaart met titel en knoppen erin, zoals HeroBanner (phoneBody) in de iPhone-app
        h('div.hero-card', [
          U.img(x.poster, 'hero-card-img', x.title), h('div.hero-card-shade'),
          h('div.hero-card-info', [
            h('div.hero-card-title', String(x.title || '').toUpperCase()),
            meta.length ? h('div.hero-card-tags', meta.join('  ·  ')) : null,
            h('div.hero-card-btns', [
              U.button(L('Play'), function () {
                if (hf.type === 'movie') B.player.playVOD(B.player.movieItem(x));
                else R.go(S.titleLink('series', x).slice(1));
              }, { primary: true, icon: 'play' }),
              h('a.btn.ghost', { href: S.titleLink(hf.type, x) }, [U.icon('info'), h('span', L('Info'))])
            ])
          ])
        ])
      ]);
    }
    function continueRow() {
      // build 128: over alle servers (xs.js)
      if (B.xs) return U.row(L('Continue watching'), S.continueCards(20));
      var lib = Lib.lib, cards = [];
      var byTitle = Lib.memo('seriesByTitle', function () { var m = {}; lib.series.forEach(function (s) { if (!m[s.title]) m[s.title] = s; }); return m; });
      var seen = {}, seriesKeys = {};
      D.progressList().forEach(function (pe) {
        var hit = lib.byId[pe.key];
        if (hit && hit.type === 'movie') { if (cards.length < 20) cards.push({ x: hit.item, type: 'movie', p: pe.e.fraction, keys: [pe.key] }); }
        else if (!hit) {
          var s = byTitle[pe.e.title];
          if (!s) return;
          (seriesKeys[s.id] = seriesKeys[s.id] || []).push(pe.key);
          if (!seen[s.id] && cards.length < 20) { seen[s.id] = true; cards.push({ x: s, type: 'series', p: pe.e.fraction, keys: seriesKeys[s.id] }); }
        }
      });
      return U.row(L('Continue watching'), cards.map(function (c) { return posterCard(c.x, c.type, { progress: c.p, continueKeys: c.keys }); }));
    }
    function myListRow() {
      var cards = myListItems().slice(0, 40).map(function (hit) { return posterCard(hit.item, hit.type); });
      return U.row(L('My List'), cards, null, '#/mylist');
    }
    function liveRow() {
      var lib = Lib.lib, chans = [];
      // build 128: recente en favoriete zenders van alle servers
      B.xs.dedupe(B.xs.listTiles('recentChannels', 'channel').concat(B.xs.listTiles('favorites', 'channel'))).forEach(function (hit) { if (chans.indexOf(hit.item) < 0) chans.push(hit.item); });
      if (!chans.length) chans = lib.channels.slice(0, 20);
      chans = chans.slice(0, 24);
      return U.row(L('Live now'), chans.map(function (c) { return channelCard(c, chans); }), 'live', '#/live');
    }
    function forYouRow() {
      // build 140: per actief profiel (geschiedenis, Verder kijken, genres en TMDB-aanbevelingen), meest passend eerst;
      // zonder geschiedenis heet de rij "Populair". Label Serie/Film linksboven op de cover (zoals iOS build 74)
      var fy = S.forYou();
      return U.row(fy.popular ? L('Popular') : L('For you'), fy.items.map(function (hit) { return posterCard(hit.item, hit.type, { kindBadge: true }); }));
    }
    function builders() {
      var lib = Lib.lib;
      var kids = B.app.profile && B.app.profile.kids;
      var b = {
        'continue': continueRow, 'mylist': myListRow, 'live': liveRow, 'foryou': forYouRow,
        'top10': function () {
          return [U.row(kids ? L('Top 10 kids series') : L('Top 10 series today'), Lib.top10(lib.series).map(function (s, i) { return top10Card(s, 'series', i); }), 'top10row'),
            U.row(kids ? L('Top 10 kids movies') : L('Top 10 movies today'), Lib.top10(lib.movies).map(function (m, i) { return top10Card(m, 'movie', i); }), 'top10row')];
        },
        // build 141: "Nieuw toegevoegd" ('recent') is weg; "Nieuw op Bingr" ('streaming') staat op zijn plek
        // build 111: Binnenkort op Bingr / Nieuw op Bingr (TMDB), met bronvermelding onder de rij
        'upcoming': function () { return B.discover ? B.discover.row('upcoming') : null; },
        'streaming': function () { return B.discover ? B.discover.row('streaming') : null; },
        'movies': function () { return U.row(L('Movies'), lib.movies.slice(0, 30).map(function (m) { return posterCard(m, 'movie'); }), null, '#/movies'); },
        'series': function () { return U.row(L('Series'), lib.series.slice(0, 30).map(function (s) { return posterCard(s, 'series'); }), null, '#/series'); },
        // rij met genretegels (build 86); 'categories' hieronder = rijen per categorie van de server
        'browse': function () { return B.categories ? B.categories.homeRow() : null; },
        'categories': function () {
          var out = [];
          var mg = Lib.byGroup('movie'), sg = Lib.byGroup('series');
          // build 147: elke rij als functie; fillRow bouwt ze één voor één in een eigen macrotaak (14 rijen × 30 tegels)
          lib.movieGroups.slice(0, 8).forEach(function (g) { out.push(function () { return U.row(g, (mg[g] || []).slice(0, 30).map(function (m) { return posterCard(m, 'movie'); }), null, R.link(['movies', g])); }); });
          lib.seriesGroups.slice(0, 6).forEach(function (g) { out.push(function () { return U.row(g, (sg[g] || []).slice(0, 30).map(function (s) { return posterCard(s, 'series'); }), null, R.link(['series', g])); }); });
          return out;
        }
      };
      D.collectionsFor(B.app.profile.id).forEach(function (c) {
        b['collection:' + c.id] = function () { return S.collectionRow(c); };
      });
      return b;
    }
    /** Volledige indeling (ook uitgezette rijen), alleen rijen die hier bestaan. */
    function layout(b) {
      var colls = D.collectionsFor(B.app.profile.id);
      return S.effectiveHomeLayout(D.homeLayout(), colls).filter(function (r) { return b[r.key]; });
    }
    var blocks = {}, rows = null, liveSlot = null, autoGenres = false;
    /**
     * Rij "Categorieën" op zijn standaardplek (in de indeling direct na "Nu live"): op Home na de 5e rij die onder
     * "Nu live" staat (elke rij telt: Top 10 = 2 rijen, "Rijen per categorie" = een rij per categorie). Minder dan
     * 5 rijen daaronder = helemaal onderaan. Geen "Nu live" (uitgezet of geen zenders): vanaf de plek waar die rij
     * zou staan. Heb je de rij zelf verplaatst, dan staat hij gewoon op die plek in de indeling.
     */
    function placeGenres() {
      var g = blocks.browse;
      if (!g || !autoGenres || !rows) return;
      if (g.parentNode) g.parentNode.removeChild(g);
      var anchor = blocks.live || liveSlot;
      var after = null, n = 0;
      if (anchor) {
        var all = rows.querySelectorAll('section.row');
        for (var i = 0; i < all.length && !after; i++) {
          var r = all[i];
          if (anchor.contains(r) || !(anchor.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
          if (++n === 5) after = r;
        }
      }
      if (after) after.parentNode.insertBefore(g, after.nextSibling); else rows.appendChild(g);
    }
    function render() {
      U.clear(el);
      blocks = {}; rows = null; liveSlot = null; autoGenres = false;
      var st = stateBox();
      if (st) { el.appendChild(st); return; }
      startHero();
      rows = h('div.rows');
      el.appendChild(rows);
      var b = builders();
      var lay = layout(b);
      var gi = -1;
      lay.forEach(function (r, i) { if (r.key === 'browse') gi = i; });
      autoGenres = gi > 0 && lay[gi - 1].key === 'live';
      // build 147: de eerste rijen meteen, de rest elk in een eigen macrotaak (Home met 15+ rijen en honderden tegels
      // hield de hoofdthread anders in één keer vast); de holders staan wel meteen op hun plek
      var later = [], shown = 0, my = ++fillJob;
      filled = {};
      lay.forEach(function (r) {
        var k = r.key;
        if (!r.visible) {
          // onzichtbaar merkteken op de plek van een uitgezette "Nu live" (telpunt voor de rij Categorieën)
          if (k === 'live' && autoGenres) { liveSlot = h('div.rowgroup.live-slot', { hidden: true }); rows.appendChild(liveSlot); }
          return;
        }
        var holder = h('div.rowgroup', { 'data-k': k });
        blocks[k] = holder;
        if (!(k === 'browse' && autoGenres)) rows.appendChild(holder);
        keysBuilt[k] = true;
        if (shown++ < FIRST_ROWS) fillRow(b, k); else later.push(k);
      });
      placeGenres();
      var tid = later.length ? B.task.begin('rows_build') : 0;
      B.steps(later.map(function (k) {
        return function () { if (my === fillJob && blocks[k] && !filled[k] && el.isConnected !== false) { fillRow(b, k); placeGenres(); } };
      })).then(function () { if (tid) B.task.end(tid); });
      loadDiscover();
    }
    var FIRST_ROWS = 3, fillJob = 0, filled = {};
    function fillRow(b, k) {
      var holder = blocks[k];
      if (!holder || !b[k]) return;
      filled[k] = true;
      return putNodes(holder, b[k]());
    }
    /** Knopen in een holder; functies (rijen die nog gebouwd moeten worden) elk in een eigen macrotaak. */
    var putGen = 0;
    function putNodes(holder, nodes) {
      nodes = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
      var my = holder._put = ++putGen;
      U.clear(holder);
      var lazy = [];
      nodes.forEach(function (n) {
        if (typeof n !== 'function') { holder.appendChild(n); return; }
        if (!lazy.length && !holder.firstChild) { var x = n(); if (x) holder.appendChild(x); return; }
        lazy.push(n);
      });
      if (!lazy.length) return;
      return B.steps(lazy.map(function (f) {
        return function () { if (holder._put !== my || !holder.isConnected) return; var x = f(); if (x) { holder.appendChild(x); placeGenres(); } };
      }));
    }
    /** build 111: TMDB-rijen en de titelindex op de achtergrond; daarna alleen die rijen opnieuw. */
    var discJob = 0;
    function loadDiscover() {
      if (!B.discover || !rows) return;
      var my = ++discJob;
      B.discover.resolveMissing();
      B.discover.loadAll().then(function (changed) {
        if (changed && my === discJob && el.isConnected !== false) refreshRows(['upcoming', 'streaming']);
      }, B.noop);
    }
    var offDiscover = B.on('discover', function () { if (rows) refreshRows(['mylist', 'upcoming', 'streaming']); });
    // build 140: TMDB-aanbevelingen voor Voor jou binnen, of nieuwe titels gezien (Nieuw op Bingr)
    var offFy = B.on('forYou', function () { if (rows) refreshRows(['foryou']); });
    var offSeen = B.on('seen', function () { if (rows) refreshRows(['streaming']); });
    pg.destroy = function () { fillJob++; offDiscover(); offFy(); offSeen(); stopHero(); };

    // MARK: uitgelicht (build 140): vaste roulerende selectie
    var heroEl = null, heroItems = [], heroIdx = 0, heroTimer = null, heroSig = '';
    function heroSigOf(list) { return list.map(function (x) { return x.type + ':' + x.item.id; }).join(','); }
    function stopHero() { clearInterval(heroTimer); heroTimer = null; }
    function showHero(i, anim) {
      if (!heroItems.length) return;
      heroIdx = ((i % heroItems.length) + heroItems.length) % heroItems.length;
      var fresh = hero(heroItems[heroIdx]);
      if (heroItems.length > 1) {
        var dots = h('div.hero-dots', { role: 'tablist', 'aria-label': L('Featured') });
        heroItems.forEach(function (x, n) {
          var d = h('button.hero-dot' + (n === heroIdx ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': n === heroIdx ? 'true' : 'false', 'aria-label': x.item.title });
          d.addEventListener('click', function () { showHero(n, true); restartHero(); });
          dots.appendChild(d);
        });
        fresh.appendChild(dots);
      }
      if (anim) fresh.classList.add('hero-in');
      if (heroEl && heroEl.parentNode) heroEl.parentNode.replaceChild(fresh, heroEl);
      heroEl = fresh;
    }
    function restartHero() {
      stopHero();
      if (heroItems.length < 2) return;
      heroTimer = setInterval(function () {
        if (!heroEl || !heroEl.isConnected) { if (heroEl && !el.isConnected) stopHero(); return; }
        // niet wisselen als de speler open is, het tabblad verborgen is of de focus in de kop staat
        if (B.player.current || document.hidden || (document.activeElement && heroEl.contains(document.activeElement))) return;
        showHero(heroIdx + 1, true);
      }, 8000);
    }
    function startHero() {
      stopHero();
      heroItems = heroList();
      heroSig = heroSigOf(heroItems);
      heroEl = null;
      if (!heroItems.length) return;
      var day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
      showHero(day % heroItems.length, false);
      el.appendChild(heroEl);
      restartHero();
    }
    S._heroState = function () { return { items: heroItems.map(function (x) { return x.item.title; }), idx: heroIdx, running: !!heroTimer }; };
    function refreshRows(keys) {
      var b = builders();
      // eerst de rij Categorieën losmaken (hij kan in een andere groep staan), daarna opnieuw op zijn plek
      if (autoGenres && blocks.browse && blocks.browse.parentNode) blocks.browse.parentNode.removeChild(blocks.browse);
      keys.forEach(function (k) {
        var holder = blocks[k];
        if (!holder || !b[k]) return;
        var nodes = b[k]();
        // scrollpositie van de rij bewaren
        var tr = holder.querySelector('.row-track'), x = tr ? tr.scrollLeft : 0;
        putNodes(holder, nodes);
        var tr2 = holder.querySelector('.row-track');
        if (tr2) tr2.scrollLeft = x;
        filled[k] = true;
      });
      placeGenres();
    }
    pg.refresh = render;
    pg.onLoading = function () { if (el.querySelector('.state')) render(); };
    var layoutKey = JSON.stringify(D.homeLayout());
    pg.onData = function () {
      var lk = JSON.stringify(D.homeLayout());
      if (lk !== layoutKey) { layoutKey = lk; render(); return; }
      refreshRows(Object.keys(blocks).filter(function (k) { return k !== 'top10' && k !== 'categories' && k !== 'browse'; }));
    };
    pg.onCollections = function () { render(); };
    pg.onEpg = function () { refreshRows(['live']); };
    render();
    return pg;
  };

  function myListItems() {
    // build 128: Mijn lijst van alle servers (zelfde titel op twee servers = één tegel)
    var out = B.xs.listTiles('myList', 'title');
    // build 111: TMDB-titels (Binnenkort op Bingr / Nieuw op Bingr) die niet in je bibliotheek staan
    if (B.discover) out = out.concat(B.discover.myListHits());
    return out;
  }
  S.myListItems = myListItems;

  // MARK: build 128: tegel uit catalogmeta openen (#/item?k=<sleutel>&t=<soort>&f=<lijst>), ook na herladen

  S.navOwner.item = function (r, last) { return last || 'home'; };
  S.pages.item = function (r) {
    var el = h('div.page.detail', [h('div.state', [U.spinner()])]);
    var pg = { el: el, title: L('Loading…') };
    var key = r.query.k || '', type = r.query.t || 'movie', field = r.query.f || null;
    var started = false;
    function leave() { if (R.current && R.current.parts[0] === 'item') { if (history.length > 1) history.back(); else R.go('/home', true); } }
    function go() {
      if (started || !key) { if (!key) R.go('/home', true); return; }
      started = true;
      B.xs.ready().then(function () {
        var tile = B.xs.tileFor(key, type === 'channel' ? 'channel' : null, field);
        if (tile && !tile.item._key) {
          if (tile.type === 'channel') { B.player.playChannel(tile.item, [tile.item]); leave(); }
          else R.go(S.titleLink(tile.type, tile.item).slice(1), true);
          return;
        }
        tile = tile || B.xs.placeholder(key, type, 'orphan', field);
        if (!tile) { leave(); return; }
        B.xs.open(tile, { replace: true, onDone: leave });
      });
    }
    go();
    return pg;
  };

  // MARK: Films en Series (categorieën als chips; "Alles" = rijen per categorie)

  function catalogPage(type) {
    return function (r) {
      var isMovie = type === 'movie';
      var group = r.parts[1] || null;
      var el = h('div.page.catalog');
      var pg = { el: el, title: L(isMovie ? 'Movies' : 'Series') };
      var grid = null;
      function render() {
        if (grid && grid.destroy) grid.destroy();
        U.clear(el);
        var st = stateBox();
        var head = h('div.page-head', [h('h1', L(isMovie ? 'Movies' : 'Series'))]);
        el.appendChild(head);
        if (st) { el.appendChild(st); return; }
        var lib = Lib.lib;
        var groups = isMovie ? lib.movieGroups : lib.seriesGroups;
        var chips = h('div.chips', { role: 'tablist' });
        var base = isMovie ? 'movies' : 'series';
        chips.appendChild(h('a.chip' + (!group ? '.active' : ''), { href: '#/' + base, role: 'tab' }, L('All')));
        groups.forEach(function (g) { chips.appendChild(h('a.chip' + (g === group ? '.active' : ''), { href: R.link([base, g]), role: 'tab' }, g)); });
        el.appendChild(chips);
        setTimeout(function () { var a = chips.querySelector('.active'); if (a && group) chips.scrollLeft = a.offsetLeft - 40; }, 0);
        var all = isMovie ? lib.movies : lib.series;
        if (!group) {
          var byG = Lib.byGroup(type);
          var rows = h('div.rows');
          el.appendChild(rows);
          var top = Lib.top10(all);
          if (top.length >= 5) rows.appendChild(U.row(L(isMovie ? 'Top 10 movies today' : 'Top 10 series today'), top.map(function (x, i) { return top10Card(x, type, i); }), 'top10row'));
          if (isMovie) { var rec = Lib.recent(all, 30); if (rec.length) rows.appendChild(U.row(L('Recently added'), rec.map(function (m) { return posterCard(m, 'movie'); }))); }
          // eigen collecties: alleen de films of series daaruit (zoals collectionRow op iOS)
          D.collectionsFor(B.app.profile.id).forEach(function (c) {
            var row = S.collectionRow(c, type);
            if (row) rows.appendChild(row);
          });
          // rijen per categorie in stukjes (veel categorieën): de rest als je verder scrolt
          var gi = 0;
          var more = h('div.grid-more');
          rows.appendChild(more);
          var io = null;
          function step() {
            var end = Math.min(groups.length, gi + 6);
            for (; gi < end; gi++) {
              var g = groups[gi];
              var row = U.row(g, (byG[g] || []).slice(0, 30).map(function (x) { return posterCard(x, type); }), null, R.link([base, g]));
              if (row) rows.insertBefore(row, more);
            }
            if (gi >= groups.length) { if (io) io.disconnect(); more.remove(); }
          }
          step();
          if (gi < groups.length && window.IntersectionObserver) {
            io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) step(); }, { rootMargin: '600px' });
            io.observe(more);
          }
          grid = { destroy: function () { if (io) io.disconnect(); } };
          return;
        }
        var items = Lib.byGroup(type)[group] || [];
        if (!items.length) { el.appendChild(h('div.state', [h('p.muted', L('Nothing here yet'))])); return; }
        grid = U.grid(items, function (x) { return posterCard(x, type); }, 'posters');
        el.appendChild(grid);
      }
      pg.refresh = render;
      pg.onLoading = function () { if (el.querySelector('.state')) render(); };
      pg.onCollections = function () { if (!group) { var y = window.scrollY; render(); window.scrollTo(0, y); } };
      pg.destroy = function () { if (grid && grid.destroy) grid.destroy(); };
      render();
      return pg;
    };
  }
  S.pages.movies = catalogPage('movie');
  S.pages.series = catalogPage('series');

  // MARK: Mijn lijst

  S.pages.mylist = function () {
    var el = h('div.page.mylist');
    var pg = { el: el, title: L('My List') };
    var grid = null;
    function render() {
      // build 97: vorig rooster (IntersectionObserver) eerst opruimen
      if (grid && grid.destroy) grid.destroy();
      grid = null;
      U.clear(el);
      el.appendChild(h('div.page-head', [h('h1', L('My List'))]));
      var st = stateBox();
      if (st) { el.appendChild(st); return; }
      var items = myListItems();
      if (!items.length) {
        el.appendChild(h('div.state', [U.icon('bookmark', 'state-ic'), h('h2', L('Your list is empty')), h('p.muted', L('Add movies and series with the My List button.'))]));
        return;
      }
      grid = U.grid(items, function (hit) { return posterCard(hit.item, hit.type); }, 'posters');
      el.appendChild(grid);
    }
    pg.refresh = render;
    pg.onData = render;
    pg.destroy = function () { if (grid && grid.destroy) grid.destroy(); grid = null; };
    render();
    return pg;
  };

  // MARK: Zoeken

  S.pages.search = function (r) {
    var q = r.query.q || '';
    var input = h('input.search-input', { type: 'search', placeholder: L('Search for channels, movies and series'), 'aria-label': L('Search'), value: q, autocomplete: 'off', enterkeyhint: 'search' });
    var results = h('div.search-results');
    var el = h('div.page.search', [h('div.search-bar', [U.icon('search'), input]), results]);
    var pg = { el: el, title: L('Search') };
    function run() {
      q = input.value;
      history.replaceState(history.state, '', '#/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
      U.clear(results);
      var st = stateBox();
      if (st) { results.appendChild(st); return; }
      if (!q.trim()) { results.appendChild(h('p.muted.search-hint', L('Type to search your channels, movies and series.'))); return; }
      // build 129: over alle servers van het account (zonder te wisselen; dezelfde titel op twee servers is één treffer)
      shownVersion = B.xs ? B.xs.version : 0;
      var res = B.xs ? B.xs.searchAll(q, 60) : Lib.search(q, 60);
      if (!res.channels.length && !res.movies.length && !res.series.length) { results.appendChild(h('div.state', [h('p.muted', L('No results for "%@"', q))])); return; }
      if (res.movies.length) { results.appendChild(h('h2.row-title.grid-title', L('Movies'))); results.appendChild(U.grid(res.movies, function (m) { return posterCard(m, 'movie'); }, 'posters')); }
      if (res.series.length) { results.appendChild(h('h2.row-title.grid-title', L('Series'))); results.appendChild(U.grid(res.series, function (s) { return posterCard(s, 'series'); }, 'posters')); }
      // Live TV (zenders) altijd als laatste, na films en series
      if (res.channels.length) results.appendChild(U.row(L('Channels'), res.channels.map(function (c) { return channelCard(c, res.channels); }), 'live'));
    }
    var deb = B.debounce(run, 220);
    input.addEventListener('input', deb);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { deb.cancel(); run(); input.blur(); } });
    var shownVersion = -1;
    pg.refresh = function () { run(); };
    // catalogus van een andere server binnen: resultaten bijwerken (alleen als er iets veranderde)
    pg.onData = function () { if (B.xs && B.xs.version !== shownVersion && input.value.trim()) run(); };
    pg.destroy = function () { deb.cancel(); };
    run();
    setTimeout(function () { input.focus(); }, 30);
    return pg;
  };

  // MARK: Live TV (categorieën, zenders met nu/straks, tv-gids per zender)

  S.pages.live = function (r) {
    var el = h('div.page.live');
    var pg = { el: el, title: L('Live TV') };
    var src = Lib.source ? Lib.source.id : '';
    var group = r.parts[1] || B.store.get('liveGroup', null) || null;
    var listEl = null, guideEl = null, selected = null, currentList = [], grid = null;
    function groupList() {
      var lib = Lib.lib, out = [];
      if (B.xs.listTiles('favorites', 'channel').length) out.push({ key: '★', label: L('Favorites') });
      if (B.xs.listTiles('recentChannels', 'channel').length) out.push({ key: '⟲', label: L('Recent') });
      out.push({ key: '*', label: L('All channels') });
      // eigen collecties met zenders (zoals in de apps)
      D.collectionsFor(B.app.profile.id).forEach(function (c) {
        if (S.collectionChannels(c).length) out.push({ key: 'collection:' + c.id, label: c.name, coll: true });
      });
      lib.channelGroups.forEach(function (g) { out.push({ key: g, label: g }); });
      return out;
    }
    function channelsFor(key) {
      var lib = Lib.lib;
      function fromKeys(keys) {
        var out = [];
        keys.forEach(function (k) {
          var p = k.split('|');
          if (p[0] !== src) return;
          var hit = lib.byId[p.slice(1).join('|')];
          if (hit && hit.type === 'channel') out.push(hit.item);
        });
        return out;
      }
      // build 128: favorieten en recente zenders van alle servers
      if (key === '★') return B.xs.listTiles('favorites', 'channel').map(function (x) { return x.item; });
      if (key === '⟲') return B.xs.listTiles('recentChannels', 'channel').map(function (x) { return x.item; });
      if (key === '*' || !key) return lib.channels;
      if (key.indexOf('collection:') === 0) {
        var c = D.collectionById(B.app.profile.id, key.slice(11));
        if (c) return S.collectionChannels(c);
      }
      return Lib.byGroup('channel')[key] || [];
    }
    function favKey(ch) { return B.xs.keyOf(ch); }
    function chanRow(ch) {
      var row = h('div.lv-row' + (selected === ch ? '.sel' : ''), { role: 'listitem' });
      var nameEl = h('div.lv-name'), nowEl = h('div.lv-now.muted'), txt = h('div.lv-txt', [nameEl, nowEl]);
      var prog = null;
      // build 97: nu/straks, voortgang en ster bijwerken zonder de rij te vervangen (focus en scrollpositie blijven)
      row._upd = function () {
        var nn = Lib.nowNext(ch);
        var fav = D.inSet('favorites', favKey(ch));
        if (row._fav !== fav) { row._fav = fav; U.clear(nameEl); U.append(nameEl, [ch.name, fav ? U.icon('starFill', 'lv-fav') : null]); }
        var t = nn.now ? B.fmtTime(nn.now.start) + '  ' + nn.now.title : (nn.next ? L('Next') + ': ' + nn.next.title : '');
        if (nowEl.textContent !== t) nowEl.textContent = t;
        if (nn.now) {
          if (!prog) { prog = h('div.card-progress.inline', [h('div')]); txt.appendChild(prog); }
          prog.firstChild.style.width = pct(nn.now);
        } else if (prog) { prog.remove(); prog = null; }
        row.classList.toggle('sel', selected === ch);
      };
      row._upd();
      var main = h('button.lv-main', { type: 'button', 'aria-label': L('Watch %@', ch.name) }, [
        h('span.lv-num', ch.number != null ? String(ch.number) : ''),
        h('div.lv-logo', [U.img(ch.logo, 'logo', ch.name)]),
        txt
      ]);
      if (ch._key || ch._noKey) phClick(main, ch, 'channel');
      else main.addEventListener('click', function () { B.player.playChannel(ch, currentList.filter(function (c) { return !c._key && !c._noKey; })); });
      U.onMenu(main, function () {
        var coll = group && group.indexOf('collection:') === 0 ? D.collectionById(B.app.profile.id, group.slice(11)) : null;
        return S.cardMenu(ch, 'channel', { collection: coll });
      }, ch.name);
      var gb = U.button('', function () { select(ch, true); }, { icon: 'guide', cls: 'icon-only lv-gbtn', title: L('TV guide') });
      row.appendChild(main); row.appendChild(gb);
      row._ch = ch;
      return row;
    }
    function select(ch, open) {
      selected = ch;
      if (listEl) Array.prototype.forEach.call(listEl.querySelectorAll('.lv-row'), function (rw) { rw.classList.toggle('sel', rw._ch === ch); });
      drawGuide();
      if (open && U.isPhone()) {
        var body = h('div.lv-guide.sheet');
        fillGuide(body, ch);
        U.modal({ title: ch.name, body: body, cls: 'sheet-dlg' });
      }
    }
    function fillGuide(box, ch) {
      U.clear(box);
      if (!ch) return;
      var nn = Lib.nowNext(ch);
      var fav = D.inSet('favorites', favKey(ch));
      var btns = h('div.lv-g-btns', [
        U.button(L('Watch live'), function () { B.player.playChannel(ch, currentList); }, { primary: true, icon: 'play' }),
        // plus / vinkje met animatie (was een ster); de knop blijft staan, de lijst werkt de ster in de rij bij
        U.plusCheckButton('favorite', fav ? L('Favorite') : L('Add to favorites'), fav, function () {
          D.toggleSet('favorites', favKey(ch)); refreshList(); return D.inSet('favorites', favKey(ch));
        }, { labels: [L('Add to favorites'), L('Favorite')] }),
        // build 129: met de server van de zender (sid), ook als die niet de actieve is
        U.button('', function () { S.addToCollection(S.collItem(ch, 'channel'), ch.name); }, { icon: 'stackAdd', cls: 'icon-only', title: L('Add to collection…') })
      ]);
      if (nn.now && Lib.canCatchup(ch, nn.now)) btns.appendChild(U.button(L('From the start'), function () { B.player.playCatchup(ch, nn.now, currentList); }, { icon: 'replay' }));
      box.appendChild(h('div.lv-g-head', [h('div.lv-g-logo', [U.img(ch.logo, 'logo', ch.name)]), h('div', [h('h2', ch.name), h('div.muted', ch.group || '')])]));
      if (nn.now) box.appendChild(h('div.lv-g-now', [h('div.lv-g-label', L('Now')), h('div.lv-g-title', nn.now.title),
        h('div.muted.small', B.fmtTime(nn.now.start) + ' – ' + B.fmtTime(nn.now.end)), h('div.card-progress.inline', [h('div', { style: { width: pct(nn.now) } })]),
        nn.now.description ? h('p.lv-g-desc', nn.now.description) : null]));
      box.appendChild(btns);
      var now = Date.now();
      var start = new Date(); start.setHours(0, 0, 0, 0);
      var progs = Lib.programsBetween(ch, Math.min(start.getTime(), now - 3 * 3600000), now + 24 * 3600000);
      if (!progs.length) { box.appendChild(h('p.muted.lv-g-empty', L('No TV guide for this channel'))); return; }
      var list = h('div.lv-g-list', { role: 'list' });
      var cur = null;
      progs.forEach(function (p) {
        var live = p.start <= now && p.end > now, past = p.end <= now;
        var it = h('div.lv-g-it' + (live ? '.live' : '') + (past ? '.past' : ''), { role: 'listitem' }, [
          h('span.lv-g-time', B.fmtTime(p.start)), h('div.lv-g-pt', [h('div', p.title), p.description && live ? h('div.muted.small.clamp2', p.description) : null])]);
        if ((past || live) && Lib.canCatchup(ch, p)) {
          var cb = U.button('', function () { B.player.playCatchup(ch, p, currentList); }, { icon: 'replay', cls: 'icon-only small', title: L('Watch from the start') });
          it.appendChild(cb);
        }
        if (live) cur = it;
        list.appendChild(it);
      });
      box.appendChild(list);
      if (cur) setTimeout(function () { list.scrollTop = Math.max(0, cur.offsetTop - list.offsetTop - 60); }, 0);
    }
    function drawGuide() { if (guideEl) fillGuide(guideEl, selected); }
    /**
     * build 97: zenderlijst bijwerken. Zelfde zenders: alleen de getoonde rijen ter plekke (nu/straks, ster).
     * Andere zenders (favoriet erbij, recent): opnieuw opbouwen met dezelfde scrollpositie, minstens zoveel rijen
     * als er al stonden, en de focus terug op dezelfde zender.
     */
    function sameList(a, b) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
      return true;
    }
    function updateRows() {
      if (!listEl) return;
      Array.prototype.forEach.call(listEl.querySelectorAll('.lv-row'), function (rw) { if (rw._upd) rw._upd(); });
    }
    function refreshList(rebuild) {
      if (!listEl) return;
      var fresh = channelsFor(group);
      if (!rebuild && grid && sameList(fresh, currentList)) { updateRows(); return; }
      currentList = fresh;
      var y = listEl.scrollTop, wy = window.scrollY;
      var old = listEl.querySelectorAll('.lv-row').length;
      var ae = document.activeElement, focusRow = ae && listEl.contains(ae) && ae.closest ? ae.closest('.lv-row') : null;
      var focusId = focusRow && focusRow._ch ? focusRow._ch.id : null, focusGuide = !!(ae && ae.classList && ae.classList.contains('lv-gbtn'));
      if (grid && grid.destroy) grid.destroy();
      U.clear(listEl);
      var need = 80;
      if (old > need) need = old;
      if (focusId != null) for (var i = 0; i < currentList.length; i++) if (currentList[i].id === focusId) { need = Math.max(need, i + 20); break; }
      grid = U.grid(currentList, chanRow, 'lv-grid', need);
      listEl.appendChild(grid);
      listEl.scrollTop = y;
      if (window.scrollY !== wy) window.scrollTo(0, wy);
      if (focusId != null) {
        var rows = listEl.querySelectorAll('.lv-row');
        for (var j = 0; j < rows.length; j++) {
          if (rows[j]._ch && rows[j]._ch.id === focusId) {
            var f = rows[j].querySelector(focusGuide ? '.lv-gbtn' : '.lv-main');
            if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
            break;
          }
        }
      }
    }
    function render() {
      if (grid && grid.destroy) grid.destroy();
      U.clear(el);
      var head = h('div.page-head', [h('h1', L('Live TV'))]);
      el.appendChild(head);
      var st = stateBox();
      if (st) { el.appendChild(st); return; }
      if (!Lib.lib.channels.length) { el.appendChild(h('div.state', [U.icon('tv', 'state-ic'), h('p.muted', L('No channels'))])); return; }
      var groups = groupList();
      if (!group || !groups.some(function (g) { return g.key === group; })) group = groups.some(function (g) { return g.key === '*'; }) ? '*' : groups[0].key;
      B.store.set('liveGroup', group);
      currentList = channelsFor(group);
      var gl = h('nav.lv-groups', { 'aria-label': L('Categories') });
      var sel = h('select.lv-select', { 'aria-label': L('Categories') });
      groups.forEach(function (g) {
        var a = h('a.lv-group' + (g.key === group ? '.active' : ''), { href: R.link(['live', g.key]) }, [h('span', g.label), h('span.muted.small', String(channelsFor(g.key).length))]);
        gl.appendChild(a);
        var o = h('option', { value: g.key }, g.label);
        if (g.key === group) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { R.go(R.link(['live', sel.value]).slice(1)); });
      head.appendChild(sel);
      listEl = h('div.lv-list', { role: 'list' });
      guideEl = h('aside.lv-guide');
      el.appendChild(h('div.lv-cols', [gl, listEl, guideEl]));
      if (!selected || currentList.indexOf(selected) < 0) selected = currentList[0] || null;
      grid = null;
      refreshList(true);
      drawGuide();
      setTimeout(function () { var a = gl.querySelector('.active'); if (a) gl.scrollTop = a.offsetTop - 80; }, 0);
    }
    pg.refresh = render;
    pg.onLoading = function () { if (el.querySelector('.state')) render(); };
    pg.onEpg = function () { refreshList(); drawGuide(); };
    pg.onData = function () { refreshList(); };
    pg.onCollections = function () { render(); };
    var tick = setInterval(function () { if (document.hidden) return; refreshList(); drawGuide(); }, 60000);
    pg.destroy = function () { clearInterval(tick); if (grid && grid.destroy) grid.destroy(); };
    render();
    return pg;
  };

  // MARK: detailpagina

  // build 97: de detailpagina licht het tabblad op waar je vandaan kwam; direct geopend: Films of Series
  S.navOwner.title = function (r, last) { return last || (r.parts[1] === 'series' ? 'series' : 'movies'); };
  S.pages.title = function (r) {
    var type = r.parts[1] === 'series' ? 'series' : 'movie';
    var id = r.parts[2] || '';
    // build 111: titel uit TMDB (Binnenkort op Bingr / Nieuw op Bingr), niet in je bibliotheek
    if (B.discover && B.discover.isExternal(id)) return B.discover.page(type, id);
    var el = h('div.page.detail');
    var pg = { el: el };
    var x = null, episodes = [], season = null, currentEp = null, versions = [];
    var buttons, epsEl, seasonSel, trailerBtnSlot, meta, langEl, plot, watchLine, seasonToggle, creditsSlot, extraSlot;
    // build 128: titel van een andere server (?s=<server>): via die server, zonder de actieve te wisselen
    var other = r.query.s && B.xs && !B.xs.isActive(r.query.s) ? D.sourceById(r.query.s) : null;
    var stremio = (other || Lib.source) && (other || Lib.source).kind === 'Stremio';
    var isShow = type === 'series';
    var listKey = null;
    var alive = true;
    var waiting = false;
    function find() {
      if (other) {
        var v = B.xs.view(other.id), h2 = v && v.byId[id];
        if (!v && !waiting) { waiting = true; B.xs.loadCatalog(other, true).then(function () { waiting = 'done'; if (alive) build(); }); }
        return h2 && h2.type === type ? h2.item : null;
      }
      var hit = Lib.lib.byId && Lib.lib.byId[id]; return hit && hit.type === type ? hit.item : null;
    }

    var metaExtra = null;
    function metaText(extra) {
      if (extra) metaExtra = extra; else extra = metaExtra;
      var parts = [];
      if (x.year) parts.push(String(x.year));
      if (x.rating) parts.push('★ ' + (Math.round(x.rating * 10) / 10));
      var ar = B.ageRatings.cached(x.rawTitle || x.title, x.year, isShow);
      if (ar && ar.age != null) parts.push(ar.age + '+');
      if (extra) parts = parts.concat(extra.filter(Boolean));
      if (x.group) parts.push(x.group);
      if (type === 'movie' && B.trakt.isMovieWatched(x)) parts.push('✓ Trakt');
      meta.textContent = parts.join('  ·  ');
    }
    function drawLang() {
      var info = B.clang.forItem(x, isShow);
      langEl.textContent = B.clang.line(info);
      langEl.style.display = langEl.textContent ? '' : 'none';
    }
    function refreshVersions() { var n = versions.length; versions = B.clang.versions(x, type); return versions.length !== n; }
    function chooseVersion() {
      if (!versions.length) { U.toast(L('No other language version found.')); return; }
      U.choose(L('Other language'), versions.map(function (v, i) {
        return { value: i, label: v.label, sub: v.item.title + (v.item.year ? ' (' + v.item.year + ')' : '') + (v.item.group ? ' · ' + v.item.group : '') };
      }), null, function (i) { R.go(S.titleLink(type, versions[i].item).slice(1)); });
    }
    function chooseStream(item, ctx) {
      U.toast(L('Loading…'));
      Lib.stremioStreams(item.stremio).then(function (list) {
        if (!list.length) { U.toast(L('No playable stream found.')); return; }
        U.choose(L('Choose a source'), list.slice(0, 40).map(function (s, i) { return { value: i, label: s.title, sub: s.addon + (B.isInsecure(s.url) ? ' · ' + L('no https') : '') }; }), null, function (i) {
          item.streamURL = list[i].url;
          B.player.playVOD(item, ctx);
        });
      });
    }
    function playEpisode(ep) { B.player.playVOD(B.player.episodeItem(ep, x), { episodes: episodes, series: x }); }
    function epWatched(ep) { return D.isWatched(ep.id) || D.isWatched(D.episodeKey(ep.seriesID, ep.season, ep.number)) || B.trakt.isEpisodeWatched(x, ep.season, ep.number); }
    function setEpWatched(list, on) {
      D.setEpisodesWatched(list, on);
      if (B.trakt.isLoggedIn()) B.trakt.setEpisodesWatched(x, list.map(function (e) { return { season: e.season, number: e.number }; }), on);
    }
    function pickCurrent() {
      var best = null, bestAt = 0;
      episodes.forEach(function (e) { var p = D.progress(e.id); if (p && p.updated > bestAt) { best = e; bestAt = p.updated; } });
      if (best) return best;
      var lastWatched = -1;
      episodes.forEach(function (e, i) { if (epWatched(e)) lastWatched = i; });
      if (lastWatched >= 0 && lastWatched < episodes.length - 1) return episodes[lastWatched + 1];
      return episodes[0] || null;
    }
    function seasons() { var s = []; episodes.forEach(function (e) { if (s.indexOf(e.season) < 0) s.push(e.season); }); return s.sort(function (a, b) { return a - b; }); }

    var trailer = null;
    function openTrailer(t) {
      stopHero();
      var frame = h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(t.key) + '?autoplay=1&rel=0&modestbranding=1&hl=' + B.lang,
        title: L('Trailer'), allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
      U.modal({ title: t.season ? L('Trailer season %d', t.season) : L('Trailer'), body: h('div.trailer', [frame]), cls: 'trailer-dlg', buttons: [{ label: L('Close') }] });
    }
    function loadTrailer() {
      if (!trailerBtnSlot) return;
      var want = isShow ? season : null;
      B.ageRatings.trailer(x, isShow, want).then(function (t) {
        if (!alive || (isShow && want !== season)) return;
        trailer = t;
        U.clear(trailerBtnSlot);
        if (t) trailerBtnSlot.appendChild(U.button(t.season ? L('Trailer season %d', t.season) : L('Trailer'), function () { openTrailer(t); }, { icon: 'trailer' }));
      });
    }

    // MARK: trailer in de kop (build 83, zoals de apps sinds build 82)
    // Na 1,5 s speelt de trailer zonder geluid achter de titel (film: die van de film; serie: die van het nieuwste
    // seizoen, anders die van de serie), met geluid aan/uit. Pas zichtbaar als YouTube meldt dat hij speelt (anders
    // blijft de afbeelding staan). Stopt bij afspelen, de trailerknop, een ander scherm of een verborgen tabblad.
    // Niet bij de instelling uit, Beweging beperken of Databesparing.
    var hero = null, heroTimer = null;
    function heroAllowed() {
      if (!S.autoplayTrailers()) return false;
      try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* stil */ }
      var c = navigator.connection;
      if (c && (c.saveData || /(^|-)2g$/.test(String(c.effectiveType || '')))) return false;
      return !document.hidden && !B.player.current && alive;
    }
    function stopHero() {
      clearTimeout(heroTimer); heroTimer = null;
      if (!hero) return;
      var hh = hero; hero = null;
      clearInterval(hh.ping); clearTimeout(hh.giveUp);
      window.removeEventListener('message', hh.onMsg);
      el.classList.remove('tr-on');
      hh.box.classList.remove('on');
      if (hh.mute.parentNode) hh.mute.remove();
      setTimeout(function () { hh.box.remove(); }, 650);
    }
    function autoTrailer() {
      stopHero();
      if (!heroAllowed()) return;
      var ss = isShow ? seasons() : [];
      var want = isShow ? (ss.length ? ss[ss.length - 1] : null) : null;
      var my = x;
      B.ageRatings.trailer(x, isShow, want).then(function (t) {
        if (!t || !alive || x !== my || hero) return;
        clearTimeout(heroTimer);
        heroTimer = setTimeout(function () { if (alive && x === my && heroAllowed()) startHero(t.key); }, 1500);
      });
    }
    function startHero(key) {
      var YT = 'https://www.youtube-nocookie.com';
      var src = YT + '/embed/' + encodeURIComponent(key) + '?autoplay=1&mute=1&controls=0&playsinline=1&loop=1&playlist=' + encodeURIComponent(key) +
        '&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0&enablejsapi=1&origin=' + encodeURIComponent(location.origin) + '&hl=' + encodeURIComponent(B.lang);
      var frame = h('iframe.dt-tr-frame', { src: src, title: L('Trailer'), allow: 'autoplay; encrypted-media', tabindex: '-1', 'aria-hidden': 'true',
        referrerpolicy: 'strict-origin-when-cross-origin' });
      var box = h('div.dt-tr', [frame]);
      var muted = true;
      var mute = U.button('', function () {
        muted = !muted;
        cmd(muted ? 'mute' : 'unMute');
        if (!muted) cmd('setVolume', [100]);
        drawMute();
      }, { icon: 'mute', cls: 'icon-btn dt-tr-mute', title: L('Sound on') });
      function drawMute() {
        U.clear(mute); mute.appendChild(U.icon(muted ? 'mute' : 'volume'));
        mute.title = muted ? L('Sound on') : L('Sound off');
        mute.setAttribute('aria-label', mute.title);
      }
      function post(o) { try { frame.contentWindow.postMessage(JSON.stringify(o), YT); } catch (e) { /* stil */ } }
      function cmd(f, args) { post({ event: 'command', func: f, args: args || [], id: 1, channel: 'widget' }); }
      var hh = hero = { box: box, frame: frame, mute: mute, ping: null, giveUp: null, onMsg: null };
      hh.onMsg = function (ev) {
        if (ev.source !== frame.contentWindow || ev.origin !== YT || hero !== hh) return;
        var d; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch (e) { return; }
        if (!d) return;
        clearInterval(hh.ping);
        var state = d.event === 'onStateChange' ? d.info : (d.event === 'infoDelivery' && d.info && typeof d.info.playerState === 'number' ? d.info.playerState : null);
        if (d.event === 'onError') { stopHero(); return; }
        if (state === 1 && !box.classList.contains('on')) {
          clearTimeout(hh.giveUp);
          box.classList.add('on');
          el.classList.add('tr-on');
          drawMute();
          el.appendChild(mute);
        }
      };
      window.addEventListener('message', hh.onMsg);
      frame.addEventListener('load', function () {
        var n = 0;
        // YouTube-iframe-API zonder script: "listening" tot de speler antwoordt
        hh.ping = setInterval(function () { if (++n > 40) clearInterval(hh.ping); post({ event: 'listening', id: 1, channel: 'widget' }); }, 250);
      });
      // speelt hij na 15 s nog niet (geblokkeerd, geen netwerk), dan weer weg: de afbeelding blijft
      hh.giveUp = setTimeout(function () { if (hero === hh && !box.classList.contains('on')) stopHero(); }, 15000);
      var bg = el.querySelector('.dt-bg');
      if (bg && bg.nextSibling) el.insertBefore(box, bg.nextSibling); else el.insertBefore(box, el.firstChild);
    }

    function listButton() {
      // plus / vinkje met animatie; de knop blijft staan (geen drawButtons)
      return U.plusCheckButton('mylist', L('My List'), D.inSet('myList', listKey), function () { S.toggleMyList(x, type); return D.inSet('myList', listKey); });
    }
    function collectionButton() {
      var item = S.collItem(x, type);
      var inAny = D.collectionsFor(B.app.profile.id).some(function (c) { return c.kind !== 'smart' && D.collectionHas(c, item); });
      return U.button(L('Collection'), function () { S.addToCollection(item, x.title); }, { icon: inAny ? 'stack' : 'stackAdd', cls: inAny ? 'on' : null, title: L('Add to collection…') });
    }
    function watchedButton() {
      var w = S.movieWatched(x);
      return U.button(L('Watched'), function () { S.setMovieWatched(x, !w); drawButtons(); },
        { icon: w ? 'checkCircleFill' : 'checkCircle', cls: w ? 'on' : null, title: w ? L('Mark as unwatched') : L('Mark as watched') });
    }
    function drawButtons() {
      U.clear(buttons);
      if (type === 'movie') {
        var p = D.progress(x.id);
        var resume = p && p.fraction > 0.02;
        buttons.appendChild(U.button(resume ? L('Resume') : L('Play'), function () { B.player.playVOD(B.player.movieItem(x), {}); }, { primary: true, icon: 'play' }));
        if (resume) buttons.appendChild(U.button(L('Watch from the beginning'), function () { B.player.open(B.player.movieItem(x), { resume: 0 }); }, { icon: 'replay' }));
        if (stremio && x.stremio) buttons.appendChild(U.button(L('Choose a source'), function () { chooseStream(B.player.movieItem(x), {}); }, { icon: 'layers' }));
      } else {
        var ep = currentEp;
        var lbl = ep ? (D.progress(ep.id) ? L('Resume') : L('Play')) + '  S' + ep.season + ':E' + ep.number : L('Play');
        var pb = U.button(lbl, function () { if (currentEp) playEpisode(currentEp); }, { primary: true, icon: 'play' });
        if (!ep) pb.disabled = true;
        buttons.appendChild(pb);
        if (stremio && ep) buttons.appendChild(U.button(L('Choose a source'), function () { if (currentEp) chooseStream(B.player.episodeItem(currentEp, x), { episodes: episodes, series: x }); }, { icon: 'layers' }));
      }
      buttons.appendChild(trailerBtnSlot);
      if (versions.length) buttons.appendChild(U.button(L('Other language'), chooseVersion, { icon: 'globe' }));
      buttons.appendChild(listButton());
      if (type === 'movie') buttons.appendChild(watchedButton());
      buttons.appendChild(collectionButton());
      // build 132: eigen Bingr-link delen (bingr.online/titel/…)
      if (B.titleLink && B.titleLink.canShare(x, type)) buttons.appendChild(U.button(L('Share'), function () { B.titleLink.share(x, type); }, { icon: 'share' }));
      if (type === 'movie') {
        var p2 = D.progress(x.id);
        if (p2 && p2.fraction > 0.02) buttons.appendChild(h('div.dt-progress', [h('div.card-progress.inline', [h('div', { style: { width: Math.round(p2.fraction * 100) + '%' } })]),
          h('span.muted.small', L('%d min left', Math.max(1, Math.round((p2.position / p2.fraction - p2.position) / 60))))]));
      }
    }
    function drawSeasons() {
      U.clear(seasonSel);
      var ss = seasons();
      if (ss.length <= 1) { seasonSel.style.display = 'none'; if (ss.length) seasonSel.parentNode.querySelector('.dt-eps-title').textContent = L('Season %d', ss[0]); return; }
      seasonSel.style.display = '';
      ss.forEach(function (sn) { var o = h('option', { value: String(sn) }, L('Season %d', sn)); if (sn === season) o.selected = true; seasonSel.appendChild(o); });
    }
    function pctWatched(list) { if (!list.length) return 0; var n = 0; list.forEach(function (e) { if (epWatched(e)) n++; }); return n / list.length; }
    function drawEpisodes() {
      U.clear(epsEl);
      var target = null;
      var inSeason = episodes.filter(function (e) { return e.season === season; });
      // hoeveel van de serie (en van dit seizoen) je al gezien hebt, en het hele seizoen in één keer afvinken
      U.clear(watchLine);
      var fAll = pctWatched(episodes), fSeason = pctWatched(inSeason);
      if (fAll > 0) {
        watchLine.appendChild(h('div.dt-watchline', [h('span.muted.small', L('%d%% of the series watched', Math.round(fAll * 100))),
          h('div.card-progress.inline', [h('div', { style: { width: Math.round(fAll * 100) + '%' } })])]));
        if (seasons().length > 1 && fSeason > 0) watchLine.appendChild(h('div.dt-watchline', [h('span.muted.small', L('Season %d · %d%% watched', season, Math.round(fSeason * 100))),
          h('div.card-progress.inline', [h('div', { style: { width: Math.round(fSeason * 100) + '%' } })])]));
      }
      U.clear(seasonToggle);
      if (inSeason.length) {
        var all = fSeason >= 1;
        seasonToggle.appendChild(U.button('', function () { setEpWatched(inSeason, !all); }, { icon: all ? 'checkCircleFill' : 'checkCircle',
          cls: 'icon-only dt-season-check' + (all ? ' on' : ''), title: all ? L('Mark as unwatched') : L('Mark as watched') }));
      }
      inSeason.forEach(function (e) {
        var p = D.progress(e.id);
        var watched = epWatched(e);
        var pc = p ? Math.round(p.fraction * 100) : (watched ? 100 : 0);
        var title = String(e.title || '').replace(/^.*?S\d+\s*E\d+\s*[-:]?\s*/i, '') || L('Episode') + ' ' + e.number;
        var card = h('button.ep' + (currentEp === e ? '.current' : ''), { type: 'button', 'aria-label': L('Episode') + ' ' + e.number + ': ' + title }, [
          h('div.ep-num', String(e.number)),
          h('div.ep-still', [U.img(e.still || x.poster, 'still'), h('div.ep-play', [U.icon('play')]), watched ? h('div.ep-watched', [U.icon('check')]) : null,
            pc ? h('div.card-progress', [h('div', { style: { width: pc + '%' } })]) : null]),
          h('div.ep-txt', [h('div.ep-title', title),
            h('div.ep-sub.muted.small', [e.durationSeconds ? Math.round(e.durationSeconds / 60) + ' min' : '', pc && !watched ? (e.durationSeconds ? '  ·  ' : '') + pc + '%' : '', watched ? (e.durationSeconds ? '  ·  ' : '') + L('Watched') : '']),
            e.plot ? h('div.ep-plot.muted', e.plot) : null])
        ]);
        card.addEventListener('click', function () { currentEp = e; playEpisode(e); });
        var toggle = U.button('', function () { setEpWatched([e], !watched); }, { icon: watched ? 'checkCircleFill' : 'checkCircle',
          cls: 'icon-only ep-check' + (watched ? ' on' : ''), title: watched ? L('Mark as unwatched') : L('Mark as watched') });
        U.onMenu(card, function () {
          return [{ icon: watched ? 'eyeOff' : 'checkCircle', label: watched ? L('Mark as unwatched') : L('Mark as watched'), fn: function () { setEpWatched([e], !watched); } },
            p ? { icon: 'close', label: L('Remove from Continue watching'), fn: function () { D.clearProgress(e.id); } } : null];
        }, title);
        if (currentEp === e) target = card;
        epsEl.appendChild(h('div.ep-wrap', [card, toggle]));
      });
      return target;
    }
    function loadEpisodes() {
      if (!isShow) return;
      U.clear(epsEl); epsEl.appendChild(U.spinner());
      Lib.episodes(x).then(function (res) {
        if (!alive) return;
        episodes = res.episodes || [];
        var info = res.info || {};
        if (info.plot && !x.plot && !plot.textContent) plot.textContent = info.plot;
        if (!episodes.length) { U.clear(epsEl); epsEl.appendChild(h('p.muted', L('No episodes found'))); drawButtons(); return; }
        currentEp = pickCurrent();
        season = currentEp ? currentEp.season : seasons()[0];
        drawSeasons();
        drawEpisodes();
        drawButtons();
        loadTrailer();
        autoTrailer();
      });
    }
    function build() {
      stopHero();
      U.clear(el);
      el.classList.remove('tr-on');
      x = find(); metaExtra = null;
      if (!x) {
        if ((!other && (Lib.loading || !Lib.lib.byId)) || (other && waiting === true)) { el.appendChild(h('div.state', [U.spinner()])); return; }
        // build 128: niet (meer) op deze server: zoeken op je andere servers (met de melding als hij nergens staat)
        var srcNow = other || Lib.source;
        if (srcNow && B.xs && !pg._searched) {
          pg._searched = true;
          var ph = B.xs.placeholder(srcNow.id + '|' + id, type, 'missing', null);
          if (ph && ph.item._meta) { B.xs.open(ph, { replace: true }); el.appendChild(h('div.state', [U.spinner()])); return; }
        }
        el.appendChild(h('div.state', [h('h2', L('Not found')), h('p.muted', L('This title is not in the library of this server.')), h('a.btn', { href: '#/home' }, L('Home'))]));
        return;
      }
      pg.title = x.title;
      document.title = x.title + ' · Bingr';
      listKey = S.keyOf(x);
      meta = h('div.dt-meta'); langEl = h('div.dt-lang'); plot = h('p.dt-plot', x.plot || '');
      creditsSlot = h('div.dt-credits-slot'); extraSlot = h('div.dt-extra-slot');
      buttons = h('div.dt-btns');
      trailerBtnSlot = h('span.dt-trailer');
      var back = h('button.icon-btn.dt-back', { type: 'button', 'aria-label': L('Back'), title: L('Back') }, [U.icon('back')]);
      back.addEventListener('click', function () { if (history.length > 1) history.back(); else R.go('/home'); });
      el.appendChild(h('div.dt-bg', [U.img(x.poster, 'hero-img')]));
      el.appendChild(h('div.dt-shade'));
      el.appendChild(h('div.dt-top', [back, h('div.dt-poster', [U.img(x.poster, 'poster', x.title)]),
        h('div.dt-info', [h('div.hero-kind', isShow ? L('SERIES') : L('FILM')), h('h1.dt-title', x.title), meta, langEl, plot, creditsSlot, buttons])]));
      if (isShow) {
        seasonSel = h('select.dt-season', { 'aria-label': L('Season') });
        seasonSel.addEventListener('change', function () {
          season = parseInt(seasonSel.value, 10);
          var inSeason = episodes.filter(function (e) { return e.season === season; });
          if (inSeason.indexOf(currentEp) < 0) {
            var withP = inSeason.filter(function (e) { return D.progress(e.id); })[0];
            currentEp = withP || inSeason.filter(function (e) { return !epWatched(e); })[0] || inSeason[0] || currentEp;
          }
          drawEpisodes(); drawButtons(); loadTrailer();
        });
        epsEl = h('div.dt-eps');
        watchLine = h('div.dt-watch');
        seasonToggle = h('span.dt-season-tg');
        el.appendChild(h('section.dt-episodes', [h('div.dt-eps-head', [h('h2.dt-eps-title', L('Episodes')), seasonSel, seasonToggle]), watchLine, epsEl]));
      }
      metaText();
      drawLang();
      drawButtons();
      setTimeout(function () { if (alive && refreshVersions()) drawButtons(); }, 60);
      B.ageRatings.originalLanguage(x, isShow).then(function () { if (!alive) return; drawLang(); metaText(); if (refreshVersions()) drawButtons(); });
      el.appendChild(extraSlot);
      if (isShow) loadEpisodes();
      else { loadTrailer(); autoTrailer(); }
      // info, cast en aanbevelingen (= DetailsService op iOS, build 90)
      var cur = x;
      (isShow ? Lib.episodes(x).then(function (r) { return r && r.info; }) : Lib.movieInfo(x)).then(function (info) {
        return B.details.load(cur, isShow, info);
      }).then(function (d) {
        if (!alive || x !== cur || !d) return;
        if (d.overview) plot.textContent = d.overview;
        metaText([d.runtime]);
        U.clear(creditsSlot); var cr = B.details.credits(d); if (cr) creditsSlot.appendChild(cr);
        U.clear(extraSlot); var ex = B.details.sections(d); if (ex) extraSlot.appendChild(ex);
      }, function () { /* stil: de pagina werkt ook zonder */ });
    }
    pg.refresh = function () { if (!x || x !== find()) build(); };
    pg.onData = function () {
      if (!x) return;
      drawButtons();
      if (isShow && episodes.length) {
        var y = window.scrollY;
        drawEpisodes();
        window.scrollTo(0, y);
      }
    };
    pg.onCollections = function () { if (x) drawButtons(); };
    function onVis() { if (document.hidden) stopHero(); }
    document.addEventListener('visibilitychange', onVis);
    var offHero = [B.on('playerOpened', stopHero), B.on('settings', function () { if (!S.autoplayTrailers()) stopHero(); })];
    pg.destroy = function () {
      alive = false; stopHero();
      document.removeEventListener('visibilitychange', onVis);
      offHero.forEach(function (f) { if (typeof f === 'function') f(); });
    };
    build();
    return pg;
  };

  // MARK: Statistieken (build 68): hoofdprofiel ziet alle profielen met een filter, andere profielen alleen zichzelf

  S.pages.stats = function () {
    var prof = B.app.profile;
    var box = h('div.stats-box');
    var back = h('a.st-back', { href: '#/settings' }, [U.icon('chevron', 'st-back-ic'), L('Settings')]);
    var el = h('div.page.settings.stats-page', [h('div.page-head', [back, h('h1', L('Statistics'))]), box]);
    var pg = { el: el, title: L('Statistics') };
    function call(action, body) {
      return A.authed(Object.assign({ action: action }, body || {})).then(function (r) {
        if (!r) throw new Error('offline');
        if (B.plan.isLockedResponse(r)) { setTimeout(function () { B.plan.markLocked('stats'); }, 0); throw new Error('signed_out'); }
        if (!r.ok) throw new Error(r.errorCode || 'error');
        return r.json;
      });
    }
    var main = D.isMain(prof);
    var view = null;
    // Statistieken horen bij Lifetime: met Gratis (of als de server feature_locked zegt) de slotweergave
    function draw() {
      if (view) { view.destroy(); view = null; }
      U.clear(box);
      if (!B.plan.has('stats')) { box.appendChild(B.plan.lockedView('stats', L('Statistics are part of Lifetime'))); return; }
      view = window.BingrStats ? window.BingrStats.mount(box, {
        call: call, lang: B.lang === 'nl' ? 'nl' : 'en', profiles: D.profiles, filter: main, profileId: main ? null : prof.id,
        avatar: function (p) { return S.avatar(p, 'tiny'); }
      }) : null;
    }
    var locked = !B.plan.has('stats');
    var offPlan = B.on('plan', function () { if (B.plan.has('stats') !== !locked) { locked = !B.plan.has('stats'); draw(); } });
    draw();
    pg.destroy = function () { offPlan(); if (view) view.destroy(); };
    return pg;
  };

  // MARK: Instellingen

  /** Rij in een lijst met instellingen (ook gebruikt door Mijn Bingr en de beheerschermen). */
  /** Supportsite (build 75): opent in een nieuw tabblad, onder Account en apparaten. */
  S.SUPPORT_URL = 'https://support.bingr.online';
  // build 146: Support zit in de app (Instellingen → Support), met het aantal ongelezen antwoorden
  S.supportRow = function (sec, sub) {
    return S.stRow(sec, L('Support'), B.support ? B.support.badge() : null, function () { location.hash = '#/support'; }, { icon: 'help', sub: sub || null });
  };
  /** Trailers automatisch afspelen (build 83): standaard aan, per browser. */
  S.autoplayTrailers = function () { return B.store.get('autoplayTrailers', true) !== false; };
  S.setAutoplayTrailers = function (on) { B.store.set('autoplayTrailers', !!on); B.emit('settings'); };
  S.stRow = function (sec, label, value, fn, opts) {
    opts = opts || {};
    var r = fn ? (opts.href ? h('a.st-row' + (opts.danger ? '.danger' : ''), { href: opts.href }) : h('button.st-row' + (opts.danger ? '.danger' : ''), { type: 'button' })) : h('div.st-row.info');
    if (opts.lead) r.appendChild(opts.lead);
    else if (opts.icon) r.appendChild(U.icon(opts.icon, 'st-ic'));
    r.appendChild(opts.sub ? h('span.st-label', [h('span', label), h('span.st-sub', opts.sub)]) : h('span.st-label', label));
    if (value != null) r.appendChild(value instanceof Node ? value : h('span.st-value', value));
    if (fn) {
      if (opts.toggle == null) r.appendChild(U.icon('chevron', 'st-chev'));
      if (fn !== true) r.addEventListener('click', function (e) { if (!opts.href) e.preventDefault(); fn(e); });
    }
    if (opts.toggle != null) {
      r.classList.add('st-toggle');
      r.setAttribute('role', 'switch'); r.setAttribute('aria-checked', opts.toggle ? 'true' : 'false');
      r.appendChild(h('span.switch' + (opts.toggle ? '.on' : ''), [h('i')]));
    }
    sec.appendChild(r);
    return r;
  };
  S.stSection = function (list, t, foot) {
    var s = h('section.st-sec', [t ? h('h2.st-head', t) : h('h2.st-head.hidden')]);
    list.appendChild(s);
    if (foot) list.appendChild(h('p.st-foot', foot));
    return s;
  };

  // build 146: Instellingen in tabs, op alle apps gelijk (Algemeen, Afspelen, Taal en ondertitels, Servers, Profielen en
  // kinderslot, Account, Koppelingen, Support, Diagnose, Over). Route #/settings/<tab>; Support ook als #/support,
  // #/support/ticket?n=<nummer> en #/support/new (doel van de pushmelding support_reply).
  var ST_TABS = [['general', 'General', 'gear'], ['playback', 'Playback', 'play'], ['language', 'Language and subtitles', 'subs'],
    ['servers', 'Servers', 'layers'], ['profiles', 'Profiles and parental lock', 'users'], ['account', 'Account', 'account'],
    ['connections', 'Connections', 'link'], ['support', 'Support', 'help'], ['diagnose', 'Diagnostics', 'chart'], ['about', 'About', 'info']];
  S.settingsTabs = ST_TABS;
  S.pages.support = function (r) { return S.pages.settings(r); };

  /** Apparaten van het account (list_devices) met platformnaam en icoon. */
  S.devicesSheet = function () {
    var body = h('div.wn-sheet', [h('div.trakt-wait', [U.spinner()])]);
    var dlg = U.modal({ title: L('Devices'), body: body, cls: 'wn-dlg', buttons: [{ label: L('Close') }] });
    A.listDevices().then(function (r) {
      if (!document.body.contains(dlg.el)) return;
      U.clear(body);
      body.appendChild(h('p.muted.small', L('%d of %d devices', r.devices.length, r.limit)));
      var list = h('div.limit-list');
      r.devices.forEach(function (d) {
        var sub = A.platformLabel(d.platform) + (d.lastSeenAt ? ' · ' + U.fmtDate(d.lastSeenAt) : '') + (d.current ? ' · ' + L('This device') : '');
        list.appendChild(h('div.limit-row', [S.platformIcon(d.platform), h('div', [h('div', d.name), h('div.muted.small', sub)])]));
      });
      body.appendChild(list);
      body.appendChild(h('p.muted.small', L('Rename or remove devices on bingr.online/account.')));
    }, function (e) { U.clear(body); body.appendChild(h('p.muted', (e && e.message) || L('Something went wrong. Please try again.'))); });
    return dlg;
  };

  S.pages.settings = function (r) {
    r = r || U.router.current || U.router.parse();
    var isSupport = r.parts[0] === 'support';
    var tab = isSupport ? 'support' : (r.parts[1] || 'general');
    if (!ST_TABS.some(function (x) { return x[0] === tab; })) tab = 'general';
    var nav = h('nav.st-tabs', { 'aria-label': L('Settings') });
    var list = h('div.st-list');
    var el = h('div.page.settings.st-tabbed', [h('div.page-head', [h('h1', L('Settings'))]), h('div.st-wrap', [nav, h('div.st-body', [list])])]);
    var pg = { el: el, title: L('Settings') };
    function drawNav() {
      U.clear(nav);
      ST_TABS.forEach(function (x) {
        var href = x[0] === 'support' ? '#/support' : '#/settings/' + x[0];
        var a = h('a.st-tab' + (x[0] === tab ? '.active' : ''), { href: href }, [U.icon(x[2], 'st-tab-ic'), h('span', L(x[1]))]);
        if (x[0] === tab) a.setAttribute('aria-current', 'page');
        if (x[0] === 'support' && B.support) { var bd = B.support.badge(); if (bd) a.appendChild(bd); }
        nav.appendChild(a);
      });
      setTimeout(function () { var act = nav.querySelector('.st-tab.active'); if (act && act.scrollIntoView && nav.scrollWidth > nav.clientWidth) act.scrollIntoView({ block: 'nearest', inline: 'center' }); }, 0);
    }
    function section(t, foot) { return S.stSection(list, t, foot); }
    var row = S.stRow;
    function onOff(v) { return v ? L('On') : L('Off'); }
    var cleanup = null;
    function render() {
      if (cleanup) { try { cleanup(); } catch (e) { /* stil */ } cleanup = null; }
      U.clear(list);
      drawNav();
      var prof = B.app.profile;
      var main = D.isMain(prof);
      var fn = TABS[tab];
      if (fn) cleanup = fn(prof, main) || null;
    }
    var TABS = {
      general: function (prof, main) {
        var sec = section(L('App'));
        var lang = D.shared('appLanguage', '') || '';
        var langLabel = L('Automatic');
        B.languages.forEach(function (l) { if (l[0] === lang && l[0]) langLabel = l[1]; });
        row(sec, L('Language'), langLabel, function () {
          U.choose(L('Language'), B.languages.map(function (l) { return { value: l[0], label: l[0] ? l[1] : L('Automatic') }; }), lang, function (v) {
            D.setShared('appLanguage', v);
            B.app.setLanguage(v);
          });
        }, { icon: 'globe' });
        // pushmeldingen (berichten van Bingr, herinneringen en antwoorden van support), per browser
        if (B.push) B.push.settingsRow(sec, row, render);
        sec = section(L('Start screen and tabs'), main ? null : L('Profiles are managed in the main account.'));
        if (main) {
          var start = String(D.shared('startScreen', 'home') || 'home');
          var starts = [['home', L('Home')], ['live', L('Live TV')], ['movies', L('Movies')], ['series', L('Series')]];
          var startLabel = L('Home');
          starts.forEach(function (x) { if (x[0] === start) startLabel = x[1]; });
          row(sec, L('Start screen'), startLabel, function () {
            U.choose(L('Start screen'), starts.map(function (x) { return { value: x[0], label: x[1] }; }), start, function (v) { D.setShared('startScreen', v); render(); });
          }, { icon: 'home' });
          var hiddenTabs = (D.shared('hiddenTabs', []) || []).slice();
          [['live', L('Show Live TV')], ['movies', L('Show Movies')], ['series', L('Show Series')]].forEach(function (t) {
            var on = hiddenTabs.indexOf(t[0]) < 0;
            row(sec, t[1], null, function () {
              var next = hiddenTabs.filter(function (k) { return k !== t[0]; });
              if (on) next.push(t[0]);
              D.setShared('hiddenTabs', next);
              if (next.indexOf(String(D.shared('startScreen', 'home'))) >= 0) D.setShared('startScreen', 'home');
              B.app.rebuildNav();
            }, { toggle: on });
          });
        }
        row(sec, L('Home screen'), null, function () { location.hash = '#/homelayout'; }, { icon: 'rows' });
        if (!prof.kids) row(sec, L('Show categories'), null, function () { location.hash = '#/catprefs'; }, { icon: 'grid' });
        sec = section(L('Accent color'));
        var themes = B.plan.has('themes');
        var accent = themes ? D.accentKey(prof) : 'red';
        var sw = h('span.st-value.swatch', [h('i', { style: { background: D.accents[accent] } }), L(accent.charAt(0).toUpperCase() + accent.slice(1))]);
        if (!themes) sw.appendChild(B.plan.badge());
        var aRow = row(sec, L('Accent color'), null, !themes ? function () { B.plan.sheet('themes'); } : function () {
          U.choose(L('Accent color'), Object.keys(D.accents).map(function (k) { return { value: k, label: L(k.charAt(0).toUpperCase() + k.slice(1)) }; }), accent, function (v) {
            B.app.applyAccent(v);
            D.setAccent(prof.id, v).then(function () { B.app.applyAccent(); render(); });
            render();
          });
        });
        aRow.insertBefore(sw, aRow.querySelector('.st-chev'));
      },
      playback: function () {
        var sec = section(L('Player'), L('The browser plays HLS, MP4/WebM and live MPEG-TS itself; buffer and deinterlacing are handled by the browser.'));
        // build 83: trailer zonder geluid in de kop van film- en seriepagina's (per browser)
        var trOn = S.autoplayTrailers();
        row(sec, L('Play trailers automatically'), null, function () { S.setAutoplayTrailers(!trOn); render(); },
          { toggle: trOn, icon: 'trailer', sub: trOn ? L('Muted, on movie and series pages. Not with data saver or Reduce Motion on.') : null });
        row(sec, L('Servers on http go through Bingr’s server, because browsers block http on a secure page. Movies and series that the server also offers as HLS play in every browser, Safari included. Otherwise MKV plays in Chrome, Edge and Firefox if the browser knows the picture and sound inside; AVI, and MKV in Safari, only play in the app. If something doesn’t play, “Details” in the error shows why.'), null, null);
        sec = section(L('Keyboard shortcuts'));
        [['Space / K', L('Play / pause')], ['← →', L('10 seconds back / forward')], ['↑ ↓', L('Volume, or another channel during live TV')],
          ['F', L('Full screen')], ['M', L('Mute')], ['Esc', L('Close the player')], ['/', L('Search')], ['Shift + F10', L('More options for a title or channel')]].forEach(function (k) {
          var r2 = row(sec, k[1], null, null);
          r2.appendChild(h('kbd', k[0]));
        });
      },
      language: function () {
        var sec = section(L('Audio & subtitles'), L('These choices apply to this profile only.'));
        var CLg = B.clang;
        var langOpts = ['nl', 'en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'tr', 'ar', 'hi'];
        function pv(key, sharedKey) { var v = D.profilePref(key); return v != null ? v : String(D.shared(sharedKey, '') || ''); }
        // build 91: alleen het hoofdprofiel (of een account zonder profielen) wijzigt de gedeelde stand
        function setPref(sharedKey, prefKey, v) {
          if (!D.profiles.length || D.isMain(B.app.profile)) D.setShared(sharedKey, v);
          D.setProfilePref(prefKey, v);
        }
        var aud = pv('audioLanguage', 'audioLanguage');
        function audLabel(v) { return v === 'stream' ? L('As in the stream') : (v ? CLg.name(v) : L('Same as app') + ' (' + CLg.name(B.lang) + ')'); }
        row(sec, L('Default audio language'), audLabel(aud), function () {
          U.choose(L('Default audio language'), [{ value: '', label: audLabel('') }, { value: 'stream', label: L('As in the stream') }]
            .concat(langOpts.map(function (c) { return { value: c, label: CLg.name(c) }; })), aud, function (v) { setPref('audioLanguage', 'audioLanguage', v); render(); });
        }, { icon: 'audio' });
        var subRaw = pv('streamSubtitleLanguage', 'subtitleLanguage');
        var subCur = subRaw === 'off' ? '' : CLg.norm(subRaw);
        var subAuto = L('Same as app') + ' (' + CLg.name(CLg.appLanguage()) + ')';
        row(sec, L('Subtitle language'), subCur ? CLg.name(subCur) : subAuto, function () {
          U.choose(L('Subtitle language'), [{ value: '', label: subAuto }].concat(langOpts.map(function (c) { return { value: c, label: CLg.name(c) }; })), subCur, function (v) {
            setPref('subtitleLanguage', 'streamSubtitleLanguage', v); render();
          });
        }, { icon: 'subs' });
        var autoS = CLg.autoSubtitles();
        var autoLabels = { off: L('Off'), whenNeeded: L('When needed'), always: L('Always') };
        row(sec, L('Automatic subtitles'), autoLabels[autoS], function () {
          U.choose(L('Automatic subtitles'), ['whenNeeded', 'always', 'off'].map(function (v) { return { value: v, label: autoLabels[v] }; }), autoS, function (v) {
            setPref('autoSubtitles', 'autoSubtitles', v); render();
          });
        });
        var OS = B.opensubtitles;
        sec = section('OpenSubtitles');
        if (OS.ready() && OS.isLoggedIn()) {
          var osl = OS.defaultLanguage();
          var oslabel = '';
          OS.languages.forEach(function (l) { if (l[0].slice(0, 2) === osl.slice(0, 2)) oslabel = l[1]; });
          if (osl && !oslabel) oslabel = CLg.name(osl) || osl;
          row(sec, L('Default subtitle language') + ' (OpenSubtitles)', osl ? oslabel : L('All'), function () {
            U.choose(L('Default subtitle language'), [{ value: '', label: L('All') }].concat(OS.languages.map(function (l) { return { value: l[0], label: l[1] }; })), osl, function (v) {
              setPref('openSubtitlesLanguage', 'subtitleLanguage', v); render();
            });
          }, { icon: 'subs' });
        } else row(sec, 'OpenSubtitles', L('Not linked'), function () { location.hash = '#/settings/connections'; }, { icon: 'subs', sub: L('Link OpenSubtitles under Connections to search subtitles for movies and series.') });
      },
      servers: function (prof, main) {
        // build 130: elk profiel ziet en gebruikt alle servers van het account; toevoegen en wijzigen blijft bij het hoofdprofiel
        var sec = section(L('Your servers'), main ? null : L('Every profile uses all servers of the account. Servers are added and changed in the main profile.'));
        var src = Lib.source;
        row(sec, L('Active server'), src ? src.name : L('None'), function () { if (!D.sources.length) { U.toast(L('No servers yet')); return; } chooseServer(); }, { icon: 'tv' });
        var rs = B.xs && B.xs.refreshing();
        row(sec, L('Refresh now'), rs ? L('Updating…') : null, function () {
          if (!D.sources.length) { U.toast(L('No servers yet')); return; }
          if (B.xs) { B.xs.refreshAll(); render(); } else if (Lib.source) { Lib.select(Lib.source, true); U.toast(L('Updating…')); }
        }, { icon: 'refresh', sub: D.sources.length > 1 ? L('Updates all your servers, the active one first.') : null });
        if (main) row(sec, L('Manage servers'), String(D.sources.length), function () { location.href = '../account/'; }, { icon: 'layers' });
        if (main) {
          var canAdd = B.plan.canAddServer(D.sources.length);
          row(sec, L('Add server'), canAdd ? null : B.plan.badge(), canAdd ? function () { location.href = '../account/'; } : function () { B.plan.sheet('servers'); },
            { icon: 'plus', sub: canAdd ? L('Servers are added on bingr.online/account.') : null });
        }
        // build 145: "Servers laden bij openen" (per browser); build 146: de tv-gids volgt dezelfde keuze
        sec = section(L('Updating'), L('The TV guide is updated together with your servers: when you choose Update now, with Always, or with Refresh now. It is no longer refreshed on a timer.'));
        if (B.xs && B.xs.loadOnOpen && !(prof && prof.kids)) {
          var LO = B.xs.loadOnOpen, lmode = LO.mode();
          var lmodes = [['ask', L('Ask')], ['always', L('Always')], ['never', L('Never, manually only')]], lLabel = L('Ask');
          lmodes.forEach(function (x) { if (x[0] === lmode) lLabel = x[1]; });
          row(sec, L('Load servers on open'), lLabel, function () {
            U.choose(L('Load servers on open'), lmodes.map(function (x) { return { value: x[0], label: x[1] }; }), lmode, function (v) {
              LO.setMode(v); render();
            });
          }, { icon: 'clock', sub: L('Bingr opens with your saved list. Choose whether it asks to update your servers, updates them right away, or only when you refresh.') });
        }
        var gv = h('span.st-value', '…');
        row(sec, L('TV guide'), gv, null, { icon: 'guide' });
        if (src) B.idb.getMeta('epg:' + src.id).then(function (c) { gv.textContent = c && c.at ? L('Updated') + ' ' + U.fmtDate(c.at) + ' ' + B.fmtTime(c.at) : L('Not loaded yet'); }, function () { gv.textContent = '—'; });
        else gv.textContent = '—';
      },
      profiles: function (prof, main) {
        var sec = section(L('Profiles'), main ? null : L('Profiles are managed in the main account.'));
        var pRow = row(sec, L('Switch profile'), prof.name, function () { B.app.switchProfile(); });
        pRow.insertBefore(S.avatar(prof, 'tiny'), pRow.firstChild);
        if (main) row(sec, L('Manage profiles'), String(D.profiles.length), function () { location.hash = '#/profiles'; }, { icon: 'users', sub: L('Names, pictures, kids profiles and PIN codes.') });
        row(sec, L('Collections'), String(D.collectionsFor(prof.id).length), function () { location.hash = '#/collections'; }, { icon: 'stack' });
        row(sec, L('Watch history'), null, function () { location.hash = '#/history'; }, { icon: 'history' });

        var mainP = D.mainProfile(), mainPin = D.pinFor(mainP);
        sec = section(L('Parental lock'), main ? (mainPin ? null : L('Set a PIN on the main account to protect the parental lock (Manage profiles → main account → PIN code).')) : null);
        var pcOn = B.bool(D.shared('parentalControl', false)) === true;
        function withPin(go) { if (mainPin) U.askPIN(L('Enter PIN'), function (x) { return D.checkPin(D.mainProfile(), x); }, go); else go(); }
        row(sec, L('Lock adult content with this PIN'), main ? null : onOff(pcOn), main ? function () {
          var go = function () { D.setShared('parentalControl', !pcOn); setTimeout(function () { Lib.applyFilters(); render(); }, 50); };
          if (pcOn) withPin(go); else go();
        } : null, main ? { toggle: pcOn, icon: 'lock' } : { icon: 'lock' });
        if (main && pcOn) {
          var autoOn = B.bool(D.shared('parentalAutoLockAdult', true)) !== false;
          row(sec, L('Lock adult groups automatically'), null, function () {
            withPin(function () { D.setShared('parentalAutoLockAdult', !autoOn); setTimeout(function () { Lib.applyFilters(); render(); }, 50); });
          }, { toggle: autoOn });
        }
        if (mainPin) {
          row(sec, PC.isUnlocked() ? L('Lock now') : L('Unlock with PIN'), null, function () {
            if (PC.isUnlocked()) { PC.lock(); render(); return; }
            U.askPIN(L('Enter PIN'), function (x) { return D.checkPin(D.mainProfile(), x); }, function () { PC.unlock(); render(); });
          }, { icon: PC.isUnlocked() ? 'lock' : 'unlock' });
        }
        if (D.ageLimit(prof) != null) row(sec, L('Age limit'), prof.kids ? L('Kids profile') : D.ageLimit(prof) + '+', null);
        if (D.profiles.some(function (p) { return !!D.pinFor(p); })) sec.appendChild(h('p.st-foot', L('Also update Bingr on your other devices, otherwise the PIN won’t work there.')));
      },
      account: function (prof, main) {
        var sec = section(L('Account'));
        row(sec, L('Signed in as %@', A.email() || ''), null, null, { icon: 'account' });
        S.planRow(sec);
        row(sec, L('Devices'), null, function () { S.devicesSheet(); }, { icon: 'laptop' });
        S.watchingNowRow(sec);
        row(sec, L('Statistics'), B.plan.has('stats') ? (main ? L('All profiles') : prof.name) : B.plan.badge(), function () { location.hash = '#/stats'; }, { icon: 'chart' });
        row(sec, L('Account and devices'), L('Devices, profiles and servers'), function () { location.href = '../account/'; }, { icon: 'gear' });
        row(sec, L('Sign out'), null, confirmSignOut, { danger: true, icon: 'logout' });
      },
      connections: function () { S.connectionsSection(list, render); },
      support: function () {
        var box = h('div.sp-box');
        list.appendChild(box);
        return B.support ? B.support.render(box, r) : null;
      },
      diagnose: function () { return B.support ? B.support.renderDiagnose(list) : null; },
      about: function () {
        // build 112: verplichte bronvermelding van TMDB en JustWatch onder Over
        var sec = section(L('About'), B.discover ? B.discover.attribution() : null);
        row(sec, 'Bingr ' + B.config.version + (B.config.build ? ' (build ' + B.config.build + ')' : ''), (B.isWindowsApp ? 'Windows' : L('Browser')) + ' · ' + A.deviceDisplayName(), null, { icon: 'info' });
        row(sec, L('What’s new'), null, function () { window.open('https://bingr.online/changelog/?p=web', '_blank', 'noopener'); }, { icon: 'sparkle' });
        row(sec, L('Privacy'), null, function () { window.open('https://bingr.online/privacy.html', '_blank', 'noopener'); }, { icon: 'lock' });
        row(sec, L('Terms of use'), null, function () { window.open('https://bingr.online/voorwaarden/', '_blank', 'noopener'); }, { icon: 'list' });
        row(sec, L('Help and support site'), null, function () { window.open(S.SUPPORT_URL, '_blank', 'noopener'); }, { icon: 'help', sub: 'support.bingr.online' });
      }
    };
    pg.refresh = render;
    // support en diagnose tekenen zichzelf (een formulier mag niet verdwijnen door een sync op de achtergrond)
    function live() { return el.parentNode && tab !== 'support' && tab !== 'diagnose'; }
    var offs = [B.on('connections', function () { if (live()) render(); }), B.on('traktStatus', function () { if (live()) render(); }),
      B.on('profiles', function () { if (live()) render(); }), B.on('settings', function () { if (live()) render(); }),
      B.on('plan', function () { if (live()) render(); }), B.on('push', function () { if (live()) render(); }),
      B.on('support', function () { if (el.parentNode) drawNav(); }),
      // build 130: "Nu vernieuwen" begint of is klaar
      B.on('xsRefresh', function () { var busy = !!(B.xs && B.xs.refreshing()); if (live() && busy !== lastBusy) { lastBusy = busy; render(); } })];
    var lastBusy = !!(B.xs && B.xs.refreshing());
    pg.onCollections = function () { if (live()) render(); };
    pg.destroy = function () { offs.forEach(function (f) { f(); }); if (cleanup) { try { cleanup(); } catch (e) { /* stil */ } } };
    render();
    return pg;
  };
})();
