# Urazy z ulepszonych broni — 1 listopada 2026

## Dostarczone zachowanie

- Miro sprzedaje „Kamień urazu” za 50 złota. Kamień jest przedmiotem kategorii ulepszeń, nie miksturą do użycia w walce.
- Szczegóły kamienia pozwalają wybrać własną sprawną broń jakości Znakomita, Doskonała lub Arcydzieło, także aktualnie założoną lub przechowywaną w innym pojemniku.
- Serwer losuje jeden z 15 urazów i całkowitą szansę 5–15%, a czas wylicza według zatwierdzonego algorytmu. Jedna broń przechowuje jeden efekt; kolejny kamień zastępuje go nowym losowaniem, które może powtórzyć ten sam rodzaj.
- Konsumpcja kamienia, zapis efektu i trwały identyfikator operacji są transakcyjne. Ponawianie tej samej operacji nie zużywa kolejnego kamienia ani nie zmienia losowania. Odrzucenie próby sprawdzenia wyniku przez trwającą operację, walkę, handel lub brak połączenia nie odrzuca nierozstrzygniętego identyfikatora.
- Ulepszenie działa na atakach bronią, najwyżej jedna próba nałożenia na cel w turze atakującego. Jeden cel ma najwyżej trzy różne urazy czasowe; powtórzenia nie zwiększają kar, a odświeżenie nie skraca dłuższego efektu.
- Urazy mają rzeczywiste skutki w silniku, wspólnych podglądach oraz decyzjach Auto i przeciwników. Czas liczy pełne własne tury celu; „do końca walki” jest osobnym stanem.
- Trwałe urazy po porażce pozostają oddzielone od czasowych efektów broni. Zapis przy miksturze, zakończeniu walki i rozłączeniu nie utrwala czasowych urazów. Powrót limitu maksymalnego HP po głębokiej ranie nie leczy postaci.
- Opisy broni pokazują rodzaj, szansę i czas; szczegóły uczestników walki pokazują czasowe urazy, w tym przeciwników. Skuteczność mikstur uwzględnia ranę brzucha.

## Decyzje wykonawcze

Sposób zdobycia i użycia kamienia oraz cena 50 złota uzupełniają zatwierdzony algorytm o działającą ścieżkę w grze. Pula zawiera również uszkodzoną dłoń występującą w przykładach algorytmu, co daje 15 rodzajów. Dotychczasowe losowanie pięciu trwałych urazów przy porażce pozostało zachowane. Nie dodawano systemu podnoszenia jakości broni ani nowej sztuki graficznej.

## Weryfikacja automatyczna

Zestawy dobrano do zmienionych zachowań. Nie uruchamiano niezwiązanej pełnej kolekcji projektu.

