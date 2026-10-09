# WEB MMORPG — przywrócenie trwałych kont i integracja ADMIN

**Data:** 2026-10-09  
**Status:** specyfikacja po self-review, gotowa do końcowego review użytkownika  
**Gałąź:** `feature/account-auth-restoration`  
**Baza:** `main`

## 1. Cel

Przywrócić pełny system kont oparty o login i hasło oraz zintegrować go z obecną wersją gry i nowym Item Creatorem. Po wdrożeniu konto użytkownika ma być jedynym źródłem tożsamości i roli w całej grze.

Docelowy przepływ:

`rejestracja/logowanie -> konto PostgreSQL -> trwała sesja -> postać -> świat gry`

oraz dla administratora:

`konto.role = ADMIN -> ta sama sesja -> Admin API -> Panel Admin -> Kreator Przedmiotów`

Obecny mechanizm `nickname + ADMIN_ACCESS_TOKEN` jest traktowany jako tymczasowy bootstrap z poprzedniego etapu i zostanie usunięty z normalnego logowania.

## 2. Zakres

W zakresie są:

- rejestracja konta,
- logowanie loginem i hasłem,
- Argon2id dla haseł,
- trwałe sesje w PostgreSQL,
- automatyczne wznowienie sesji po ponownym otwarciu klienta,
- wylogowanie,
- odzyskiwanie hasła przez recovery code,
- rotacja recovery code po odzyskaniu,
- unieważnienie starych sesji po odzyskaniu hasła,
- role `PLAYER` i `ADMIN` zapisane w bazie,
- integracja roli konta z obecnym Admin API i Item Creatorem,
- bootstrap pierwszego konta ADMIN,
- panel administracyjny do zarządzania rolą i statusem kont,
- trwałe powiązanie konta z postacią,
- przywrócenie flow `AuthScene -> CharacterCreatorScene -> WorldScene`,
- migracja istniejącej bazy bez usuwania danych katalogu przedmiotów,
- testy jednostkowe, integracyjne, E2E i produkcyjne.

## 3. Poza zakresem

Na tym etapie nie wdrażamy:

- logowania przez Google/Discord/Steam,
- odzyskiwania hasła przez e-mail,
- 2FA,
- CAPTCHA,
- wielu postaci na jednym koncie,
- panelu aktywnych urządzeń/sesji,
- pełnego systemu uprawnień granularnych poza `PLAYER`/`ADMIN`,
- nowego lub rozszerzonego systemu usuwania postaci; istniejące historyczne pola lifecycle można zachować technicznie, ale nie są częścią tej funkcji.

Projekt ma pozostawić możliwość dodania tych funkcji później bez przebudowy podstawowego modelu konta.

## 4. Istniejące elementy do ponownego użycia

Na historycznej gałęzi `feature/mvp-vertical-slice` istnieją już komponenty, które należy przenieść lub zaadaptować zamiast pisać drugi system auth od zera:

- `apps/server/src/auth/AuthService.ts`,
- `apps/server/src/auth/credentials.ts`,
- `apps/server/src/auth/secrets.ts`,
- `apps/server/src/persistence/AccountRepository.ts`,
- `apps/server/src/persistence/SessionRepository.ts`,
- trwały model `accounts`, `account_sessions`, `characters`,
- `AuthScene`,
- `CharacterCreatorScene`,
- lifecycle postaci.

Stary kod jest źródłem sprawdzonych zachowań, ale nie jest kopiowany bezkrytycznie. Musi zostać dopasowany do aktualnego `main`, obecnego runnera migracji, aktualnego inventory opartego o centralny katalog przedmiotów oraz nowego Admin API.

## 5. Model danych

### 5.1 `accounts`

Tabela przechowuje trwałą tożsamość użytkownika.

Pola:

