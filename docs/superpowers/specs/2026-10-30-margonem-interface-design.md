# Interfejs inspirowany Margonem — projekt

Data: 2026-10-30. Status: propozycja do zatwierdzenia przed implementacją.
Przegląd przez niezależnego agenta: brak istotnych pytań blokujących planowanie.

## Cel i ustalenia

Użytkownik chce przebudować cały interfejs w obu wersjach gry i wskazał
Margonem jako wzorzec. Obie wersje oznaczają istniejący klient przeglądarkowy
na komputerze oraz klient Android, pakowany z tego samego kodu przez Capacitor.
Przeglądarka telefonu korzysta z tego samego wariantu responsywnego.

Proponowany efekt: dominująca mapa, uporządkowany boczny panel postaci i toreb,
kwadratowe sloty przedmiotów, czytelne paski zasobów oraz wspólna oprawa
wszystkich okien. To zmiana prezentacji i obsługi istniejących funkcji gry.

Inspirację zweryfikowano na oficjalnym przykładzie interfejsu:
https://help.margonem.com/index/view,320
oraz zamieszczonym tam zrzucie nowego interfejsu:
https://mwc.garmory-cdn.cloud/documentation/przyk%C5%82ad-dowodu-NI_com.png
Własne kolory, obramowania, ikony i dotychczasowe grafiki WEB_MMORPG pozostają
materiałem do wykonania projektu. Zrzut służy wyłącznie jako odniesienie układu.

## Rozważone podejścia

1. Ogólny interfejs MMORPG z dolnym paskiem jako głównym centrum obsługi:
   dobry dla gry z wieloma umiejętnościami, ale słabiej odpowiada wskazanej
   inspiracji i obecnej liczbie dostępnych akcji.
2. Układ inspirowany Margonem: mapa w centrum, panel postaci i przedmiotów
   po prawej, czat po lewej na dole, oszczędny pasek menu. Ten kierunek
   proponujemy na podstawie wskazanej przez użytkownika gry.
3. Dwa niezależne interfejsy dla przeglądarki i Androida: wymagają powielania
   obsługi funkcji i zwiększają ryzyko różnic pomiędzy wersjami. Obecna wspólna
   architektura przemawia za jednym zestawem komponentów i dwoma układami.

Wybór konkretnej gry pochodzi od użytkownika. Responsywna implementacja,
proporcje i szczegóły opisane poniżej są propozycją wykonawcy.

## Oprawa

- Ciemne kamienne powierzchnie, ciemnobrązowe listwy i przygaszone mosiężne
  obramowania, niewielkie narożniki, subtelne światło wewnątrz ramek.
- Jasny kremowy tekst, czerwony pasek HP, bursztynowy XP, czytelnie policzone
  segmenty PA/AP. Kolor zawsze uzupełnia liczba albo podpis.
- Zwarta typografia interfejsu; ozdobny charakter wyłącznie w tytułach.
- Jedna skala odstępów, przycisków, slotów i warstw okien we wszystkich modułach.
- Stany aktywny, zaznaczony, zablokowany, oczekiwanie, błąd i utrata połączenia
  mają spójne oznaczenia. Widoczny fokus klawiatury; etykiety dla ikon.
- Bez dodawania pozornych zakładek dla nieistniejących funkcji.

## Komputer — świat

```text
+-----------------------------------------------------------------------+
| WEB MMORPG                  nazwa lokacji                połączenie    |
+-------------------------------------------------------+---------------+
|                                                       | nick / poziom |
|                                                       | wygląd postaci|
|                      MAPA                             | HP / AP / XP  |
|                                                       | złoto         |
|                                                       +---------------+
|                                                       | Postać /      |
|                                                       | Przedmioty    |
|                                                       | torby 1 2 3 4 |
|                                                       | zawartość     |
|                                                       | wybranej torby|
| [czat: W pobliżu / Ogólny, zwijany]                     |               |
+-------------------------------------------------------+---------------+
| Postać | Przedmioty | Społeczność | Czat | Menu                         |
+-----------------------------------------------------------------------+
```

