# Logowanie Google

Opcjonalne logowanie jest wspólne dla przeglądarki i Androida. Istniejące konta używają nadal loginu, hasła i kodu odzyskiwania. Pierwszy wybór niepowiązanego konta Google tworzy konto PLAYER; istniejące konto należy połączyć przez Menu → Konto → Połącz z Google, potwierdzając hasło gry.

## Google Cloud

Projekt utworzony dla tej gry: `borderland-chronicles-krystian`, numer `216526194523`.

1. Skonfiguruj nazwę aplikacji „Borderland Chronicles”, adres pomocy i odbiorców aplikacji w Google Auth Platform. W fazie testowej dodaj osoby testujące zgodnie z wymaganiami konsoli. Udostępnianie publiczne wymaga odpowiedniej konfiguracji ekranu zgody.
2. Utwórz klienta OAuth typu aplikacja internetowa. Autoryzowany origin produkcyjny: `https://borderland-chronicles-krystian.onrender.com`. Dla własnych lokalnych prób dodaj dokładny origin używanego serwera developerskiego. Ten przepływ używa callbacku GIS z tokenem ID, bez przekierowania na własny callback OAuth.
3. Utwórz klienta Android w tym samym projekcie dla pakietu `io.github.owca217.webmmorpg`. Lokalny podpis APK: SHA-1 `D1:1D:87:94:B3:FB:E2:5C:92:3B:0D:4D:41:1F:73:C5:5E:56:E7:8E`. Dla instalacji ze sklepu użyj osobnego wpisu z SHA-1 certyfikatu podpisywania aplikacji wskazanego przez Play Console. Certyfikat przesyłania AAB może być inny niż podpis aplikacji ze sklepu.
4. Na docelowym serwerze ustaw `GOOGLE_WEB_CLIENT_ID` na rzeczywisty identyfikator klienta internetowego. To publiczna konfiguracja; sekret klienta nie jest potrzebny do tego przepływu. Android również prosi o token dla tego klienta internetowego.

Bez tej zmiennej `/api/auth/providers` zwraca `google.enabled=false`. Formularz zwykłego logowania pozostaje dostępny, a przycisk Google jest ukryty. Identyfikator jest pobierany przez klienta z API, dzięki czemu zmiana konfiguracji nie wymaga ponownego pakowania aplikacji.

## Dane i zabezpieczenia

Serwer używa oficjalnego `google-auth-library` do weryfikacji podpisu, wystawcy i odbiorcy tokenu; dodatkowo wymaga niewygasłego tokenu oraz nonce z jednorazowego wyzwania serwera ważnego pięć minut. Wyzwanie łączenia jest przypisane do konta i jego bieżącej sesji. Powiązanie wymaga ponownego potwierdzenia hasła.

Trwałą tożsamością Google jest `sub`. Nie ma łączenia po adresie e-mail ani nazwie. Token ID może zawierać dane profilu przesłane przez Google, ale aplikacja nie zapisuje tokenów ani tych danych profilu; w bazie powiązania pozostają identyfikator Google, UUID konta gry i data utworzenia. Przycisk Google nie uruchamia automatycznego logowania One Tap.

Migracja `019_google_auth` dodaje tabele powiązań/wyzwań i dopuszcza brak lokalnego hasła oraz kodu odzyskiwania dla nowego konta Google. Zachowuje istniejące wartości. Role, blokady, postacie oraz zasada jednej aktywnej sesji pozostają obsługiwane przez własny serwer gry.

## Weryfikacja

Testy bazodanowe Google wymagają `GOOGLE_AUTH_TEST_DATABASE_URL` wskazującego dedykowaną lokalną bazę `google_auth_tests` na `127.0.0.1`. Istniejące testy auth używają `DATABASE_URL` i usuwają schemat: przypisuj do niej wyłącznie tę jednorazową bazę testową.

Testy jednostkowe sprawdzają kryptografię, odbiorcę, ważność tokenu i nonce; bazodanowe tworzenie/powrót/równoległość, powiązania i zachowanie lokalnych kont; klientowe anulowanie, zmiany sesji i ponawianie po błędzie socketu. Testy JVM obejmują obsługę cyklu życia natywnej operacji. Rzeczywisty wybór konta Google, konfigurację podpisów Google Play i próbę na urządzeniu sprawdza się osobno po skonfigurowaniu OAuth.

## Źródła

- [Konfiguracja klienta internetowego](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Weryfikacja tokenu na serwerze](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [Credential Manager na Androidzie](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation)
