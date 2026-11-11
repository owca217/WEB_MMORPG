# Dodatkowe logowanie przez Google — projekt integracji

Stan: zatwierdzony przez użytkownika 11 listopada 2026 r.; implementacja i konfiguracja w toku.

## Uzgodniony cel

Użytkownik chce, żeby gracz mógł utworzyć konto gry podczas pierwszego logowania kontem Google. Potwierdził, że Google ma być dodatkową metodą obok obecnego loginu i hasła. Integracja obejmuje aplikację Android oraz wersję przeglądarkową. Konta, postacie i postęp pozostają w dotychczasowej bazie PostgreSQL na Renderze.

## Podejście

Proponowane rozwiązanie zachowuje własny serwer uwierzytelniania: Google Identity Services w przeglądarce i Credential Manager na Androidzie dostarczają token tożsamości, który sprawdza serwer. Serwer wystawia dotychczasową sesję gry. Jest to wybór techniczny autora projektu, oparty na istniejącym backendzie i aplikacji Capacitor.

Rozważone warianty:

- Własny backend i oficjalne biblioteki Google — proponowany wariant; wykorzystuje obecną bazę, sesje i obsługę postaci.
- Zewnętrzna platforma uwierzytelniania, np. Firebase Auth — wymagałaby dodatkowego systemu i szerszej migracji istniejących kont; użytkownik zamówił dodatkową metodę logowania.
- Identyfikator Google Play Games jako główna tożsamość — nie odpowiada obecnym wytycznym Google. Osiągnięcia i rankingi pozostają osobnym możliwym rozszerzeniem.

## Zachowanie widoczne dla gracza

1. Ekran logowania zachowuje formularz loginu i hasła, rejestrację oraz odzyskiwanie konta. Obok pojawia się standardowy przycisk „Zaloguj się przez Google”. Okno wyboru Google otwiera się po działaniu gracza; brak automatycznego przejmowania ekranu logowania.
2. Pierwsze logowanie niepowiązanym kontem Google tworzy jedno konto gry z rolą PLAYER. Serwer nadaje mu unikalny, neutralny login techniczny. Nazwę postaci gracz wybiera w obecnym kreatorze. Adres e-mail ani nazwisko z Google nie stają się publiczną nazwą gracza.
3. Kolejne logowania tym samym kontem Google otwierają tę samą postać na Androidzie i w przeglądarce. Obowiązuje obecna reguła jednej aktywnej sesji konta.
4. Gracz mający już konto loguje się dotychczasowym loginem i hasłem, a następnie wybiera Menu → Konto → Połącz z Google. Potwierdza hasło gry i wybiera konto Google. Ekran logowania zawiera krótką wskazówkę o tej drodze, aby ograniczyć przypadkowe tworzenie drugiego konta.
5. Połączenie nie zmienia identyfikatora konta, loginu, hasła, kodu odzyskiwania, roli ani danych postaci. Panel Konto pokazuje stan połączenia bez wyświetlania adresu e-mail. Po sukcesie gracz pozostaje w tym panelu.
6. Jedno konto gry może mieć jedno powiązanie Google, a jedno konto Google może należeć do jednego konta gry. Próba połączenia z innym kontem kończy się czytelnym błędem i zachowaniem wszystkich danych. Ponowne połączenie tej samej pary jest bezpieczne.
7. Anulowanie okna Google pozostawia gracza na dotychczasowym ekranie. Błąd lub niedostępność Google pozwala nadal korzystać z formularza loginu i hasła. Zamknięcie panelu, wylogowanie lub zmiana sesji unieważnia oczekujące działania interfejsu.
8. Konto utworzone przez Google korzysta z Google do logowania i odzyskania dostępu. Ustawianie hasła dla takiego konta, odłączanie lub zamiana konta Google i scalanie dwóch kont gry nie wchodzą do pierwszego wydania.

Przyciski zamknięcia oraz Wstecz działają zgodnie z istniejącymi panelami. Wylogowanie kończy sesję gry i czyści stan automatycznego wyboru poświadczeń aplikacji; nie wylogowuje całego konta Google z urządzenia.

## Backend i trwałość danych

