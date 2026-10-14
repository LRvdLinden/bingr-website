/*
 * Bingr web: kleine UI-bouwstenen (elementen, iconen, meldingen, vensters, keuzelijsten, pincode) en de router (#/…).
 * Responsief: muis, aanraken en toetsenbord. Geen frameworks.
 */
(function () {
  'use strict';
  var B = window.B;
  var L = function () { return B.L.apply(null, arguments); };
  var U = B.ui = {};

  /** h('div.a.b#id', {attrs}, [kinderen]) of h('span', 'tekst'). */
  U.h = function (sel, attrs, kids) {
    if (attrs != null && (typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node)) { kids = attrs; attrs = null; }
    var m = String(sel).split(/(?=[.#])/);
    var el = document.createElement(m[0] || 'div');
    for (var i = 1; i < m.length; i++) {
      if (m[i].charAt(0) === '.') el.classList.add(m[i].slice(1)); else el.id = m[i].slice(1);
    }
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (s) { el.style[s] = v[s]; });
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    U.append(el, kids);
    return el;
  };
  U.append = function (el, kids) {
    if (kids == null) return el;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (k) {
      if (k == null || k === false) return;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    });
    return el;
  };
  U.clear = function (el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; };
  var h = U.h;

  // MARK: iconen (24×24, lijnstijl)

  var P = {
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.7 5.7 3.7 9s-1.2 6.3-3.7 9c-2.5-2.7-3.7-5.7-3.7-9S9.5 5.7 12 3z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    guide: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
    starFill: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" fill="currentColor"/>',
    replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
    back10: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700" font-family="Arial">10</text>',
    fwd10: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700" font-family="Arial">10</text>',
    audio: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/>',
    subs: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 13h4M13 13h4M7 16h7"/>',
    next: '<path d="M5 5l9 7-9 7z" fill="currentColor"/><path d="M18 5v14"/>',
    pip: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor"/>',
    full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    fullExit: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
    volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    chart: '<path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    tv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M9 2l3 4 3-4"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    series: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M6 4h12"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    logout: '<path d="M14 4h5v16h-5M10 12h10M14 8l-4 4 4 4" transform="matrix(-1 0 0 1 24 0)"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    trailer: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z" fill="currentColor"/>',
    mail: '<rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="currentColor" stroke="none"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5" stroke="#0b0b0b" stroke-width="1.8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M17.5 14.5c2.4.3 4 1.9 4 4.5"/>',
    account: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5c1.3-2 3.2-3 5.5-3s4.2 1 5.5 3"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
    chUp: '<path d="M6 15l6-6 6 6"/>',
    chDown: '<path d="M6 9l6 6 6-6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/>',
    checkCircleFill: '<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="M8 12.5l2.8 2.8L16 10" stroke="#000" stroke-width="2.4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    stack: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M6 5h12M8 2h8"/>',
    stackAdd: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M6 5h12M12 11.5v6M9 14.5h6"/>',
    sparkle: '<path d="M12 3l1.8 4.9L19 9.7l-4.9 1.8L12 16.5l-1.8-4.9L5 9.7l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>',
    minus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    rows: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="18" height="5" rx="1.5"/><path d="M3 20h18"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17v.01"/>',
    heart: '<path d="M12 20s-7-4.4-9-8.6C1.5 8.2 3.5 5 6.7 5c2 0 3.4 1.1 4.3 2.4h2C13.9 6.1 15.3 5 17.3 5c3.2 0 5.2 3.2 3.7 6.4-2 4.2-9 8.6-9 8.6z"/>'
  };
  U.icon = function (name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    s.innerHTML = P[name] || '';
    return s;
  };

  /** Knop: U.button(label, fn, {icon, primary, cls, title, round}). */
  U.button = function (label, fn, opts) {
    opts = opts || {};
    var b = h('button.btn' + (opts.primary ? '.primary' : '') + (opts.round ? '.round' : '') + (opts.cls ? '.' + opts.cls.split(' ').join('.') : ''), { type: 'button' });
    if (opts.icon) b.appendChild(U.icon(opts.icon));
    if (label) b.appendChild(h('span', label));
    var t = opts.title || (!label ? opts.label : null);
    if (t) { b.title = t; b.setAttribute('aria-label', t); }
    if (fn) b.addEventListener('click', function (e) { e.stopPropagation(); fn(e); });
    return b;
  };
  U.spinner = function () { return h('div.spinner', { role: 'status', 'aria-label': L('Loading…') }); };
  U.logo = function () { return h('div.logo', 'BINGR'); };

  /**
   * Afbeelding met terugval op een tekstvlak. http mag niet op een https-pagina: eerst dezelfde URL op https
   * (de meeste beeldbanken kunnen dat), lukt dat niet, dan via de proxy (alleen hosts van je eigen servers).
   */
  U.img = function (url, cls, alt) {
    var wrap = h('div.imgbox' + (cls ? '.' + cls : ''));
    var orig = url ? String(url).trim() : '';
    var http = B.isInsecure(orig);
    // afbeeldingen van je eigen http-server: meteen via de proxy (die server kent geen https)
    var direct = http && B.isSourceHost(orig) ? B.proxyGetURL(orig) : null;
    var u = direct || (http ? orig.replace(/^http:\/\//i, 'https://') : orig);
    var viaProxy = !!direct;
    if (!u) { wrap.classList.add('noimg'); if (alt) wrap.appendChild(h('span.alt', alt)); return wrap; }
    var im = h('img', { src: u, alt: alt || '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    function giveUp() { if (im.parentNode) im.parentNode.removeChild(im); wrap.classList.add('noimg'); if (alt) wrap.appendChild(h('span.alt', alt)); }
    im.onerror = function () {
      if (http && !viaProxy) {
        viaProxy = true;
        var p = B.proxyGetURL(orig);
        if (p) { im.src = p; return; }
        B.ensureProxyToken().then(function () { var p2 = B.proxyGetURL(orig); if (p2) im.src = p2; else giveUp(); });
        return;
      }
      giveUp();
    };
    im.onload = function () { wrap.classList.add('loaded'); };
    wrap.appendChild(im);
    return wrap;
  };

  // MARK: meldingen

  var toastBox = null, toastTimer = null;
  U.toast = function (text, ms) {
    if (!toastBox) { toastBox = h('div.toast', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
    toastBox.textContent = text;
    toastBox.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastBox.classList.remove('show'); }, ms || 3000);
  };

  // MARK: vensters (modal, keuzelijst, pincode)

  var stack = [];
  U.dialogOpen = function () { return stack.length > 0; };
  /** Venster: {title, text, body (element), buttons: [{label, fn, primary, danger, icon}], cls, onClose}. */
  U.modal = function (o) {
    var prevFocus = document.activeElement;
    var box = h('div.dialog' + (o.cls ? '.' + o.cls : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || '' });
    var layer = h('div.dlg-layer', [box]);
    if (o.title) box.appendChild(h('h2.dlg-title', o.title));
    if (o.text) box.appendChild(h('p.dlg-text', o.text));
    if (o.body) box.appendChild(o.body);
    var close = function (fromKey) {
      var i = stack.indexOf(api);
      if (i < 0) return;
      stack.splice(i, 1);
      layer.classList.remove('show');
      setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 160);
      if (o.onClose) o.onClose(fromKey);
      try { if (prevFocus && prevFocus.focus && document.body.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch (e) { /* stil */ }
    };
    if (o.buttons && o.buttons.length) {
      var row = h('div.dlg-buttons');
      o.buttons.forEach(function (bt, i) {
        var b = U.button(bt.label, function () { close(); if (bt.fn) bt.fn(); }, { primary: bt.primary || (i === 0 && o.buttons.length > 1 && bt.primary !== false && !bt.danger), icon: bt.icon, cls: bt.danger ? 'danger' : null });
        row.appendChild(b);
      });
      box.appendChild(row);
    }
    layer.addEventListener('click', function (e) { if (e.target === layer) close(true); });
    var api = { close: close, el: box, layer: layer };
    stack.push(api);
    document.body.appendChild(layer);
    requestAnimationFrame(function () { layer.classList.add('show'); });
    var first = box.querySelector('input, .dlg-buttons .btn.primary, .opt.sel, .opt, .btn');
    if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }, 30);
    return api;
  };
  U.closeTopDialog = function () { var t = stack[stack.length - 1]; if (t) { t.close(true); return true; } return false; };

  /** Keuzelijst: opties [{value, label, sub}] met de huidige waarde gemarkeerd. */
  U.choose = function (title, opts, current, onPick) {
    var list = h('div.opts', { role: 'listbox' });
    var dlg;
    opts.forEach(function (o) {
      var sel = o.value === current;
      var b = h('button.opt' + (sel ? '.sel' : ''), { type: 'button', role: 'option', 'aria-selected': sel ? 'true' : 'false' }, [
        h('span.opt-l', [h('span', o.label), o.sub ? h('span.opt-sub', o.sub) : null]), sel ? U.icon('check') : null]);
      b.addEventListener('click', function () { dlg.close(); onPick(o.value); });
      list.appendChild(b);
    });
    dlg = U.modal({ title: title, body: list, cls: 'choose' });
    var s = list.querySelector('.sel');
    if (s) setTimeout(function () { s.scrollIntoView({ block: 'center' }); }, 10);
    return dlg;
  };

  /** Pincode vragen (4 cijfers); check(pin) → true als hij klopt. */
  /** Pincode vragen; avatar (optioneel) = element dat boven de stippen staat (rond, zoals in de apps). */
  U.askPIN = function (title, check, onOK, avatar) {
    var val = '';
    var dots = h('div.pin-dots');
    var err = h('div.pin-err');
    var input = h('input.pin-input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', 'aria-label': title, pattern: '[0-9]*' });
    function draw() { U.clear(dots); for (var i = 0; i < 4; i++) dots.appendChild(h('span' + (i < val.length ? '.on' : ''))); }
    var dlg;
    function attempt() {
      if (val.length < 4) return;
      if (check(val)) { dlg.close(); onOK(); return; }
      err.textContent = L('Wrong PIN');
      dots.classList.add('shake');
      setTimeout(function () { dots.classList.remove('shake'); val = ''; input.value = ''; draw(); }, 450);
    }
    input.addEventListener('input', function () { val = input.value.replace(/\D/g, '').slice(0, 4); input.value = val; err.textContent = ''; draw(); attempt(); });
    var pad = h('div.pin-pad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach(function (k) {
      if (!k) { pad.appendChild(h('span')); return; }
      var b = h('button.pin-key', { type: 'button', 'aria-label': k === '⌫' ? L('Delete') : k }, k);
      b.addEventListener('click', function () {
        if (k === '⌫') val = val.slice(0, -1); else if (val.length < 4) val += k;
        input.value = val; err.textContent = ''; draw(); attempt();
      });
      pad.appendChild(b);
    });
    draw();
    dlg = U.modal({ title: title, body: h('div.pin', [avatar ? h('div.pin-av', [avatar]) : null, input, dots, err, pad]), cls: 'pin-dlg', buttons: [{ label: L('Cancel'), primary: false }] });
    setTimeout(function () { input.focus(); }, 40);
    return dlg;
  };

  /**
   * Menu met acties (zoals het contextmenu in de apps): items [{icon, label, fn, danger} | 'sep'].
   * at = element (menu eronder) of {x, y}. Op de telefoon als blad van onderen.
   */
  U.menu = function (at, items, title) {
    items = items.filter(Boolean);
    if (!items.length) return null;
    if (U.isPhone()) {
      var list = h('div.opts', { role: 'menu' });
      var dlg;
      items.forEach(function (it) {
        if (it === 'sep') return;
        var b = h('button.opt.menu-opt' + (it.danger ? '.danger' : ''), { type: 'button', role: 'menuitem' }, [h('span.opt-l.row-l', [it.icon ? U.icon(it.icon) : null, h('span', it.label)])]);
        b.addEventListener('click', function () { dlg.close(); if (it.fn) it.fn(); });
        list.appendChild(b);
      });
      dlg = U.modal({ title: title || '', body: list, cls: 'choose' });
      return dlg;
    }
    var menu = h('div.menu', { role: 'menu' });
    var prev = document.activeElement;
    var veil = h('div.menu-veil');
    function close() { veil.remove(); menu.remove(); document.removeEventListener('keydown', onKey, true); try { if (prev && prev.focus) prev.focus({ preventScroll: true }); } catch (e) { /* stil */ } }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var all = Array.prototype.slice.call(menu.querySelectorAll('.menu-it'));
        var i = all.indexOf(document.activeElement);
        var n = e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
        if (all[n]) all[n].focus();
      }
    }
    if (title) menu.appendChild(h('div.menu-title', title));
    items.forEach(function (it) {
      if (it === 'sep') { menu.appendChild(h('div.menu-sep')); return; }
      var b = h('button.menu-it' + (it.danger ? '.danger' : ''), { type: 'button', role: 'menuitem' }, [it.icon ? U.icon(it.icon) : null, h('span', it.label)]);
      b.addEventListener('click', function (e) { e.stopPropagation(); close(); if (it.fn) it.fn(); });
      menu.appendChild(b);
    });
    veil.addEventListener('click', close);
    veil.addEventListener('contextmenu', function (e) { e.preventDefault(); close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(veil);
    document.body.appendChild(menu);
    var x, y;
    if (at && at.getBoundingClientRect) { var r = at.getBoundingClientRect(); x = r.left; y = r.bottom + 6; }
    else { x = (at && at.x) || 0; y = (at && at.y) || 0; }
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    x = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
    if (y + mh > window.innerHeight - 8) y = Math.max(8, y - mh - (at && at.getBoundingClientRect ? at.getBoundingClientRect().height + 12 : 0));
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    var f = menu.querySelector('.menu-it');
    if (f) f.focus({ preventScroll: true });
    return { close: close };
  };

  /**
   * Contextmenu op een element: rechtermuisknop, de menutoets/Shift+F10 en lang indrukken op aanraakschermen.
   * build() geeft de items terug (pas op het moment zelf, zodat ze kloppen).
   */
  U.onMenu = function (el, build, title) {
    function open(at) { var items = build(); if (items && items.length) U.menu(at, items, typeof title === 'function' ? title() : title); }
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopPropagation();
      // via het toetsenbord (geen muispositie): onder het element
      open(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : el);
    });
    var timer = null, fired = false, sx = 0, sy = 0;
    el.addEventListener('touchstart', function (e) {
      fired = false;
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () { fired = true; if (navigator.vibrate) { try { navigator.vibrate(10); } catch (x) { /* stil */ } } open(el); }, 550);
    }, { passive: true });
    el.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) clearTimeout(timer); }, { passive: true });
    el.addEventListener('touchend', function (e) { clearTimeout(timer); if (fired) { e.preventDefault(); } }, { passive: false });
    el.addEventListener('touchcancel', function () { clearTimeout(timer); });
    el.addEventListener('click', function (e) { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
    el.classList.add('has-menu');
    return open;
  };

  /** Invoervenster: velden [{key, label, value, type, placeholder}] → onSave(values) (mag een Promise teruggeven). */
  U.form = function (title, fields, onSave, opts) {
    opts = opts || {};
    var inputs = {};
    var msg = h('div.login-err');
    var body = h('div.field-dlg.form-dlg', fields.map(function (f) {
      var inp = h('input', { type: f.type || 'text', value: f.value || '', placeholder: f.placeholder || f.label || '', 'aria-label': f.label || f.placeholder || '', autocomplete: f.autocomplete || 'off' });
      inputs[f.key] = inp;
      return h('label.form-row', [f.label ? h('span.form-label', f.label) : null, inp]);
    }).concat([opts.note ? h('p.muted.small.form-note', opts.note) : null, msg]));
    var dlg = U.modal({ title: title, body: body, buttons: [] });
    var save = U.button(opts.saveLabel || L('Save'), function () { submit(); }, { primary: true });
    dlg.el.appendChild(h('div.dlg-buttons', [save, U.button(L('Cancel'), function () { dlg.close(); })]));
    function submit() {
      var vals = {};
      Object.keys(inputs).forEach(function (k) { vals[k] = inputs[k].value; });
      msg.textContent = '';
      var r;
      try { r = onSave(vals); } catch (e) { msg.textContent = e.message; return; }
      if (r === false) return;
      if (r && r.then) {
        save.disabled = true;
        r.then(function (res) { if (res !== false) dlg.close(); else save.disabled = false; }, function (e) { save.disabled = false; msg.textContent = (e && e.message) || L('Something went wrong. Please try again.'); });
      } else dlg.close();
    }
    Object.keys(inputs).forEach(function (k) { inputs[k].addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } }); });
    return dlg;
  };

  /** Bevestigen: U.confirm(titel, tekst, knoptekst, fn, {danger}). */
  U.confirm = function (title, text, label, fn, opts) {
    opts = opts || {};
    return U.modal({ title: title, text: text, buttons: [{ label: label, fn: fn, primary: !opts.danger, danger: !!opts.danger }, { label: L('Cancel'), primary: false }] });
  };

  /** Nieuwe pincode kiezen (twee keer invoeren); onDone(pin). */
  U.choosePIN = function (onDone, avatar) {
    var first = null;
    U.askPIN(L('Choose a 4-digit PIN'), function (x) { first = x; return true; }, function () {
      U.askPIN(L('Enter the PIN again'), function (x) { return x === first; }, function () { onDone(first); }, avatar);
    }, avatar);
  };

  // MARK: rijen (horizontaal scrollen met pijlen op de computer)

  U.row = function (title, cards, cls, onMore) {
    if (!cards || !cards.length) return null;
    var track = h('div.row-track');
    cards.forEach(function (c) { track.appendChild(c); });
    var left = U.button('', function () { track.scrollBy({ left: -track.clientWidth * 0.85, behavior: 'smooth' }); }, { icon: 'back', cls: 'row-arrow left', title: L('Back') });
    var right = U.button('', function () { track.scrollBy({ left: track.clientWidth * 0.85, behavior: 'smooth' }); }, { icon: 'chevron', cls: 'row-arrow right', title: L('Next') });
    left.tabIndex = -1; right.tabIndex = -1;
    function arrows() {
      left.classList.toggle('hide', track.scrollLeft < 8);
      right.classList.toggle('hide', track.scrollLeft + track.clientWidth >= track.scrollWidth - 8);
    }
    track.addEventListener('scroll', arrows, { passive: true });
    setTimeout(arrows, 50);
    var head = h('div.row-head', [h('h2.row-title', title)]);
    if (onMore) { var more = h('a.row-more', { href: onMore }, [L('See all'), U.icon('chevron')]); head.appendChild(more); }
    return h('section.row' + (cls ? '.' + cls : ''), [head, h('div.row-wrap', [left, track, right])]);
  };

  /** Rooster dat in stukjes groeit (grote categorieën): items, render(item) → element. */
  U.grid = function (items, render, cls, step) {
    step = step || 60;
    var grid = h('div.grid' + (cls ? '.' + cls : ''));
    var i = 0;
    var sentinel = h('div.grid-more');
    function more() {
      var end = Math.min(items.length, i + step);
      var frag = document.createDocumentFragment();
      for (; i < end; i++) frag.appendChild(render(items[i], i));
      grid.insertBefore(frag, sentinel);
      if (i >= items.length && io) { io.disconnect(); sentinel.remove(); }
    }
    grid.appendChild(sentinel);
    var io = window.IntersectionObserver ? new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) more(); }, { rootMargin: '800px' }) : null;
    more();
    if (io && i < items.length) io.observe(sentinel);
    else if (!io) while (i < items.length) more();
    grid.destroy = function () { if (io) io.disconnect(); };
    return grid;
  };

  // MARK: router (#/pad?query)

  var R = U.router = { handlers: [], current: null };
  R.parse = function () {
    var raw = location.hash.replace(/^#\/?/, '');
    var q = {}, path = raw, qi = raw.indexOf('?');
    if (qi >= 0) {
      path = raw.slice(0, qi);
      raw.slice(qi + 1).split('&').forEach(function (p) { if (!p) return; var kv = p.split('='); q[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); });
    }
    var parts = path.split('/').filter(Boolean).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    return { path: '/' + parts.join('/'), parts: parts, query: q, hash: location.hash || '#/' };
  };
  R.go = function (path, replace) {
    var hash = '#' + (path.charAt(0) === '/' ? path : '/' + path);
    if (location.hash === hash) { R.fire(); return; }
    if (replace) { history.replaceState(history.state, '', hash); R.fire(); }
    else location.hash = hash;
  };
  R.link = function (parts) { return '#/' + parts.map(function (p) { return encodeURIComponent(p); }).join('/'); };
  R.fire = function () { var r = R.parse(); R.current = r; R.handlers.forEach(function (fn) { fn(r); }); };
  window.addEventListener('hashchange', function () { R.fire(); });

  /** Smal scherm (telefoon): onderbalk met tabbladen en het e-mailformulier om in te loggen. */
  U.isPhone = function () {
    var w = Math.min(window.innerWidth, screen.width || window.innerWidth);
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return w < 700 || (coarse && Math.min(screen.width, screen.height) < 600);
  };
  U.isTouch = function () { return window.matchMedia && window.matchMedia('(hover: none)').matches; };

  /** Relatieve tijd ("5 min geleden", "gisteren"). */
  U.fmtDate = function (ms) {
    try { return new Date(ms).toLocaleDateString(B.lang === 'nl' ? 'nl-NL' : (B.lang || 'en'), { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return new Date(ms).toDateString(); }
  };
})();
