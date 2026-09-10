# Drift av Cure CRM

Appen kjører **live på Railway**: https://crm.cure.no (også nåbar på
`cure-crm-production.up.railway.app`). Prosjektet heter `cure-crm` i
Railway-workspacet «Cure».

Appen bruker SQLite som en fil på disk (`/app/data/crm.db`), derfor et
Railway-volum montert på `/app/data` i stedet for en serverless-plattform
(Vercel nullstiller filsystemet mellom forespørsler — se `DEPLOY_VERCEL.md`
for den varianten, som i så fall krever en ekte ekstern database).

`fly.toml` ligger fortsatt i repoet fra et tidligere Fly.io-oppsett, men er
ikke i bruk — Railway er nåværende driftsplattform.

## Autodeploy

Railway-tjenesten er koblet til `cureglobal/cure-crm` på GitHub. **Alt som
pushes til `main` bygges og deployes automatisk.** Det finnes ikke noe eget
staging-miljø — kun ett Railway-miljø (`production`), rett mot `main`.

## Miljøvariabler (satt i Railway, ikke i repoet)

- `SESSION_SECRET` — signerer innloggingscookies
- `CRYPTO_KEY` — krypterer lagrede e-postpassord. Byttes den, blir lagrede
  e-postpassord uleselige og må legges inn på nytt
- `HOSTNAME=::` — **kritisk**. Railways edge ruter over IPv6; uten denne
  binder Next.js-serveren seg kun til IPv4 og alt blir 502
  ("Application failed to respond")
- `PORT=3000`

## Ting som var vanskelige å få riktig (les før du endrer Dockerfile)

1. **`VOLUME`-direktiv i Dockerfile støttes ikke av Railway** — de bruker
   egne volumer, ikke Dockers native mekanisme.
2. **Railway monterer volumet som root ved oppstart**, uansett hva som er
   `chown`'et i imaget. `entrypoint.sh` retter eierskapet på
   `/app/data` til `nextjs`-brukeren før appen starter — ikke fjern den uten
   å løse dette på annen måte.
3. **`next build` kjører flere parallelle byggeprosesser**, som hver
   importerer databasemodulen og migrerer mot samme lokale fil samtidig.
   `PRAGMA busy_timeout` i `migrate.ts` hindrer `SQLITE_BUSY`, og
   `addMissingColumns` svelger `duplicate column name`-feil av samme grunn
   (to prosesser kan begge se en kolonne som fraværende og begge forsøke å
   legge den til).
4. **Databasen kjører i WAL-modus** (satt i `src/lib/db/index.ts`). Uten WAL
   tar hver skriving en eksklusiv lås på hele fila, så alle som leser
   blokkeres mens én person lagrer. Følgen for kopiering/backup: databasen
   er nå tre filer — `crm.db`, `crm.db-wal` og `crm.db-shm`. Kopierer du kun
   `crm.db` mens appen kjører, får du en database som mangler de nyeste
   skrivingene. Kjør `PRAGMA wal_checkpoint(TRUNCATE);` først, eller kopier
   alle tre.
5. **Slett alltid `crm.db-wal` og `crm.db-shm` før du legger tilbake en
   kopi av `crm.db`.** Ligger det en gammel WAL-fil ved siden av, spilles
   den av oppå fila du nettopp la inn, og du sitter igjen med den GAMLE
   databasen — i verste fall en tom en. (Skjedde under ytelsesarbeidet:
   en 5 MB produksjonskopi ble til en tom database på 335 kB.)

## Ytelse — les før du legger til en spørring

Appen føltes treg fordi listesidene sendte profilbilder som base64 i selve
siden. Bildene ligger som data-URL i `users.avatar_data_url` (opptil ~1 MB
per bruker), og fordi spørringene hentet hele brukerraden, fulgte bildet med
i hver eneste rad i hver eneste sidelasting. Målt på ekte data:

| Side          | Før       | Etter   |
| ------------- | --------- | ------- |
| `/leads`      | 153,5 MB  | 331 kB  |
| `/statistikk` | 39,5 MB   | 168 kB  |
| `/companies`  | 27,1 MB   | 2,1 MB  |
| `/` (forsiden)| 2,2 MB    | 157 kB  |

Reglene som holder det slik:

1. **Hent aldri `avatarDataUrl` i en side- eller listespørring.** Bruk
   `userColumns` fra `src/lib/db/schema.ts` i stedet for
   `db.query.users.findMany()`/`findFirst()` — den utelater både bildet og
   passordhashen. Bildet leses kun i `/api/avatar/[id]`.
2. **Bygg bilde-URL-en med `avatarUrlFor(userId, avatarUpdatedAt)`** fra
   `src/lib/avatar.ts`. Nettleseren cacher bildet i et år; `avatarUpdatedAt`
   i URL-en sørger for at et nytt bilde likevel vises med én gang.
3. **Alt som lastes opp skaleres ned i nettleseren først**
   (`src/lib/downscaleImage.ts`, maks 256 px). Uten det havner et
   ukomprimert kamerabilde i databasen for godt.
4. `/companies` er fortsatt 2,1 MB fordi den henter alle 893 selskapene og
   rendrer hele tabellen. Det er ikke bilder — det er rader. Neste steg der
   er paginering eller virtualisering, ikke flere spørringsjusteringer.

## Sikkerhet

- Innlogging er rate-limitet (`src/lib/rateLimit.ts`): 5 feil på 10 min låser
  i 15 min, både per e-post og grovere per IP. In-memory — nullstilles ved
  hver deploy/restart. Greit nok for én replika, men ikke robust mot flere
  instanser.
- Sikkerhetsheadere (CSP, HSTS, X-Frame-Options m.fl.) settes i
  `next.config.ts`. CSP tillater `unsafe-inline` for script/style fremfor
  nonces, siden nonces krever at hele appen rendres dynamisk.
- **Ingen backup av databasen.** Den bor kun på Railway-volumet. Går
  volumet tapt, er dataene borte. Ikke løst ennå.
- Ingen selvregistrering etter at første bruker er opprettet — kun admin kan
  legge til nye brukere (Innstillinger).

## Vanlige CLI-kommandoer

```bash
railway status                                  # oversikt
railway logs --deployment                       # runtime-logg
railway logs --build <deployment-id>             # bygglogg for en spesifikk deploy
railway variables --service cure-crm             # se miljøvariabler
railway up --service cure-crm --ci               # manuell deploy fra lokal mappe (bypasser GitHub)
railway redeploy --service cure-crm --yes        # redeploy siste image på nytt
```

## Om dataene

Databasen starter tom ved førstegangs deploy. Første bruker som oppretter
konto via `/login` blir admin.

Alle brukere ser samme pipeline, men **e-postdialog er privat per bruker** —
andre ser at det finnes e-poster på et selskap, og må be om innsyn som
eieren godkjenner. Verdt å si eksplisitt når lenken deles, ellers tror folk
det er en feil.
