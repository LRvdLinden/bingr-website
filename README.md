# bingr.online

De website van **Bingr**, de IPTV-speler voor iPhone, iPad, Apple TV, Mac en Android. Statische HTML (Nederlands en Engels), zonder build-stap: `index.html`, `privacy.html` en `support.html`, met afbeeldingen in `assets/img/nl` en `assets/img/en`.

- App (iOS, iPadOS, tvOS, macOS): [LRvdLinden/iptv-ios-appletv](https://github.com/LRvdLinden/iptv-ios-appletv)
- Android: [LRvdLinden/bingr-android](https://github.com/LRvdLinden/bingr-android)

## Online zetten

De workflow **Website** uploadt de site via FTPS naar de webserver bij elke push naar `main` (of met de hand via *Actions → Website → Run workflow*). Nodig als repository-secrets (*Settings → Secrets and variables → Actions*): `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, en optioneel `FTP_USERNAME_ALT` en `FTP_DIR` (vaste doelmap; anders zoekt de workflow zelf `public_html`, `httpdocs`, `www` enz.). Wachtwoorden staan nooit in de repo.

## Covers en screenshots

De workflow **Covers** haalt elke maandag echte film- en serieposters op via TMDB (secret `TMDB_API_KEY`), maakt de screenshots opnieuw met de mockups uit de app-repo, werkt de site bij (screenshots, profielfiguurtjes, icoon, versienummer) en zet hem online.

Lokaal kan dat ook, met beide repo's naast elkaar:

```
python3 iptv-ios-appletv/tools/sync_website.py --site bingr-website [--zip Bingr-website.zip]
```
