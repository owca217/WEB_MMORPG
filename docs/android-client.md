# Klient Android

Klient jest pakowany przez Capacitor 8 z tego samego kodu Phaser co wersja przeglądarkowa. APK zawiera grafiki i kod interfejsu. Logowanie, postacie, doświadczenie, ekwipunek i rozgrywka korzystają z serwera `https://web-mmorpg-server.onrender.com` i istniejących kont. Gra wymaga internetu.

Wybór implementacyjny: pakiet Android z lokalnymi zasobami zapewnia wspólny rozwój gry i instalację z APK. Osobne przepisanie gry na silnik natywny powieliłoby kod; samo otwieranie strony w WebView uzależniałoby ekran startowy od pobrania całego klienta. Nie ustawiamy produkcyjnego `server.url` w konfiguracji Capacitor.

## Instalacja

Pobierz podpisany `WEB-MMORPG-0.1.1.apk` z wydania Android w repozytorium. Otwórz go na telefonie i, jeśli Android tego zażąda, zezwól tej aplikacji pobierającej plik na instalację. Zaloguj się na dotychczasowe konto gry. Aktualizacja z 0.1.0 używa tego samego podpisu i zachowuje dane aplikacji.

Wersja 0.1.1 zastępuje przycisk Ekwipunek czterema slotami na pojemniki w panelu gry. Kliknięcie slotu otwiera wybór własnego przedmiotu kategorii Pojemniki; przypisanie jest sprawdzane przez serwer i zapisane przy postaci.

Wymagania: Android 7 (API 24) lub nowszy oraz aktualny Android System WebView / Chrome (wersja co najmniej 111). Aplikacja działa w poziomie i wymaga wyłącznie uprawnienia do internetu. Przycisk Wstecz zamyka otwarty panel, a następnie minimalizuje grę.

Krótka wizyta w tle zachowuje działającą sesję. Po utracie połączenia klient ponownie uwierzytelnia konto i odtwarza świat. Serwer usuwa niedokończoną walkę przy rozłączeniu; zapisany postęp postaci pozostaje zachowany.

## Kompilacja

Wymagane: Node.js 22+, JDK 21, Android SDK platform 36 i build-tools 36.0.0. Zainstaluj zależności `npm ci`. Ustaw `JAVA_HOME` i `ANDROID_HOME` odpowiednio do swojego komputera.

Z katalogu repozytorium:

```powershell
npm run android:apk -w @web-mmorpg/client
```

Polecenie buduje osobny `apps/client/dist-android`, synchronizuje zasoby i pluginy, uruchamia Gradle oraz kopiuje debug APK i SHA-256 do `artifacts/android`. Nie nadpisuje przeglądarkowego `dist`. `npm run android:open -w @web-mmorpg/client` otwiera projekt w Android Studio.

Podpisane wydanie wymaga czterech zmiennych środowiskowych, których wartości należy przechowywać poza repozytorium:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

```powershell
npm run android:apk -w @web-mmorpg/client -- --release
```

Zachowaj kopię klucza podpisu: kolejne aktualizacje APK muszą być podpisane tym samym kluczem. Klucze i hasła nigdy nie są dołączane do APK ani Git. Podpisane wydanie nie zawiera możliwości zdalnego debugowania WebView.

Domyślny serwer HTTPS można zastąpić przez `ANDROID_GAME_SERVER_URL`. Skrypt odrzuca HTTP, adresy z hasłami, parametrami i ścieżką API. Osobny workflow **Android APK** buduje testowy debug APK; dystrybucja podpisanego wydania używa zachowanego klucza. Publikacja w Google Play wymaga osobnego konta wydawcy i konfiguracji sklepu.

## Weryfikacja

Testy obejmują ponowne uwierzytelnianie po utracie sieci, wyścig zapisu przy szybkim ponownym połączeniu, cykl życia aplikacji, dotykowe ataki i dopasowanie planszy do poziomego ekranu telefonu. Podpis APK należy sprawdzić narzędziem `apksigner verify`, a uruchomienie i ekran logowania na emulatorze lub telefonie.

Dokumentacja źródłowa: [Capacitor Android](https://capacitorjs.com/docs/android), [konfiguracja](https://capacitorjs.com/docs/config), [cykl życia App](https://capacitorjs.com/docs/apis/app).
