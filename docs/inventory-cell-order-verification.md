# Ręczne układanie przedmiotów — 31 października 2026

Przedmioty w tej samej torbie można przenosić na puste miejsca lub zamieniać miejscami po upuszczeniu na zajęte pole. Puste miejsca i dokładne pozycje są przechowywane na serwerze. Przeciąganie przez pośrednie pola nie zatwierdza operacji; zapis następuje przy puszczeniu albo Enter. Dotychczasowe przenoszenie między torbami, przypisywanie pojemników i zakładanie uzbrojenia pozostają.

## Zapis i migracja

- Opcjonalne `InventoryItem.containerPosition` i `moveItemToContainer.targetPosition` są indeksami od zera. Dotychczasowe pakiety nadal działają.
- Migracja014 dodaje pozycje i ograniczenie unikalności. Istniejące przedmioty otrzymały stabilną kolejność; zamiany odbywają się atomowo pod blokadą postaci. Nagrody i automatyczne chowanie wykorzystują pierwsze wolne miejsce, bez przesuwania pozostałych przedmiotów.
- Przed aktualizacją podglądu zatrzymano jego stary serwer i utworzono kopię `web_mmorpg_ui_pre_slot_order_20261031`. Potem uruchomiono aktualny serwer3002 z migracją014.
- Kontrola przed/po:10 wierszy przedmiotów, identyfikatory kont/postaci i uprawnienia zachowane; `owca` / `yuna` nadal ADMIN. Brak duplikatów i brakujących pozycji w przechowywanych przedmiotach. Nie resetowano bazy podglądu ani dev.

## Weryfikacja

- Serwer/shared:77 wybranych testów przechowywania, pozycji, wyposażenia, handlu, socketów i zgodności migracji przeszło na osobnej bazie `web_mmorpg_slot_order_tests`, z szeregowym uruchamianiem plików. Polecenia i wyniki w `.superpowers/sdd/margonem-current/slot-order-server-report.md`.
- Klient:39 testów zawartości/przeciągania,16 GameSocket i18 WorldScene przeszło. Nowe regresje sprawdzono red→green; test z faktycznie zamontowaną siatką potwierdza przekazanie pozycji i zachowanie pustego miejsca po odpowiedzi serwera.
- TypeScript serwera/shared i końcowy build klienta przeszły. Build Android APK i podpis przeszły. Przegląd integracji nie zgłosił istotnych usterek.
- W przeglądarce: na własnym koncie testowym myszą przeniesiono tarczę z pola1 na11, następnie zamieniono ją z kosturem. Po wylogowaniu i ponownym zalogowaniu pole1 pozostało puste, tarcza była na2, a kostur na11. Nie zmieniano układu ani przedmiotów owca/yuna. Test odbył się pod osobnym originem localhost; karta testowa została zamknięta.
- Screenshot:`artifacts/ui/current-inventory-order.jpg`.

## Stan wdrożenia

Funkcja działa na lokalnym podglądzie5174/serwerze3002. Nie wykonano wdrożenia na oficjalny serwer. APK `artifacts/android/WEB-MMORPG-0.1.24-debug.apk` zawiera przygotowanego klienta i domyślnie łączy się z oficjalnym HTTPS backendem: ręczne układanie w tym środowisku wymaga również wdrożenia nowego serwera i migracji014. Nie testowano APK na fizycznym urządzeniu. SHA256:`75bc6b1a7e3b81fe8c20673bb56584907f90d5f8d5c7106166642d0949504502`.
