# Statystyki sprzętu i drzewko specjalizacji

Użytkownik usuwa ogólny poziom postaci i wybiera: statystyki przedmiotów + premie specjalizacji. Osobne okno „Drzewko specjalizacji” zastępuje zakładkę „Władanie”. Układ inspirowany radialną mapą Albion Online, z własną oprawą Kronik Pogranicza.

## Zasady

- Ogólny poziom i XP znikają z rozwoju, interfejsu, wymagań noszenia/zakupu przedmiotów i skalowania walk. Historyczne kolumny pozostają bez resetowania, aby zachować dane. Poziomy przeciwników nadal oznaczają ich trudność.
- Stała baza bez sprzętu: STR/DEX/VIT 0, HP 100, PA 5, inicjatywa 10, obrażenia pięścią 5, pancerz 0. Baza nigdy nie rośnie. Broń korzysta z własnych obrażeń, atrybutów i premii swojej specjalizacji; bez dodatkowych dawnych obrażeń poziomu.
- Dotychczasowe 10 rodzin broni, XP, 40 technik, punkty i darmowy reset poza walką pozostają. Zmiana sprzętu nie kasuje postępu.
- Trzy specjalizacje pancerza: cloth/płócienne, leather/skórzane, plate/płytowe. Każda ma rangę 0–100 z dotychczasową krzywą XP oraz własną pulę punktów (1 co 5 rang).
- Za wygraną walkę połowa surowej nagrody XP (z istniejącym bonusem drużyny) jest dzielona między użyte rodzaje broni. Druga połowa trafia do rodzin założonych pancerzy proporcjonalnie do liczby noszonych elementów. Tarcze pozostają specjalizacją broni. Uwzględniamy uzbrojenie z początku walki; w walce nie można go zmieniać.
- Ranga pancerza dodaje 0,2% do ARMOR, MAX_HP i VITALITY wyłącznie pasujących elementów za każdą rangę. Cztery dodatkowe pasywne węzły: +5% pancerza (ranga10/koszt2), +5% HP/VIT (30/6), +10% pancerza (50/8, poprzednik drugi), +10% HP/VIT (60/8, poprzednik pierwszy). Maksymalna pula20 wymusza wybór (całość kosztuje24).
- Pancerze otrzymują jawne pole armorFamily w katalogu/adminie. Znane stare cloth-* są płócienne; nie zgadujemy rodzaju pozostałych autorskich przedmiotów. Dodajemy podstawowe skórzane i płytowe odpowiedniki dostępne u kupca, aby wszystkie nowe gałęzie dało się rozwijać. Nie zmieniamy autorskich wersji istniejących przedmiotów.
- Leczenie, urazy, sakiewka, ekwipunek, kolejność w plecakach i wyposażone instancje pozostają zachowane. Po zmianie statystyk HP jest ograniczane do nowego maksimum; zmiana stroju nie leczy za darmo.

## Okno

- Niezależny przycisk „Specjalizacje”, skrót K; okno „Drzewko specjalizacji”. Postać zawiera zakładki „Statystyki” i „Uzbrojenie”.
- Mapa: środek → grupy broni/pancerzy → rodziny → węzły. Okrągłe ikony, połączenia i pierścienie postępu; widoczny stan wyuczony/dostępny/zablokowany.
- Wybór rodziny/węzła pokazuje opis, rangę, XP, punkty, warunki i czynności nauki/resetu. Zachowane mechaniki serwerowe i ochrona przed odpowiedziami po wylogowaniu.
- Mapa ma przesuwanie i przybliżanie; dotyk i klawiatura, przyciski powiększania i reset widoku. Telefon otrzymuje czytelny panel szczegółów pod mapą, poprawne zamykanie i obsługę Wstecz. Interakcja z oknem nie porusza postaci.

## Podejścia i decyzje

Wybrane przez użytkownika: statystyki sprzętu wzmacniane specjalizacją. Alternatywa „tylko sprzęt, specjalizacje wyłącznie odblokowują techniki” została odrzucona. Zachowanie obecnego zapisu broni i dodanie niezależnego armor_training ogranicza ryzyko utraty postępów; zastąpienie całego modelu rozwoju wymagałoby niepotrzebnej konwersji. Stała baza i konkretne wartości nowych premii są decyzjami implementacyjnymi.

## Sprawdzenie i wydanie

Testy obejmą niezmienność statystyk wobec starego poziomu, rzeczywisty wpływ sprzętu i pasywów, rozdział XP, zapis/ponowne logowanie, brak bramek poziomu oraz interakcje mapy. Jeden pełny zestaw przed wydaniem jest uzasadniony zmianą wspólnego modelu wszystkich walk i postaci. Wydanie na dotychczasowy Render i podpisany Android, z zachowaniem danych i poprzednich artefaktów.
