<?php
// bingr.online/titel/?type=movie|tv&id=<tmdb-id>&q=<titel>&y=<jaar>: universele link naar een titel (nieuwsbrief en, vanaf
// build 132, de deelknoppen in alle apps). Is de app geïnstalleerd, dan opent die (apple-app-site-association / assetlinks.json,
// pad /titel/*); anders deze pagina.
// Build 132: server-side gerenderd, zodat WhatsApp, iMessage, Telegram, Facebook, X, Slack enz. een preview tonen (die voeren
// geen JavaScript uit): Open Graph- en Twitter-tags met titel (jaar), omschrijving en backdrop/poster. De gegevens komen uit de
// openbare Supabase-functie title-meta (iptv-ios-appletv, docs/NEWSLETTER.md "Deelpreview"); de TMDB-sleutel staat alleen
// daar. Korte timeout, 1 dag cache in een tmp-bestand; lukt het niet, dan de algemene Bingr-preview.
declare(strict_types=1);

const SITE = 'https://bingr.online';
const FALLBACK_IMG = SITE . '/assets/img/nl/tv_home.jpg';
const TTL_OK = 86400, TTL_FAIL = 600;

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function clean(string $s, int $max): string {
  $s = preg_replace('/[\x00-\x1f\x7f]+/u', ' ', $s) ?? '';
  $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
  return mb_substr($s, 0, $max, 'UTF-8');
}
function short(string $s, int $max): string {
  if (mb_strlen($s, 'UTF-8') <= $max) return $s;
  $cut = mb_substr($s, 0, $max, 'UTF-8');
  $sp = mb_strrpos($cut, ' ', 0, 'UTF-8');
  return rtrim(($sp !== false && $sp > $max * 0.6) ? mb_substr($cut, 0, $sp, 'UTF-8') : $cut, " ,.;:-") . '…';
}
function qs(array $p): string {
  $out = [];
  foreach ($p as $k => $v) if ($v !== '' && $v !== null) $out[] = $k . '=' . rawurlencode((string)$v);
  return implode('&', $out);
}

// --- invoer (zelfde regels als de apps en de webspeler) ---
$type = $_GET['type'] ?? '';
$type = is_string($type) && ($type === 'movie' || $type === 'tv') ? $type : '';
$id = $_GET['id'] ?? '';
$id = is_string($id) && preg_match('/^[1-9]\d{0,9}$/', $id) ? $id : '';
$q = isset($_GET['q']) && is_string($_GET['q']) ? clean($_GET['q'], 200) : '';
$y = isset($_GET['y']) && is_string($_GET['y']) && preg_match('/^(18|19|20|21)\d{2}$/', $_GET['y']) ? $_GET['y'] : '';
$valid = $type !== '' && ($id !== '' || $q !== '');

// taal van de server-side tekst (tags): ?lang=, anders Accept-Language, anders nl. De pagina wisselt zelf met site.js.
$ql = isset($_GET['lang']) && is_string($_GET['lang']) ? strtolower($_GET['lang']) : '';
$al = strtolower((string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''));
$lang = $ql === 'en' ? 'en' : ($ql === 'nl' ? 'nl' : (str_starts_with($al, 'en') ? 'en' : 'nl'));