- Kluczem połączenia jest zweryfikowane Google `sub`, powiązane z istniejącym UUID konta gry. Nie łączymy kont na podstawie adresu e-mail, nazwiska ani nazwy wyświetlanej.
- Nowa tabela przechowuje powiązanie Google i datę jego utworzenia, z ograniczeniami unikalności po obu stronach. Nie zapisujemy tokenów Google, zdjęcia profilowego ani adresu e-mail.
- Hasło i kod odzyskiwania mogą być puste dla nowych kont Google. Migracja zachowuje wartości istniejących kont. Obecne logowanie i odzyskiwanie odrzucają brakujące lokalne poświadczenia w kontrolowany sposób.
- Utworzenie konta i powiązania odbywa się w jednej transakcji. Równoczesne pierwsze logowania nie tworzą osieroconych lub podwójnych kont. Operacja połączenia również jest atomowa.
- Wszystkie metody logowania sprawdzają status konta i korzystają ze wspólnej logiki tworzenia sesji. Konto zablokowane nie uzyskuje dostępu przez Google. Rola ADMIN nigdy nie jest nadawana na podstawie danych Google.
- Serwer weryfikuje podpis, wystawcę, czas ważności i odbiorcę tokenu oficjalną biblioteką Google. Używa skonfigurowanego identyfikatora klienta webowego także jako odbiorcy żądań natywnych.
- Każde logowanie i połączenie używa losowego wyzwania serwera ważnego pięć minut. Token Google musi zawierać przypisany nonce. Wyzwanie jest jednorazowe, związane z celem operacji, a przy łączeniu także z bieżącą sesją konta. Weryfikacja i wykorzystanie wyzwania zapobiegają ponowieniu operacji. Limity prób i usuwanie wygasłych wyzwań ograniczają nadużycia.
- Łączenie wymaga ważnej sesji gry i ponownego potwierdzenia hasła istniejącego konta. Nie ma automatycznego scalania ani przepinania istniejących powiązań.

## Konfiguracja i granice prac

Docelowy serwer to `https://borderland-chronicles-krystian.onrender.com`. Android zachowuje pakiet `io.github.owca217.webmmorpg` oraz dotychczasowy podpis. Punktem wyjścia jest aktualna kopia `weapon-proficiencies`, commit bazowy `ffccc81413b186998c837b3122ee0ac7c3b36d46`, wraz z zachowanymi zmianami wydania 0.1.32.

W Google Cloud potrzebne są projekt, konfiguracja ekranu zgody oraz klienci OAuth dla aplikacji webowej i Androida. Klient webowy dopuszcza produkcyjny adres gry. Klient Androida używa pakietu gry i certyfikatu podpisu odpowiedniego dla dystrybucji. Dla Google Play należy odczytać SHA-1 podpisu aplikacji w Play Console; lokalny APK ma SHA-1 `D1:1D:87:94:B3:FB:E2:5C:92:3B:0D:4D:41:1F:73:C5:5E:56:E7:8E`.

W dniu przygotowania projektu nie ma dostępnej zalogowanej karty Google Cloud ani Play Console. Identyfikatory klientów OAuth nie zostały jeszcze pozyskane. Nie wpisujemy przykładowych identyfikatorów do wydania. Ten przepływ nie wymaga sekretu klienta w aplikacji ani przesyłania haseł Google do serwera gry.

Serwer udostępnia klientowi informację, czy Google jest skonfigurowane, i publiczny identyfikator klienta. Przy braku konfiguracji działa obecny system kont; interfejs nie pokazuje przycisku obiecującego niedostępną funkcję. Awaria usługi zewnętrznej nie wyłącza zwykłego logowania.

Przewidziany wynik po implementacji: działająca integracja webowa, natywny most Capacitor, wdrożenie na istniejącej usłudze Render oraz podpisane APK i AAB z kolejnym wolnym numerem wersji. Przed migracją produkcyjną powstaje kopia bazy. Dotychczasowe pliki wydań i kopie serwera pozostają zachowane.

## Sprawdzenia potrzebne do odbioru

- Wydzielona, jednorazowa lokalna baza testowa: zachowanie dotychczasowych kont po migracji, utworzenie jednego nowego konta Google, powracające i równoległe logowanie, łączenie bez zmiany danych postaci oraz konflikty powiązań. Istniejące testy uwierzytelniania usuwają schemat; nigdy nie uruchamiamy ich z adresem bazy produkcyjnej.
- Testy weryfikacji tożsamości: niewłaściwy podpis lub odbiorca, wygasły token, niezgodny/wygasły/użyty nonce, pomylenie logowania z łączeniem, blokada konta i błędne hasło potwierdzające. Testy jednostkowe korzystają z kontrolowanego weryfikatora; nie zastępuje on weryfikatora produkcyjnego.
- Testy interfejsu i API: zwykłe logowanie nadal działa, istniejące konto zachowuje swoją postać, Google można anulować, błędy nie usuwają formularza, a spóźniony wynik po wylogowaniu lub zamknięciu panelu nie zmienia sesji.
- Kontrola typów klienta i serwera oraz kompilacja web/Android. Sprawdzenie podpisów i manifestów końcowych APK i AAB.
- Próba rzeczywistego wyboru konta Google w przeglądarce oraz na Androidzie z usługami Google Play, po skonfigurowaniu OAuth. Wyniki prób na urządzeniu, emulatorze, wersji lokalnej i wersji Google Play raportujemy oddzielnie. Sam build nie oznacza potwierdzenia logowania Google.

Dobór klas, nazw tras, kolejnego numeru migracji i wersji stabilnych bibliotek pozostaje po stronie wykonawcy. Używamy istniejących wzorców repozytorium i tylko testów dotyczących zmiany oraz jej bezpośrednich skutków.

## Źródła techniczne

- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
- https://developer.android.com/games/pgs/migration_overview