Przy szerokości od 1100 px i wysokości od 600 px: górna listwa ok. 40 px,
dolna ok. 52 px, prawy panel ok. 280 px (wartości startowe do dopasowania).
Mapa zajmuje rzeczywistą pozostałą przestrzeń. Kamera i wybór celów posługują
się wymiarami tej przestrzeni; panel nie przykrywa interaktywnej części mapy.

Prawy panel przedstawia istniejący wygląd postaci, nick, poziom, HP, maksymalne
AP, postęp XP i złoto. Zawiera cztery istniejące sloty pojemników oraz skróty
do karty postaci i listy wszystkich przedmiotów. Wyposażona torba pokazuje
swoją zawartość w panelu; przypisanie torby i operacje wkładania/wyjmowania
zachowują obecne reguły i potwierdzenia serwera. Pełne opisy otwiera wybór
przedmiotu. Puste sloty są jednoznaczne i nie udają posiadanych przedmiotów.

Czat ma zwijany dok po lewej na dole; jego otwarcie pozostaje działaniem
użytkownika. Zachowuje kanały, historię, liczniki i zasady wysyłania.
Menu grupuje wylogowanie i dostępny wyłącznie dla ADMIN panel administracyjny.
Skróty klawiatury nie przechwytują znaków podczas pisania w formularzu/czacie.

## Android i małe okna

```text
+--------------------------------------------------------------+
| nick / poziom   HP / XP                    lokacja    [Menu]   |
|                                                              |
|                         MAPA                         [Postać] |
|                                                      [Torby] |
|                                                      [Ludzie]|
| [sterowanie dotykowe]                                 [Czat]  |
+--------------------------------------------------------------+
```

Tryb kompaktowy obowiązuje poniżej 1100 px szerokości lub 600 px wysokości,
niezależnie od rodzaju urządzenia. Zachowuje istniejącą obsługę przeglądarki
w pionie i Androida w poziomie. Szczegóły proporcji są decyzją wykonawcy.

Domyślnie widoczne są kompaktowa ramka zasobów, mapa, sterowanie i skróty.
Panel postaci/toreb otwiera się po dotknięciu i można go zamknąć jednym
przyciskiem lub Androidowym Wstecz. Przyciski mają pola dotyku min. 44×44 px.
W pionie szczegóły mogą zajmować większość ekranu; przewijana jest zawartość
okna. Nie są potrzebne gesty najechania kursorem ani przeciąganie przedmiotów.

Podstawowe sterowanie pozostaje poza otwartym panelem albo jest zablokowane,
jeśli pełnoekranowe okno zasłania mapę. Otwarta klawiatura ekranowa zmniejsza
okno czatu/formularza; zamknięcie przywraca poprzedni układ. Respektowane są
safe-area, notch i pasek gestów. Przyciski czatu i społeczności nie nakładają
się na joystick, potwierdzenie ataku ani przycisk końca tury.

## Walka

Walka zachowuje planszę izometryczną, heksy i reguły AP. Korzysta z tej samej
oprawy, ale ma własny układ dostosowany do decyzji taktycznych:

- Górna część: kompaktowe zasoby własnej postaci, runda i aktualna tura.
  Kolejność uczestników korzysta z istniejących danych `turnOrder`.
- Prawa część na komputerze: szczegóły postaci, urazy i przedmioty użytkowe.
  Pełna lista statystyk jest rozwijana, aby nie wypierała planszy.
- Dolna część: wybrany cel i możliwy atak, koszt AP, obrażenia, potwierdzenie,
  auto/przejęcie sterowania oraz koniec tury. Wyświetlamy wyłącznie istniejące
  akcje; ruch nadal wybiera się na planszy.
- Na telefonie szczegóły są zwijane, a przyciski akcji i informacja o turze
  pozostają dostępne. Wybór celu i potwierdzenie dotykiem zachowują dwa kroki.
- Planowanie geometrii planszy rezerwuje faktyczne prostokąty zajęte przez
  widoczne kontrolki, uwzględnia zmianę rozmiaru i safe-area. Zmiana CSS bez
  aktualizacji `calculateBattleLayout` nie wystarczy.