// --- metadata ophalen (title-meta), met cache ---
function supabase_url(): string {
  $cfg = @file_get_contents(__DIR__ . '/../assets/config.js');
  if (is_string($cfg) && preg_match('#url:\s*"(https://[a-z0-9]+\.supabase\.co)"#', $cfg, $m)) return $m[1];
  return 'https://vjewsncmsxmhmhnoxwqx.supabase.co';
}
function http_get(string $url): ?string {
  if (function_exists('curl_init')) {
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_TIMEOUT => 3,
      CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => ['Accept: application/json'], CURLOPT_USERAGENT => 'bingr.online/titel']);
    $body = curl_exec($c);
    $code = (int)curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    curl_close($c);
    return is_string($body) && $code === 200 ? $body : null;
  }
  $ctx = stream_context_create(['http' => ['timeout' => 3, 'ignore_errors' => true, 'header' => "Accept: application/json\r\nUser-Agent: bingr.online/titel\r\n"]]);
  $body = @file_get_contents($url, false, $ctx);
  $st = isset($http_response_header[0]) ? $http_response_header[0] : '';
  return is_string($body) && preg_match('#^HTTP/\S+ 200#', $st) ? $body : null;
}
function img_ok($u): bool { return is_string($u) && preg_match('#^https://image\.tmdb\.org/t/p/w\d{2,4}/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$#', $u) === 1; }
function fetch_meta(string $type, string $id, string $q, string $y): ?array {
  $dir = rtrim(sys_get_temp_dir(), '/') . '/bingr-title-meta';
  $file = $dir . '/' . sha1("v1|$type|$id|" . mb_strtolower($q, 'UTF-8') . "|$y") . '.json';
  if (is_file($file)) {
    $c = json_decode((string)@file_get_contents($file), true);
    $age = time() - (int)@filemtime($file);
    if (is_array($c) && $age < (!empty($c['ok']) ? TTL_OK : TTL_FAIL)) return !empty($c['ok']) ? $c['m'] : null;
  }
  $body = http_get(supabase_url() . '/functions/v1/title-meta?' . qs(['type' => $type, 'id' => $id, 'q' => $q, 'y' => $y]));
  $m = $body !== null ? json_decode($body, true) : null;
  $ok = is_array($m) && ($m['ok'] ?? false) === true && ($m['type'] ?? '') === $type && is_int($m['id'] ?? null)
    && is_array($m['title'] ?? null) && is_string($m['title']['nl'] ?? null) && $m['title']['nl'] !== '';
  if ($ok) {
    $m = [
      'id' => $m['id'],
      'year' => is_int($m['year'] ?? null) ? $m['year'] : null,
      'title' => ['nl' => clean($m['title']['nl'], 200), 'en' => clean((string)($m['title']['en'] ?? $m['title']['nl']), 200)],
      'overview' => ['nl' => clean((string)($m['overview']['nl'] ?? ''), 2000), 'en' => clean((string)($m['overview']['en'] ?? ''), 2000)],
      'poster' => img_ok($m['poster'] ?? null) ? $m['poster'] : null,
      'backdrop' => img_ok($m['backdrop'] ?? null) ? $m['backdrop'] : null,
    ];
  }
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  if (is_dir($dir) && is_writable($dir)) {
    $tmp = @tempnam($dir, 'w');
    if ($tmp !== false && @file_put_contents($tmp, json_encode($ok ? ['ok' => true, 'm' => $m] : ['ok' => false])) !== false) @rename($tmp, $file);
    elseif ($tmp !== false) @unlink($tmp);
    // af en toe oude bestanden opruimen (ouder dan 2 dagen)
    if (mt_rand(1, 200) === 1) foreach (array_slice(glob($dir . '/*.json') ?: [], 0, 2000) as $f) if (time() - (int)@filemtime($f) > 2 * TTL_OK) @unlink($f);
  }
  return $ok ? $m : null;
}

$meta = $valid ? fetch_meta($type, $id, $q, $y) : null;

