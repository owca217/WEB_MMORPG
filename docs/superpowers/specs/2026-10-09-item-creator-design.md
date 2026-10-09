# WEB MMORPG — Kreator Przedmiotów

Data: 2026-10-09
Status: zatwierdzony projekt funkcjonalny, przed planem implementacji
Gałąź bazowa: `tmp-do-not-use-8`

## 1. Cel

Kreator Przedmiotów ma być centralnym narzędziem administratora do bezpiecznego i szybkiego powiększania puli przedmiotów w grze bez ręcznego edytowania kodu. Utworzony przedmiot ma od razu nadawać się do późniejszego użycia w ekwipunku, loot table, sklepach NPC, questach, craftingu, nagrodach i innych systemach gry.

System ma być rozszerzalny, ale nie może pozwalać administratorowi tworzyć mechanik, których silnik gry nie rozumie.

## 2. Główne założenie architektoniczne — wariant hybrydowy B

Silnik gry utrzymuje kontrolowaną listę mechanik i statystyk technicznych, np. `MAX_HP`, `PHYSICAL_DAMAGE`, `CRIT_CHANCE`, `BURN`, `STUN`. Kategorie, podkategorie, przypisanie dozwolonych statystyk, wszystkie definicje przedmiotów, ich wersje, wymagania, efekty, tagi i dane katalogowe są przechowywane w PostgreSQL.

Administrator może np. utworzyć własną kategorię `Broń palna` i przypisać do niej istniejące statystyki takie jak obrażenia, celność, penetracja czy szybkość ataku, ale nie może stworzyć nowej statystyki, której serwer nie potrafi interpretować.

## 3. Trwałość danych

PostgreSQL staje się trwałym źródłem danych dla katalogu przedmiotów. Dane nie mogą znikać po restarcie lub deployu serwera.

Baza będzie później możliwa do wykorzystania także przez inne trwałe systemy gry, m.in. konta, postacie, ekwipunki, questy, sklepy i crafting.

## 4. Kategorie i podkategorie

System ma być hybrydowy:

- gotowe kategorie systemowe dostępne od razu,
- możliwość późniejszego dodawania własnych kategorii i podkategorii z panelu administratora,
- każda kategoria i podkategoria określa pulę dozwolonych statystyk i pól specjalistycznych,
- walidacja tej puli odbywa się po stronie serwera.

### 4.1. Kategorie startowe

1. Broń
   - Miecze
   - Topory
   - Młoty
   - Sztylety
   - Włócznie
   - Łuki
   - Kusze
   - Kostury
   - Różdżki
   - Tarcze ofensywne
   - Broń dwuręczna
2. Pancerz
   - Hełm
   - Napierśnik
   - Rękawice
   - Buty
   - Spodnie
   - Płaszcz
   - Tarcza
3. Biżuteria
   - Pierścień
   - Amulet
   - Talizman
   - Bransoleta
4. Konsumpcyjne
   - Mikstura HP
   - Mikstura many
   - Eliksir
   - Jedzenie
   - Napój
   - Antidotum
   - Bandaż
   - Zwój
5. Materiały
   - Rudy
   - Drewno
   - Skóry
   - Tkaniny
   - Kamienie
   - Zioła
   - Kryształy
   - Części potworów
   - Materiały magiczne
6. Narzędzia
7. Przedmioty craftingowe
8. Questowe
9. Klucze
10. Kontenery
11. Plecaki
12. Amunicja
13. Przedmioty do ulepszania
14. Runy i klejnoty
15. Przedmioty specjalne

## 5. Pola wspólne dla wszystkich przedmiotów

Każda definicja przedmiotu może posiadać:

- nazwę,
- stałe `itemId`,
- kategorię,
- podkategorię,
- ikonę,
- opis,
- rzadkość,
- poziom przedmiotu,
- minimalny poziom postaci,
- wartość sprzedaży,
- flagę sprzedaży,
- flagę handlu,
- flagę wyrzucania,
- możliwość stackowania,
- maksymalny stack,
- wagę,
- flagę przedmiotu questowego,
- typ soulbound: brak / po podniesieniu / po założeniu,
- flagę unikalności,
- tagi,
- status: szkic / opublikowany / zarchiwizowany.

