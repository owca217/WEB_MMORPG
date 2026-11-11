# Kroniki Pogranicza — klient Android

Klient jest pakowany przez Capacitor 8 z tego samego kodu Phaser co wersja przeglądarkowa. APK zawiera grafiki i kod interfejsu. Logowanie, postacie, doświadczenie, ekwipunek i rozgrywka korzystają z serwera `https://borderland-chronicles-krystian.onrender.com` i istniejących kont. Gra wymaga internetu.

Wybór implementacyjny: pakiet Android z lokalnymi zasobami zapewnia wspólny rozwój gry i instalację z APK. Osobne przepisanie gry na silnik natywny powieliłoby kod; samo otwieranie strony w WebView uzależniałoby ekran startowy od pobrania całego klienta. Nie ustawiamy produkcyjnego `server.url` w konfiguracji Capacitor.

## Instalacja

Lokalne wydanie 0.1.33 (kod wersji 34): [Borderland-Chronicles-0.1.33.apk](../artifacts/android/Borderland-Chronicles-0.1.33.apk) do instalacji na telefonie oraz [Borderland-Chronicles-0.1.33.aab](../artifacts/android/Borderland-Chronicles-0.1.33.aab) do przesłania do Google Play. Otwórz APK na telefonie i, jeśli Android tego zażąda, zezwól tej aplikacji pobierającej plik na instalację. Zaloguj się na dotychczasowe konto gry. Aktualizacja z poprzednich wersji używa tego samego podpisu i zachowuje dane aplikacji.

Wersja 0.1.1 zastępuje przycisk Ekwipunek czterema slotami na pojemniki w panelu gry. Kliknięcie slotu otwiera wybór własnego przedmiotu kategorii Pojemniki; przypisanie jest sprawdzane przez serwer i zapisane przy postaci.

Wersja 0.1.2 dodaje do katalogu pojemnik „Szmaciany worek” z 8 miejscami. Kliknięcie wyposażonego worka otwiera jego zawartość; cały stos zajmuje jedno miejsce. Puste sloty panelu mają czarne tło i wyblakłą ikonę plecaka. Na telefonie przycisk w nagłówku zwija panel gry do jednej ikony; ponowne dotknięcie go rozwija.

Wersja 0.1.3 dodaje izometryczną planszę walki po prawej i szczegóły własnej postaci po lewej. Dotknięcie przeciwnika wybiera cel i pokazuje dopasowany atak, szansę trafienia i obrażenia po pancerzu; przycisk podglądu potwierdza atak. Zielone pola pokazują aktualny zasięg ruchu z uwzględnieniem AP, przeszkód i urazów. W panelu można użyć przedmiotów użytkowych z ekwipunku, także z pojemników, za 2 AP. Podstawowy bandaż leczy 30 HP. Obecne poprawne ataki zawsze trafiają, dlatego podgląd pokazuje 100%; cel poza zasięgiem lub za przeszkodą jest niedostępny.

Wersja 0.1.4 dodaje ikonę czatu w prawym dolnym rogu świata i walki. Zakładka „W pobliżu” obejmuje postacie w widocznym obszarze kamery i pokazuje sześciusekundowe dymki nad nadawcą; podczas walki korzystaj z zakładki „Ogólny”. Czat ogólny łączy wszystkich graczy online niezależnie od miejsca. Serwer przechowuje ostatnie 50 wiadomości ogólnych do restartu, a klient do 100 wiadomości na kanał w bieżącej sesji. Wiadomość ma limit 300 znaków. Pisanie zatrzymuje sterowanie postacią; Enter wysyła, Escape lub Wstecz zamyka okno. Widok dopasowuje się do rozmiaru ekranu i klawiatury.

Wersja 0.1.5 dodaje panel „Społeczność” obok ikony czatu. Drużyna mieści do 5 osób; zwycięzca walki otrzymuje +10% XP za każdego dodatkowego członka online w tej samej lokacji i zasięgu 800, maksymalnie +40%. Członek musi należeć do drużyny na początku i końcu walki. Spotkania nadal rozgrywa się indywidualnie. Lista znajomych i zaproszenia są zapisywane w bazie, wraz z możliwością akceptacji, odrzucenia, anulowania i usunięcia znajomości. Handel przedmiotami wymaga bliskości (160), braku walki i potwierdzenia tej samej oferty przez obie strony. Zmiana oferty zeruje potwierdzenia. Całe przedmioty i części stosów są przekazywane w jednej transakcji; pojemniki muszą być puste i zdjęte ze slotu. Rozłączenie, walka, odległość lub upływ czasu anulują trwające zaproszenie/wymianę. Drużyny i otwarte wymiany są sesjami na żywo.

