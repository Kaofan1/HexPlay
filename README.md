# HexPlay Launcher

Własny launcher do serwera FiveM zbudowany w [Electron](https://www.electronjs.org/) + [React](https://reactjs.org/).

Projekt bazuje na otwartoźródłowym [bartosjiri/fivem-launcher](https://github.com/bartosjiri/fivem-launcher) (licencja MIT). Autor oryginału wycofał projekt z rozwoju, a poniższa wersja jest kontynuacją dostosowaną pod własny serwer.

## ⚠️ Zanim zaczniesz

FiveM w swoim regulaminie ogranicza zewnętrzne launchery i sposoby łączenia się z serwerami. Ten launcher **nie omija** żadnych zabezpieczeń: uruchamia lokalny `FiveM.exe` z parametrem `+connect <adres>` i pokazuje status serwera z publicznego endpointu. Przed publikacją/distrybucją launcherów wśród graczy sprawdź aktualny regulamin FiveM (https://fivem.net/terms). Odpowiedzialność za zgodność leży po stronie właściciela serwera.

## Funkcje

- **Wybór wielu serwerów**: lista z `servers.json`, przycisk „Join server” dla każdego z nich.
- **Status i gracze online**: odświeżanie co 20 s na podstawie `/info.json` i `/players.json` serwera.
- **Linki społeczności**: dowolna liczba przycisków (Discord, forum, Teamspeak itd.).
- **Tła multimedialne**: zdjęcia i filmy `.webm` z pokazem slajdów; pauza, gdy okno traci focus.
- **Automatyczne aktualizacje**: GitHub API + instalator NSIS.
- **Ustawienia**: wskazanie własnej ścieżki do `FiveM.exe`.

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
| `applications.json` | Przyciski linków: `label`, `url`, `icon` (`app/assets/icons/applications/`), `priority`, `enabled` (obecnie Discord i strona `hexplay.pl`) |
| `settings.json` | Domyślna ścieżka do `FiveM.exe` |

Przykład serwera:

```json
{
  "main": {
    "label": "HexPlay",
    "priority": 1,
    "address": "37.221.94.185:30176",
    "enabled": true
  }
}
```

> Panel graczy korzysta z publicznych endpointów serwera (`http://<adres>/info.json` i `/players.json`). Jeśli serwer ma `sv_endpointPrivacy = true` albo firewall blokuje te porty, launcher pokaże „Server is offline”.

## Branding i kolory

- **Logo**: podmień `app/assets/images/logo/logo-static.png` (używane w hero i preloaderze) oraz ikony w `resources/icons/` (ikona aplikacji i instalatora).
- **Kolory**: paleta z `panel-theme.css` w `app/styles/colors.scss`: `$brand-accent` (#7c5cff), `$brand-accent-2` (#00c2ff), `$brand-surface` (#070b14), `$brand-elevated` (#0b1220), `$brand-text` (#e9edf6), `$brand-muted`, `$brand-line`. Reszta odcieni liczy się z tych zmiennych.
- **Fonty**: launcher używa lokalnego Work Sans (offline). Panel używa Inter/Sora; jeśli chcesz je podmienić, dodaj pliki do `app/assets/fonts/` i zaktualizuj `app/styles/fonts.scss`.
- **Tytuł okna**: `app/app.html` (`<title>`).
- **Nazwa aplikacji / instalatora**: `productName` i `build.appId` w `package.json` oraz `app/package.json`.
- **Tła**: lista w `app/components/background/Background.js`, pliki z `app/assets/images/background/` i `app/assets/videos/background/`.

## Ustawienia launchera

W panelu ustawień (ikona koła zębatego) można zmienić lokalizację `FiveM.exe` oraz wyłączyć **animowane tło**. Po wyłączeniu launcher nie odtwarza wideo ani nie uruchamia animacji CSS, tylko pokazuje jedno statyczne zdjęcie, co zmniejsza obciążenie CPU i GPU na słabszych komputerach. Wybór jest zapisywany w konfiguracji użytkownika i obowiązuje po restarcie aplikacji.

## Aktualizacje

Launcher sprawdza najnowsze wydanie przez GitHub API (`/repos/Kaofan1/HexPlay/releases/latest`), porównuje tag z własną wersją i pobiera instalator bezpośrednio z release'u. Release zawiera **wyłącznie** `HexPlay-Launcher-Setup.exe`, bez `latest.yml` i bez plików `.blockmap`.

Przed uruchomieniem instalatora launcher weryfikuje rozmiar pliku oraz sumę SHA-256 z GitHub API, zamyka klienta FiveM (najpierw grzecznie, żeby gra zdążyła rozłączyć się z serwerem, a po chwili wymusza zamknięcie pozostałych procesów), a następnie uruchamia instalator w trybie cichym (`--updated /S --force-run`), który instaluje nową wersję i otwiera launcher ponownie.

Launcher sprawdza aktualizacje przy starcie, co minutę oraz po powrocie okna na pierwszy plan, więc nowa wersja pojawia się w **uruchomionej** aplikacji zwykle w ciągu minuty od publikacji, bez konieczności zamykania jej i otwierania ponownie. W nagłówku widać pasek postępu pobierania, a po pobraniu przycisk **Zainstaluj**. Zapytania są warunkowe (ETag), więc odpowiedzi 304 nie zużywają limitu API GitHuba.

### Wydanie nowej wersji jednym poleceniem

```bash
export GH_TOKEN=github_pat_...   # PowerShell: $env:GH_TOKEN = "github_pat_..."
yarn release patch              # 1.0.0 -> 1.0.1 (albo minor / major / 1.4.2)
```

Skrypt `internals/scripts/Release.js`:

1. podbija `version` w `package.json`, `app/package.json` i `app/package-lock.json`,
2. commituje `Release vX.Y.Z`, tworzy tag i wypycha oba na `origin/main`,
3. buduje (`yarn build`) i pakuje instalator NSIS przez `electron-builder --publish never`,
4. tworzy release przez GitHub API i wysyła tylko instalator NSIS,
5. publikuje release i sprawdza, że nie ma w nim `latest.yml` ani `.blockmap`.

Wymagania: gałąź `main`, czyste drzewo robocze, Windows oraz `GH_TOKEN` z **Contents: Read and write**. Push commita i taga korzysta z Twojego skonfigurowanego dostępu do gita (GCM/SSH). `GH_TOKEN` służy do publikacji release'u. Podgląd planu bez zmian: `yarn release patch --dry-run`.

Jeśli publikacja przerwie się po utworzeniu commita i taga (np. brak uprawnień tokenu albo błąd sieci), nie podbijaj wersji ponownie. Uruchom `yarn release --publish-only`, żeby przebudować instalator i opublikować release dla już istniejącego taga.

Publikowany jest sam instalator NSIS (to jego dotyczy auto-update). MSI zbudujesz ręcznie przez `yarn package-win`.

Ręcznie (bez skryptu) wystarczy jedno asset: `HexPlay-Launcher-Setup.exe`. Launcher nie potrzebuje plików metadanych w release, bo wersję i adres instalatora odczytuje z GitHub API.

Instalator NSIS (`release/HexPlay Launcher Setup.exe`) jest niepodpisany, więc Windows SmartScreen pokaże ostrzeżenie. Podpisanie wymaga certyfikatu code signing. Nazwa pliku jest stała (bez wersji); wersję klient odczytuje z tagu release'u i metadanych aplikacji.

> Launchery w wersjach 1.0.0-1.0.4 korzystały z `electron-updater` i wymagały `latest.yml` w release. Po przejściu na GitHub API trzeba je raz zaktualizować ręcznie do 1.0.5; od 1.0.5 aktualizacje działają automatycznie.

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

MIT. Kod źródłowy wywodzi się z projektu [bartosjiri/fivem-launcher](https://github.com/bartosjiri/fivem-launcher). Informacje o autorze oryginału pozostają w `package.json` i w ustawieniach aplikacji.
