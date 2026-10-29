# Klient Android

Klient jest pakowany przez Capacitor 8 z tego samego kodu Phaser co wersja przeglądarkowa. APK zawiera grafiki i kod interfejsu. Logowanie, postacie, doświadczenie, ekwipunek i rozgrywka korzystają z serwera `https://web-mmorpg-server.onrender.com` i istniejących kont. Gra wymaga internetu.

Wybór implementacyjny: pakiet Android z lokalnymi zasobami zapewnia wspólny rozwój gry i instalację z APK. Osobne przepisanie gry na silnik natywny powieliłoby kod; samo otwieranie strony w WebView uzależniałoby ekran startowy od pobrania całego klienta. Nie ustawiamy produkcyjnego `server.url` w konfiguracji Capacitor.

## Instalacja

Pobierz podpisany `WEB-MMORPG-0.1.7.apk` z wydania Android w repozytorium. Otwórz go na telefonie i, jeśli Android tego zażąda, zezwól tej aplikacji pobierającej plik na instalację. Zaloguj się na dotychczasowe konto gry. Aktualizacja z poprzednich wersji używa tego samego podpisu i zachowuje dane aplikacji.

Wersja 0.1.1 zastępuje przycisk Ekwipunek czterema slotami na pojemniki w panelu gry. Kliknięcie slotu otwiera wybór własnego przedmiotu kategorii Pojemniki; przypisanie jest sprawdzane przez serwer i zapisane przy postaci.

Wersja 0.1.2 dodaje do katalogu pojemnik „Szmaciany worek” z 8 miejscami. Kliknięcie wyposażonego worka otwiera jego zawartość; cały stos zajmuje jedno miejsce. Puste sloty panelu mają czarne tło i wyblakłą ikonę plecaka. Na telefonie przycisk w nagłówku zwija panel gry do jednej ikony; ponowne dotknięcie go rozwija.

Wersja 0.1.3 dodaje izometryczną planszę walki po prawej i szczegóły własnej postaci po lewej. Dotknięcie przeciwnika wybiera cel i pokazuje dopasowany atak, szansę trafienia i obrażenia po pancerzu; przycisk podglądu potwierdza atak. Zielone pola pokazują aktualny zasięg ruchu z uwzględnieniem AP, przeszkód i urazów. W panelu można użyć przedmiotów użytkowych z ekwipunku, także z pojemników, za 2 AP. Podstawowy bandaż leczy 30 HP. Obecne poprawne ataki zawsze trafiają, dlatego podgląd pokazuje 100%; cel poza zasięgiem lub za przeszkodą jest niedostępny.

Wersja 0.1.4 dodaje ikonę czatu w prawym dolnym rogu świata i walki. Zakładka „W pobliżu” obejmuje postacie w widocznym obszarze kamery i pokazuje sześciusekundowe dymki nad nadawcą; podczas walki korzystaj z zakładki „Ogólny”. Czat ogólny łączy wszystkich graczy online niezależnie od miejsca. Serwer przechowuje ostatnie 50 wiadomości ogólnych do restartu, a klient do 100 wiadomości na kanał w bieżącej sesji. Wiadomość ma limit 300 znaków. Pisanie zatrzymuje sterowanie postacią; Enter wysyła, Escape lub Wstecz zamyka okno. Widok dopasowuje się do rozmiaru ekranu i klawiatury.

Wersja 0.1.5 dodaje panel „Społeczność” obok ikony czatu. Drużyna mieści do 5 osób; zwycięzca walki otrzymuje +10% XP za każdego dodatkowego członka online w tej samej lokacji i zasięgu 800, maksymalnie +40%. Członek musi należeć do drużyny na początku i końcu walki. Spotkania nadal rozgrywa się indywidualnie. Lista znajomych i zaproszenia są zapisywane w bazie, wraz z możliwością akceptacji, odrzucenia, anulowania i usunięcia znajomości. Handel przedmiotami wymaga bliskości (160), braku walki i potwierdzenia tej samej oferty przez obie strony. Zmiana oferty zeruje potwierdzenia. Całe przedmioty i części stosów są przekazywane w jednej transakcji; pojemniki muszą być puste i zdjęte ze slotu. Rozłączenie, walka, odległość lub upływ czasu anulują trwające zaproszenie/wymianę. Drużyny i otwarte wymiany są sesjami na żywo.

Wersja 0.1.6 dodaje osobne skórki pixel art dla Borana, Ady i kupca Miro. Miro stoi przy placu osady, blisko miejsca startu. Podejdź i dotknij go, aby otworzyć sklep: bandaż (5 złota, 30 HP), Szmaciany worek (30 złota, 8 miejsc), mała mikstura leczenia (10 złota, 50 HP) i Tonik wigoru (12 złota, 3 PA). Przedmioty użytkowe działają w walce według obecnych zasad. Każda postać otrzymuje jednorazowo 100 złota, również postacie utworzone przed aktualizacją; zwycięstwo nad wilkami daje 15 złota. Stan portfela zapisuje się oddzielnie od pozycji i statystyk. Zakup wymaga obecności przy kupcu poza walką; złoto i przedmioty zapisują się w jednej transakcji. Ponowienie niepotwierdzonego zakupu używa tego samego identyfikatora i nie pobiera opłaty ponownie. Złoto jest widoczne w panelu gry i sklepie.

Wersja 0.1.7 odświeża teren i roślinność Zielonego Brzegu. Trawa, ziemna droga i leśne podłoże otrzymują tekstury pixel art; drzewa liściaste, sosny, krzewy i niskie rośliny korzystają z osobnych grafik z przezroczystością. Podłoże powtarza małe tekstury, a roślinność pozostawia wolne przejścia, NPC i miejsce spotkania z wilkami. Zasoby są zawarte w APK i wczytywane razem z lokacją; przy niedostępnym obrazie pozostaje widoczny prosty odpowiednik.

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