Wersja 0.1.6 dodaje osobne skórki pixel art dla Borana, Ady i kupca Miro. Miro stoi przy placu osady, blisko miejsca startu. Podejdź i dotknij go, aby otworzyć sklep: bandaż (5 złota, 30 HP), Szmaciany worek (30 złota, 8 miejsc), mała mikstura leczenia (10 złota, 50 HP) i Tonik wigoru (12 złota, 3 PA). Przedmioty użytkowe działają w walce według obecnych zasad. Każda postać otrzymuje jednorazowo 100 złota, również postacie utworzone przed aktualizacją; zwycięstwo nad wilkami daje 15 złota. Stan portfela zapisuje się oddzielnie od pozycji i statystyk. Zakup wymaga obecności przy kupcu poza walką; złoto i przedmioty zapisują się w jednej transakcji. Ponowienie niepotwierdzonego zakupu używa tego samego identyfikatora i nie pobiera opłaty ponownie. Złoto jest widoczne w panelu gry i sklepie.

Wersja 0.1.7 odświeża teren i roślinność Zielonego Brzegu. Trawa, ziemna droga i leśne podłoże otrzymują tekstury pixel art; drzewa liściaste, sosny, krzewy i niskie rośliny korzystają z osobnych grafik z przezroczystością. Podłoże powtarza małe tekstury, a roślinność pozostawia wolne przejścia, NPC i miejsce spotkania z wilkami. Zasoby są zawarte w APK i wczytywane razem z lokacją; przy niedostępnym obrazie pozostaje widoczny prosty odpowiednik.

Wersja 0.1.8 dodaje menu przy potworze z opcjami „Walcz” i „Auto”. Samo dotknięcie potwora otwiera wybór; wybrana opcja uruchamia spotkanie w dotychczasowym zasięgu. Auto wykonuje ruchy i ataki po stronie serwera, priorytetowo eliminując możliwych do dobicia przeciwników i dobierając pozycję oraz ataki do kosztu PA, pancerza i przeszkód. Nie wydaje przedmiotów użytkowych. Panel walki pokazuje włączony automat i pozwala przejąć sterowanie lub ponownie włączyć auto. Wynik przyznaje zwykłe doświadczenie, złoto, premię drużyny i łup. Automat kończy się wraz z walką lub rozłączeniem; po ponownym połączeniu klient wraca do świata. Menu dopasowuje pozycję do kamery i ekranu telefonu.

Wersja 0.1.9 dodaje małe menu przy NPC. „Rozmowa” jest dostępna u każdej postaci niezależnej, a „Sklep” tylko u kupca. Kliknięcie Miro pozwala teraz osobno wybrać dialog lub ofertę handlową. Dialog Ady zachowuje leczenie. Menu podąża za postacią wraz z kamerą i mieści się na ekranie telefonu; można je zamknąć kliknięciem poza nim, Escape lub Wstecz. Nowy wybór zamyka poprzednie okna NPC, a opóźnione odpowiedzi nie otwierają nieaktualnego sklepu lub rozmowy.

Wersja 0.1.10 dodaje automatyczne podejście do NPC po wybraniu „Rozmowa” lub „Sklep”, gdy postać jest poza zasięgiem. Wybrana interakcja otwiera się dopiero po potwierdzeniu przez serwer, że gracz dotarł wystarczająco blisko. Ręczny ruch, wybór innego celu lub utrata połączenia anulują podejście.

Wersja 0.1.11 dodaje siedem biegłości broni w panelu postaci: miecze, topory, broń obuchowa, sztylety, broń drzewcowa, łuki i kusze. Każda rozwija się niezależnie od 0 do 100. Za każdy zaakceptowany przez serwer atak, również w trybie Auto, wybrana biegłość otrzymuje 1 punkt doświadczenia treningowego. Każdy poziom daje 0,25% premii do obrażeń odpowiedniego stylu, do 25%; wypracowana premia obowiązuje od kolejnej walki. Postęp zapisuje się przy postaci. Poza walką można wybrać jeden styl wręcz i jeden dystansowy. Ten wybór dotyczy stylów walki i nie wyposaża przedmiotu z ekwipunku.

