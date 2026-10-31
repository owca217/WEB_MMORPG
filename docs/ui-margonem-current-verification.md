# Aktualny podgląd interfejsu — 31 października 2026

Podgląd został zastąpiony interfejsem inspirowanym Margonem na aktualnej bazie `7f2b12bd67d650fae474344c98af696485d3452f`, zgodnej w chwili rozpoczęcia integracji z `origin/feature/mvp-vertical-slice` (wersja Android0.1.24). Wcześniejsza wersja UI powstała na starszej gałęzi; jej wyniki nie stanowią weryfikacji bieżących funkcji.

## Uruchomiona wersja

- Źródła: `C:/Users/kgkg1/.codex/worktrees/margonem-current/WEB_MMORPG`.
- Podgląd: `http://127.0.0.1:5174/WEB_MMORPG/`, serwer lokalny3002.
- Zachowano bazę podglądu i konto `owca` / postać `yuna` / uprawnienia `ADMIN`. Przed aktualizacją wykonano kopię bazy; następnie bieżący serwer zastosował migracje009–013. Nie zmieniano hasła ani danych postaci.
- Oryginalny katalog z wcześniejszym UI i osobny checkout bieżących funkcji pozostały zachowane.
- Nie wdrożono zmian na oficjalną stronę ani nie wykonano push.

## Weryfikacja

- Pełny zestaw klienta:47 plików /307 testów, `npm run test -w @web-mmorpg/client -- --maxWorkers=2`.
- Późniejsza regresja pomiaru wysokości paska walki:16 testów BattleHud przeszło. Zmiany czysto wizualne zweryfikowano w przeglądarce i końcowych buildach.
- Końcowy `npm run build -w @web-mmorpg/client`: powodzenie.
- Końcowy `npm run android:apk -w @web-mmorpg/client`: powodzenie; podpis APK sprawdzony przez apksigner.
- Niezależny przegląd zachowania aktualnych kontraktów: naprawiono warstwę panelu leczenia zasłanianą przez nowy pasek boczny. Brak dalszych zgłoszonych usterek.
- Kod serwera, pakiet shared, migracje i protokoły pozostają bez zmian w tej integracji. Nie uruchamiano testów resetujących bazę; nie były potrzebne dla zmian prezentacji.

W przeglądarce sprawdzono:

- przejście Osada Leśna → Las Wschodni → Osada Leśna i ruch przez bieżące portale;
- kartę postaci, Władanie, Uzbrojenie, zakładanie miecza/tarczy i zamianę na dwuręczny kostur;
- stały16-slotowy plecak, oczekujące przedmioty, szczegóły i ramki jakości;
- leczenie na mapie64→92HP oraz w walce92→100HP, z kosztem AP i blokadą kolejnego użycia w turze;
- wybór przeciwnika na planszy, dopasowanie/powiększenie, przejęcie przez Auto, zakończenie walki, powrót do świata, XP i nagrody w plecaku;
- układy1280×720,390×844 i844×390, czat ponad rozszerzonym paskiem leczenia w walce;
- mobilny panel wyposażenia po korekcie szerokości:scrollWidth=clientWidth354; brak poziomego przewijania;
- brak przechwyconych błędów konsoli podczas końcowych kontroli.

Testy natywnego przycisku Wstecz obejmują kolejność zamykania szczegółów przedmiotu/plecaka, warstwy czatu/społeczności i rozwijany interfejs. Admin granty/edytor kategorii i walka drużynowa zostały zachowane oraz sprawdzone w aktualnych testach i przeglądzie kodu; nie wykonywano ręcznego nadawania przedmiotów na koncie owca ani sesji z wieloma graczami. Nie testowano APK na fizycznym urządzeniu lub emulatorze.

## Pliki

- `artifacts/ui/current-eastern-forest.jpg` — druga lokacja;
- `artifacts/ui/current-phone.jpg` — świat na telefonie;
- `artifacts/ui/current-healing-desktop.jpg` — poprawiony panel leczenia;
- `artifacts/ui/current-battle-desktop.jpg`, `current-battle-phone.jpg` — aktualna walka;
- `artifacts/android/WEB-MMORPG-0.1.24-debug.apk` — aktualny klient Android z nowym UI, podpis debug, domyślny oficjalny serwer HTTPS;
- SHA256: `75bc6b1a7e3b81fe8c20673bb56584907f90d5f8d5c7106166642d0949504502`.