// --- teksten ---
$T = [
  'nl' => ['movie' => 'Film', 'tv' => 'Serie', 'openApp' => 'Open in Bingr', 'openWeb' => 'Kijk in je browser',
    'appHint' => 'Opent de app niet vanzelf?', 'appLink' => 'Gebruik deze link',
    'note' => 'Bingr levert zelf geen films of series: of deze titel bij jou te zien is, hangt af van je eigen IPTV-abonnement, afspeellijst of mediaserver.',
    'get' => 'Nog geen Bingr?', 'getSub' => 'Kijk meteen in je browser, doe mee met de bèta op iPhone, iPad, Apple TV en Mac, of download de testversie voor Android.',
    'tf' => 'Doe mee met de bèta via', 'apk' => 'Download de testversie', 'howto' => 'Zo installeer je Bingr',
    'desc' => 'Bekijk %s in Bingr, de IPTV-speler voor je eigen abonnement op iPhone, iPad, Apple TV, Mac, Android, Samsung TV en in je browser.',
    'genTitle' => 'Bingr: IPTV-speler voor je eigen abonnement',
    'genDesc' => 'Speel je eigen IPTV-abonnement af op iPhone, iPad, Apple TV, Mac, Android, Samsung TV en in je browser.',
    'badTitle' => 'Link onvolledig', 'badText' => 'Deze link mist gegevens. Open Bingr en zoek de titel zelf op.', 'poster' => 'Poster van %s'],
  'en' => ['movie' => 'Movie', 'tv' => 'Series', 'openApp' => 'Open in Bingr', 'openWeb' => 'Watch in your browser',
    'appHint' => "App didn't open?", 'appLink' => 'Use this link',
    'note' => "Bingr doesn't provide any movies or series itself: whether you can watch this title depends on your own IPTV subscription, playlist or media server.",
    'get' => "Don't have Bingr yet?", 'getSub' => 'Watch right away in your browser, join the beta on iPhone, iPad, Apple TV and Mac, or download the test version for Android.',
    'tf' => 'Join the beta on', 'apk' => 'Download the test version', 'howto' => 'How to install Bingr',
    'desc' => 'Watch %s in Bingr, the IPTV player for your own subscription on iPhone, iPad, Apple TV, Mac, Android, Samsung TV and in your browser.',
    'genTitle' => 'Bingr: IPTV player for your own subscription',
    'genDesc' => 'Play your own IPTV subscription on iPhone, iPad, Apple TV, Mac, Android, Samsung TV and in your browser.',
    'badTitle' => 'Incomplete link', 'badText' => 'This link is missing information. Open Bingr and search for the title yourself.', 'poster' => 'Poster of %s'],
];

$year = $meta['year'] ?? ($y !== '' ? (int)$y : null);
$name = ['nl' => $meta['title']['nl'] ?? $q, 'en' => $meta['title']['en'] ?? $q];
foreach (['nl', 'en'] as $l) if ($name[$l] === '') $name[$l] = $type !== '' ? $T[$l][$type] : 'Bingr';
$full = fn(string $l) => $name[$l] . ($year ? " ($year)" : '');
$over = ['nl' => $meta['overview']['nl'] ?? '', 'en' => $meta['overview']['en'] ?? ''];

// canonieke link: de gedeelde link zelf (type, id, titel, jaar), zonder lang
$canon = SITE . '/titel/' . ($valid ? '?' . qs(['type' => $type, 'id' => $id, 'q' => $q !== '' ? $q : ($meta['title']['en'] ?? ''), 'y' => $year ? (string)$year : '']) : '');
$tmdbId = $id !== '' ? $id : (isset($meta['id']) ? (string)$meta['id'] : '');
$app = 'bingr://title?' . qs(['type' => $type, 'id' => $tmdbId, 'q' => $q !== '' ? $q : ($meta['title']['nl'] ?? '')]);
$web = '../web/#/titel?' . qs(['type' => $type, 'id' => $tmdbId, 'q' => $q !== '' ? $q : ($meta['title']['nl'] ?? ''), 'y' => $year ? (string)$year : '']);

