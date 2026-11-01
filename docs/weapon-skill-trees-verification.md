# Drzewka władania — weryfikacja

## Dostarczone zachowanie

Dziewięć rodzin ma po cztery węzły w dwóch gałęziach: trzy aktywne techniki i jeden pasyw. Punkty wynikają z aktualnego poziomu (1 co5, maksymalnie20); koszt pełnego drzewka24 wymusza wybór. Nauka i darmowy reset rodziny zapisują się w istniejącym JSON treningu. Zachowano XP oraz dotychczasowe premie i urazy.

Władanie pokazuje drzewko przed zwiniętą listą starych pasków. Podczas walki działa wybór techniki i celu, podgląd efektu, AP i odnowienia; na telefonie techniki otwiera przycisk. Auto wykorzystuje wyuczone techniki. Efekty tarczy nie zmieniają trwałych statystyk. Bastion trwa do początku drugiej kolejnej tury postaci.

## Celowane kontrole

- Shared: nowe testy `weaponSkills.test.ts` oraz istniejące `weapons.test.ts`:14przeszło. Testy pasywów i ekwipunku `equipmentCombat.test.ts`:6przeszło. Nowe przypadki odtworzyły brak funkcji przed podłączeniem i brak działania pasywu przed poprawką.
- Silnik:8nowych testów `weaponSkillBattle.test.ts`, w tym atak, leczenie, odnowienie, tarcza, Auto, filtrowanie według założonej rodziny i izolacja snapshotów. Bezpośrednio dotknięte zestawy walki, treningu, urazów i Auto:60przeszło; po końcowych poprawkach dotknięte zestawy leczenia, tarcz, drużyny i serwisu:42przeszło.
- Zapis/socket: `socketWeaponSkills.test.ts`:5przeszło z `DATABASE_URL=postgresql://postgres@127.0.0.1:15433/web_mmorpg_test`. Pokryto brak autoryzacji, ponowienie nauki, XP, reconnect, reset rodziny, równoległe akcje, walkę/handel, zmianę sesji, błąd zapisu, utracony COMMIT i odczyt wyniku. Pusty reset po utraconym COMMIT był odtworzony jako błąd przed poprawką.
- Klient:6celowanych zestawów drzewa, technik, scen, HUD i socketów:70przeszło. Poprawkę prezentacji Bastionu potwierdził osobny przypadek. Końcowe poprawki typów sprawdzono w dwóch dotkniętych zestawach:21przeszło.
- TypeScript serwera/shared przeszedł w kontroli integracyjnej. Błędy zawężania typu klienta i fikstur z optionalproperty naprawiono; `npx tsc --noEmit -p apps/client/tsconfig.json` i `npm run build -w @web-mmorpg/client` przeszły. Ostatnia zmiana nazwy w nagłówku świata została objęta kompilacją Vite. Istniejące ostrzeżenie o wielkości pakietu pozostaje.
- Jeden niezależny przegląd integracji nie wykazał dodatkowych pewnych usterek funkcjonalnych. Nie uruchamiano pełnej lokalnej kolekcji.

## Działająca gra

Osobny lokalny serwer `http://localhost:13004/` i baza `weapon_skills_qa_20261101` w odizolowanym klastrze15433. Baza graczy i główny checkout nie były używane do zmian/testów.

Przez rzeczywisty interfejs potwierdzono logowanie, poziom100 i20punktów za wcześniejszy trening, naukę pierwszej techniki (18punktów), odblokowanie następcy, darmowy reset do20, naukę dwóch technik i następcy (4punktypozostałe), blokadę pasywu wymagającego8punktów oraz zachowanie wyborów po przeładowaniu i ponownym uwierzytelnieniu. Nie zmieniano postaci graczy.

Przy szerokości390px panel miał354px, drzewko328px, a każdy węzeł159,5px; nie występowało poziome przepełnienie. Zapisano rzeczywiste zrzuty desktop i telefonu w katalogu wizualizacji bieżącego czatu. Podgląd zamknięto i przywrócono domyślny rozmiar przeglądarki.

Podpisany Android0.1.27/code28 i oficjalne wdrożenie są kontrolowane w etapie wydania. Nie wykonano fizycznego testu na urządzeniu Android; podgląd telefonu oznacza rozmiar przeglądarki.