Wersja 0.1.12 dodaje kostury leczące i tarcze do stylów walki. Kostur leczy siebie w walce za 3 AP, raz na turę; na mapie pozwala leczyć siebie i pobliskich członków drużyny w tej samej lokacji (zasięg 160, odnowienie 10 sekund, poza walka). Nie usuwa urazow ani nie wskrzesza. Biegłość kosturów rosnie tylko za faktycznie przywrócone HP. Tarcza pasywnie ogranicza obrażenia atakow po pancerzu o 10-25%, zostawiajac co najmniej 1 obrażenie; rozwija się przy skutecznie ograniczonych uderzeniach, bez treningu za krwawienie. Auto moze uleczyć siebie przy HP do 35%, jeśli akcja jest dostępna.

Wersja 0.1.13 dodaje wspólne walki drużynowe. Rozpoczęcie spotkania dołącza dostępnych, żywych członków drużyny online w tej samej lokacji, niezależnie od odległości; postacie już walczące lub zajęte są pomijane. Wszyscy widzą tę samą arenę, a każdy steruje własną postacią podczas jej tury i osobno włącza Auto. Kostur może leczyć żywego sojusznika w zasięgu 6 pól i linii widzenia za 3 AP, raz na turę; nie wskrzesza. Pula doświadczenia jest dzielona przez liczbę uczestników na początku walki, a złoto, łup i premia drużyny rozliczane osobno. Rozłączenie usuwa tylko daną postać, zachowuje jej bieżące HP i urazy oraz pozbawia ją nagród za tę walkę; pozostali mogą kontynuować. Po zakończeniu żywi wracają na poprzednie pozycje, a pokonani odradzają się w osadzie.

Wersja 0.1.14 dodaje „Gęsty Las” na wschód od osady. Wejście w oznaczony obszar przy prawej krawędzi osady przenosi do lasu, a obszar przy lewej krawędzi lasu prowadzi z powrotem. Las zawiera nowe grupy dzików, pająków leśnych i wilków. Pokonana grupa odradza się po 3 minutach; znacznik pokazuje pozostały czas i blokuje ponowną walkę. Licznik jest wspólny dla graczy i zapisany na serwerze, więc ponowne logowanie ani restart serwera go nie skracają.

Wersja 0.1.15 dodaje kolizje pni drzew, skał, budynków i ogrodzenia w obu lokacjach. Kliknięcie celu wyznacza przejście omijające przeszkody; podejście do NPC wybiera dostępne miejsce w zasięgu rozmowy lub sklepu. Brama, ścieżki i obszary teleportacyjne pozostają drożne. Ruch jest sprawdzany również na serwerze; krzewy i drobna roślinność pozostają dekoracją.

Wersja 0.1.16 dzieli okno postaci na zakładki „Statystyki”, „Władanie” i „Uzbrojenie”. Broń, tarczę i sześć części pancerza zakłada się z posiadanych przedmiotów poza walką; podstawowe wyposażenie sprzedaje Miro. Łuki, kusze i kostury zajmują obie ręce. Ataki, leczenie i parametry postaci wynikają z faktycznie założonych przedmiotów, a stare zapisane style nie zastępują broni. Połowa zdobytego doświadczenia za zwycięstwo jest dzielona między faktycznie użyte rodzaje broni i tarczę; dotychczasowy postęp zostaje zachowany. Założonych przedmiotów nie można przekazać w handlu ani schować do pojemnika.

Wersja 0.1.17 dodaje sześć jakości przedmiotów: „Zwykła” (szara), „Normalna” (biała), „Dobra” (zielona), „Znakomita” (niebieska), „Doskonała” (złota) i „Arcydzieło” (czerwona). Jakość wpływa na oznaczenie i kolor przedmiotu, bez zmiany statystyk. Istniejące przedmioty bez przypisanej jakości otrzymują domyślnie jakość „Normalna”.

Wersja 0.1.18 zastępuje lewy slot pojemnika stałym plecakiem z 16 miejscami i nową grafiką. Każda postać otrzymuje go od początku i nie może go zdjąć ani zastąpić innym pojemnikiem. Pozostałe trzy sloty nadal służą zwykłym pojemnikom. Dotychczasowy pojemnik z lewego slotu pozostaje w ekwipunku jako niewyposażony i zachowuje swoją zawartość.