- `npm run test -w @web-mmorpg/shared -- src/weaponInjuryUpgrade.test.ts` — 11 testów, w tym pięć zatwierdzonych przykładów i 99 kombinacji jakości/ciężkości/szansy.
- `npm run test -w @web-mmorpg/shared -- tests/battleRules.test.ts` — 4 testy wspólnych podglądów.
- Testy serwera: `weaponInjuryUpgradeService.test.ts`, `socketWeaponInjury.test.ts`, `merchantService.test.ts`, `seedStarterItems.test.ts` — 4 pliki, 19 testów. Pokrywają transakcję, jakość instancji, cudze przedmioty, powtórzenia i konflikty identyfikatorów, równoległe żądania, zmianę sesji i blokady walki/handlu.
- Testy walki: `weaponInjuryBattle.test.ts`, `weaponInjuryBattleService.test.ts`, `battleEngine.test.ts`, `injuries.test.ts`, `autoBattleAi.test.ts`, `npcBattleAi.test.ts`, `battleService.test.ts`, `battleConsumables.test.ts`, `healingShieldEngine.test.ts`, `partyBattleService.test.ts`, `partyHealingEngine.test.ts`, `battleWeaponTraining.test.ts`, `battleSupportStyles.test.ts` — 13 plików, 116 testów. Po poprawce planowania drugiego ataku przy urazie barku powtórzono tylko pięć dotkniętych zestawów: 54 testy przeszły.
- Testy klienta: `weaponInjuryUi.test.ts`, `gameSocket.test.ts`, `worldSceneProgression.test.ts`, `containerContentsPanel.test.ts`, `hudEquipmentSlots.test.ts`, `BattleHud.test.ts`, `weaponTrainingUi.test.ts` — 7 plików, 101 testów.
- Końcowa poprawka ponawiania i podglądu mikstur: `npm run test -w @web-mmorpg/client -- tests/weaponInjuryUi.test.ts tests/BattleHud.test.ts` — 32 testy przeszły; wcześniej siedem nowych przypadków odtwarzało błędy.
- `npm run test -w @web-mmorpg/server -- tests/renderLegacyMigrationCompatibility.test.ts` — test migracji starej struktury bazy przeszedł, z zachowaniem zastanych danych.
- Końcowy `npm run build` — klient, serwer i shared przeszły. Vite nadal zgłasza istniejące ostrzeżenie o wielkości pakietu.
- `npm run android:apk -w @web-mmorpg/client` — kompilacja Androida zakończona `BUILD SUCCESSFUL`; debug APK: `artifacts/android/WEB-MMORPG-0.1.25-debug.apk`.
- `apksigner verify --verbose artifacts/android/WEB-MMORPG-0.1.25-debug.apk` — podpis poprawny, schemat v2. SHA-256: `79da4efcea79e45e773c9bbcac954d5feba0af556688d0954dc319a5f622b92a`.
- Niezależny przegląd integracji wykrył błąd odrzucania identyfikatora nierozstrzygniętej operacji i niespójny podgląd leczenia miksturą. Oba poprawiono; przegląd zakresu poprawek potwierdził ich zamknięcie.

## Działający serwer i zapis

Uruchomiono osobny lokalny serwer na porcie 13003, z klientem zbudowanym dla tej samej domeny. Baza to nowy, odizolowany klaster PostgreSQL 16 na localhost:15432; schematy testów znajdowały się w `web_mmorpg_test` oraz osobnej bazie `web_mmorpg_injury_migrations`. Nie używano bazy autora ani istniejących podglądów.

Przez rzeczywiste REST i Socket.IO potwierdzono:

1. Logowanie odizolowanego konta testowego i odczyt sklepu Miro.
2. Zakup dwóch kamieni za 100 złota.
3. Odrzucenie broni jakości Normalnej bez zużycia kamienia.
4. Ulepszenie założonego miecza jakości Znakomitej oraz aktualizację kopii przedmiotu w wyposażeniu postaci.
5. Powtórzenie tego samego żądania z tym samym wynikiem i bez kolejnej konsumpcji.
6. Nowe losowanie przy użyciu drugiego kamienia.
7. Zachowanie efektu po rozłączeniu i ponownym uwierzytelnieniu.
8. Bezpośredni odczyt PostgreSQL: dokładnie dwa potwierdzenia operacji i zgodny efekt zapisany na właściwej instancji.

Dowód: `artifacts/injury-runtime-verification.json` (artefakt lokalny ignorowany przez Git, bez hasła i tokenu sesji).

## Ograniczenia

Sterowanie lokalną przeglądarką jest wyłączone w ustawieniach Work. Nie wykonano oględzin interfejsu w przeglądarce ani fizycznych prób Androida; testy DOM i transportu nie są przedstawiane jako taki odbiór. Dane konta pomocniczego znajdują się wyłącznie w ignorowanym lokalnym artefakcie.

Zmiany dotyczą bieżącego drzewa roboczego. Nie wykonano wdrożenia na oficjalny serwer, publikacji wydania, push ani modyfikacji produkcyjnej bazy. Docelowy serwer musi uruchamiać tę wersję i migrację 015, aby opublikowany klient mógł korzystać z nowej operacji.

Zbudowany debug APK ma domyślny oficjalny adres HTTPS z konfiguracji projektu. Jest dowodem poprawnej kompilacji; użycie nowej funkcji pod tym adresem wymaga wcześniejszego wdrożenia zgodnego serwera. Pomocniczy serwer lokalny i nowy klaster testowy zostały zatrzymane po weryfikacji; pozostawiono ich odizolowane dane do odtworzenia wyników.