- `id uuid PRIMARY KEY`,
- `username varchar(32) NOT NULL`,
- `username_normalized varchar(32) NOT NULL UNIQUE`,
- `password_hash text NOT NULL`,
- `recovery_code_hash text NOT NULL`,
- `role text NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('PLAYER','ADMIN'))`,
- `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned'))`,
- `created_at timestamptz`,
- `updated_at timestamptz`.

Każda publiczna rejestracja tworzy konto z rolą `PLAYER`. Klient nie może przekazać roli podczas rejestracji.

### 5.2 `account_sessions`

Sesje są trwałe i nie zależą od pamięci procesu Rendera.

Pola:

- `id uuid PRIMARY KEY`,
- `account_id uuid REFERENCES accounts(id) ON DELETE CASCADE`,
- `token_hash char(64) UNIQUE NOT NULL`,
- `created_at`,
- `expires_at`,
- `last_seen_at`,
- `revoked_at`.

W aktualnym zakresie utrzymujemy **jedną aktywną sesję na konto**, zgodnie ze starym modelem. Ponowne logowanie unieważnia poprzednią aktywną sesję. Rozszerzenie do wielu urządzeń może być dodane później przez usunięcie tego ograniczenia bez zmiany publicznego kontraktu logowania.

Surowy token sesji nigdy nie jest zapisywany w bazie — baza przechowuje wyłącznie jego hash.

### 5.3 `characters`

Na obecnym etapie jedno konto posiada maksymalnie jedną aktywną postać (`account_id UNIQUE`).

Postać przechowuje trwałe dane gameplayowe, m.in.:

- `id`,
- `account_id`,
- `nickname` i `nickname_normalized`,
- appearance,
- lokację i pozycję,
- poziom/HP/AP i pozostały istniejący stan postaci,
- daty utworzenia/aktualizacji.

### 5.4 Inventory i Item Creator

Nie przywracamy starego `character_items`, który duplikował nazwę/opis/kategorię itemu. Aktualny centralny model Item Creatora pozostaje źródłem prawdy.

Docelowym trwałym właścicielem `item_instances` jest **`character_id`**. Instancje nie mogą być własnością losowego ID sesji tworzonego przy każdym wejściu.

Jeżeli obecny schemat ma legacy owner/player identifier, migracja dodaje trwałe `character_id` i zachowuje dane nieposiadające bezpiecznego mapowania jako legacy/orphan zamiast zgadywać właściciela.

Migracja nie kasuje ani nie przebudowuje danych:

- `items`,
- `item_versions`,
- statystyk,
- efektów,
- kategorii,
- audit logów Item Creatora.

Anonimowych danych z dawnych tymczasowych sesji nickowych nie przypisujemy automatycznie do nowych kont, ponieważ nie istnieje wiarygodny klucz właściciela. Takie dane nie mogą być zgadywane na podstawie samego nicku.

## 6. Hasła i sekrety

Hasła są hashowane przy użyciu **Argon2id**, zgodnie z istniejącym `credentials.ts`.

Reguły pierwszego etapu:

- login po normalizacji: `3–32` znaków,
- dozwolone: `a-z`, `0-9`, `_`, `-`,
- login jest porównywany case-insensitive przez `username_normalized`,
- hasło: `10–256` znaków,
- brak jawnego hasła w logach, bazie, audycie i odpowiedziach API.

Recovery code jest losowym sekretem generowanym przez serwer dla zwykłej rejestracji i recovery. W bazie przechowujemy wyłącznie jego hash. Pełny recovery code jest ujawniany klientowi tylko po rejestracji lub skutecznym odzyskaniu hasła.

## 7. API uwierzytelniania

REST jest właściwym kanałem dla auth. Socket.IO nie służy do przesyłania loginu i hasła.

Planowane endpointy:

- `POST /api/auth/register`
  - input: `username`, `password`,
  - output: recovery code,
  - **nie loguje automatycznie**; po zapisaniu recovery code użytkownik wraca do formularza logowania i loguje się jawnie.

- `POST /api/auth/login`
  - input: `username`, `password`,
  - output: surowy session token + `SessionView` zawierający username, role i lifecycle postaci.

