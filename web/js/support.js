/*
 * Bingr web, build 146: Support in de webspeler (Instellingen → Support, #/support en #/support/ticket?n=<nummer>) en de
 * tab Diagnose. Contract: docs/ACCOUNT.md van iptv-ios-appletv, "Build 146" → "Support vanuit de app".
 * - Functie `support` met de acties app_list, app_get, app_mark_read, app_reply, app_create en app_close, altijd met de
 *   sessie van het account (Bearer); bij 401 één keer de sessie vernieuwen. Geen captcha meer.
 * - Lijst in Open / In behandeling / Gesloten, ticket met gesprek (reageren, sluiten), nieuw ticket met "Diagnose
 *   meesturen" (standaard aan, met Bekijken). Badge met counts.unread (bij openen, terugkeer naar het tabblad, heartbeat).
 * - Pushmelding support_reply: de service worker opent #/support/ticket?n=…; niet ingelogd = na het inloggen de lijst,
 *   404 = de lijst. Kinderprofiel: eerst de ouderpoort (screens.js, KIDS_GATED).
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, A = B.account, h = U.h;
  var L = function () { return B.L.apply(null, arguments); };
  var SP = B.support = {};
  var SITE = 'https://support.bingr.online';

  // MARK: aanroepen

  function post(body, token) {
    var hd = { 'apikey': B.config.supabaseKey, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) hd.Authorization = 'Bearer ' + token;
    return B.http(B.config.supabaseUrl + '/functions/v1/support', { method: 'POST', headers: hd, body: body, timeout: 30000 });
  }
  function SupportError(code, field, status) { this.code = code; this.field = field || null; this.status = status || 0; this.message = SP.errorText(code); }
  SupportError.prototype = Object.create(Error.prototype);
  /** Actie van de functie support; geeft json of gooit SupportError(code). */
  SP.call = function (action, body) {
    if (!A.isSignedIn()) return Promise.reject(new SupportError('not_signed_in', null, 401));
    var b = B.assign({ action: action }, body || {});
    var tried = false;
    function go(token) {
      return post(b, token).then(function (r) {
        var j = r.json || {};
        if (r.status === 401 && (j.error === 'user_banned' || j.banned === true || A.isBanned(r))) throw new SupportError('user_banned', null, 401);
        if (r.status === 401 && !tried) {
          tried = true;
          return A.refresh().then(function (res) { if (res !== 'ok') throw new SupportError('not_signed_in', null, 401); return A.validAccessToken().then(go); });
        }
        if (r.status < 200 || r.status >= 300) throw new SupportError(j.error || (r.status === 429 ? 'rate_limited' : 'generic'), j.field, r.status);
        return j;
      }, function (e) { if (e instanceof SupportError) throw e; throw new SupportError('network'); });
    }
    return A.validAccessToken().then(go, function () { throw new SupportError('network'); });
  };
  SP.errorText = function (code) {
    var m = {
      subject_missing: L('Enter a subject (at least 3 characters).'), subject_too_long: L('The subject is too long (max. 120 characters).'),
      message_too_short: L('Please describe your question in a bit more detail (at least 10 characters).'),
      message_too_long: L('Your message is too long (max. 5000 characters).'), message_missing: L('Type a message first.'),
      too_many_links: L('Your message contains too many links.'), bad_category: L('Choose a category.'),
      rate_limited: L('You’ve just sent quite a few messages. Please try again later.'), closed: L('This ticket is closed.'),
      not_found: L('Ticket not found.'), network: L('No internet connection.'), not_signed_in: L('Sign in to use support.'),
      user_banned: A.bannedMessage(), diagnostics_too_large: L('The diagnostics are too large. Send without diagnostics.'),
      bad_diagnostics: L('The diagnostics could not be added. Send without diagnostics.'), too_large: L('Your message is too long (max. 5000 characters).')
    };
    return m[code] || L('Something went wrong. Please try again.');
  };

  // MARK: teller (ongelezen) en lijst

  var state = { items: null, counts: { open: 0, in_progress: 0, closed: 0, unread: 0 }, at: 0, error: null };
  var busy = null;
  SP.state = function () { return state; };
  SP.unread = function () { return (state.counts && state.counts.unread) || 0; };
  /** app_list (alle tickets) → lijst en tellers; meldt 'support'. Stil bij fouten. */
  SP.refresh = function () {
    if (!A.isSignedIn()) return Promise.resolve(null);
    if (busy) return busy;
    busy = SP.call('app_list', { status: 'all' }).then(function (j) {
      state.items = Array.isArray(j.items) ? j.items : [];
      state.counts = j.counts || state.counts;
      state.at = Date.now(); state.error = null;
      B.emit('support');
      return state;
    }, function (e) {
      state.error = e;
      if (e && e.code === 'user_banned') A.revokedSignOut();
      B.emit('support');
      return null;
    }).then(function (r) { busy = null; return r; });
    return busy;
  };
  B.on('signedOut', function () { state = { items: null, counts: { open: 0, in_progress: 0, closed: 0, unread: 0 }, at: 0, error: null }; B.emit('support'); });
  /** Badge met het aantal ongelezen (of null). */
  SP.badge = function (cls) {
    var n = SP.unread();
    if (!n) return null;
    return h('span.sp-badge' + (cls ? '.' + cls : ''), { 'aria-label': L('%d unread', n) }, n > 99 ? '99+' : String(n));
  };

  // MARK: deeplink (pushmelding, #/support/ticket?n=…)

  var pending = null;
  SP.init = function () {
    try {
      var r = U.router.parse();
      if (r.parts[0] === 'support') {
        var n = r.parts[1] === 'ticket' ? B.int(r.query.n) : null;
        pending = { n: n, afterLogin: !A.isSignedIn() };
      }
    } catch (e) { /* stil */ }
    if ('serviceWorker' in navigator) {
      try {
        navigator.serviceWorker.addEventListener('message', function (e) {
          var m = e.data || {};
          if (m.type === 'bingr-push-open' && m.support) SP.open(B.int(m.support.n));
        });
      } catch (e) { /* stil */ }
    }
  };
  /** Na het kiezen van een profiel: Support openen als een melding dat vroeg. */
  SP.tryPending = function () {
    if (!pending || !B.app || !B.app.profile) return false;
    var p = pending; pending = null;
    SP.open(p.afterLogin ? null : p.n, true);
    return true;
  };
  /** Ticket (of de lijst) openen. */
  SP.open = function (n, replace) {
    if (!B.app || !B.app.profile) { pending = { n: n, afterLogin: false }; return; }
    U.router.go(n ? '/support/ticket?n=' + encodeURIComponent(n) : '/support', !!replace);
  };

  // MARK: weergave

  var STATUS = function () {
    return { new: L('New'), open: L('In progress'), pending: L('Awaiting your reply'), resolved: L('Resolved'), closed: L('Closed') };
  };
  var GROUPS = function () { return [['open', L('Open')], ['in_progress', L('In progress')], ['closed', L('Closed')]]; };
  SP.categories = function () {
    return [['account', L('Account and sign-in')], ['afspelen', L('Playback and streams')], ['apps', L('Apps and installing')],
      ['website', L('Website and web player')], ['overig', L('Other')]];
  };
  function when(iso) {
    var t = B.parseISO(iso);
    if (!t) return '';
    var d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
    if (t >= today.getTime()) return B.fmtTime(t);
    try { return d.toLocaleDateString(B.lang === 'zh-Hans' ? 'zh-CN' : B.lang, { day: 'numeric', month: 'short' }) + ' ' + B.fmtTime(t); } catch (e) { return d.toDateString(); }
  }
  /** Platte tekst met aanklikbare https-links (nooit HTML). */
  function linkify(text) {
    var out = [];
    String(text || '').split(/(https?:\/\/[^\s<>"']+)/).forEach(function (part, i) {
      if (!part) return;
      if (i % 2 === 1) {
        var url = part.replace(/[.,;:!?)]+$/, ''), rest = part.slice(url.length);
        out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url));
        if (rest) out.push(rest);
      } else out.push(part);
    });
    return out;
  }
  function backLink(href, label) { return h('a.st-back', { href: href }, [U.icon('chevron', 'st-back-ic'), label]); }

  /** Startdiagnose na een crash, of de app-diagnose; {kind, label}. */
  function diagChoice() {
    var crash = B.diag && B.diag.crashToOffer();
    return crash ? { kind: 'start', label: L('Send start diagnostics') } : { kind: 'app', label: L('Send diagnostics') };
  }
  /** Vinkje "Diagnose meesturen" met Bekijken. Geeft {el, on(), kind}. */
  function diagToggle(kind) {
    var ch = diagChoice();
    if (kind) ch = { kind: kind, label: kind === 'start' ? L('Send start diagnostics') : L('Send diagnostics') };
    var box = h('input', { type: 'checkbox', checked: true, id: 'sp-diag-' + Math.random().toString(36).slice(2) });
    var view = h('button.link-btn', { type: 'button' }, L('View'));
    view.addEventListener('click', function () { SP.showDiagnostics(ch.kind); });
    var el = h('div.sp-diag', [h('label.sp-check', [box, h('span', ch.label)]), view,
      h('p.muted.small', L('Only device, app and connection information. No email address, server names, addresses or titles.'))]);
    return { el: el, on: function () { return box.checked; }, kind: ch.kind };
  }
  /** Bijlage laten zien (JSON) vóór het versturen. */
  SP.showDiagnostics = function (kind) {
    var pre = h('pre.sp-json', L('Loading…'));
    U.modal({ title: kind === 'start' ? L('Start diagnostics') : L('Diagnostics'), body: pre, cls: 'sp-json-dlg', buttons: [{ label: L('Close') }] });
    B.diag.collect(kind).then(function (r) { pre.textContent = JSON.stringify(r.payload, null, 2); }, function () { pre.textContent = L('Something went wrong. Please try again.'); });
  };
  function withDiag(toggle) {
    if (!toggle || !toggle.on()) return Promise.resolve(null);
    return B.diag.collect(toggle.kind).then(function (r) { return r.payload; }, function () { return null; });
  }
  function basics(diag) {
    var b = { lang: B.lang === 'nl' ? 'nl' : 'en', device_id: A.deviceId() };
    if (!diag) { b.platform = B.isWindowsApp ? 'windows' : 'web'; b.app_version = A.appVersion(); }
    return b;
  }

  /** Niet ingelogd (kan in de webspeler eigenlijk niet): uitleg en de supportsite. */
  function signedOutView(box) {
    box.appendChild(h('div.state', [U.icon('help', 'state-ic'), h('h2', L('Support')),
      h('p.muted', L('Sign in to see your support tickets here. Without an account you can still ask a question on support.bingr.online.')),
      h('div.state-btns', [h('a.btn.primary', { href: SITE, target: '_blank', rel: 'noopener' }, [U.icon('link'), h('span', 'support.bingr.online')])])]));
  }

  /** Lijst met tickets in drie groepen. */
  function listView(box) {
    var head = h('div.sp-head', [
      h('p.muted.small', L('Questions or a problem? Send a ticket; we usually reply within a day. You get a notification and an email when we answer.')),
      h('a.btn.primary.small', { href: '#/support/new' }, [U.icon('plus'), h('span', L('New ticket'))])
    ]);
    box.appendChild(head);
    var crash = B.diag && B.diag.crashToOffer();
    if (crash) {
      box.appendChild(h('div.sp-crash', [U.icon('warn', 'sp-crash-ic'), h('div', [h('b', L('Bingr ran into a problem last time.')),
        h('p.muted.small', L('Send the start diagnostics so we can see what went wrong.'))]),
        h('div.sp-crash-btns', [h('a.btn.small.primary', { href: '#/support/new?kind=start' }, L('Send start diagnostics')),
          U.button(L('Not now'), function () { B.diag.crashOffered(); box._redraw(); }, { cls: 'small' })])]));
    }
    var listBox = h('div.sp-list');
    box.appendChild(listBox);
    function draw() {
      U.clear(listBox);
      var st = state;
      if (!st.items) {
        if (st.error) { listBox.appendChild(h('p.muted', st.error.message)); listBox.appendChild(U.button(L('Try again'), function () { SP.refresh(); }, { cls: 'small', icon: 'refresh' })); }
        else listBox.appendChild(h('div.trakt-wait', [U.spinner()]));
        return;
      }
      if (!st.items.length) { listBox.appendChild(h('p.muted.sp-empty', L('You have no support tickets yet.'))); return; }
      var S = STATUS();
      GROUPS().forEach(function (g) {
        var items = st.items.filter(function (t) { return t.group === g[0]; });
        var sec = h('section.st-sec', [h('h2.st-head', g[1] + ' (' + items.length + ')')]);
        if (!items.length) sec.appendChild(h('div.st-row.info', [h('span.st-label.muted', L('None'))]));
        items.forEach(function (t) {
          var a = h('a.st-row.sp-item' + (t.unread ? '.unread' : ''), { href: '#/support/ticket?n=' + encodeURIComponent(t.number) }, [
            t.unread ? h('span.sp-dot', { 'aria-label': L('Unread') }) : h('span.sp-dot.off'),
            h('span.st-label', [h('span', t.subject || ('#' + t.number)), h('span.st-sub', '#' + t.number + ' · ' + (S[t.status] || t.status) + ' · ' + when(t.last_reply_at || t.created_at))]),
            U.icon('chevron', 'st-chev')
          ]);
          sec.appendChild(a);
        });
        listBox.appendChild(sec);
      });
    }
    box._redraw = function () { U.clear(box); listView(box); };
    draw();
    var off = B.on('support', draw);
    SP.refresh();
    return off;
  }

  /** Eén ticket: gesprek, reageren, sluiten. */
  function ticketView(box, n) {
    var alive = true;
    box.appendChild(backLink('#/support', L('Support')));
    var body = h('div.sp-ticket', [h('div.trakt-wait', [U.spinner()])]);
    box.appendChild(body);
    function load() {
      SP.call('app_get', { number: n }).then(function (j) {
        if (!alive) return;
        draw(j);
        SP.refresh();
      }, function (e) {
        if (!alive) return;
        if (e.code === 'not_found') { U.toast(L('Ticket not found.')); U.router.go('/support', true); return; }
        U.clear(body);
        body.appendChild(h('p.muted', e.message));
        body.appendChild(U.button(L('Try again'), load, { cls: 'small', icon: 'refresh' }));
      });
    }
    function draw(j) {
      U.clear(body);
      var t = j.ticket || {}, S = STATUS();
      body.appendChild(h('div.sp-thead', [h('h2', t.subject || ''), h('div.muted.small', '#' + t.number + ' · ' + (S[t.status] || t.status) + ' · ' + when(t.created_at))]));
      if (t.status === 'pending') body.appendChild(h('div.sp-note', L('Awaiting your reply')));
      var msgs = h('div.sp-msgs');
      (j.messages || []).forEach(function (m) {
        if (m.author === 'event') {
          msgs.appendChild(h('div.sp-event', L('Status: %@', S[m.body] || m.body) + ' · ' + when(m.created_at)));
          return;
        }
        var mine = m.author === 'customer';
        msgs.appendChild(h('div.sp-msg' + (mine ? '.mine' : '.them'), [
          h('div.sp-who', (mine ? L('You') : 'Bingr Support') + ' · ' + when(m.created_at)),
          h('div.sp-text', linkify(m.body)),
          m.diagnostics ? h('div.sp-att', [U.icon('chart'), h('span', m.diagnostics.kind === 'start' ? L('Start diagnostics attached') : L('Diagnostics attached'))]) : null
        ]));
      });
      body.appendChild(msgs);
      if (!t.can_reply) {
        body.appendChild(h('div.sp-closed', [h('p.muted', L('This ticket is closed. Do you have another question? Create a new ticket.')),
          h('a.btn.primary.small', { href: '#/support/new' }, [U.icon('plus'), h('span', L('New ticket'))])]));
        return;
      }
      var ta = h('textarea.form-input.sp-ta', { rows: '4', maxlength: '5000', 'aria-label': L('Your reply'), placeholder: L('Your reply') });
      var toggle = diagToggle();
      var err = h('div.login-err', { role: 'alert' });
      var send = U.button(L('Send'), function () {
        var msg = ta.value.trim();
        if (!msg) { err.textContent = SP.errorText('message_missing'); return; }
        send.disabled = true; err.textContent = L('Sending…');
        withDiag(toggle).then(function (diag) {
          var b = { number: t.number, message: msg };
          if (diag) b.diagnostics = diag;
          return SP.call('app_reply', b);
        }).then(function () {
          if (toggle.on() && toggle.kind === 'start' && B.diag) B.diag.crashOffered();
          U.toast(L('Sent'));
          load();
        }, function (e) {
          send.disabled = false; err.textContent = e.message;
          if (e.code === 'closed') load();
        });
      }, { primary: true, icon: 'share' });
      var close = U.button(L('Close ticket'), function () {
        U.confirm(L('Close ticket'), L('Close this ticket? You can still read it, but no longer reply.'), L('Close ticket'), function () {
          SP.call('app_close', { number: t.number }).then(function () { U.toast(L('Ticket closed')); load(); }, function (e) { U.toast(e.message); });
        });
      }, { cls: 'small' });
      body.appendChild(h('div.sp-reply', [ta, toggle.el, err, h('div.dlg-buttons', [send, close])]));
    }
    load();
    return function () { alive = false; };
  }

  /** Nieuw ticket. opts: {kind: 'start'|'app', subject, message, category}. */
  function newView(box, opts) {
    opts = opts || {};
    box.appendChild(backLink('#/support', L('Support')));
    var subject = h('input.form-input', { type: 'text', maxlength: '120', autocomplete: 'off', 'aria-label': L('Subject') });
    subject.value = opts.subject || '';
    var cat = h('select.form-select', { 'aria-label': L('Category') }, SP.categories().map(function (c) { return h('option', { value: c[0] }, c[1]); }));
    cat.value = opts.category || 'website';
    var msg = h('textarea.form-input.sp-ta', { rows: '6', maxlength: '5000', 'aria-label': L('Message') });
    msg.value = opts.message || '';
    var toggle = diagToggle(opts.kind);
    var err = h('div.login-err', { role: 'alert' });
    var send = U.button(L('Send'), function () {
      err.textContent = '';
      var s = subject.value.trim(), m = msg.value.trim();
      if (s.length < 3) { err.textContent = SP.errorText('subject_missing'); subject.focus(); return; }
      if (m.length < 10) { err.textContent = SP.errorText('message_too_short'); msg.focus(); return; }
      send.disabled = true; err.textContent = L('Sending…');
      withDiag(toggle).then(function (diag) {
        var b = B.assign({ subject: s, message: m, category: cat.value }, basics(diag));
        if (diag) b.diagnostics = diag;
        return SP.call('app_create', b);
      }).then(function (j) {
        if (toggle.on() && toggle.kind === 'start' && B.diag) B.diag.crashOffered();
        U.toast(L('Sent as ticket #%@', j.number), 5000);
        SP.refresh();
        U.router.go('/support/ticket?n=' + encodeURIComponent(j.number), true);
      }, function (e) { send.disabled = false; err.textContent = e.message; });
    }, { primary: true, icon: 'share' });
    box.appendChild(h('div.form-dlg.sp-new', [
      h('h2', L('New ticket')),
      h('div.form-row', [h('label.form-label', L('Subject')), subject]),
      h('div.form-row', [h('label.form-label', L('Category')), cat]),
      h('div.form-row', [h('label.form-label', L('Message')), msg]),
      toggle.el, err,
      h('div.dlg-buttons', [send, h('a.btn', { href: '#/support' }, L('Cancel'))]),
      h('p.muted.small', L('Your name and email address come from your Bingr account. We reply by email and here in Bingr.'))
    ]));
    setTimeout(function () { if (!subject.value) subject.focus(); else msg.focus(); }, 40);
  }

  /** Support-tab tekenen in box; r = router-route. Geeft een opruimfunctie. */
  SP.render = function (box, r) {
    U.clear(box);
    if (!A.isSignedIn()) { signedOutView(box); return function () {}; }
    var sub = r && r.parts[0] === 'support' ? r.parts[1] : null;
    if (sub === 'ticket' && B.int(r.query.n)) return ticketView(box, B.int(r.query.n));
    if (sub === 'new') {
      var k = r.query.kind === 'start' ? 'start' : (r.query.kind === 'app' ? 'app' : null);
      newView(box, k === 'start' ? { kind: 'start', subject: L('Bingr ran into a problem'), category: 'website' } :
        k === 'app' ? { kind: 'app', subject: L('Diagnostics from the web player'), message: '', category: 'website' } : {});
      return function () {};
    }
    return listView(box);
  };

  // MARK: Diagnose-tab

  function fmtAgo(ms) {
    if (!ms) return L('Never');
    var min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return L('Just now');
    if (min < 60) return L('%d min ago', min);
    var hrs = Math.round(min / 60);
    if (hrs < 48) return L('%d hours ago', hrs);
    return L('%d days ago', Math.round(hrs / 24));
  }
  function infoRows(sec, rows) {
    rows.forEach(function (x) { sec.appendChild(h('div.st-row.info', [h('span.st-label', x[0]), h('span.st-value', x[1] == null ? '—' : String(x[1]))])); });
  }
  var CHECK = function (c, ms) {
    var t = { ok: L('OK'), slow: L('Slow'), fail: L('Not reachable'), skipped: L('Not checked'), unknown: '—' }[c] || '—';
    return ms != null && c !== 'skipped' ? t + ' (' + ms + ' ms)' : t;
  };
  SP.renderDiagnose = function (list) {
    var S = B.screens, G = B.diag;
    var sec = S.stSection(list, L('This device'));
    infoRows(sec, G.deviceRows());

    sec = S.stSection(list, L('Start diagnostics'), L('How Bingr started on this device: the steps with their time and memory use.'));
    if (G.prevIncomplete) sec.appendChild(h('div.st-row.info.sp-warn', [U.icon('warn', 'st-ic'), h('span.st-label', L('The previous start did not finish.'))]));
    G.milestones().forEach(function (m) {
      sec.appendChild(h('div.st-row.info', [h('span.st-label', m.name), h('span.st-value', (m.ms / 1000).toFixed(2) + ' s' + (m.mb != null ? ' · ' + m.mb + ' MB' : '') + (m.ok === false ? ' · ✕' : ''))]));
    });
    var c = G.crash();
    if (c) {
      var cr = h('div.st-row.info.sp-crashrow', [h('span.st-label', [h('span', L('Last error') + ': ' + c.type), h('span.st-sub', c.reason + ' · ' + when(c.at) + (c.build ? ' · build ' + c.build : ''))])]);
      sec.appendChild(cr);
      if (c.stack && c.stack.length) sec.appendChild(h('pre.sp-stack', c.stack.slice(0, 8).join('\n')));
    }

    sec = S.stSection(list, L('App diagnostics'), L('Servers, account sync, connection, storage and memory. No names, addresses or titles.'));
    var out = h('div.sp-appdiag');
    sec.appendChild(out);
    var last = null;
    function run() {
      U.clear(out);
      out.appendChild(h('div.trakt-wait', [U.spinner()]));
      G.collect('app').then(function (r) {
        last = r;
        U.clear(out);
        var p = r.payload, st = p.state || {}, net = st.network || {}, sto = st.storage || {}, mem = p.memory || {};
        var LOm = { ask: L('Ask'), always: L('Always'), never: L('Never, manually only') };
        var rows = [[L('Servers'), String(st.servers || 0) + (st.serverKinds && st.serverKinds.length ? ' · ' + st.serverKinds.join(', ') : '')]];
        r.extra.servers.forEach(function (s) {
          rows.push([L('Server %d', s.n) + (s.active ? ' (' + L('active') + ')' : ''), L('Updated') + ': ' + fmtAgo(s.at)]);
        });
        rows.push([L('Load servers on open'), LOm[r.extra.loadOnOpen] || '—']);
        rows.push([L('Last account sync'), st.lastSync ? when(st.lastSync) + ' · ' + (st.lastSyncOk ? L('OK') : L('Failed')) : L('Never')]);
        rows.push([L('Bingr server'), CHECK(net.backend, net.backendMs)]);
        rows.push([L('Your server'), CHECK(net.provider, net.providerMs)]);
        rows.push([L('Connection'), (net.online ? L('Online') : L('Offline')) + (net.type && net.type !== 'unknown' ? ' · ' + net.type : '')]);
        rows.push([L('Storage'), sto.usedMB != null ? sto.usedMB + ' MB' + (sto.freeMB != null ? ' · ' + L('%d MB free', sto.freeMB) : '') : '—']);
        rows.push([L('Memory'), mem.appMB != null ? mem.appMB + ' MB' + (mem.totalMB ? ' · ' + L('device %d MB', mem.totalMB) : '') : (mem.totalMB ? L('device %d MB', mem.totalMB) : '—')]);
        rows.push([L('Active profiles'), String(st.profiles || 0)]);
        rows.push([L('Library'), L('%d channels · %d movies · %d series', st.channels || 0, st.movies || 0, st.series || 0)]);
        infoRows(out, rows);
        out.appendChild(h('div.dlg-buttons.sp-diag-btns', [
          h('a.btn.primary.small', { href: '#/support/new?kind=app' }, [U.icon('share'), h('span', L('Send to support'))]),
          U.button(L('View'), function () { SP.showDiagnostics('app'); }, { cls: 'small' }),
          U.button(L('Run again'), run, { cls: 'small', icon: 'refresh' })
        ]));
      }, function () { U.clear(out); out.appendChild(h('p.muted', L('Something went wrong. Please try again.'))); });
    }
    out.appendChild(h('div.dlg-buttons', [U.button(L('Run diagnostics'), run, { primary: true, cls: 'small', icon: 'chart' })]));
    return function () { last = null; };
  };
})();
