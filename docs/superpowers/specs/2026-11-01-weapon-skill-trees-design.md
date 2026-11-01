# Drzewka władania — Kroniki Pogranicza

Rozwijamy uzgodniony z autorem kierunek: każda z dziewięciu rodzin ma osobne punkty i drzewko, głównie aktywne techniki, a broń dostarcza statystyki i cechy. Dotychczasowe XP, poziomy 0–100, premie, urazy i połowa XP za walkę pozostają zachowane.

Decyzje wykonawcze: 1 punkt za każde 5 poziomów, maksymalnie 20; wcześniej zdobyte poziomy od razu dają punkty. Każda rodzina ma cztery węzły w dwóch gałęziach: power (poziom10, koszt2) → ultimate (poziom60, koszt8), technique (poziom30, koszt6) → mastery (poziom50, koszt8). Łączny koszt24 wymusza wybór. Trzy techniki aktywne i jeden pasyw. Darmowy reset jednej rodziny poza walką pozwala poprawić wybór.

Wszystkie węzły mają rzeczywisty efekt. Techniki wymagają założonej rodziny broni lub tarczy, tury gracza, odpowiedniego celu, AP i odnowienia. Kostury leczą siebie/sojuszników; tarcze mają uderzenie, osłonę i drugi oddech. Podgląd klienta i walidacja serwera współdzielą reguły. Auto korzysta z wyuczonych technik.

Wyuczone identyfikatory zapisujemy jako opcjonalne learnedSkills wewnątrz istniejącego weaponTraining JSON, bez migracji i bez kasowania XP. Punkty są wyliczane, nie przekazywane przez klienta. Zakup/reset ma blokadę równoległych mutacji, walki i zmiany sesji oraz trwały zapis przed potwierdzeniem.

Interfejs: Postać → Władanie zachowuje dziewięć pasków i otwiera wybraną rodzinę, pokazuje punkty, połączenia gałęzi, opis/koszt/próg/przyczynę blokady. Walka pokazuje aktywne wyuczone techniki, wybór celu i odnowienie na komputerze i telefonie.

Rozważone podejścia: same paski nie realizują wyboru; automatyczne odblokowanie wszystkich technik usuwa specjalizację; osobne punkty i rozgałęzienia realizują ustalenia autora. Nie dodajemy nowej waluty, przedmiotów ani zmiany wyglądu świata.