Automatyczne mutacje testowe dotyczyły wyłącznie lokalnego konta `ui_preview_mvvlc7hs`. Po weryfikacji wylogowano konto testowe i pozostawiono ekran logowania; przywrócono domyślny rozmiar przeglądarki.

## Uproszczenie dostępu do plecaka

Na prośbę autora usunięto przycisk „Przedmioty” z dolnego menu i „Otwórz pojemnik” spod podglądu zawartości. Zachowano slot stałego plecaka, dostęp do oczekujących przedmiotów i skrót I. Istniejące testy zaktualizowano do tych wejść.

`npm run test -w @web-mmorpg/client -- tests/worldHud.test.ts tests/worldSceneProgression.test.ts --maxWorkers=2`:23 testy przeszły. Podgląd potwierdzony na zalogowanej postaci yuna, bez zmiany jej danych; screenshot:`artifacts/ui/current-simplified-backpack.jpg`. APK przebudowane z tą zmianą, kontrola TypeScript i podpisu zakończona powodzeniem; powyższy SHA256 dotyczy tej wersji.

## Komentarze z podglądu — sloty, nagłówek i czat

Usunięto „4 sloty”, a nazwę postaci przeniesiono w miejsce „Twój bohater”. Wprowadzono wspólne `--rpg-slot-size:29px` i `--rpg-slot-gap:2px` w `ui/itemSlots.css`: sloty toreb, zawartości/pending i ikony wyposażenia korzystają z tego rozmiaru, a zwykłe przyciski zachowują swoją wielkość. Przy otwieraniu czatu mały ekran lub główny wskaźnik dotykowy otrzymuje fokus zakładki kanału; pole wiadomości aktywuje się dopiero po wybraniu go przez gracza. Komputer zachowuje autofocus tekstu.

- Bieżące testy:9 WorldHud i15 testów czatu przeszło. Przypadki obejmują telefon pionowo, telefon poziomo, duży ekran dotykowy, zachowanie wersji desktopowej, jawne wybranie pola i powrót fokusu.
- Przeglądarka: sloty HUD i okna plecaka mają zmierzone29×29px; telefon844×390 po otwarciu czatu ma aktywny `BUTTON[role=tab]`, a `inputFocused=false`. Bez wysyłania wiadomości i bez zmiany danych postaci. Przywrócono domyślny viewport i zamknięty czat.
- Screenshoty:`artifacts/ui/current-small-slots.jpg`, `current-mobile-chat-no-focus.jpg`.
- Bieżący APK przebudowano z poprawkami; TypeScript i podpis przeszły. Nadal brak testu klawiatury systemowej na fizycznym urządzeniu.

## Standard36px

Na prośbę autora wspólny rozmiar slotów zmieniono na36×36px. APK przebudowano poleceniem `npm run android:apk -w @web-mmorpg/client`; build i kontrola podpisu apksigner zakończyły się powodzeniem (Android Debug, schemat v2). Aktualny SHA256 powyżej dotyczy tej wersji. Wcześniejsza sekcja29px dokumentuje poprzedni podgląd.

Przeglądarka potwierdziła36×36px dla przycisków toreb HUD, komórek podglądu i właściwej zawartości plecaka; panel boczny ma `scrollWidth<=clientWidth`, bez przepełnienia poziomego. Screenshot: `artifacts/ui/current-slots-36.jpg`. Zachowano sesję yuna; bez mutacji rozgrywki.

Najnowsza zmiana: działający plecak pod slotami, bez osobnego okna — opis i aktualna weryfikacja w [ui-inline-inventory-verification.md](ui-inline-inventory-verification.md).

Ręczne układanie wewnątrz plecaka dodaje teraz zapis serwerowy i migrację014; aktualna weryfikacja oraz ograniczenie wdrożenia oficjalnego: [inventory-cell-order-verification.md](inventory-cell-order-verification.md).