Wersja 0.1.19 automatycznie odkłada zdobyte przedmioty najpierw do stałego plecaka, a następnie do wyposażonych pojemników w kolejności pozostałych trzech slotów. Gdy wszystkie są pełne, przedmioty pozostają zapisane w widoku „Oczekujące” i trafiają do pojemników po zwolnieniu miejsca. Dolna sekcja „Włóż do pojemnika” znika; kliknięcie przedmiotu otwiera menu przenoszenia lub zakładania. Pojemniki przechowywane w plecaku można przypisać do wolnych slotów, a przechowywane przedmioty nadal można przekazywać w handlu.

Wersja 0.1.20 upraszcza sloty ekwipunku do ikon przedmiotów. Pełne informacje o wybranym przedmiocie są dostępne w osobnym oknie szczegółów, otwieranym z jego menu. Zmiana obejmuje również interfejs telefonu.

Wersja 0.1.21 zmniejsza sloty ekwipunku o połowę i dodaje przenoszenie przedmiotów przez przeciąganie nad wyposażony pojemnik. Na komputerze przeciągnij ikonę myszą; na telefonie najpierw przytrzymaj ją dłużej, a następnie przeciągnij nad wybrany pojemnik. Okno szczegółów nie zawiera już opcji „Przenieś”.

Wersja 0.1.22 wyśrodkowuje podgląd przeciąganego przedmiotu pod kursorem lub palcem. Upuszczenie przedmiotu na pasujący slot uzbrojenia zakłada go, jeśli spełnia wymagania tego slotu i postaci.

Wersja 0.1.23 pozwala przypisać pojemnik przez upuszczenie go na jeden ze zwykłych slotów 2–4, także z widoku „Oczekujące” i z zachowaniem zawartości. Przedmioty można przenosić między założonymi pojemnikami przez przeciągnięcie nad ich ikonę. Obsługiwane są również starsze plecaki z pojemnością zapisaną jako dodatkowe miejsca. Podczas przeciągania pasek pojemników pozostaje nad oknami gry. Administrator może dodać wybraną ilość opublikowanego przedmiotu z katalogu do ekwipunku swojej aktualnej postaci.

Wersja 0.1.24 porządkuje panel kategorii przedmiotów administratora. Wyszukiwarka filtruje kategorie i podkategorie, karty oraz grupy można zwijać, a pola wyboru są ułożone w siatce. Tworzenie kategorii i podkategorii ma osobne sekcje formularza.

Wersja 0.1.26 nadaje grze nazwę „Kroniki Pogranicza”. Nowa nazwa jest widoczna w aplikacji i na liście zainstalowanych aplikacji Androida. Aktualizacja zachowuje identyfikator aplikacji, podpis oraz istniejące konto i dane.

Wersja 0.1.27 dodaje drzewka umiejętności dziewięciu rodzin broni w zakładce Postać → Władanie. Co 5 poziomów władania otrzymujesz 1 punkt danej rodziny, również za wcześniej zdobyte poziomy. Każde drzewko ma dwie gałęzie i cztery węzły: trzy techniki aktywne oraz pasyw. Pełne drzewko kosztuje 24 punkty, a poziom 100 daje 20. Wybrane techniki wymagają odpowiedniej założonej broni lub tarczy i mają koszt AP oraz odnowienie w walce. Auto korzysta z wyuczonych technik; reset jednej rodziny poza walką jest darmowy i zachowuje XP.

Wersja 0.1.28 zachowuje tło i zawartość bocznego panelu podczas przeciągania przedmiotów. Sloty pojemników pozostają dostępne do przenoszenia przedmiotów.

Wersja 0.1.29 dodaje opisy aktywnych urazów postaci oraz umożliwia ich całkowite wyleczenie u uzdrowicielki. Leczenie przywraca zdrowie i usuwa zapisane urazy.

Wersja 0.1.30 zastępuje ogólny poziom postaci statystykami wyposażenia i premiami specjalizacji. Osobne okno „Drzewko specjalizacji” otworzysz przyciskiem Specjalizacje (na komputerze także K). Mapa zawiera zachowane techniki broni oraz rozwój pancerzy płóciennych, skórzanych i płytowych. Można ją przesuwać i powiększać, a szczegóły węzła pokazują wymagania i dostępne punkty. Noszone pancerze otrzymują połowę nagrody XP za zwycięstwo, dzieloną według liczby elementów; druga połowa rozwija użyte rodzaje broni. Kupiec oferuje również podstawowe skórzane i płytowe uzbrojenie. Dotychczasowe XP specjalizacji, wyuczone techniki i ekwipunek zostają zachowane.

