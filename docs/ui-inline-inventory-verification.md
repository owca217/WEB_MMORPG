# Plecak w bocznym panelu — 31 października 2026

Kliknięcie przypisanej torby przełącza zawartość pod slotami. Boczny panel korzysta z dotychczasowego ContainerContentsPanel i InventoryDragController: zachowuje przenoszenie między torbami, przypisywanie pojemników, zakładanie wyposażenia, oczekujące przedmioty, jakość, paginację oraz potwierdzenia serwera. Sloty mają36×36px. Pusty zwykły slot nadal może otworzyć wybór torby; szczegóły przedmiotu zachowują osobny podgląd.

Stały panel nie jest dialogiem i nie blokuje chodzenia po mapie. Skrót I rozwija torby na telefonie; C pozwala zachować widoczną siatkę przy karcie postaci. W pionie oba obszary są ułożone jeden nad drugim, w poziomie obok siebie, z niezależnym przewijaniem. Zamknięcie paska nie unieważnia trwającego potwierdzenia operacji.

Weryfikacja:

-46 testów WorldHud/WorldScene/NPC oraz30 testów zawartości/przeciągania przeszło. Obejmują przeciąganie z faktycznie zamontowanej siatki, busy/stale-ACK, puste i brakujące torby, widok oczekujących, ruch po mapie, kompaktowe I/C i natywny Back podczas przeciągania.
- Końcowy build przeglądarki i Android APK zakończyły się powodzeniem; TypeScript i podpis APK sprawdzone.
- Przegląd integracji: naprawione rozbieżności pustego slotu, brakującego plecaka, układu telefonu i natywnego Back. Brak pozostałych zgłoszeń.
- W przeglądarce na osobnym lokalnym koncie testowym sprawdzono: oczekująca torba→slot2, miecz→druga torba klawiaturą, miecz→stały plecak myszą, miecz→slot broni na telefonie z potwierdzonym stanem serwera. Układy390×844 i844×390 pokazują oba panele w oddzielnych granicach; dolne menu pozostaje dostępne.
- Testy mutujące wykonano na `ui_preview_mvvlc7hs`, pod osobnym originem localhost. Dane i sesja owca/yuna pod127.0.0.1 pozostały zachowane. Zamknięto kartę testową i pozostawiono właściwy podgląd w domyślnym rozmiarze.
- Nie uruchamiano ponownie całego zestawu ani testów resetujących bazę. Kod serwera/shared i protokoły bez zmian. Nie wykonano wdrożenia produkcyjnego ani testu na fizycznym telefonie.

Screenshoty: `artifacts/ui/current-inline-inventory.jpg`, `current-inline-equipment-phone.jpg`. APK: `artifacts/android/WEB-MMORPG-0.1.24-debug.apk`. SHA256: `14256bad519d380929ca11a609c13743402f4e9b351310a213f0d6397c758b44`.
