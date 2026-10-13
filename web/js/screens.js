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
  var S = B.screens = { pages: {} };

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
    var email = h('input', { type: 'email', autocomplete: 'email', placeholder: L('Email'), 'aria-label': L('Email'), required: true });
    var pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: L('Password'), 'aria-label': L('Password'), minlength: '6', required: true });
    var show = h('button.pw-toggle', { type: 'button' }, L('Show'));
    show.addEventListener('click', function () { var s = pw.type === 'password'; pw.type = s ? 'text' : 'password'; show.textContent = s ? L('Hide') : L('Show'); });
    var err = h('div.login-err', { role: 'alert' });
    var submit = h('button.btn.primary.wide', { type: 'submit' });
    var forgot = h('button.linkbtn', { type: 'button' }, L('Forgot password?'));
    var switchLine = h('div.login-switch');
    var form = h('form.login-form', { novalidate: true }, [title, h('label.field', [email]), h('label.field.pw', [pw, show]), err, submit]);
    var card = h('div.login-card.email', [form, h('div.login-links', [forgot, switchLine,
      onQR ? h('button.linkbtn.qrback', { type: 'button', onclick: onQR }, [U.icon('back'), L('Sign in with your phone')]) : null])]);
    function draw() {
      title.textContent = signup ? L('Create account') : L('Sign In');
      submit.textContent = signup ? L('Create account') : L('Sign In');
      pw.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
      forgot.style.display = signup ? 'none' : '';
      U.clear(switchLine);
      switchLine.appendChild(h('span.muted', (signup ? L('Already have an account?') : L('New to Bingr?')) + ' '));
      var a = h('button.linkbtn.strong', { type: 'button' }, signup ? L('Sign in.') : L('Sign up now.'));
      a.addEventListener('click', function () { signup = !signup; err.textContent = ''; draw(); });
      switchLine.appendChild(a);
    }
    function validEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var em = email.value.trim(), p = pw.value;
      if (!validEmail(em)) { err.textContent = L('Enter a valid email address.'); email.focus(); return; }
      if (p.length < 6) { err.textContent = L('Password must be at least 6 characters.'); pw.focus(); return; }
      busy = true; err.textContent = '';
      submit.disabled = true; U.clear(submit); submit.appendChild(U.spinner());
      var req = signup ? A.signUp(em, p) : A.signIn(em, p);
      req.then(function (r) {
        if (r === 'confirm') {
          err.textContent = ''; signup = false; draw();
          U.modal({ title: L('Create account'), text: L('Check your inbox to confirm your email address, then sign in.'), buttons: [{ label: L('OK') }] });
          return;
        }
        onDone();
      }, function (e2) { err.textContent = e2.message || L('Something went wrong. Please try again.'); })
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
  S.platformIcon = function (p) {
    var s = String(p || '');
    var k = /iPhone|^Android$/.test(s) ? 'phone' : /iPad|tablet/i.test(s) ? 'tablet' : /^Mac$/.test(s) ? 'laptop' : /browser/i.test(s) ? 'browser' : 'tv';
    var svg = U.icon('tv');
    svg.innerHTML = '<path d="' + DEV_ICONS[k] + '"/>';
    return svg;
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
    var el = h('div.profiles-screen', [h('header.login-top', [h('a.logo', { href: '../' }, 'BINGR')]),
      h('div.pf-wrap', [h('h1.pf-title', L("Who's watching?")), grid,
        h('a.btn.ghost.pf-manage', { href: '../account/' }, L('Manage profiles'))])]);
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
          if (pin) U.askPIN(L('Enter PIN'), function (x) { return x === pin; }, function () { onPick(p); }, S.avatar(p, 'pinav'));
          else onPick(p);
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
  S.titleLink = function (type, x) { return R.link(['title', type, x.id]); };
  function posterCard(x, type, opts) {
    opts = opts || {};
    var isShow = type === 'series';
    var pr = opts.progress;
    var card = h('a.card', { href: S.titleLink(type, x), 'aria-label': x.title + (x.year ? ' (' + x.year + ')' : '') }, [
      h('div.card-img', [U.img(x.poster, 'poster', x.title), langBadge(x, isShow),
        pr ? h('div.card-progress', [h('div', { style: { width: Math.round(B.clamp(pr, 0, 1) * 100) + '%' } })]) : null]),
      h('div.card-title', x.title)
    ]);
    return card;
  }
  S.posterCard = posterCard;
  function top10Card(x, type, i) {
    return h('a.card.top10', { href: S.titleLink(type, x), 'aria-label': (i + 1) + '. ' + x.title }, [
      h('div.top10-num', String(i + 1)), h('div.card-img', [U.img(x.poster, 'poster', x.title), langBadge(x, type === 'series')])]);
  }
  function pct(p) { return Math.round(B.clamp((Date.now() - p.start) / (p.end - p.start), 0, 1) * 100) + '%'; }
  function channelCard(ch, list) {
    var nn = Lib.nowNext(ch);
    var b = h('button.ccard', { type: 'button', 'aria-label': ch.name }, [
      h('div.ccard-logo', [U.img(ch.logo, 'logo', ch.name)]),
      h('div.ccard-info', [h('div.ccard-name', ch.name), h('div.ccard-now.muted', nn.now ? nn.now.title : (ch.group || '')),
        nn.now ? h('div.card-progress.inline', [h('div', { style: { width: pct(nn.now) } })]) : null])
    ]);
    b.addEventListener('click', function () { B.player.playChannel(ch, list || [ch]); });
    return b;
  }
  S.channelCard = channelCard;

  function itemCard(hit, chans) {
    return hit.type === 'channel' ? channelCard(hit.item, chans) : posterCard(hit.item, hit.type);
  }

  // MARK: hoofdscherm (navigatie bovenaan of onderaan, pagina's via de router)

  var NAV = [['home', 'Home', 'home'], ['live', 'Live TV', 'tv'], ['movies', 'Movies', 'film'], ['series', 'Series', 'series'], ['mylist', 'My List', 'bookmark']];

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
      links.appendChild(h('a.top-link', { href: '#/' + n[0], 'data-k': n[0] }, L(n[1])));
      tabs.appendChild(h('a.tab', { href: '#/' + n[0], 'data-k': n[0] }, [U.icon(n[2]), h('span', L(n[1]))]));
    });
    var el = h('div.app', [header, content, tabs]);
    var page = null, pageKey = null, scrolls = {};
    function drawProf() {
      U.clear(profBtn);
      var p = B.app.profile;
      if (p) profBtn.appendChild(S.avatar(p, 'small'));
      profBtn.appendChild(U.icon('down', 'caret'));
    }
    drawProf();
    profBtn.addEventListener('click', function (e) { e.stopPropagation(); profileMenu(profBtn); });

    function onScroll() { header.classList.toggle('solid', window.scrollY > 10); }
    window.addEventListener('scroll', onScroll, { passive: true });

    function render(r) {
      if (B.player.current) return;
      var key = r.parts[0] || 'home';
      if (!S.pages[key]) { R.go('/home', true); return; }
      if (page && pageKey) scrolls[pageKey] = window.scrollY;
      if (page && page.destroy) { try { page.destroy(); } catch (e) { B.log('destroy', e); } }
      U.clear(content);
      pageKey = r.hash;
      page = S.pages[key](r);
      content.appendChild(page.el);
      el.setAttribute('data-page', key);
      [links, tabs].forEach(function (box) {
        Array.prototype.forEach.call(box.children, function (a) {
          var on = a.getAttribute('data-k') === key;
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
      if (!page || B.player.current) return;
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
    var offs = [
      B.on('library', function () { clearTimeout(pending.data); clearTimeout(pending.epg); soon('lib', rerender, 200); }),
      B.on('loading', function () { if (page && page.onLoading) page.onLoading(); }),
      B.on('profileData', function () { if (page && page.onData) soon('data', function () { if (page && page.onData) page.onData(); }, 300); }),
      B.on('epg', function () { if (page && page.onEpg) soon('epg', function () { if (page && page.onEpg) page.onEpg(); }, 300); }),
      B.on('profiles', drawProf)
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
        R.handlers = [];
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
    function item(icon, label, fn, href) {
      var it = href ? h('a.menu-it', { href: href, role: 'menuitem' }, [U.icon(icon), h('span', label)]) : h('button.menu-it', { type: 'button', role: 'menuitem' }, [U.icon(icon), h('span', label)]);
      it.addEventListener('click', function () { close(); if (fn) fn(); });
      menu.appendChild(it);
    }
    if (menu.children.length) menu.appendChild(h('div.menu-sep'));
    item('users', L('Switch profile'), function () { B.app.switchProfile(); });
    item('gear', L('Settings'), null, '#/settings');
    item('account', L('My Bingr'), null, '../account/');
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

  // MARK: Home

  S.pages.home = function () {
    var el = h('div.page.home');
    var pg = { el: el, title: L('Home') };
    var keysBuilt = {};
    function heroFor() {
      var lib = Lib.lib;
      return Lib.memo('hero', function () {
        var cands = lib.movies.filter(function (m) { return m.poster; }).slice(0, 400);
        if (!cands.length) cands = lib.series.filter(function (s) { return s.poster; }).slice(0, 400);
        if (!cands.length) return null;
        var top = Lib.top10(lib.movies.length ? lib.movies : lib.series);
        var pick = top.length ? top[Math.floor(Math.random() * Math.min(5, top.length))] : cands[Math.floor(Math.random() * cands.length)];
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
        h('div.hero-poster', [U.img(x.poster, 'poster', x.title)])
      ]);
    }
    function continueRow() {
      var lib = Lib.lib, cards = [];
      var byTitle = Lib.memo('seriesByTitle', function () { var m = {}; lib.series.forEach(function (s) { if (!m[s.title]) m[s.title] = s; }); return m; });
      var seen = {};
      D.progressList().forEach(function (pe) {
        if (cards.length >= 20) return;
        var hit = lib.byId[pe.key];
        if (hit && hit.type === 'movie') cards.push(posterCard(hit.item, 'movie', { progress: pe.e.fraction }));
        else if (!hit) {
          var s = byTitle[pe.e.title];
          if (s && !seen[s.id]) { seen[s.id] = true; cards.push(posterCard(s, 'series', { progress: pe.e.fraction })); }
        }
      });
      return U.row(L('Continue watching'), cards);
    }
    function myListRow() {
      var cards = myListItems().slice(0, 40).map(function (hit) { return posterCard(hit.item, hit.type); });
      return U.row(L('My List'), cards, null, '#/mylist');
    }
    function liveRow() {
      var lib = Lib.lib, src = Lib.source ? Lib.source.id : '', chans = [];
      D.setList('recentChannels').concat(D.setList('favorites')).forEach(function (k) {
        var parts = k.split('|');
        if (parts[0] !== src) return;
        var hit = lib.byId[parts.slice(1).join('|')];
        if (hit && hit.type === 'channel' && chans.indexOf(hit.item) < 0) chans.push(hit.item);
      });
      if (!chans.length) chans = lib.channels.slice(0, 20);
      chans = chans.slice(0, 24);
      return U.row(L('Live now'), chans.map(function (c) { return channelCard(c, chans); }), 'live', '#/live');
    }
    function builders() {
      var lib = Lib.lib;
      var kids = B.app.profile && B.app.profile.kids;
      var b = {
        'continue': continueRow, 'mylist': myListRow, 'live': liveRow,
        'top10': function () {
          return [U.row(kids ? L('Top 10 kids series') : L('Top 10 series today'), Lib.top10(lib.series).map(function (s, i) { return top10Card(s, 'series', i); }), 'top10row'),
            U.row(kids ? L('Top 10 kids movies') : L('Top 10 movies today'), Lib.top10(lib.movies).map(function (m, i) { return top10Card(m, 'movie', i); }), 'top10row')];
        },
        'recent': function () { return U.row(L('Recently added'), Lib.recent(lib.movies, 30).map(function (m) { return posterCard(m, 'movie'); })); },
        'movies': function () { return U.row(L('Movies'), lib.movies.slice(0, 30).map(function (m) { return posterCard(m, 'movie'); }), null, '#/movies'); },
        'series': function () { return U.row(L('Series'), lib.series.slice(0, 30).map(function (s) { return posterCard(s, 'series'); }), null, '#/series'); },
        'categories': function () {
          var out = [];
          var mg = Lib.byGroup('movie'), sg = Lib.byGroup('series');
          lib.movieGroups.slice(0, 8).forEach(function (g) { out.push(U.row(g, (mg[g] || []).slice(0, 30).map(function (m) { return posterCard(m, 'movie'); }), null, R.link(['movies', g]))); });
          lib.seriesGroups.slice(0, 6).forEach(function (g) { out.push(U.row(g, (sg[g] || []).slice(0, 30).map(function (s) { return posterCard(s, 'series'); }), null, R.link(['series', g]))); });
          return out;
        }
      };
      D.collectionsFor(B.app.profile.id).forEach(function (c) {
        b['collection:' + c.id] = function () {
          var items = Lib.collectionItems(c, 40);
          var chans = items.filter(function (x) { return x.type === 'channel'; }).map(function (x) { return x.item; });
          return U.row(c.name, items.map(function (x) { return itemCard(x, chans); }), chans.length === items.length ? 'live' : null);
        };
      });
      return b;
    }
    function order(b) {
      var colls = Object.keys(b).filter(function (k) { return k.indexOf('collection:') === 0; });
      var o = ['continue', 'mylist', 'top10', 'live', 'recent'].concat(colls).concat(['categories']);
      var layout = D.homeLayout();
      if (layout) {
        var known = {};
        o = [];
        layout.forEach(function (r) { if (r && r.key && b[r.key]) { known[r.key] = true; if (r.visible !== false) o.push(r.key); } });
        colls.forEach(function (k) { if (!known[k]) o.push(k); });
        if (!known.categories && o.indexOf('categories') < 0) o.push('categories');
      }
      return o;
    }
    var blocks = {};
    function render() {
      U.clear(el);
      blocks = {};
      var st = stateBox();
      if (st) { el.appendChild(st); return; }
      var hf = heroFor();
      if (hf) el.appendChild(hero(hf));
      var rows = h('div.rows');
      el.appendChild(rows);
      var b = builders();
      order(b).forEach(function (k) {
        var nodes = b[k]();
        nodes = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
        var holder = h('div.rowgroup', nodes);
        blocks[k] = holder;
        rows.appendChild(holder);
        keysBuilt[k] = true;
      });
    }
    function refreshRows(keys) {
      var b = builders();
      keys.forEach(function (k) {
        var holder = blocks[k];
        if (!holder || !b[k]) return;
        var nodes = b[k]();
        nodes = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
        // scrollpositie van de rij bewaren
        var tr = holder.querySelector('.row-track'), x = tr ? tr.scrollLeft : 0;
        U.clear(holder);
        U.append(holder, nodes);
        var tr2 = holder.querySelector('.row-track');
        if (tr2) tr2.scrollLeft = x;
      });
    }
    pg.refresh = render;
    pg.onLoading = function () { if (el.querySelector('.state')) render(); };
    pg.onData = function () { refreshRows(['continue', 'mylist', 'live']); };
    pg.onEpg = function () { refreshRows(['live']); };
    render();
    return pg;
  };

  function myListItems() {
    var lib = Lib.lib, src = Lib.source ? Lib.source.id : '', out = [];
    D.setList('myList').forEach(function (k) {
      var parts = k.split('|');
      if (parts[0] !== src) return;
      var hit = lib.byId && lib.byId[parts.slice(1).join('|')];
      if (hit && hit.type !== 'channel') out.push(hit);
    });
    return out;
  }

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
        setTimeout(function () { var a = chips.querySelector('.active'); if (a && a.scrollIntoView) chips.scrollLeft = a.offsetLeft - 40; }, 0);
        var all = isMovie ? lib.movies : lib.series;
        if (!group) {
          var byG = Lib.byGroup(type);
          var rows = h('div.rows');
          el.appendChild(rows);
          var top = Lib.top10(all);
          if (top.length >= 5) rows.appendChild(U.row(L(isMovie ? 'Top 10 movies today' : 'Top 10 series today'), top.map(function (x, i) { return top10Card(x, type, i); }), 'top10row'));
          if (isMovie) { var rec = Lib.recent(all, 30); if (rec.length) rows.appendChild(U.row(L('Recently added'), rec.map(function (m) { return posterCard(m, 'movie'); }))); }
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
    function render() {
      U.clear(el);
      el.appendChild(h('div.page-head', [h('h1', L('My List'))]));
      var st = stateBox();
      if (st) { el.appendChild(st); return; }
      var items = myListItems();
      if (!items.length) {
        el.appendChild(h('div.state', [U.icon('bookmark', 'state-ic'), h('h2', L('Your list is empty')), h('p.muted', L('Add movies and series with the My List button.'))]));
        return;
      }
      el.appendChild(U.grid(items, function (hit) { return posterCard(hit.item, hit.type); }, 'posters'));
    }
    pg.refresh = render;
    pg.onData = render;
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
      var res = Lib.search(q, 60);
      if (!res.channels.length && !res.movies.length && !res.series.length) { results.appendChild(h('div.state', [h('p.muted', L('No results for "%@"', q))])); return; }
      if (res.channels.length) results.appendChild(U.row(L('Channels'), res.channels.map(function (c) { return channelCard(c, res.channels); }), 'live'));
      if (res.movies.length) { results.appendChild(h('h2.row-title.grid-title', L('Movies'))); results.appendChild(U.grid(res.movies, function (m) { return posterCard(m, 'movie'); }, 'posters')); }
      if (res.series.length) { results.appendChild(h('h2.row-title.grid-title', L('Series'))); results.appendChild(U.grid(res.series, function (s) { return posterCard(s, 'series'); }, 'posters')); }
    }
    var deb = B.debounce(run, 220);
    input.addEventListener('input', deb);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { deb.cancel(); run(); input.blur(); } });
    pg.refresh = function () { run(); };
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
      if (D.setList('favorites').some(function (k) { return k.split('|')[0] === src; })) out.push({ key: '★', label: L('Favorites') });
      if (D.setList('recentChannels').some(function (k) { return k.split('|')[0] === src; })) out.push({ key: '⟲', label: L('Recent') });
      out.push({ key: '*', label: L('All channels') });
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
      if (key === '★') return fromKeys(D.setList('favorites'));
      if (key === '⟲') return fromKeys(D.setList('recentChannels'));
      if (key === '*' || !key) return lib.channels;
      return Lib.byGroup('channel')[key] || [];
    }
    function favKey(ch) { return D.key(src, ch.id); }
    function chanRow(ch) {
      var nn = Lib.nowNext(ch);
      var fav = D.inSet('favorites', favKey(ch));
      var row = h('div.lv-row' + (selected === ch ? '.sel' : ''), { role: 'listitem' });
      var main = h('button.lv-main', { type: 'button', 'aria-label': L('Watch %@', ch.name) }, [
        h('span.lv-num', ch.number != null ? String(ch.number) : ''),
        h('div.lv-logo', [U.img(ch.logo, 'logo', ch.name)]),
        h('div.lv-txt', [h('div.lv-name', [ch.name, fav ? U.icon('starFill', 'lv-fav') : null]),
          h('div.lv-now.muted', nn.now ? B.fmtTime(nn.now.start) + '  ' + nn.now.title : (nn.next ? L('Next') + ': ' + nn.next.title : '')),
          nn.now ? h('div.card-progress.inline', [h('div', { style: { width: pct(nn.now) } })]) : null])
      ]);
      main.addEventListener('click', function () { B.player.playChannel(ch, currentList); });
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
        U.button(fav ? L('Favorite') : L('Add to favorites'), function () { D.toggleSet('favorites', favKey(ch)); fillGuide(box, ch); refreshList(); }, { icon: fav ? 'starFill' : 'star' })
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
    function refreshList() {
      if (!listEl) return;
      var y = listEl.scrollTop;
      if (grid && grid.destroy) grid.destroy();
      U.clear(listEl);
      grid = U.grid(currentList, chanRow, 'lv-grid', 80);
      listEl.appendChild(grid);
      listEl.scrollTop = y;
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
      refreshList();
      drawGuide();
      setTimeout(function () { var a = gl.querySelector('.active'); if (a) gl.scrollTop = a.offsetTop - 80; }, 0);
    }
    pg.refresh = render;
    pg.onLoading = function () { if (el.querySelector('.state')) render(); };
    pg.onEpg = function () { refreshList(); drawGuide(); };
    pg.onData = function () { refreshList(); };
    var tick = setInterval(function () { if (document.hidden) return; refreshList(); drawGuide(); }, 60000);
    pg.destroy = function () { clearInterval(tick); if (grid && grid.destroy) grid.destroy(); };
    render();
    return pg;
  };

  // MARK: detailpagina

  S.pages.title = function (r) {
    var type = r.parts[1] === 'series' ? 'series' : 'movie';
    var id = r.parts[2] || '';
    var el = h('div.page.detail');
    var pg = { el: el };
    var x = null, episodes = [], season = null, currentEp = null, versions = [];
    var buttons, epsEl, seasonSel, trailerBtnSlot, meta, langEl, plot;
    var stremio = Lib.source && Lib.source.kind === 'Stremio';
    var isShow = type === 'series';
    var listKey = null;
    var alive = true;
    function find() { var hit = Lib.lib.byId && Lib.lib.byId[id]; return hit && hit.type === type ? hit.item : null; }

    function metaText(extra) {
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

    function listButton() {
      var on = D.inSet('myList', listKey);
      return U.button(L('My List'), function () { D.toggleSet('myList', listKey); drawButtons(); }, { icon: on ? 'check' : 'plus', cls: on ? 'on' : null, title: on ? L('Remove from My List') : L('Add to My List') });
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
    function drawEpisodes() {
      U.clear(epsEl);
      var target = null;
      episodes.filter(function (e) { return e.season === season; }).forEach(function (e) {
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
        if (currentEp === e) target = card;
        epsEl.appendChild(card);
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
        if (info.plot && !x.plot) plot.textContent = info.plot;
        if (info.genre) metaText([info.genre]);
        if (!episodes.length) { U.clear(epsEl); epsEl.appendChild(h('p.muted', L('No episodes found'))); drawButtons(); return; }
        currentEp = pickCurrent();
        season = currentEp ? currentEp.season : seasons()[0];
        drawSeasons();
        drawEpisodes();
        drawButtons();
        loadTrailer();
      });
    }
    function build() {
      U.clear(el);
      x = find();
      if (!x) {
        if (Lib.loading || !Lib.lib.byId) { el.appendChild(h('div.state', [U.spinner()])); return; }
        el.appendChild(h('div.state', [h('h2', L('Not found')), h('p.muted', L('This title is not in the library of this server.')), h('a.btn', { href: '#/home' }, L('Home'))]));
        return;
      }
      pg.title = x.title;
      document.title = x.title + ' · Bingr';
      listKey = D.key(Lib.source ? Lib.source.id : '', x.id);
      meta = h('div.dt-meta'); langEl = h('div.dt-lang'); plot = h('p.dt-plot', x.plot || '');
      buttons = h('div.dt-btns');
      trailerBtnSlot = h('span.dt-trailer');
      var back = h('button.icon-btn.dt-back', { type: 'button', 'aria-label': L('Back'), title: L('Back') }, [U.icon('back')]);
      back.addEventListener('click', function () { if (history.length > 1) history.back(); else R.go('/home'); });
      el.appendChild(h('div.dt-bg', [U.img(x.poster, 'hero-img')]));
      el.appendChild(h('div.dt-shade'));
      el.appendChild(h('div.dt-top', [back, h('div.dt-poster', [U.img(x.poster, 'poster', x.title)]),
        h('div.dt-info', [h('div.hero-kind', isShow ? L('SERIES') : L('FILM')), h('h1.dt-title', x.title), meta, langEl, plot, buttons])]));
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
        el.appendChild(h('section.dt-episodes', [h('div.dt-eps-head', [h('h2.dt-eps-title', L('Episodes')), seasonSel]), epsEl]));
      }
      metaText();
      drawLang();
      drawButtons();
      setTimeout(function () { if (alive && refreshVersions()) drawButtons(); }, 60);
      B.ageRatings.originalLanguage(x, isShow).then(function () { if (!alive) return; drawLang(); metaText(); if (refreshVersions()) drawButtons(); });
      if (isShow) loadEpisodes();
      else {
        loadTrailer();
        Lib.movieInfo(x).then(function (info) {
          if (!info || !alive) return;
          if (info.plot && !x.plot) plot.textContent = info.plot;
          metaText([info.duration, info.genre]);
        });
      }
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
    pg.destroy = function () { alive = false; };
    build();
    return pg;
  };

  // MARK: Instellingen

  S.pages.settings = function () {
    var list = h('div.st-list');
    var el = h('div.page.settings', [h('div.page-head', [h('h1', L('Settings'))]), list]);
    var pg = { el: el, title: L('Settings') };
    function section(t) { var s = h('section.st-sec', [h('h2.st-head', t)]); list.appendChild(s); return s; }
    function row(sec, label, value, fn, opts) {
      opts = opts || {};
      var r = fn ? h('button.st-row' + (opts.danger ? '.danger' : ''), { type: 'button' }) : h('div.st-row.info');
      if (opts.icon) r.appendChild(U.icon(opts.icon, 'st-ic'));
      r.appendChild(h('span.st-label', label));
      if (value != null) r.appendChild(h('span.st-value', value));
      if (fn) { r.appendChild(U.icon('chevron', 'st-chev')); r.addEventListener('click', fn); }
      sec.appendChild(r);
      return r;
    }
    function onOff(v) { return v ? L('On') : L('Off'); }
    function render() {
      U.clear(list);
      var prof = B.app.profile;
      var main = D.isMain(prof);
      var sec = section(L('Account'));
      row(sec, L('Signed in as %@', A.email() || ''), null, null, { icon: 'account' });
      row(sec, L('My Bingr'), L('Devices, profiles and servers'), function () { location.href = '../account/'; }, { icon: 'gear' });
      row(sec, L('Sign out'), null, confirmSignOut, { danger: true, icon: 'logout' });

      sec = section(L('Profile'));
      var pRow = row(sec, L('Switch profile'), prof.name, function () { B.app.switchProfile(); });
      pRow.insertBefore(S.avatar(prof, 'tiny'), pRow.firstChild);
      var accent = D.accentKey(prof);
      var sw = h('span.st-value.swatch', [h('i', { style: { background: D.accents[accent] } }), L(accent.charAt(0).toUpperCase() + accent.slice(1))]);
      var aRow = row(sec, L('Accent color'), null, function () {
        U.choose(L('Accent color'), Object.keys(D.accents).map(function (k) { return { value: k, label: L(k.charAt(0).toUpperCase() + k.slice(1)) }; }), accent, function (v) {
          B.app.applyAccent(v);
          D.setAccent(prof.id, v).then(function () { B.app.applyAccent(); render(); });
          render();
        });
      });
      aRow.insertBefore(sw, aRow.querySelector('.st-chev'));
      row(sec, L('Intro sound'), onOff(B.app.tuneEnabled()), function () { B.app.setTune(!B.app.tuneEnabled()); render(); });

      sec = section(L('Server'));
      var src = Lib.source;
      row(sec, L('Active server'), src ? src.name : L('None'), function () { if (!D.sources.length) { U.toast(L('No servers yet')); return; } chooseServer(); });
      row(sec, L('Refresh now'), null, function () { if (Lib.source) { Lib.select(Lib.source, true); U.toast(L('Updating…')); } }, { icon: 'refresh' });

      sec = section(L('Audio & subtitles'));
      var CLg = B.clang;
      var langOpts = ['nl', 'en', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'tr', 'ar', 'hi'];
      function pv(key, sharedKey) { var v = D.profilePref(key); return v != null ? v : String(D.shared(sharedKey, '') || ''); }
      var aud = pv('audioLanguage', 'audioLanguage');
      function audLabel(v) { return v === 'stream' ? L('As in the stream') : (v ? CLg.name(v) : L('Same as app') + ' (' + CLg.name(B.lang) + ')'); }
      row(sec, L('Default audio language'), audLabel(aud), function () {
        U.choose(L('Default audio language'), [{ value: '', label: audLabel('') }, { value: 'stream', label: L('As in the stream') }]
          .concat(langOpts.map(function (c) { return { value: c, label: CLg.name(c) }; })), aud, function (v) { D.setShared('audioLanguage', v); D.setProfilePref('audioLanguage', v); render(); });
      });
      var autoS = CLg.autoSubtitles();
      var autoLabels = { off: L('Off'), whenNeeded: L('When needed'), always: L('Always') };
      row(sec, L('Automatic subtitles'), autoLabels[autoS], function () {
        U.choose(L('Automatic subtitles'), ['whenNeeded', 'always', 'off'].map(function (v) { return { value: v, label: autoLabels[v] }; }), autoS, function (v) {
          D.setShared('autoSubtitles', v); D.setProfilePref('autoSubtitles', v); render();
        });
      });
      var subRaw = pv('streamSubtitleLanguage', 'subtitleLanguage');
      var subCur = subRaw === 'off' ? '' : CLg.norm(subRaw);
      var subAuto = L('Same as app') + ' (' + CLg.name(CLg.appLanguage()) + ')';
      row(sec, L('Subtitle language'), subCur ? CLg.name(subCur) : subAuto, function () {
        U.choose(L('Subtitle language'), [{ value: '', label: subAuto }].concat(langOpts.map(function (c) { return { value: c, label: CLg.name(c) }; })), subCur, function (v) {
          D.setShared('subtitleLanguage', v); D.setProfilePref('streamSubtitleLanguage', v); render();
        });
      });
      var OS = B.opensubtitles;
      row(sec, 'OpenSubtitles', OS.isLoggedIn() ? OS.username() : L('Not linked'), null);
      if (OS.isLoggedIn()) {
        var osl = OS.defaultLanguage();
        var oslabel = '';
        OS.languages.forEach(function (l) { if (l[0].slice(0, 2) === osl.slice(0, 2)) oslabel = l[1]; });
        row(sec, L('Default subtitle language'), oslabel || L('All'), function () {
          U.choose(L('Default subtitle language'), [{ value: '', label: L('All') }].concat(OS.languages.map(function (l) { return { value: l[0], label: l[1] }; })), osl, function (v) {
            D.setShared('openSubtitlesLanguage', v); D.setProfilePref('subtitleLanguage', v); render();
          });
        });
      }

      sec = section(L('App'));
      var lang = D.shared('appLanguage', '') || '';
      var langLabel = L('Automatic');
      B.languages.forEach(function (l) { if (l[0] === lang && l[0]) langLabel = l[1]; });
      row(sec, L('Language'), langLabel, function () {
        U.choose(L('Language'), B.languages.map(function (l) { return { value: l[0], label: l[0] ? l[1] : L('Automatic') }; }), lang, function (v) {
          D.setShared('appLanguage', v);
          B.app.setLanguage(v);
        });
      });

      sec = section(L('Parental lock'));
      var pcOn = B.bool(D.shared('parentalControl', false)) === true;
      var mainPin = D.pinFor(D.mainProfile());
      row(sec, L('Parental lock'), onOff(pcOn), main ? function () {
        var go = function () { D.setShared('parentalControl', !pcOn); setTimeout(function () { Lib.applyFilters(); render(); }, 50); };
        if (mainPin && pcOn) U.askPIN(L('Enter PIN'), function (x) { return x === mainPin; }, go); else go();
      } : null, { icon: 'lock' });
      if (mainPin) {
        row(sec, PC.isUnlocked() ? L('Lock now') : L('Unlock with PIN'), null, function () {
          if (PC.isUnlocked()) { PC.lock(); render(); return; }
          U.askPIN(L('Enter PIN'), function (x) { return x === mainPin; }, function () { PC.unlock(); render(); });
        }, { icon: PC.isUnlocked() ? 'lock' : 'unlock' });
      }
      if (D.ageLimit(prof) != null) row(sec, L('Age limit'), prof.kids ? L('Kids profile') : D.ageLimit(prof) + '+', null);

      sec = section(L('Keyboard shortcuts'));
      [['Space / K', L('Play / pause')], ['← →', L('10 seconds back / forward')], ['↑ ↓', L('Volume, or another channel during live TV')],
        ['F', L('Full screen')], ['M', L('Mute')], ['Esc', L('Close the player')], ['/', L('Search')]].forEach(function (k) {
        var r2 = row(sec, k[1], null, null);
        r2.appendChild(h('kbd', k[0]));
      });

      sec = section(L('About'));
      row(sec, 'Bingr ' + B.config.version + (B.config.build ? ' (build ' + B.config.build + ')' : ''), L('Browser') + ' · ' + A.deviceDisplayName(), null);
      row(sec, L('Servers on http go through Bingr’s server, because browsers block http on a secure page. Some formats (such as MKV) only play in the app.'), null, null);
    }
    pg.refresh = render;
    var off = B.on('connections', render);
    var off2 = B.on('settings', function () { if (el.parentNode) render(); });
    pg.destroy = function () { off(); off2(); };
    render();
    return pg;
  };
})();