- `GET /api/auth/session`
  - Bearer token,
  - waliduje i odświeża `last_seen_at`,
  - zwraca bieżący `SessionView`.

- `POST /api/auth/logout`
  - Bearer token,
  - ustawia `revoked_at`.

- `POST /api/auth/recover`
  - input: `username`, `recoveryCode`, `newPassword`,
  - po sukcesie zmienia hasło, rotuje recovery code i unieważnia wszystkie wcześniejsze sesje.

Błędy nie mogą ujawniać, czy konto o danym loginie istnieje przy logowaniu/recovery poza sytuacjami, gdzie jest to niezbędne dla UX rejestracji (`USERNAME_TAKEN`).

## 8. Sesja klienta

Klient przechowuje tylko opaque session token i minimalny cache widoku sesji.

Dla automatycznego wznowienia token jest przechowywany w browser storage. Przy starcie:

1. brak tokenu -> `AuthScene`,
2. token istnieje -> `GET /api/auth/session`,
3. poprawna sesja -> routing według lifecycle postaci,
4. `401`/wygasła/unieważniona sesja -> usunięcie tokenu -> `AuthScene`.

Hasło i recovery code nigdy nie są zapisywane w browser storage.

Wylogowanie najpierw próbuje unieważnić sesję na serwerze, następnie zawsze usuwa lokalny token.

## 9. Socket.IO i gameplay

Po przywróceniu kont obecny socket login oparty o nickname przestaje być źródłem autoryzacji.

Socket przy zestawieniu/rozpoczęciu sesji gameplayowej przekazuje session token. Serwer:

1. waliduje token przez ten sam auth/session service co REST,
2. odczytuje konto,
3. odczytuje trwałą postać konta,
4. dopiero wtedy dopuszcza gameplay events.

Nie wolno ufać `playerId`, `role`, `accountId` ani nickname przesłanym przez klienta jako dowodowi tożsamości.

Identyfikator aktywnego gracza w warstwie gameplayowej wynika z trwałego `character.id`, nie z losowego UUID tworzonego przy każdym połączeniu.

## 10. Flow klienta

### 10.1 Start

`BootScene -> próba wznowienia sesji`

- sesja brak/invalid -> `AuthScene`,
- sesja valid + brak postaci -> `CharacterCreatorScene`,
- sesja valid + postać istnieje -> `WorldScene`.

### 10.2 `AuthScene`

Trzy tryby w jednym spójnym ekranie.

**Logowanie**

- login,
- hasło,
- `Zaloguj się`,
- `Załóż konto`,
- `Nie pamiętam hasła`.

**Rejestracja**

- login,
- hasło,
- powtórz hasło,
- `Utwórz konto`.

Po sukcesie klient pokazuje modal z recovery code i wymusza świadome zamknięcie/zaakceptowanie komunikatu o zapisaniu kodu. Następnie wraca do trybu logowania z uzupełnionym loginem, ale bez hasła.

**Odzyskiwanie**

- login,
- recovery code,
- nowe hasło,
- powtórz nowe hasło.

Po sukcesie pokazuje nowy recovery code, usuwa starą sesję lokalną i kieruje do logowania.

### 10.3 Walidacja klienta

Klient może sprawdzać format loginu, długość hasła i zgodność pól powtórzenia dla UX, ale serwer pozostaje jedynym autorytetem.

## 11. Rola ADMIN i Item Creator

`accounts.role` jest jedynym źródłem roli.

Po walidacji sesji backend tworzy auth context zawierający co najmniej:

- `accountId`,
- `role`,
- `sessionId`,
- opcjonalnie `characterId` jeśli postać istnieje.

Obecny `AdminAuth` zostanie przepięty z pamięciowego `SessionStore` na ten auth context.

Każdy endpoint `/api/admin/*` nadal wymaga serwerowego `role === 'ADMIN'`.