## 6. Pule statystyk według kategorii

### 6.1. Broń

Dostępne statystyki zależnie od podkategorii mogą obejmować:

- obrażenia minimalne,
- obrażenia maksymalne,
- obrażenia fizyczne,
- obrażenia magiczne,
- obrażenia ognia,
- obrażenia lodu,
- obrażenia trucizny,
- obrażenia elektryczne,
- szybkość ataku,
- zasięg,
- celność,
- szansę na trafienie krytyczne,
- mnożnik obrażeń krytycznych,
- penetrację pancerza,
- kradzież życia,
- kradzież many,
- szansę krwawienia,
- siłę krwawienia,
- szansę podpalenia,
- szansę zamrożenia,
- szansę ogłuszenia,
- odrzut,
- obrażenia od tyłu,
- czas przeładowania dla odpowiednich podkategorii,
- moc zaklęć,
- szybkość rzucania zaklęć,
- regenerację many.

Podkategorie ograniczają widoczną pulę, np. sztylet eksponuje krytyk i obrażenia od tyłu, kusza czas przeładowania i penetrację, a kostur moc zaklęć i manę.

### 6.2. Pancerz

- pancerz fizyczny,
- odporność magiczna,
- odporność na ogień,
- odporność na lód,
- odporność na truciznę,
- odporność na pioruny,
- maksymalne HP,
- maksymalna mana,
- regeneracja HP,
- regeneracja many,
- unik,
- blok,
- siła bloku,
- prędkość ruchu,
- redukcja obrażeń,
- odporność na stun,
- odporność na slow,
- odporność na bleed.

### 6.3. Biżuteria

Szeroka pula statystyk pomocniczych i ofensywnych, m.in.:

- Siła,
- Zręczność,
- Inteligencja,
- Witalność,
- Szczęście,
- HP,
- Mana,
- krytyk,
- unik,
- celność,
- penetracja,
- regeneracje,
- odporności,
- bonus do doświadczenia,
- bonus do złota.

### 6.4. Konsumpcyjne

- wartość leczenia,
- wartość przywracanej many,
- czas działania,
- cooldown,
- czas użycia,
- liczba użyć,
- efekt,
- siła efektu,
- szansa efektu.

### 6.5. Materiały

Bez statystyk bojowych. Główne pola:

- jakość,
- tier,
- wartość,
- stack,
- typ materiału,
- tagi craftingu.

### 6.6. Narzędzia

- siła narzędzia,
- szybkość zbierania,
- tier,
- trwałość,
- maksymalna trwałość,
- bonus do zbierania,
- szansa dodatkowego surowca.

### 6.7. Przedmioty craftingowe

- odblokowywana receptura,
- wymagany poziom profesji,
- użycie jednorazowe / wielokrotne.

### 6.8. Questowe

- `questId`,
- etap questa,
- unikalność,
- możliwość wyrzucenia,
- możliwość sprzedaży.

Domyślnie: niesprzedawalne, niehandlowalne i niewyrzucalne.

### 6.9. Klucze

- `keyId`,
- otwierany obiekt,
- liczba użyć,
- zużycie po użyciu.

### 6.10. Kontenery

- pojemność,
- `lootTableId`,
- liczba losowanych przedmiotów,
- minimalna rzadkość,
- maksymalna rzadkość,
- zużycie po otwarciu.

### 6.11. Plecaki

- dodatkowe sloty,
- maksymalna waga,
- redukcja ciężaru,
- bonus do zbierania.

### 6.12. Amunicja

- obrażenia,
- penetracja,
- typ obrażeń,
- kompatybilne bronie,
- stack.

### 6.13. Przedmioty do ulepszania

- typ ulepszenia,
- wartość bonusu,
- maksymalny tier,
- szansa powodzenia,
- szansa zniszczenia.

### 6.14. Runy i klejnoty

- bonus,
- wartość bonusu,
- typ slotu,
- poziom klejnotu.

### 6.15. Przedmioty specjalne

Kontrolowana szeroka pula istniejących statystyk i efektów, przeznaczona do eventów, prototypowania i nietypowych przedmiotów administratora.

## 7. Typy modyfikatorów statystyk

