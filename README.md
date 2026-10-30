# bingr.online

De website van **Bingr**, de IPTV-speler met de look & feel van Netflix voor iPhone, iPad, Apple TV, Mac, Android, Android TV / Google TV / Fire TV, Windows en de browser. Samsung TV (Tizen) en LG-tv (webOS) worden niet meer ondersteund; /iptv-samsung-tv/ stuurt met een 301 door naar de homepage. De site is er in het Nederlands en het Engels.

- Apple-apps (iOS, iPadOS, tvOS, macOS): [LRvdLinden/iptv-ios-appletv](https://github.com/LRvdLinden/iptv-ios-appletv)
- Android en Android TV: [LRvdLinden/bingr-android](https://github.com/LRvdLinden/bingr-android)
- Wat er nieuw is per build: [bingr.online/changelog](https://bingr.online/changelog/)

## /web: Bingr in je browser

Op [bingr.online/web](https://bingr.online/web/) kijk je Bingr zonder iets te installeren, in Chrome, Safari, Edge of Firefox, op je computer, iPad of telefoon.

- **Inloggen**: op een telefoon met e-mail en wachtwoord; op een iPad of computer scan je de QR-code met de Bingr-app op je telefoon (of kies je *Inloggen met e-mail*). Ben je al ingelogd op bingr.online, dan ben je meteen binnen.
- **Alles uit je account**: je profielen ("Wie kijkt er?"), servers, Mijn lijst, voortgang, collecties en instellingen komen uit je Bingr-account en synchroniseren met je andere apparaten.
- **Netflix-look**: Home met billboard en rijen, Live TV met tv-gids, Films en Series met detailpagina's, seizoenen en afleveringen, Zoeken en Mijn Bingr.
- **Bronnen**: M3U, Xtream Codes, MAC-portal, Plex, Jellyfin, Emby en Stremio.
- **Formaten**: HLS (.m3u8), MP4/WebM en live MPEG-TS. Plex, Jellyfin en Emby zetten andere formaten zelf om.
- **Servers zonder CORS**: veel IPTV-servers staan geen browsers toe; Bingr haalt de lijst en streams dan op via een beveiligde doorgeefdienst, alleen voor de servers in je eigen account. Alleen https-servers en -streams werken in de browser.
- **Sneltoetsen**: spatie (afspelen/pauze), ← → (10 seconden), ↑ ↓ (volume of andere zender), F (volledig scherm), M (geluid), Esc (sluiten) en / (zoeken).
- **Pushmeldingen**: in Instellingen → App zet je *Pushmeldingen* aan (de browser vraagt pas dan om toestemming). Je krijgt berichten van Bingr en herinneringen uit de Bingr-app, ook met het tabblad dicht. Standaard Web Push (VAPID) via de service worker `web/sw.js` (scope `/web/`, alleen push, geen cache), contract in `docs/PUSH.md` van iptv-ios-appletv. Op iPhone en iPad alleen als Bingr als web-app op het beginscherm staat.
- De browser telt als apparaat en als scherm (limieten van het abonnement: Gratis 2 apparaten / 1 scherm, Lifetime 15 / 3; build 157).

## /koppelen: je tv koppelen

Op **Apple TV, Android TV, Google TV en Fire TV** toont Bingr bij het inloggen een QR-code en een code als `K7Q-4MX`. Op [bingr.online/koppelen](https://bingr.online/koppelen/) koppel je die tv aan je account:

1. Scan de QR-code met je telefoon (de code staat dan al ingevuld), of ga zelf naar bingr.online/koppelen en vul de code in.
2. Log in met je Bingr-account, of maak er hier een aan (ook *Wachtwoord vergeten?* kan hier).
3. Tik op **Koppelen**: de tv is meteen ingelogd.

Een verlopen of ongeldige code geeft een duidelijke melding; de tv toont dan vanzelf een nieuwe code. De oude link `bingr.online/tv` stuurt door naar /koppelen, zodat QR-codes van oudere apps blijven werken.

## Functies van de site

- **Home** ([bingr.online](https://bingr.online)): uitleg over Bingr, screenshots per apparaat en de downloadknoppen (App Store, Android-APK en Windows-installer; altijd de nieuwste versie).
- **Mijn Bingr** ([/account](https://bingr.online/account/)): je account op je computer: apparaten bekijken, hernoemen en verwijderen, wie er nu kijkt en de kijkgeschiedenis (hoofdprofiel), servers en collecties beheren.
- **Support**: staat op [support.bingr.online](https://support.bingr.online) (repo LRvdLinden/bingr-support), met de hulpartikelen (inloggen en koppelen, installeren en bijwerken op Android en Android TV / Google TV / Fire TV) en supporttickets. De oude `/support.html` stuurt door: een `Redirect 301` in `.htaccess` op de server (de workflow *Website* zet die regel erin) en als vangnet een kleine doorverwijspagina `support.html`.
- **Changelog** ([/changelog](https://bingr.online/changelog/)): wat er nieuw is per build, te filteren per platform.
- **Status** ([/status](https://bingr.online/status/)): of de diensten van Bingr werken: totaalbeeld, lopende storingen en gepland onderhoud met tijdlijn, onderdelen per groep met 90-dagenbalken, afgelopen incidenten (14 dagen), [geschiedenis](https://bingr.online/status/history/), detailpagina per melding, abonneren per e-mail en feeds (`/status/feed.atom`, `/status/feed.rss`, Engels: `feed.en.atom`/`feed.en.rss`, doorverwijzing via `.htaccess`).
- **Beveiligingsheaders en https**: de workflow *Website* zet bovenaan `.htaccess` op de server het blok `bingr-security`: http → https naar hetzelfde pad (pad uit de aanvraagregel, dus nooit meer `https://bingr.online/bingr.online/`), HSTS (`max-age=31536000`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (gevoelige pagina's houden hun eigen `no-referrer`-meta), `Permissions-Policy` (camera, microfoon en locatie uit) en tegen clickjacking `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`. Uitzondering: `/trailer/` (wordt bewust in een frame geladen door de Samsung TV-app). Een volledige CSP met `script-src` volgt als de inline scripts weg zijn. De controlestap van de workflow faalt als een header of de doorverwijzing niet live staat; stuurt https naar zichzelf door (server ziet https niet), dan zet hij `.htaccess` zonder de https-regel terug.
- **Wachtwoord opnieuw instellen** ([/reset](https://bingr.online/reset/)) en **afmelden voor e-mails** ([/unsubscribe](https://bingr.online/unsubscribe/)).
- **Links uit de accountmails** ([/bevestigen](https://bingr.online/bevestigen/)): e-mailadres bevestigen, wachtwoord vergeten, inloglink, uitnodiging en e-mailwijziging. Bevestigt pas na een klik (linkscanners maken de link zo niet op); bij wachtwoord vergeten gaat hij daarna door naar /reset.
- **Privacy** ([/privacy.html](https://bingr.online/privacy.html)) en cookie-instellingen.
- Overal Nederlands en Engels (volgt de taal van je browser, of kies zelf).
