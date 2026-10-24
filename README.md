# HexPlay Launcher

Własny launcher do serwera FiveM zbudowany w [Electron](https://www.electronjs.org/) + [React](https://reactjs.org/).

Projekt bazuje na otwartoźródłowym [bartosjiri/fivem-launcher](https://github.com/bartosjiri/fivem-launcher) (licencja MIT). Autor oryginału wycofał projekt z rozwoju — poniższa wersja jest kontynuacją dostosowaną pod własny serwer.

## ⚠️ Zanim zaczniesz

FiveM w swoim regulaminie ogranicza zewnętrzne launchery i sposoby łączenia się z serwerami. Ten launcher **nie omija** żadnych zabezpieczeń: uruchamia lokalny `FiveM.exe` z parametrem `+connect <adres>` i pokazuje status serwera z publicznego endpointu. Przed publikacją/distrybucją launcherów wśród graczy sprawdź aktualny regulamin FiveM (https://fivem.net/terms) — odpowiedzialność za zgodność leży po stronie właściciela serwera.

## Funkcje

- **Wybór wielu serwerów** — lista z `servers.json`, przycisk „Join server” dla każdego z nich.
- **Status i gracze online** — odświeżanie co 20 s na podstawie `/info.json` i `/players.json` serwera.
- **Linki społeczności** — dowolna liczba przycisków (Discord, forum, Teamspeak itd.).
- **Tła multimedialne** — zdjęcia i filmy `.webm` z pokazem slajdów; pauza, gdy okno traci focus.
- **Automatyczne aktualizacje** — `electron-updater` + GitHub Releases.
- **Ustawienia** — wskazanie własnej ścieżki do `FiveM.exe`.

## Wymagania

- Node.js 18+ (testowane na Node 24)
- Yarn 1.x (`corepack enable` albo `npm i -g yarn`)
- Zainstalowany klient FiveM

## Instalacja i uruchomienie

```bash
corepack enable       # jednorazowo, jeśli nie masz yarn
yarn install
yarn dev              # tryb developerski z hot reloadem
```

Build produkcyjny:

```bash
yarn build            # kompiluje main + renderer do app/
yarn package-win      # instaluje i pakuje do release/
```

## Konfiguracja

Wszystkie dane serwera i marki są w `app/configuration/`:

| Plik | Co ustawiasz |
| --- | --- |
| `branding.json` | `name` (nazwa w nagłówku), `tagline` (podtytuł), `title` (tytuł okna), `logo` (ścieżka do pliku), `website` |
| `servers.json` | Serwery: `label`, `address` (`ip:port`), `priority`, `enabled` |
| `applications.json` | Przyciski linków: `label`, `url`, `icon` (`app/assets/icons/applications/`), `priority`, `enabled` |
| `settings.json` | Domyślna ścieżka do `FiveM.exe` |

Przykład serwera:

```json
{
  "main": {
    "label": "HexPlay",
    "priority": 1,
    "address": "twoj-serwer.pl:30120",
    "enabled": true
  }
}
```

> Panel graczy korzysta z publicznych endpointów serwera (`http://<adres>/info.json` i `/players.json`). Jeśli serwer ma `sv_endpointPrivacy = true` albo firewall blokuje te porty, launcher pokaże „Server is offline”.

## Branding i kolory

- **Logo**: podmień `app/assets/images/logo/logo-static.png` (używane w hero i preloaderze) oraz ikony w `resources/icons/` (ikona aplikacji i instalatora).
- **Kolory**: paleta z `panel-theme.css` w `app/styles/colors.scss` — `$brand-accent` (#7c5cff), `$brand-accent-2` (#00c2ff), `$brand-surface` (#070b14), `$brand-elevated` (#0b1220), `$brand-text` (#e9edf6), `$brand-muted`, `$brand-line`. Reszta odcieni liczy się z tych zmiennych.
- **Fonty**: launcher używa lokalnego Work Sans (offline). Panel używa Inter/Sora — jeśli chcesz je podmienić, dodaj pliki do `app/assets/fonts/` i zaktualizuj `app/styles/fonts.scss`.
- **Tytuł okna**: `app/app.html` (`<title>`).
- **Nazwa aplikacji / instalatora**: `productName` i `build.appId` w `package.json` oraz `app/package.json`.
- **Tła**: lista w `app/components/background/Background.js` — pliki z `app/assets/images/background/` i `app/assets/videos/background/`.

## Aktualizacje

`electron-updater` pobiera wydania z GitHuba wskazanego w `package.json` → `build.publish`:

```json
"publish": [{ "provider": "github", "owner": "twoj-github", "repo": "hexplay-launcher" }]
```

Wydanie nowej wersji:

1. Podbij `version` w `package.json` **i** `app/package.json`.
2. Ustaw `GH_TOKEN` (token z zakresem `repo`).
3. `yarn package-win` i wrzuć artefakty z `release/` jako GitHub Release.

## Struktura

```
app/
  configuration/   # branding, serwery, linki, ścieżka FiveM
  components/      # hero, sidebar, server info, settings, updater
  store/           # Redux: serwery, aplikacje, ustawienia, sidebar
  utils/           # parsery konfiguracji, pobieranie statusu serwera
  styles/          # paleta kolorów i style globalne
configs/           # konfiguracja webpack (dev/prod, main/renderer)
internals/         # skrypty pomocnicze boilerplate'u
resources/         # ikony aplikacji i instalatora
```

## Licencja

MIT. Kod źródłowy wywodzi się z projektu [bartosjiri/fivem-launcher](https://github.com/bartosjiri/fivem-launcher) — informacje o autorze oryginału pozostają w `package.json` i w ustawieniach aplikacji.
