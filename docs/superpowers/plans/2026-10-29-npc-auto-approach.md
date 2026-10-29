# Automatyczne podejście do NPC

Cel: wybór Rozmowa lub Sklep poza zasięgiem uruchamia podejście i wykonuje wybór po potwierdzonym przez serwer dotarciu.

- [x] Testy sceny: oba wybory czekają na autorytatywną pozycję, docelowy ruch jest ponawiany do potwierdzenia; w zasięgu działają od razu.
- [x] WorldScene przechowuje oczekującą opcję, idzie z prędkością istniejącego ruchu do punktu 16 px wewnątrz interactionRadius i uruchamia żądanie tylko raz. Ręczny ruch, pisanie, nowy cel, brak NPC/gracza, rozłączenie i wyjście ze sceny anulują wybór. Brak postępu przez 5 s kończy podejście komunikatem.
- [x] Testy bezpośrednich skutków + kompilacja klienta; podgląd rozmowy i sklepu z podejściem w przeglądarce i rozmiarze telefonu.
- [x] Zbudowany i sprawdzony APK 0.1.10 z dotychczasowym podpisem. Wydanie: publikacja, wdrożenie i sprawdzenie publicznych artefaktów. Bez zmian protokołu, bazy i walidacji serwera.
