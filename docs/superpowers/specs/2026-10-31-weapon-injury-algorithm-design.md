# Ulepszenia broni nadające urazy — uzgodniony algorytm

Data: 2026-10-31.

Status: algorytm zaakceptowany przez autora gry w rozmowie; 2026-11-01 zaimplementowany i po kolejnym poleceniu autora opublikowany na oficjalnym serwerze. Weryfikacja i granice wdrożenia: [raport](../../weapon-injuries-verification.md).

## Cel i zakres

Broń odpowiedniej jakości może otrzymać jedno ulepszenie nadające przeciwnikowi określony uraz po trafieniu. Rodzaj urazu i szansa nałożenia są losowane podczas ulepszania; czas działania oblicza algorytm. Gracz nie wybiera czasu.

Dokument obejmuje ograniczenie jakości, losowanie parametrów, obliczenie czasu i ponowne losowanie. Nie ustala sposobu zdobywania ulepszeń, ich kosztów, ekranów, pełnej tabeli skutków nowych urazów ani leczenia trwałych urazów po porażce. Te elementy nie były przedmiotem zaakceptowanego algorytmu.

## Uzgodnione reguły

- Ulepszenie jest dostępne tylko dla broni jakości Znakomita (`EXCELLENT`), Doskonała (`PERFECT`) i Arcydzieło (`MASTERWORK`). Zwykła, Normalna i Dobra nie kwalifikują się.
- Jedna broń ma najwyżej jeden przypisany rodzaj urazu.
- Podczas ulepszania losujemy rodzaj urazu z dostępnej puli oraz całkowitą szansę nałożenia od 5% do 15% włącznie.
- Rodzaj, szansa i obliczony czas zostają zapisane przy ulepszonej broni. Nie losujemy ich ponownie przy każdym ataku.
- Trafienie podczas walki daje próbę nałożenia zapisanego urazu z zapisaną szansą.
- Ponowne ulepszenie przelosowuje rodzaj oraz szansę i zastępuje poprzedni efekt; następnie przelicza czas. Nie tworzy drugiego efektu na tej samej broni.
- Czas może wynosić 2, 3, 4 lub 5 tur albo trwać do końca walki.

Nie ustalono, czy ponowne losowanie musi wykluczać dotychczasowy rodzaj urazu. Gwarantowana zmiana rodzaju nie jest zaakceptowaną zasadą.

## Rozważone podejścia

1. Czas wybierany przez gracza: autor odrzucił tę opcję.
2. Niezależne losowanie rodzaju, szansy i czasu: autor wskazał losowanie tylko rodzaju i szansy.
3. Losowanie rodzaju i szansy oraz automatyczne obliczenie czasu: zaakceptowany wariant. Dłuższe działanie wynagradza niższą szansę, a mocniejszy uraz skraca czas.

## Parametry obliczeń

Premia jakości `Q`: Znakomita = 0, Doskonała = 1, Arcydzieło = 2.

To nowa rola jakości w przyszłym systemie ulepszeń. Obecny kod opisuje jakość jako kosmetyczną; zapisanie projektu nie zmienia zachowania gry.

| Ciężkość | S | Przykłady z zaakceptowanego algorytmu |
|---|---:|---|
| Lekki | 0 | Wstrząśnienie, uszkodzone oko |
| Średni | 1 | Krwawienie, rana brzucha, uszkodzona dłoń |
| Ciężki | 2 | Złamana ręka, uraz nogi, rana klatki piersiowej |

Ciężkość jest cechą definicji urazu, a nie dodatkowym losowaniem. Klasyfikacja pozostałych proponowanych urazów należy do dopracowania tabeli balansu przed wdrożeniem pełnej puli.

## Obliczenie czasu

`C` to całkowita szansa wyrażona w procentach: dla 8% podstawiamy `C = 8`, a nie `0.08`.

```text
punkty = 15 - C + Q - 2 * S
tury = min(5, max(2, 2 + floor(punkty / 3)))
```

`floor` oznacza zaokrąglenie w dół. Wynik liczbowy jest zawsze jedną z wartości 2, 3, 4, 5.

Osobny warunek ma pierwszeństwo: jeśli jakość to `MASTERWORK`, ciężkość wynosi 0, a `C` wynosi 5 lub 6, efekt trwa **do końca walki**. Jest to odrębny stan czasu, nie sześć tur.

### Przykłady kontrolne

| Jakość | Uraz | C | S | Punkty | Wynik |
|---|---|---:|---:|---:|---|
| Znakomita | Złamana ręka | 12 | 2 | -1 | 2 tury |
| Doskonała | Uraz nogi | 8 | 2 | 4 | 3 tury |
| Arcydzieło | Krwawienie | 7 | 1 | 8 | 4 tury |
| Arcydzieło | Uszkodzone oko | 7 | 0 | 10 | 5 tur |
| Arcydzieło | Wstrząśnienie | 6 | 0 | 11 | Do końca walki |

## Odliczanie i odświeżanie

- Odliczamy pełne własne tury poszkodowanego, począwszy od jego następnej tury.
- Powtórne nałożenie tego samego urazu nie zwiększa kary. Odświeża czas, ale krótszy nowy efekt nie skraca już trwającego dłuższego efektu.
- Stan „do końca walki” jest dłuższy od dowolnego licznika tur i nie zostaje zastąpiony krótszym czasem.
- Urazy nadane ulepszeniem broni wygasają po zakończeniu walki. Ich pochodzenie należy oddzielić od trwałych urazów otrzymywanych przy spadku HP do zera.

## Granice przyszłej implementacji

Serwer powinien wykonywać losowania, sprawdzać jakość i własność przedmiotu oraz zapisywać wynik. Klient pokazuje potwierdzony wynik; nie narzuca wylosowanego urazu ani procentu. Są to wybory wykonawcze wynikające z istniejącej architektury serwera autorytatywnego.

Przed planowaniem całej funkcji trzeba określić jej zastosowanie w interfejsie i ekonomii gry, katalog dopuszczonych urazów z pełnymi skutkami oraz rozdzielenie czasowych efektów walki od trwałych urazów postaci. Ten dokument nie nadaje tym elementom nieuzgodnionych wartości.