Każda statystyka przedmiotu musi określać typ modyfikatora:

- `flat` — np. `+25 HP`,
- `percent` — np. `+8% HP`,
- `multiplier` — np. `x1.10 obrażeń`.

System musi obsługiwać również wartości ujemne.

Przykład:

`Pierścień Berserkera`

- `+15 Siły`,
- `+8% obrażeń fizycznych`,
- `-10% maksymalnego HP`,
- `+20% obrażeń krytycznych`.

## 8. Efekty specjalne

Efekty są budowane z kontrolowanych przez silnik triggerów, warunków i akcji.

### 8.1. Przykładowe triggery

- po trafieniu,
- po otrzymaniu obrażeń,
- przy trafieniu krytycznym,
- po zabiciu przeciwnika,
- gdy HP spadnie poniżej progu,
- po użyciu umiejętności,
- okresowo co X sekund.

### 8.2. Przykładowe efekty

- zadaj obrażenia,
- ulecz,
- odnów manę,
- nałóż buff,
- nałóż debuff,
- podpal,
- zatruj,
- ogłusz,
- spowolnij,
- przywołaj jednostkę.

Każdy efekt może posiadać m.in. wartość, czas trwania, cooldown i szansę aktywacji.

Przykład:

`Miecz Krwawego Księżyca`: przy trafieniu krytycznym 20% szansy na nałożenie Krwawienia na 5 sekund.

## 9. Panel administratora — sekcja Przedmioty

W panelu administratora powstaje główna sekcja `Przedmioty` z co najmniej dwoma widokami:

1. `Katalog przedmiotów`,
2. `Kreator przedmiotu`.

Dostęp do niej jest możliwy wyłącznie dla kont z rolą `ADMIN`.

## 10. Katalog przedmiotów

Katalog zawiera:

- wyszukiwarkę,
- filtry po nazwie,
- filtr po `itemId`,
- filtr kategorii i podkategorii,
- filtr rzadkości,
- filtr poziomu,
- filtr statusu,
- podgląd itemu,
- edycję,
- duplikowanie,
- archiwizację,
- historię wersji.

Domyślnie nie stosujemy twardego usuwania opublikowanych itemów. Archiwizacja chroni istniejące odwołania z ekwipunków, lootów, questów i innych systemów.

## 11. Kreator — przepływ dziewięcioetapowy

### Etap 1 — Kategoria i podkategoria

Wybór kategorii zawęża dalsze pola i pulę dostępnych statystyk.

### Etap 2 — Dane podstawowe

- nazwa,
- automatycznie proponowane `itemId`,
- opis,
- ikona,
- rzadkość,
- poziom przedmiotu.

### Etap 3 — Zachowanie przedmiotu

- stackowanie,
- maksymalny stack,
- waga,
- handel,
- sprzedaż,
- wyrzucanie,
- soulbound,
- unikalność.

### Etap 4 — Statystyki

Administrator wybiera tylko statystyki dozwolone dla danej kategorii i określa typ modyfikatora oraz wartość.

### Etap 5 — Wymagania

- poziom postaci,
- profesja,
- minimalne statystyki,
- opcjonalne wymagania questowe,
- opcjonalny tier.

### Etap 6 — Efekty specjalne

Konfiguracja triggera, warunku, efektu, wartości, czasu trwania, cooldownu i szansy aktywacji.

### Etap 7 — Dane specjalistyczne

Dynamiczne pola zależne od kategorii, np. trwałość narzędzia, dodatkowe sloty plecaka, `questId`, `lootTableId` lub typ amunicji.

### Etap 8 — Tagi i integracje

Tagi typu `starter`, `undead`, `blacksmith`, `fire` itd. służą do późniejszego wyszukiwania i integracji z innymi systemami.

### Etap 9 — Podsumowanie i publikacja

Pełna walidacja oraz akcje:

- `Zapisz szkic`,
- `Opublikuj`,
- `Anuluj`.

## 12. Podgląd tooltipa na żywo

Po prawej stronie kreatora ma być stale widoczny podgląd finalnego tooltipa w formie możliwie identycznej z widokiem gracza po najechaniu na item.

Tooltip pokazuje:

- ikonę,
- nazwę,
- kolor rzadkości,
- poziom,
- statystyki,
- wymagania,
- opis,
- efekty specjalne.

## 13. Duplikowanie

Katalog musi umożliwiać duplikowanie istniejącego przedmiotu do nowego szkicu. `itemId` nowego przedmiotu musi pozostać unikalne.

Przykładowy przepływ: `Żelazny Miecz` → Duplikuj → zmiana nazwy, ikony i statystyk → `Stalowy Miecz`.

## 14. Wersjonowanie definicji

Każdy przedmiot posiada jedną stałą tożsamość `itemId`, ale jego opublikowana definicja jest wersjonowana.

Edycja opublikowanego przedmiotu tworzy nowy szkic wersji. Zmiany nie wpływają na grę do momentu publikacji.

Po publikacji nowej wersji wszystkie istniejące egzemplarze korzystają z nowych bazowych parametrów definicji.

Przykład:

- v3: `DMG 120`,
- szkic v4: `DMG 105`, większa szansa krwawienia,
- do publikacji gracze nadal korzystają z v3,
- po publikacji v4 staje się wersją aktywną.

## 15. Historia wersji i rollback

Panel pokazuje historię rewizji wraz z:

- numerem wersji,
- autorem,
- datą,
- listą zmian,
- możliwością porównania wersji,
- akcją `Przywróć tę wersję`.

Rollback tworzy nową wersję na podstawie wskazanej historycznej definicji, zamiast usuwać historię.

## 16. Definicja przedmiotu a egzemplarz gracza

Bazowa definicja itemu i indywidualny egzemplarz są rozdzielone.

Definicja przechowuje właściwości wspólne, np. nazwę, bazowe statystyki, ikonę i wymagania.

Egzemplarz gracza przechowuje dane indywidualne, np.:

- `instanceId`,
- `itemDefinitionId`,
- ilość,
- aktualną trwałość,
- ulepszenie `+N`,
- przyszłe losowe affixy,
- sockety,
- `boundToPlayerId`.

Zmiana opublikowanej definicji nie usuwa indywidualnego stanu egzemplarza.

## 17. Relacyjny model PostgreSQL

Docelowy model obejmuje co najmniej:

- `items`,
- `item_versions`,
- `item_categories`,
- `item_subcategories`,
- `stat_definitions`,
- `category_allowed_stats`,
- `item_stat_modifiers`,
- `item_requirements`,
- `item_effects`,
- `item_tags`,
- `item_instances`,
- `admin_audit_log`.

Dane złożone mogą korzystać z JSONB tylko tam, gdzie nie osłabia to integralności i walidacji modelu. Podstawowe relacje i statystyki mają pozostać jawnie modelowane.

## 18. Ikony i asset storage

Obrazy ikon nie są zapisywane jako binarne dane w PostgreSQL.

Przepływ:

1. administrator wybiera plik,
2. serwer sprawdza typ i rozmiar,
3. plik jest zapisywany w trwałym storage,
4. baza zapisuje klucz lub URL zasobu,
5. kreator natychmiast aktualizuje podgląd tooltipa.

Storage musi przetrwać deploye. Historia wersji może zachowywać odwołania do wcześniejszych assetów.

## 19. Autoryzacja i bezpieczeństwo

Ukrycie przycisku `Panel admin` w kliencie nie jest zabezpieczeniem.

Każda administracyjna operacja jest autoryzowana po stronie serwera. Użytkownik bez roli `ADMIN` otrzymuje odmowę, np. HTTP `403 Forbidden` dla endpointów HTTP lub odpowiadający kod błędu w protokole realtime.

Operacje chronione obejmują m.in.:

- utworzenie przedmiotu,
- zapis szkicu,
- publikację,
- edycję,
- rollback,
- archiwizację,
- tworzenie kategorii i podkategorii,
- zmianę puli dozwolonych statystyk.

## 20. Audit log

Każda istotna administracyjna modyfikacja katalogu jest zapisywana.

Log przechowuje co najmniej:

- administratora,
- czas,
- typ operacji,
- identyfikator obiektu,
- poprzednią wersję,
- nową wersję,
- skrócone dane zmiany.