- Własna postać może korzystać z istniejącej grafiki wybranego wyglądu.
  Trafienia, urazy, stan auto i oczekiwanie na serwer nadal blokują te same
  niedozwolone działania co obecnie.

## Pozostałe ekrany i okna

- Logowanie, rejestracja, odzyskiwanie: wspólne obramowanie fantasy i czytelne
  formularze; zachowane wszystkie komunikaty, kod odzyskiwania i stany sieci.
- Tworzenie postaci: większy podgląd istniejących skórek, uporządkowany wybór
  wyglądu, zachowane kierunki podglądu i formularz nicku.
- Karta postaci: wygląd, najważniejsze zasoby i atrybuty; urazy oraz rozwój
  jako oddzielne czytelne sekcje. Bez nowych zasad rozwoju.
- Ekwipunek/pojemniki: siatka ikon z liczbą sztuk, oznaczeniem wyboru i opisem
  na kliknięcie/dotknięcie. Brak modelu zakładania broni w bieżącym kliencie
  oznacza brak fikcyjnych aktywnych slotów wyposażenia.
- NPC i przeciwnicy: małe menu kontekstowe we wspólnym stylu; wybór rozmowy,
  sklepu, walki ręcznej i auto oraz automatyczne podejście pozostają działające.
- Dialog i sklep: czytelna treść, portfel, liczby sztuk i wyraźne działania;
  zachowane leczenie, potwierdzenia serwera i obsługa opóźnionych odpowiedzi.
- Społeczność: dotychczasowe drużyny, znajomi, zaproszenia i handel; nowe
  obramowania, zakładki i układ list. Zachowane wszystkie reguły wymiany.
- ADMIN: wspólna oprawa katalogu, kreatora, historii, kategorii i kont.
  Gęste formularze nadal priorytetowo pokazują dane i błędy walidacji.
- Wynik walki i powiadomienia: wspólna prezentacja nagród, złota, XP i awansu,
  bez zasłaniania kluczowych przycisków i pól planszy.

## Granice i ograniczenia

Projekt nie dodaje systemu zadań, minimapy, many, klas, gildii, umiejętności
ani nowych zasad zakładania wyposażenia. Nie wymaga migracji bazy ani zmian
rozstrzygających rozgrywkę po stronie klienta. Dostępność wszystkich obecnych
funkcji, kont i postaci jest warunkiem odbioru.

W repozytorium istnieją niezatwierdzone zmiany dotyczące m.in. przeciwników,
broni i kilku ekranów. Implementacja zachowa je, a przed edycją sprawdzi
aktualną zawartość plików. Nie cofamy zmian i nie przenosimy starszego interfejsu
z innej gałęzi w całości.

## Miejsca zmian i weryfikacja

Główne miejsca: `src/style.css`, `ui/WorldHud.ts`, `scenes/WorldScene.ts`,
`ui/CharacterPanel.ts`, `ui/InventoryPanel.ts`, moduły pojemników, czatu,
społeczności i sklepu oraz `ui/BattleHud.ts`, `ui/BattleAttackCard.ts`,
`scenes/battleLayout.ts`, `scenes/BattleScene.ts`. Ścieżki względem
`apps/client`. Ekrany konta i moduły ADMIN otrzymują wspólne style.

Odbiór obejmuje: logowanie → świat → postać/przedmioty/torby → NPC i sklep →
walka ręczna i auto → nagrody → powrót do świata, a także czat i społeczność.
Sprawdzenie w przeglądarce dla 1280×720, 844×390 i 390×844 oraz przy zmianie
rozmiaru, otwieraniu okien i wymuszonej utracie połączenia. Android wymaga
sprawdzenia safe-area, klawiatury i Wstecz; fizyczne urządzenie lub emulator
może być potrzebny do potwierdzenia zachowania systemowego.

Wykorzystujemy istniejące testy komponentów i geometrii. Nowe testy dotyczą
wyłącznie nowych istotnych zachowań (np. przełączanie doku, rezerwacja miejsca
na planszę). Uruchamiamy właściwe testy klienta oraz jego produkcyjny build.
Build Android sprawdza spakowanie tego samego interfejsu; publikacja
i dystrybucja nowej wersji nie są częścią zatwierdzania samego wyglądu.