Wersja 0.1.31 odświeża wygląd walki. Gracze i członkowie drużyny używają wybranych skórek ze świata gry; portret postaci pokazuje tę samą skórkę. Plansza korzysta z tekstur terenu, przeciwnicy z istniejących grafik, a przeszkody i osłony otrzymują nowe omszałe skały i powalone pnie. Bandaż, mikstura leczenia i tonik wigoru mają nowe ikony także w plecaku. Oznaczenia zasięgu ruchu, wyboru celu i aktywnej tury pozostają widoczne na teksturowanym podłożu. Na niskim ekranie poziomym sterowanie zajmuje boczną kolumnę, pozostawiając planszy całą wysokość ekranu.

Wersja 0.1.32 łączy aplikację z serwerem na koncie Krystiana: `https://borderland-chronicles-krystian.onrender.com`. Pakiet pozostaje `io.github.owca217.webmmorpg`, a kod wersji wzrasta do 33. Wydanie zachowuje funkcje wersji 0.1.31 i korzysta z przeniesionej bazy kont oraz postaci.

Wersja 0.1.33 dodaje obsługę opcjonalnego logowania Google na Androidzie oraz w przeglądarce. Istniejące konto można połączyć w Menu → Konto → Połącz z Google, potwierdzając obecne hasło gry. Funkcja wymaga skonfigurowania rzeczywistych klientów OAuth w Google Cloud i `GOOGLE_WEB_CLIENT_ID` na serwerze; do czasu konfiguracji działa zwykły formularz konta. Aplikacja pobiera publiczny identyfikator klienta z serwera. Nie zapisuje danych profilu Google ani tokenów Google. Zwykły login i hasło pozostają dostępne. Konto utworzone przez Google korzysta z Google do odzyskania dostępu.

Wymagania: Android 7 (API 24) lub nowszy oraz aktualny Android System WebView / Chrome (wersja co najmniej 111). Aplikacja działa w poziomie i wymaga wyłącznie uprawnienia do internetu. Przycisk Wstecz zamyka otwarty panel, a następnie minimalizuje grę.

Krótka wizyta w tle zachowuje działającą sesję. Po utracie połączenia klient ponownie uwierzytelnia konto i odtwarza świat. Serwer usuwa niedokończoną walkę przy rozłączeniu; zapisany postęp postaci pozostaje zachowany.

## Kompilacja

Wymagane: Node.js 22+, JDK 21, Android SDK platform 36 i build-tools 36.0.0. Zainstaluj zależności `npm ci`. Ustaw `JAVA_HOME` i `ANDROID_HOME` odpowiednio do swojego komputera.

Z katalogu repozytorium:

```powershell
npm run android:apk -w @web-mmorpg/client
```

Polecenie buduje osobny `apps/client/dist-android`, synchronizuje zasoby i pluginy, uruchamia Gradle oraz kopiuje debug APK i SHA-256 do `artifacts/android`. Nie nadpisuje przeglądarkowego `dist`. `npm run android:open -w @web-mmorpg/client` otwiera projekt w Android Studio.

Podpisane wydanie wymaga czterech zmiennych środowiskowych, których wartości należy przechowywać poza repozytorium:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

```powershell
npm run android:apk -w @web-mmorpg/client -- --release
```

Zachowaj kopię klucza podpisu: kolejne aktualizacje APK muszą być podpisane tym samym kluczem. Klucze i hasła nigdy nie są dołączane do APK ani Git. Podpisane wydanie nie zawiera możliwości zdalnego debugowania WebView.

Domyślny serwer HTTPS można zastąpić przez `ANDROID_GAME_SERVER_URL`. Skrypt odrzuca HTTP, adresy z hasłami, parametrami i ścieżką API. Osobny workflow **Android APK** buduje testowy debug APK; dystrybucja podpisanego wydania używa zachowanego klucza. Publikacja w Google Play wymaga osobnego konta wydawcy i konfiguracji sklepu.

## Weryfikacja

Testy obejmują ponowne uwierzytelnianie po utracie sieci, wyścig zapisu przy szybkim ponownym połączeniu, cykl życia aplikacji, dotykowe ataki i dopasowanie planszy do poziomego ekranu telefonu. Podpis APK należy sprawdzić narzędziem `apksigner verify`, a uruchomienie i ekran logowania na emulatorze lub telefonie.

Dokumentacja źródłowa: [Capacitor Android](https://capacitorjs.com/docs/android), [konfiguracja](https://capacitorjs.com/docs/config), [cykl życia App](https://capacitorjs.com/docs/apis/app).
