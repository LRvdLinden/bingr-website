// Animaties op de homepage (build 169):
//  A1  hero: schuine wand van covers die eindeloos omhoog loopt, en de kop die woord voor woord omhoog komt
//  B   blokken (.rv) schuiven één keer in als ze in beeld komen, met een kleine vertraging per element (--r)
//  E   prijstabel (#plansTable): rijen schuiven in, vinkjes springen tevoorschijn; ook na een nieuwe opbouw door setLang
//  G   kaart "Verder kijken waar je was": draait mee met B (CSS op .reason.in .sync)
// Zonder JS of met "minder beweging" staat alles gewoon stil en zichtbaar. De stijl staat in index.html.
// Draait na het inline-script van index.html (setLang heeft de taal dan al gezet).
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('anim-ok'); // CSS-vangnet (show na 3 s) is niet meer nodig: dit script regelt het
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var hasIO = 'IntersectionObserver' in window;

  // ---------- A1: covers ----------
  // Verzonnen titels uit de App Store-generator (tools/make_covers.mjs); nooit echte posters.
  var IDS = ['noordlicht', 'haven', 'nachtrit', 'polder', 'stillestad', 'kustlijn', 'stationzero', 'archief', 'glas',
    'vuurlinie', 'diepzee', 'wolfsuur', 'zomer', 'dex', 'piraten', 'ekster', 'erfenis', 'kortsluiting'];
  var SPEED = 34; // px per seconde
  var PACE = [1, 0.86, 0.95, 0.8, 1.06, 0.9, 0.98]; // per kolom een iets andere snelheid
  var hero = document.querySelector('.hero');
  var wall = hero && hero.querySelector('.wall');
  var built = 0, builtCols = 0;

  function coverSrc(id) {
    var l = root.lang === 'en' ? 'en' : 'nl';
    return 'assets/img/covers/' + l + '/' + id + '.webp';
  }
  function buildWall() {
    if (!wall) return;
    // hoogte die een kolom moet vullen: de wand zelf (vóór de rotatie) plus de verschuiving van de kolom
    var probe = document.createElement('div'); probe.className = 'col'; wall.appendChild(probe);
    var cs = getComputedStyle(probe);
    var w = probe.getBoundingClientRect().width || 180, gap = parseFloat(cs.rowGap || cs.gap) || 18;
    wall.removeChild(probe);
    var step = w * 1.5 + gap;
    var need = Math.max(8, Math.ceil((wall.offsetHeight + 200) / step) + 1);
    // zoveel kolommen als de wand breed is (op een telefoon dus minder)
    var cols = Math.min(14, Math.ceil(wall.offsetWidth / (w + gap)) + 1);
    if (need <= built && cols <= builtCols) return;
    built = need; builtCols = cols;
    wall.textContent = '';
    for (var c = 0; c < cols; c++) {
      var col = document.createElement('div');
      col.className = 'col';
      col.style.setProperty('--t', Math.round(need * step / (SPEED * PACE[c % PACE.length])) + 's');
      var seq = [];
      for (var i = 0; i < need; i++) seq.push(IDS[(c * 7 + i * 5) % IDS.length]);
      seq.concat(seq).forEach(function (id, k) {
        var im = document.createElement('img');
        im.alt = ''; im.width = 300; im.height = 450; im.decoding = 'async';
        if (k >= need || c < cols / 2 - 1.5 || c > cols / 2 + 1.5) im.loading = 'lazy'; // de middelste kolommen meteen
        im.setAttribute('data-loc', '');
        im.src = coverSrc(id);
        col.appendChild(im);
      });
      wall.appendChild(col);
    }
  }
  buildWall();
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(buildWall, 300); }, { passive: true });
  // buiten beeld: de wand stilzetten
  if (hero && hasIO) new IntersectionObserver(function (es) {
    hero.classList.toggle('off', !es[0].isIntersecting);
  }).observe(hero);

  // ---------- A1: kop woord voor woord ----------
  var h1 = hero && hero.querySelector('h1');
  function split() {
    if (!h1 || h1.querySelector('.w') || h1.children.length) return; // alleen platte tekst
    var words = h1.textContent.trim().split(/\s+/);
    h1.textContent = '';
    words.forEach(function (wd, i) {
      var s = document.createElement('span');
      s.className = 'w'; s.style.setProperty('--d', i); s.textContent = wd;
      h1.appendChild(s);
      if (i < words.length - 1) h1.appendChild(document.createTextNode(' '));
    });
    h1.classList.add('split');
  }
  if (h1 && !reduce) {
    split();
    // na het inkomen niet opnieuw spelen; setLang zet de tekst terug als platte tekst, dan opnieuw opdelen (zonder animatie)
    setTimeout(function () { h1.classList.add('w-done'); }, 2200);
    if ('MutationObserver' in window) new MutationObserver(split).observe(h1, { childList: true });
  }

  // ---------- B, G en E: in beeld ----------
  var pending = [].slice.call(document.querySelectorAll('.rv'));
  var plans = document.getElementById('plansTable');

  function rowsIndex() {
    if (!plans) return;
    [].forEach.call(plans.querySelectorAll('tbody tr'), function (tr, i) { tr.style.setProperty('--r', i); });
  }
  var plansState = 'wait';
  function playPlans() {
    if (plansState !== 'wait') return;
    plansState = 'play';
    rowsIndex();
    plans.classList.remove('pl-wait');
    plans.classList.add('pl-play');
    var n = plans.querySelectorAll('tbody tr').length;
    setTimeout(function () { plansState = 'done'; plans.classList.remove('pl-play'); }, n * 70 + 1000);
  }

  function reveal(els) {
    els.forEach(function (el, i) {
      if (el.classList.contains('in')) return;
      el.style.setProperty('--r', Math.min(i, 6));
      el.classList.add('in');
    });
    pending = pending.filter(function (el) { return !el.classList.contains('in'); });
  }

  if (reduce || !hasIO) {
    reveal(pending);
    return;
  }

  if (plans) {
    plans.classList.add('pl-wait');
    // lifetime.js / setLang bouwen de tabel soms opnieuw op: tijdens het spelen de nieuwe rijen weer nummeren
    if ('MutationObserver' in window) new MutationObserver(function () { if (plansState === 'play') rowsIndex(); })
      .observe(plans, { childList: true });
  }

  var io = new IntersectionObserver(function (entries) {
    var batch = [];
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      if (e.target === plans) playPlans(); else batch.push(e.target);
    });
    if (batch.length) reveal(batch);
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  pending.forEach(function (el) { io.observe(el); });
  if (plans) io.observe(plans);

  // Vangnet: wat in (of boven) beeld staat en na 3 s nog niet zichtbaar is, gaat alsnog aan
  function inView(el) { return el.getBoundingClientRect().top < innerHeight; } // in beeld of al voorbij
  function sweep() {
    var now = Date.now(), late = [];
    pending.concat(plans && plansState === 'wait' ? [plans] : []).forEach(function (el) {
      if (!inView(el)) { el._seen = 0; return; }
      if (!el._seen) el._seen = now;
      else if (now - el._seen >= 3000) late.push(el);
    });
    late.forEach(function (el) { io.unobserve(el); if (el === plans) playPlans(); });
    late = late.filter(function (el) { return el !== plans; });
    if (late.length) reveal(late);
    if (!pending.length && (!plans || plansState !== 'wait')) clearInterval(timer);
  }
  var timer = setInterval(sweep, 1000);
  sweep();
})();
