# Panel administratora w WEB_MMORPG

Data: 2026-10-08. Status: projekt do zatwierdzenia; kod funkcji nie został jeszcze zmieniony.

Punkt odniesienia: `feature/mvp-vertical-slice`, commit `f75be4940fc361d44b260c5348183bc1ff6a1894`. Sprawdzono zgodność lokalnego kodu aplikacji z tą wersją na GitHubie.

## Cel i zakres pierwszej wersji

Administrator ma mieć narzędzie w grze do przeglądania wszystkich zdefiniowanych przedmiotów i dodawania wybranego przedmiotu, w podanej ilości, do ekwipunku własnej postaci.

Wymagania użytkownika:

- Panel jest dostępny wyłącznie dla kont z rangą `ADMIN`.
- Przycisk `Panel admin` znajduje się na samym dole rozwijanego menu, za `Wyloguj`.
- Przycisk otwiera okno z listą narzędzi administratora.
- Pierwszym działającym narzędziem jest katalog wszystkich przedmiotów i dodawanie ich do własnego ekwipunku.

Proponowane decyzje do zatwierdzenia:

- Pierwsza wersja udostępnia sekcję `Przedmioty`; kolejne narzędzia można dodawać jako osobne sekcje bez przebudowy panelu.
- Nadawanie i odbieranie rangi odbywa się poleceniem uruchamianym na serwerze dla wskazanego loginu konta. Panel nie otrzymuje na tym etapie zarządzania rangami innych kont.
- Jedno dodanie przyjmuje od 1 do 1000 sztuk. Większą liczbę można dodać kolejnymi operacjami. Limit ogranicza koszt tworzenia osobnych instancji toreb.
- Przedmioty trafiają do ogólnego ekwipunku własnej aktywnej postaci. Torby można następnie normalnie wyekwipować. Dodawanie podczas walki jest niedostępne.

## Rozważone warianty uprawnień

1. **Ranga w bazie danych i polecenie serwerowe — rekomendowane.** Ranga należy do konta, pozostaje po restarcie i może zostać nadana lub odebrana przez operatora serwera. To odpowiada żądanemu statusowi `ADMIN` bez dokładania panelu zarządzania użytkownikami.
2. **Lista administratorów w konfiguracji serwera.** Mniejsza zmiana w bazie, ale każda zmiana listy wymaga zmiany konfiguracji i zwykle restartu. Gorzej pasuje do trwałej rangi konta.
3. **Ranga w bazie i zarządzanie kontami wewnątrz panelu.** Wygodniejsze przy większej liczbie administratorów, ale dodaje osobny zakres: wyszukiwanie kont, nadawanie uprawnień oraz zasady chroniące ostatniego administratora. Możliwa późniejsza rozbudowa.

Dalsza część projektu opisuje wariant 1.

## Konto i autoryzacja

Obecne pole `status` przyjmuje `active` lub `banned` i zachowuje znaczenie związane z blokadą konta. Nowa kolumna `role` przyjmuje `PLAYER` albo `ADMIN`, domyślnie `PLAYER`. Wszystkie istniejące konta początkowo otrzymują `PLAYER`.

Serwer przekazuje rangę w odpowiedzi dotyczącej sesji. Klient używa jej do widoczności przycisku i panelu. Brak rangi w odpowiedzi oznacza brak dostępu administracyjnego, co pozwala bezpiecznie wyświetlać klienta także przed aktualizacją serwera.

Każde żądanie katalogu i dodania przedmiotu ponownie sprawdza ważność sesji oraz aktualną rangę konta na serwerze. Ranga, identyfikator odbiorcy i definicja przedmiotu nie są przyjmowane jako uprawnienia z danych klienta. Identyfikator postaci wynika z zalogowanego połączenia.

Odebranie rangi blokuje kolejne operacje także dla już otwartego panelu. Po odpowiedzi o braku uprawnień klient zamyka panel i ukrywa przycisk. Ranga jest odświeżana przy logowaniu i ponownym połączeniu. Tryb testowy logowania samym nickiem nie przyznaje uprawnień administratora.

Polecenie operatora przyjmuje login konta i rangę, sprawdza istnienie konta oraz zapisuje zmianę w bazie. Nie ma automatycznego awansowania pierwszego zarejestrowanego użytkownika. Dokumentacja poda sposób nadania pierwszego `ADMIN` na serwerze.

Migracja rangi i tabeli operacji uruchamia się automatycznie przy starcie serwera. Pierwszego administratora można nadać po skonfigurowaniu `DATABASE_URL` poleceniem:

```bash
npm run admin:set-role -- <login-konta> ADMIN
```

Rangę można odebrać tym samym poleceniem, podając `PLAYER`. Polecenie odrzuca nieistniejące konto i wartości inne niż `PLAYER` lub `ADMIN`.

## Katalog przedmiotów

Obecnie gra definiuje sześć przedmiotów: `simple-bag`, `traditional-backpack`, `travel-backpack`, `expedition-backpack`, `wolf-pelt` oraz `field-bandage`.

Powstaje wspólny katalog definicji używany przez panel, tworzenie toreb i generowanie łupów. Zawiera identyfikator, nazwę, kategorię, opis oraz pojemność dla toreb. Istniejące nazwy i parametry zostają zachowane. Katalog opisuje typy przedmiotów; nie zawiera identyfikatorów instancji posiadanych przez graczy.