if ($valid) {
  $ogTitle = $full($lang);
  $ogDesc = $over[$lang] !== '' ? short($over[$lang], 200) : sprintf($T[$lang]['desc'], $full($lang));
} else {
  $ogTitle = $T[$lang]['genTitle'];
  $ogDesc = $T[$lang]['genDesc'];
}
$backdrop = $meta['backdrop'] ?? null;
$poster = $meta['poster'] ?? null;
if ($backdrop) { $img = $backdrop; $iw = 1280; $ih = 720; }
elseif ($poster) { $img = $poster; $iw = 780; $ih = 1170; }
else { $img = FALLBACK_IMG; $iw = 1400; $ih = 788; }
$ogType = !$meta ? 'website' : ($type === 'tv' ? 'video.tv_show' : 'video.movie');

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: public, max-age=300');
header('Vary: Accept-Language');
?><!doctype html>
<html lang="<?= $lang ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($valid ? $full($lang) . ' · Bingr' : 'Bingr') ?></title>
<meta name="robots" content="noindex,nofollow">
<meta name="description" content="<?= h($ogDesc) ?>">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#000000">
<meta property="og:site_name" content="Bingr">
<meta property="og:type" content="<?= $ogType ?>">
<meta property="og:title" content="<?= h($ogTitle) ?>">
<meta property="og:description" content="<?= h($ogDesc) ?>">
<meta property="og:url" content="<?= h($canon) ?>">
<meta property="og:image" content="<?= h($img) ?>">
<meta property="og:image:secure_url" content="<?= h($img) ?>">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="<?= $iw ?>">
<meta property="og:image:height" content="<?= $ih ?>">
<meta property="og:image:alt" content="<?= h($valid ? $full($lang) : 'Bingr') ?>">
<meta property="og:locale" content="<?= $lang === 'en' ? 'en_GB' : 'nl_NL' ?>">
<meta property="og:locale:alternate" content="<?= $lang === 'en' ? 'nl_NL' : 'en_GB' ?>">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?= h($ogTitle) ?>">
<meta name="twitter:description" content="<?= h($ogDesc) ?>">
<meta name="twitter:image" content="<?= h($img) ?>">
<meta name="twitter:image:alt" content="<?= h($valid ? $full($lang) : 'Bingr') ?>">
<link rel="canonical" href="<?= h($canon) ?>">
<link rel="icon" href="../favicon.png">
<link rel="apple-touch-icon" href="../apple-touch-icon.png">
<link rel="stylesheet" href="../assets/css/site.css?v=95">
<style>
/* titelpagina (build 132): grote backdrop, poster, titel en knoppen; gedeelde stijl staat in assets/css/site.css */
.tl-page main{padding:0;min-height:0}
.tl-hero{position:relative;min-height:min(78vh,760px);display:flex;align-items:flex-end;padding:140px 0 56px;overflow:hidden;background:#000}
.tl-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 20%;opacity:.62}
.tl-hero::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,#000 2%,#000000c0 34%,#00000040 70%,#000000a0 100%),linear-gradient(90deg,#000000d0 0,#00000000 70%)}
.tl-hero .wrap{position:relative;z-index:1;display:flex;gap:40px;align-items:flex-end;width:100%}
.tl-poster{flex:none;width:clamp(150px,20vw,250px);aspect-ratio:2/3;border-radius:12px;object-fit:cover;background:var(--s2);box-shadow:0 24px 60px #000c,0 0 0 1px #ffffff1a}
.tl-info{min-width:0;max-width:720px}
.tl-kind{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--sec);font-size:15px;font-weight:700;letter-spacing:.02em}
.tl-kind .pill{padding:4px 11px;border-radius:999px;background:var(--red);color:#fff;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
.tl-info h1{font-size:clamp(34px,5.4vw,64px);font-weight:900;letter-spacing:-.035em;line-height:1.02;margin-top:12px;overflow-wrap:anywhere}
.tl-info .ov{color:#e2e2e2;font-size:17px;line-height:1.6;margin-top:16px;max-width:64ch;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
.tl-acts{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}
.tl-acts .btn svg{width:22px;height:22px}
.tl-fb{color:var(--sec);font-size:14px;margin-top:14px}
.tl-fb a{color:#fff}
.tl-body{padding:20px 0 90px}
.tl-note{color:var(--sec);font-size:14px;max-width:72ch}
.tl-get{margin-top:34px;padding:28px;border-radius:16px;background:var(--s1);border:1px solid var(--line)}
.tl-get h2{font-size:24px;font-weight:800;letter-spacing:-.02em}
.tl-get p{color:var(--sec);font-size:15px;margin-top:6px;max-width:68ch}
.tl-get .row{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px;align-items:center}
.tl-get .howto{color:var(--sec);font-size:14px;margin-top:16px}.tl-get .howto a{color:#fff}
.tf-badge{display:inline-flex;align-items:center;gap:12px;padding:8px 18px 8px 12px;border-radius:12px;background:#000;color:#fff;text-decoration:none;box-shadow:inset 0 0 0 1.5px #ffffffcc;transition:box-shadow .15s,background .15s}
.tf-badge:hover{background:#141414;box-shadow:inset 0 0 0 1.5px #fff}
.tf-badge:focus-visible{outline:2px solid var(--red);outline-offset:3px}
.tf-badge svg{width:34px;height:34px;flex:none;padding:6px;border-radius:9px;background:var(--red);color:#fff}
.tf-badge span{display:flex;flex-direction:column;line-height:1.1}
.tf-badge small{font-size:12px;font-weight:600;letter-spacing:.01em}
.tf-badge b{font-size:22px;font-weight:800;letter-spacing:-.02em}
.tl-bad{padding:150px 0 90px}
@media (max-width:760px){
  .tl-hero{min-height:0;padding:96px 0 32px}
  .tl-hero .wrap{flex-direction:column;align-items:flex-start;gap:22px}
  .tl-poster{width:132px}
  .tl-bg{opacity:.5;object-position:center top}
  .tl-acts .btn{flex:1 1 100%}
  .tl-get{padding:22px 18px}
}
</style>
</head>
<body class="sub-page tl-page">
<nav id="nav" aria-label="Hoofdmenu">
  <div class="wrap">
    <a href="../" class="logo" aria-label="Bingr">BINGR</a>
    <div class="links">
      <a href="../#features" data-s="nav.features">Functies</a>
      <a href="../#start" data-s="nav.start">Wat heb je nodig</a>
      <a href="../#download" data-s="nav.platforms">Apparaten</a>
      <a href="../#faq">FAQ</a>
      <a href="https://support.bingr.online">Support</a>
    </div>
    <div class="right">
      <div class="lang" role="group" aria-label="Language"><button type="button" data-lang="nl">NL</button><button type="button" data-lang="en">EN</button></div>
    </div>
  </div>
</nav>
<?php if (!$valid): ?>
<main class="tl-bad"><div class="wrap"><div class="panel authcard titel done">
  <div class="big" aria-hidden="true">!</div>
  <?php foreach (['nl', 'en'] as $l): ?><div data-l="<?= $l ?>"<?= $l !== $lang ? ' hidden' : '' ?>>
    <h1><?= h($T[$l]['badTitle']) ?></h1><p><?= h($T[$l]['badText']) ?></p>
    <a class="btn red full" href="../web/"><?= h($T[$l]['openWeb']) ?></a>
  </div><?php endforeach; ?>
</div></div></main>
<?php else: ?>
<main>
<section class="tl-hero">
  <?php if ($backdrop || $poster): ?><img class="tl-bg" src="<?= h($backdrop ?? $poster) ?>" alt="" decoding="async" fetchpriority="high"><?php endif; ?>
  <div class="wrap">
    <?php if ($poster): ?><img class="tl-poster" src="<?= h($poster) ?>" alt="<?= h(sprintf($T[$lang]['poster'], $name[$lang])) ?>" width="780" height="1170" decoding="async"><?php endif; ?>
    <div class="tl-info">
    <?php foreach (['nl', 'en'] as $l): ?><div data-l="<?= $l ?>"<?= $l !== $lang ? ' hidden' : '' ?>>
      <p class="tl-kind"><span class="pill"><?= h($T[$l][$type]) ?></span><?php if ($year): ?><span><?= $year ?></span><?php endif; ?></p>
      <h1><?= h($name[$l]) ?></h1>
      <?php if ($over[$l] !== ''): ?><p class="ov"><?= h($over[$l]) ?></p><?php endif; ?>
      <div class="tl-acts">
        <a class="btn red tl-app" href="<?= h($app) ?>"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5z"/></svg><?= h($T[$l]['openApp']) ?></a>
        <a class="btn ghost" href="<?= h($web) ?>"><?= h($T[$l]['openWeb']) ?></a>
      </div>
      <p class="tl-fb"><?= h($T[$l]['appHint']) ?> <a href="<?= h($app) ?>"><?= h($T[$l]['appLink']) ?></a></p>
    </div><?php endforeach; ?>
    </div>
  </div>
</section>
<section class="tl-body"><div class="wrap">
  <?php foreach (['nl', 'en'] as $l): ?><div data-l="<?= $l ?>"<?= $l !== $lang ? ' hidden' : '' ?>>
    <p class="tl-note"><?= h($T[$l]['note']) ?></p>
    <div class="tl-get">
      <h2><?= h($T[$l]['get']) ?></h2>
      <p><?= h($T[$l]['getSub']) ?></p>
      <div class="row">
        <a class="tf-badge" href="https://testflight.apple.com/join/JW915fdA" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3"/><path d="M7.2 14h9.6"/></svg><span><small><?= h($T[$l]['tf']) ?></small><b>TestFlight</b></span></a>
        <a class="tf-badge" href="https://beheer.bingr.online/dl.php?app=android" rel="nofollow noopener" download><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg><span><small><?= h($T[$l]['apk']) ?></small><b>APK</b></span></a>
        <a class="btn ghost sm" href="<?= h($web) ?>"><?= h($T[$l]['openWeb']) ?></a>
      </div>
      <p class="howto"><a href="https://support.bingr.online/hulp/installeren/"><?= h($T[$l]['howto']) ?></a></p>
    </div>
  </div><?php endforeach; ?>
</div></section>
</main>
<?php endif; ?>
<footer>
  <div class="wrap">
    <div class="top">
      <div><a href="../" class="logo">BINGR</a><div style="margin-top:12px" data-s="foot.tag">IPTV zoals het hoort.</div></div>
      <div class="flinks">
        <a href="../#faq">FAQ</a>
        <a href="https://support.bingr.online">Support</a>
        <a href="../koppelen/" data-s="foot.pair">Tv koppelen</a>
        <a href="../account/" data-s="foot.account">Mijn Bingr</a>
        <a href="../web/" data-s="foot.web">Webspeler</a>
        <a href="../changelog/">Changelog</a>
        <a href="../status/">Status</a>
        <a href="/presskit">PressKit</a>
        <a href="../iptv-app/" data-s="foot.iptvapp">IPTV-app voor Apple</a>
        <a href="../iptv-samsung-tv/" data-s="foot.samsung">IPTV op Samsung TV</a>
        <a href="../m3u-xtream-toevoegen/" data-s="foot.m3u">M3U of Xtream toevoegen</a>
        <a href="../vergelijking/" data-s="foot.compare">Bingr vs. Smarters en TiviMate</a>
        <a href="../privacy.html" data-s="foot.privacy">Privacy</a>
        <a href="../voorwaarden/" data-s="foot.terms">Voorwaarden</a>
        <a href="#" data-consent-link onclick="BingrConsent.open();return false" data-s="foot.cookies">Cookie-instellingen</a>
      </div>
    </div>
    <p class="disc" data-s="foot.disc">Bingr is een mediaspeler en levert, verkoopt of host geen zenders, films of series. Je bent zelf verantwoordelijk voor de content die je afspeelt en het recht om die te bekijken. Apple, iPhone, iPad, Apple TV, Mac en AirPlay zijn handelsmerken van Apple Inc. Android, Google TV en Android TV zijn handelsmerken van Google LLC, Fire TV van Amazon.com, Inc. en Samsung en Tizen van Samsung Electronics Co., Ltd.</p>
    <p class="disc tmdb" data-s="foot.tmdb">Film- en seriegegevens en afbeeldingen: <a href="https://www.themoviedb.org" rel="noopener">TMDB</a>. Dit product gebruikt de TMDB API maar is niet goedgekeurd of gecertificeerd door TMDB.</p>
    <p class="copy">© <span id="yr">2026</span> Bingr, <span data-s="foot.version">versie</span> <span data-build></span></p>
  </div>
</footer>
<script src="../assets/js/site.js?v=111" data-base="../"></script>
<script>
// titel en lege afbeeldingen in de gekozen taal (site.js wisselt de data-l-blokken)
(function () {
  var T = <?= json_encode($valid ? ['nl' => $full('nl') . ' · Bingr', 'en' => $full('en') . ' · Bingr'] : ['nl' => 'Bingr', 'en' => 'Bingr'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
  var l = window.BingrSite && BingrSite.lang === "en" ? "en" : "nl";
  document.title = T[l];
  document.querySelectorAll("img.tl-bg, img.tl-poster").forEach(function (im) { im.addEventListener("error", function () { im.remove(); }); });
})();
</script>
</body>
</html>
