# Interfejs inspirowany Margonem — wdrożenie i weryfikacja

Data: 2026-10-31.

Wspólny klient przeglądarkowy i Android otrzymał oprawę kamienia, drewna
i mosiądzu, prawy panel postaci i toreb, paski HP/AP/XP, menu z powiadomieniami
czatu/społeczności oraz kompaktowy układ telefonu. Kamera świata rezerwuje
rzeczywiste miejsce na panel. Ekwipunek i pojemniki mają siatki ikon, liczniki
i bezpieczne opisy; karta postaci korzysta z istniejącej grafiki wyglądu.

Walka ma górny panel zasobów i kolejności tur, prawy panel szczegółów oraz dolne
akcje i podgląd celu. Na małych ekranach szczegóły są zwijane; przełącznik
przybliżenia pozwala łatwiej wybierać heksy i wrócić do widoku całej planszy.
Logowanie, kreator postaci, dialogi, sklep, czat, społeczność i ADMIN korzystają
ze wspólnej oprawy. Zachowano dotychczasowe reguły serwera i aktywne zmiany
dotyczące przeciwników oraz przedmiotów.

## Wyniki

| Sprawdzenie | Wynik |
| --- | --- |
| `npm run test -w @web-mmorpg/client -- --maxWorkers=2` | 45 plików, 259 testów, wszystkie poprawne |
| `npm run build -w @web-mmorpg/client` | TypeScript i produkcyjny build Vite poprawne |
| `npm run android:apk -w @web-mmorpg/client` | Synchronizacja Capacitor i Gradle assembleDebug poprawne |
| `apksigner verify artifacts/android/WEB-MMORPG-0.1.10-debug.apk` | Poprawny podpis testowego APK, kod wyjścia 0 |
| Przegląd kodu po poprawkach | Zgodność ze specyfikacją i jakość zatwierdzone; brak istotnych pozostałych usterek |

Pierwszy przebieg bez ograniczenia równoległości zakończył proces roboczy
Vitest błędem systemowym Windows. Izolowany plik przeszedł wszystkie 13 testów;
końcowy pełny przebieg z dwoma równoległymi procesami zakończył się poprawnie.

## Sprawdzenie w działającej przeglądarce

Sprawdzono rozmiary 1280×720, 844×390 i 390×844, w tym zmianę rozmiaru podczas
gry. Na oddzielnym koncie i zgodnej bazie podglądu potwierdzono:

- logowanie i odtworzenie świata, ruch oraz prawidłowe kotwiczenie menu NPC;
- automatyczne podejście do kupca, zakup, stan złota i listę przedmiotów;
- założenie torby, pojemność, przeniesienie przedmiotu pojedynczym kliknięciem
  po odpowiedzi serwera oraz aktualizację podglądu w prawym panelu;
- wybór i opis przedmiotu w pionowym układzie telefonu;
- przejście ze świata do walki, podgląd celu poza zasięgiem, przybliżenie planszy,
  auto oraz zwycięstwo z +40 XP i powrót do świata z aktualnymi HP/XP;
- czytelny czat podczas walki w poziomie: wysokość historii 106 px przy 844×390;
- zwijanie panelu telefonu i brak dodatkowych niezależnych przycisków czatu
  nakładających się na menu świata.

Poprawiono błędy ujawnione przez odbiór: odwołanie do usuniętej przez Phaser
kamery podczas shutdown, kolejność zamykania okien uwzględniającą warstwy
rodziców, zbyt niski czat w poziomej walce oraz przesuwanie przycisku wskutek
ujawniania opisu między pointerdown i pointerup. Nowe zachowania mają testy
regresyjne, obserwowane przed poprawką i po niej.

## Artefakty lokalne

- Podgląd demo: http://127.0.0.1:5174/WEB_MMORPG/ (serwer podglądu na porcie 3002).
- APK testowe: `artifacts/android/WEB-MMORPG-0.1.10-debug.apk`.
- SHA-256: `38f81182ece8707be9d5e1523c710086c3af9880eec65c1b842aef945fecb23a`.
- Zrzuty: `artifacts/ui/margonem-desktop.jpg`, `margonem-phone.jpg`,
  `margonem-inventory-portrait.jpg`, `margonem-battle-desktop.jpg`,
  `margonem-battle-phone.jpg`, `margonem-login.jpg`.

## Zakres i ograniczenia

Podgląd używa osobnej bazy, ponieważ wcześniejsza lokalna baza zawierała nowszą
regułę z innej gałęzi, rezerwującą pierwszy slot plecaka. Nie zmieniano jej
schematu ani istniejących kont. Utworzono wyłącznie własne dane do prób UI.

APK jest kompilacją debug. Nie publikowano wydania ani nie wdrażano klienta
na publiczny serwer. Nie było podłączonego telefonu/emulatora; systemowe
Wstecz zweryfikowano testami cyklu życia, a układy i interakcje w przeglądarce.
Klawiatura systemowa i rzeczywiste wcięcia ekranu wymagają odbioru na urządzeniu.

Zmiany pozostają w bieżącym checkoutcie z zachowaniem wcześniejszych
niezatwierdzonych zmian użytkownika. Projekt nie wprowadza nowych reguł walki,
many, klas, minimapy ani fikcyjnych slotów wyposażenia.