Przykład:

`2026-10-09 18:43 — ADMIN Owczy — Iron Sword — v3 -> v4 — DMG 120 -> 105`.

## 21. Walidacja serwerowa

Serwer nigdy nie ufa danym z formularza.

Walidacja obejmuje co najmniej:

- unikalność `itemId`,
- istnienie kategorii i podkategorii,
- zgodność statystyki z kategorią,
- typ modyfikatora,
- dozwolone zakresy wartości,
- wymagane pola,
- poprawność efektów specjalnych,
- poprawność referencji do tagów, statystyk i innych encji,
- format i rozmiar ikony,
- spójność min/max,
- zgodność statusów szkic/publikacja/archiwum.

Przykład: materiał `Żelazo` z niedozwoloną statystyką `CRIT_DAMAGE +500%` zostaje odrzucony po stronie serwera nawet wtedy, gdy klient przez błąd pozwoli wysłać taki formularz.

## 22. Integracja z przyszłymi systemami

Każdy system korzystający z przedmiotów odwołuje się do centralnego identyfikatora definicji. Dotyczy to w szczególności:

- loot table,
- sklepów NPC,
- craftingu,
- questów,
- nagród,
- ekwipunku,
- kontenerów,
- wyposażenia postaci.

Nie duplikujemy kompletnej definicji itemu w tych systemach.

## 23. Migracja obecnego inventory

Obecny model `InventoryItem` jest prosty i zawiera m.in. nazwę, kategorię i opis. Implementacja kreatora musi przeprowadzić migrację tak, aby ekwipunek docelowo odnosił się do centralnej definicji itemu, a stan egzemplarza był rozdzielony od katalogu.

Migracja nie może zerwać istniejącego przepływu lootu i ekwipunku.

## 24. Błędy i zachowanie UI

Kreator powinien:

- blokować publikację przy błędach krytycznych,
- wskazywać pole powodujące błąd,
- nie kasować niezapisanego formularza po błędzie serwera,
- ostrzegać przed opuszczeniem niezapisanego szkicu,
- rozróżniać błąd walidacji, brak uprawnień, konflikt wersji i błąd infrastruktury,
- obsłużyć konflikt równoczesnej edycji przez dwóch administratorów.

Konflikt wersji powinien być wykrywany optymistycznie przez numer rewizji lub podobny mechanizm.

## 25. Testowanie

Implementacja musi posiadać testy co najmniej dla:

- autoryzacji ADMIN,
- odmowy dla zwykłego gracza,
- walidacji category -> allowed stats,
- tworzenia szkicu,
- publikacji,
- wersjonowania,
- rollbacku,
- archiwizacji,
- duplikowania,
- audit logu,
- serializacji definicji do tooltipa,
- migracji inventory,
- trwałości PostgreSQL,
- konfliktów równoczesnej edycji,
- błędnych ikon i błędnych referencji.

## 26. Kryteria akceptacji

Funkcja jest gotowa, gdy administrator może bez edycji kodu:

1. wejść do sekcji `Przedmioty`,
2. utworzyć item przez kreator,
3. wybrać kategorię i zobaczyć tylko właściwe statystyki,
4. wgrać ikonę,
5. dodać modyfikatory i efekty,
6. zapisać szkic,
7. zobaczyć tooltip na żywo,
8. opublikować item,
9. znaleźć go w katalogu,
10. zduplikować go,
11. utworzyć nową wersję,
12. opublikować balansową zmianę,
13. zobaczyć historię i rollback,
14. zarchiwizować item bez zerwania referencji,
15. po restarcie serwera nadal widzieć wszystkie zapisane dane.

Dodatkowo zwykły gracz nie może wykonać żadnej operacji administracyjnej przez ręcznie skonstruowane żądanie.

## 27. Poza zakresem tej implementacji

Kreator ma przygotować integracyjne punkty zaczepienia, ale pierwsza implementacja nie musi jeszcze dostarczać pełnych edytorów:

- loot table,
- craftingu,
- sklepów NPC,
- questów,
- generatora losowych affixów,
- socketowania,
- systemu ulepszania,
- pełnego systemu profesji.

Te systemy będą później korzystać z centralnego katalogu itemów.