Serwer zwraca katalog dopiero po autoryzacji administratora. Dodanie nowej definicji w przyszłości automatycznie uwzględnia ją na liście panelu.

## Dodawanie przedmiotów

Klient wysyła identyfikator definicji, całkowitą liczbę sztuk i unikalny identyfikator operacji. Serwer sprawdza typy danych, istnienie definicji, zakres ilości, dostęp administratora oraz dostępność aktywnej postaci poza walką.

Operacja korzysta z istniejącej kolejki zmian ekwipunku. Dzięki temu nie nadpisuje równoczesnego przenoszenia przedmiotów, wyposażania torby ani przyznania nagrody.

Materiały i środki medyczne łączą się ze stosem w ogólnym ekwipunku lub tworzą tam nowy stos. Nie zwiększają stosu schowanego w torbie. Każda dodana torba otrzymuje osobną instancję, ilość 1 i pojemność z katalogu. Istniejące wyposażenie i zawartość toreb są zachowane.

Zapis ekwipunku, wyposażenia i wpisu o operacji następuje w jednej transakcji. Wpis zawiera identyfikator operacji, konto administratora, postać, identyfikator przedmiotu, ilość i datę. Unikalność operacji chroni przed podwójnym dodaniem po ponowieniu żądania. Ponowienie tego samego identyfikatora z innymi danymi jest odrzucane.

Potwierdzenie powodzenia i zaktualizowany stan gracza są wysyłane dopiero po trwałym zapisie. Przy niepewnym wyniku zapisu serwer uzgadnia stan z bazą przed dalszymi zmianami; ponowienie korzysta z tego samego identyfikatora operacji. Błąd nie może pozostawić wyłącznie lokalnie dodanych przedmiotów.

## Okno w grze

Okno korzysta z obecnego ciemnego stylu RPG i wspólnych kontrolek: zamykanie, skalowanie oraz opcjonalne przesuwanie. Układ dopasowuje się do telefonu i komputera.

Panel zawiera:

- listę dostępnych narzędzi z sekcją `Przedmioty`;
- pole wyszukiwania po nazwie lub identyfikatorze i filtr kategorii;
- przewijaną listę z ikoną, nazwą, kategorią i opisem przedmiotu, a dla toreb również pojemnością;
- wybór przedmiotu, pole `Ilość` ustawione początkowo na 1 i przycisk `Dodaj do ekwipunku`;
- czytelny komunikat o powodzeniu lub przyczynie odmowy.

Wysłanie żądania blokuje przycisk do czasu odpowiedzi lub upłynięcia czasu oczekiwania. Ponowienie nie tworzy nowej operacji, dopóki wynik poprzedniej pozostaje nieznany. Wpisywanie w wyszukiwarkę i pole ilości nie powinno sterować postacią. Dane tekstowe z katalogu są wstawiane jako tekst.

## Miejsca zmian i granice

- `packages/shared`: ranga konta, katalog przedmiotów i typy komunikatów administracyjnych.
- `apps/server`: migracja, odczyt rangi w repozytorium i sesji, polecenie zmiany rangi, obsługa katalogu i grantów, trwały zapis operacji.
- `apps/client`: nowy panel, obsługa komunikatów, warunkowy przycisk w menu oraz podłączenie i sprzątanie panelu w scenie świata.
- `createGameServer.ts`: podłączenie osobnego modułu obsługującego administratora do istniejącej autoryzacji i kolejki ekwipunku. Bez przebudowy niezwiązanych mechanizmów gry.

## Weryfikacja i kryteria odbioru

- Konto `PLAYER`, nieważna sesja i tryb logowania nickiem nie mogą pobrać katalogu ani dodać przedmiotu, także przez ręcznie wysłane żądanie.
- Konto `ADMIN` widzi `Panel admin` na końcu menu i wszystkie aktualne definicje przedmiotów.
- Nadanie i odebranie rangi działają dla loginu konta; odebranie rangi blokuje następny grant.
- Nieprawidłowy identyfikator, zero, liczba ujemna, ułamek, tekst i przekroczenie limitu ilości są odrzucane bez zmiany ekwipunku.
- Wybrana ilość pojawia się w ogólnym ekwipunku, z prawidłowym łączeniem stosów oraz osobnymi instancjami toreb.
- Wynik pozostaje po ponownym logowaniu; błąd zapisu nie daje fałszywego potwierdzenia, a ponowienie nie dubluje przedmiotów.
- Równoległe przeniesienie przedmiotu i grant nie gubią zmian ani wyposażenia.
- Okno i lista są użyteczne przy szerokości telefonu, a wprowadzanie tekstu nie porusza postacią.
- Testy klienta, serwera i pakietu wspólnego, build oraz workflowy GitHuba przechodzą przed uznaniem wdrożenia za zakończone.

Aktualizacja klienta na GitHub Pages i aktualizacja serwera są osobnymi etapami. Funkcja administracyjna stanie się dostępna po wdrożeniu obu części, wykonaniu migracji oraz nadaniu rangi wybranemu kontu.