Klient pokazuje `Panel Admin` tylko gdy `SessionView.accountRole === 'ADMIN'`, ale ukrycie przycisku nie jest zabezpieczeniem — ręcznie wysłany request zwykłego gracza zawsze dostaje `403`.

`ADMIN_ACCESS_TOKEN` i `VITE_ENABLE_ADMIN_LOGIN` zostają usunięte z normalnego flow po pełnym wdrożeniu nowego auth.

## 12. Bootstrap pierwszego ADMIN-a

Serwer obsługuje jednorazowe zmienne:

- `INITIAL_ADMIN_USERNAME`,
- `INITIAL_ADMIN_PASSWORD`,
- `INITIAL_ADMIN_RECOVERY_CODE`.

`INITIAL_ADMIN_RECOVERY_CODE` musi spełniać format recovery secretu i jest dostarczany przez właściciela hostingu tak samo jak hasło; serwer przechowuje wyłącznie jego hash i nigdy nie wypisuje go do logów.

Podczas startu, po migracjach:

1. jeśli istnieje co najmniej jeden aktywny ADMIN — bootstrap nic nie robi,
2. jeśli nie ma żadnego ADMIN-a i wszystkie trzy zmienne są obecne — tworzy pierwsze konto ADMIN z Argon2id oraz hashem recovery code,
3. jeśli wskazany username już istnieje jako konto nie-ADMIN — startup zgłasza jawny błąd bootstrapu zamiast po cichu podnosić rolę,
4. hasło i recovery code bootstrapu nie są logowane,
5. po utworzeniu ADMIN-a wszystkie `INITIAL_ADMIN_*` powinny zostać usunięte z konfiguracji hostingu.

Bootstrap nie może działać jako stały backdoor do podnoszenia ról.

## 13. Zarządzanie kontami z Panelu Admin

Do Panelu Admin dochodzi sekcja `Konta`.

Minimalne operacje:

- lista kont z paginacją i wyszukiwaniem po username,
- podgląd: username, role, status, createdAt,
- `PLAYER -> ADMIN`,
- `ADMIN -> PLAYER`,
- `active -> banned`,
- `banned -> active`.

Backend wymaga ADMIN dla wszystkich operacji.

Zabezpieczenia:

- nie można zdegradować ostatniego aktywnego ADMIN-a,
- nie można zbanować ostatniego aktywnego ADMIN-a,
- konflikt równoczesnych zmian nie może przypadkiem pozostawić systemu bez administratora,
- każda zmiana roli/statusu trafia do admin audit log z aktorem, celem, poprzednią i nową wartością.

Ochrona ostatniego ADMIN-a jest egzekwowana transakcyjnie na backendzie. Próba naruszenia tej reguły zwraca `409`.

Zmiana roli konta zaczyna obowiązywać przy następnym zweryfikowanym requestcie/sesji. Serwer każdorazowo odczytuje aktualną rolę konta i nie ufa roli zapisanej dawno w kliencie.

## 14. Recovery i bezpieczeństwo sesji

Odzyskanie konta:

1. waliduje login i recovery code,
2. waliduje nowe hasło,
3. blokuje rekord konta w transakcji,
4. ustawia nowy `password_hash`,
5. generuje nowy recovery code i hash,
6. unieważnia wszystkie sesje,
7. commit,
8. zwraca nowy recovery code.

Operacja ma być atomowa — nie może zmienić hasła bez rotacji recovery code albo bez revocation sesji.

## 15. Migracja aktualnego `main`

Aktualny `main` ma już `001_item_catalog.sql` i własny runner migracji. Nie kopiujemy starego numerowania migracji 1:1.

Nowe migracje zaczynają się od następnego wolnego numeru w aktualnym katalogu `apps/server/src/db/migrations/` i są addytywne.

Migracja dodaje konta/sesje/postać oraz trwałe `character_id` dla obecnego inventory.

Zasady:

- brak `DROP` danych katalogu Item Creatora,
- brak zmiany stable `itemId`,
- brak kasowania wersji itemów i audit logów,
- migracje są idempotentne w sensie runnera `schema_migrations`,
- produkcyjny startup uruchamia migracje przed startem HTTP/Socket.IO,
- seed Item Creatora działa po migracjach auth w bezpiecznej kolejności.

Dane anonimowych, tymczasowych sesji nickowych nie są automatycznie przypisywane do kont. Jeśli istnieją osierocone `item_instances` bez trwałego właściciela, migracja zachowuje je jako legacy/orphan — nie przypisuje ich do konta na podstawie zbieżności nicku.

## 16. Deployment

Kolejność produkcyjna:

1. GREEN CI na gałęzi feature,
2. migracje na pustej testowej bazie,
3. migracja istniejącej struktury testowej z Item Creatorem,
4. deploy backendu z PostgreSQL,
5. bootstrap pierwszego ADMIN-a,
6. test rejestracji/logowania/session resume/admin guard na produkcyjnym backendzie,
7. deploy klienta,
8. potwierdzenie pełnego flow w przeglądarce,
9. usunięcie wszystkich `INITIAL_ADMIN_*` po udanym bootstrapie,
10. usunięcie/wyłączenie starego `ADMIN_ACCESS_TOKEN` i pola tokenu z klienta.

Obecne ograniczenie GitHub Pages dotyczące dozwolonej gałęzi deployu musi zostać uwzględnione w planie wdrożenia; artefakt publikowany jako finalny ma zawsze pochodzić z aktualnego `main`.

## 17. Obsługa błędów

REST używa spójnego formatu `code + message`.

Minimalne mapowanie:

- `400` — błędny format loginu/hasła/requestu,
- `401` — błędne credentials, brak/wygasły/revoked session token, zły recovery code,
- `403` — banned account lub brak roli ADMIN,
- `404` — nieistniejący zasób administracyjny,
- `409` — zajęty username, konflikt biznesowy lub ochrona ostatniego ADMIN-a,
- `500` — zanonimizowany błąd wewnętrzny bez sekretów/SQL w odpowiedzi.

UI nie czyści formularza po błędzie serwera poza polami, które użytkownik jawnie zresetuje.

## 18. Testy

### Auth

- poprawna rejestracja,
- duplikat loginu case-insensitive,
- invalid username,
- invalid password,
- hash w bazie nie jest plaintextem,
- Argon2id verify,
- poprawny login,
- błędne hasło,
- banned account,
- raw token nie jest zapisywany w DB,
- session expiration/revocation,
- ponowne logowanie unieważnia poprzednią aktywną sesję,
- logout,
- recovery success/failure,
- recovery rotuje kod,
- recovery unieważnia wcześniejsze sesje.

### Client

- trzy tryby AuthScene,
- client-side validation,
- recovery code modal,
- rejestracja wraca do logowania bez auto-loginu,
- auto-resume z poprawnym tokenem,
- invalid token -> czyszczenie storage -> login,
- logout -> czyszczenie storage,
- brak zapisywania hasła/recovery code.

### Role i Admin

- nowe konto zawsze `PLAYER`,
- próba podania `role=ADMIN` przy rejestracji ignorowana/odrzucana,
- PLAYER nie widzi panelu,
- PLAYER ręcznie wywołujący każdą rodzinę mutacji `/api/admin/*` dostaje `403`,
- ADMIN widzi panel i Item Creator,
- forged role w request body/header nie zmienia uprawnień,
- bootstrap tworzy ADMIN tylko gdy nie istnieje aktywny ADMIN,
- bootstrap wymaga jawnego recovery code i nie loguje sekretów,
- konflikt bootstrap username nie eskaluje istniejącego konta,
- nie można usunąć ostatniego aktywnego ADMIN-a przez demotion/ban,
- zmiany ról/statusów są audytowane.

### Gameplay/persistence

- konto bez postaci -> creator,
- konto z postacią -> world,
- restart procesu nie usuwa konta/sesji/postaci,
- Socket.IO odrzuca invalid session token,
- socket identity pochodzi z serwera, nie z payloadu klienta,
- inventory należy do trwałego `character_id`,
- publikacja nowej wersji item definition nadal aktualizuje bazową definicję istniejącej instancji,
- stary forest -> battle -> loot -> inventory flow nadal działa.

### Migracje

- pusta baza: wszystkie migracje przechodzą,
- baza zawierająca `001_item_catalog.sql`: auth migration przechodzi bez utraty danych,
- ponowne uruchomienie migracji jest bezpieczne,
- istniejący item catalog i historie wersji zachowują liczbę rekordów i relacje,
- orphan/legacy inventory nie jest arbitralnie przypisywane do nowego konta.

### Końcowe E2E

Scenariusz:

1. rejestracja PLAYER,
2. zapis recovery code,
3. jawny login,
4. utworzenie postaci,
5. wejście do świata,
6. reconnect / reload klienta,
7. automatyczne wznowienie sesji,
8. brak Admin Panel dla PLAYER,
9. login jako bootstrap ADMIN,
10. dostęp do Admin Panel i Kreatora Przedmiotów,
11. utworzenie/publikacja itemu,
12. nadanie drugiemu kontu roli ADMIN,
13. nowa rola obowiązuje przy kolejnej walidacji requestu/sesji,
14. recovery hasła unieważnia starą sesję,
15. pełny `npm test`, migracje i `npm run build` są GREEN.

## 19. Kryteria akceptacji

Feature jest ukończony dopiero gdy:

- ekran logowania nie wymaga `ADMIN_ACCESS_TOKEN`,
- rejestracja i recovery działają na PostgreSQL,
- rejestracja nie wykonuje ukrytego auto-loginu,
- hasła są Argon2id,
- sesja przeżywa restart procesu i reload klienta,
- role pochodzą wyłącznie z `accounts.role`,
- Admin API używa tej samej sesji co reszta aplikacji,
- konto `PLAYER` nie może wykonać operacji administracyjnej nawet ręcznym requestem,
- konto `ADMIN` widzi i używa obecnego Item Creatora,
- pierwszy ADMIN może zostać bezpiecznie utworzony bootstrapem z kontrolowanym recovery code,
- kolejnych adminów można zarządzać z Panelu Admin,
- nie można przypadkiem pozostawić systemu bez aktywnego ADMIN-a,
- katalog przedmiotów i jego historia przetrwają migrację,
- gameplay i inventory nadal działają,
- produkcyjny klient publikuje aktualny finalny build,
- pełne testy i build są GREEN.

## 20. Decyzje projektowe

Zatwierdzone decyzje:

1. Wariant B — ponowne użycie starego auth i integracja z obecną architekturą zamiast kopiowania 1:1 lub pisania od zera.
2. PostgreSQL jest źródłem prawdy dla kont, sesji, roli i postaci.
3. Rola ADMIN jest częścią konta, nie osobnym sekretem logowania.
4. Rejestracja, login, recovery i auto-resume wracają jako pełny flow.
5. Recovery code pozostaje mechanizmem odzyskania na tym etapie.
6. Pierwszy ADMIN powstaje przez jednorazowy bootstrap z env, tylko gdy nie istnieje żaden aktywny ADMIN.
7. Bootstrap pierwszego ADMIN-a wymaga kontrolowanego `INITIAL_ADMIN_RECOVERY_CODE`; sekret nie trafia do logów.
8. Kolejnymi rolami/statusami zarządza Panel Admin.
9. Jedno konto ma obecnie maksymalnie jedną postać.
10. Jedno konto ma obecnie jedną aktywną sesję.
11. `item_instances` należą docelowo do trwałego `character_id`.
12. Centralny Item Creator i jego model wersjonowania pozostają bez zmian jako źródło definicji przedmiotów.
13. Anonimowe stare sesje nie są mapowane do kont na podstawie nicku.
14. Backend zawsze pozostaje autorytetem dla sesji, roli i ownership.
