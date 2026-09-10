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
4. Lange lister rendrer bare de 60 øverste radene og henter flere ved
   rulling (`src/lib/useIncrementalRender.ts`). All data ligger fortsatt i
   nettleseren, så søk og sortering er uendret — men nettleserens egen
   Ctrl+F finner ikke rader som ennå ikke er rendret.

### `npm run perf:check`

Vaktposten som fanger regresjoner i punkt 1–3. Den bygger et syntetisk
datasett med fella i seg — åtte brukere med profilbilder på 700 kB — og
feiler hvis en side blir større enn budsjettet sitt:

```bash
npm run build && npm run perf:check
```

Krever ingen produksjonsdata. Sjekken er testet mot den ekte feilen: legger
man profilbildene tilbake i pipeline-spørringen, går `/leads` fra 383 kB til
313 000 kB og sjekken feiler med beskjed om hva som er galt.

Justér budsjettene i skriptet hvis appen vokser reelt — men behandle et
hopp i størrelsesorden som en feil, ikke som vekst.

## Sikkerhet

- Innlogging er rate-limitet (`src/lib/rateLimit.ts`): 5 feil på 10 min låser
  i 15 min, både per e-post og grovere per IP. In-memory — nullstilles ved
  hver deploy/restart. Greit nok for én replika, men ikke robust mot flere
  instanser.
- Sikkerhetsheadere (CSP, HSTS, X-Frame-Options m.fl.) settes i
  `next.config.ts`. CSP tillater `unsafe-inline` for script/style fremfor
  nonces, siden nonces krever at hele appen rendres dynamisk.
- Sikkerhetskopi: se eget avsnitt under.
- Ingen selvregistrering etter at første bruker er opprettet — kun admin kan
  legge til nye brukere (Innstillinger).

## Sikkerhetskopi (Litestream → Cloudflare R2)

Databasen bodde tidligere kun på Railway-volumet. Forsvant volumet, var alt
borte. Nå replikerer **Litestream** SQLite-fila fortløpende til R2-bøtta
`cure-crm-backup` i Cloudflare-kontoen «Cure». Litestream starter appen som
sin egen underprosess (`entrypoint.sh`), så replikeringen lever nøyaktig
like lenge som appen.

Mangler nøklene under, starter appen som før — bare uten sikkerhetskopi.
Det står i oppstartsloggen hvilken av delene som skjer.

### Nøkler (satt i Railway)

- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — hentet fra 1Password-oppføringen
  **Cloudflare (Cure)**, feltene «Global R2 Buckets Key ID» og
  «Global R2 Buckets Secret Key»
- `R2_ENDPOINT` — `d95d98e082afd7e756cea2e70a3c72f8.r2.cloudflarestorage.com`
  (uten `https://`)

> **Å rydde opp i:** nøklene som brukes nå er *globale* — de gir tilgang til
> ALLE R2-bøttene i Cure-kontoen (`cure-clients`, `cure-videos`,
> `cure-webflow-files` …), ikke bare `cure-crm-backup`. Kommer noen inn i
> CRM-serveren, får de dermed også alt det andre. Litestream trenger kun
> skrivetilgang til én bøtte. Lag et eget token i Cloudflare → R2 → API med
> **Object Read & Write** begrenset til `cure-crm-backup`, bytt de to
> variablene, og redeploy. Alt annet kan stå som det er.

### Hente data tilbake

Går volumet tapt, skjer det av seg selv: `-restore-if-db-not-exists` i
entrypointet ser at `/app/data/crm.db` mangler og henter ned siste versjon
før appen starter. Ingen manuelle steg.

Verifisert 10.09.2026: gjenoppretting fra R2 ga en database med
`integrity_check ok`, 398 deals, 893 selskaper, 688 personer og 8 brukere —
identisk med produksjon.

Trenger du en kopi lokalt, eller å rulle tilbake til et tidspunkt:

```bash
litestream restore -o crm.db \
  s3://cure-crm-backup/crm?endpoint=<account-id>.r2.cloudflarestorage.com
litestream restore -timestamp 2026-09-10T12:00:00Z -o crm.db s3://...   # tilbake i tid
```

### Manuelt øyeblikksbilde — `npm run db:backup`

```bash
npm run db:backup
```

Tar en kopi av produksjonsdatabasen og legger den i R2 under `manual/`.
Krever kun innlogget `railway` og `wrangler` — **ingen R2-nøkler**, så den
virker selv om Litestream ikke er satt opp ennå. Kjør den før du gjør noe
risikabelt med dataene.

Skriptet bruker `VACUUM INTO`, som gir én konsistent fil med WAL-en
inkludert — å kopiere `crm.db` alene ville mistet de nyeste skrivingene.
Det stopper med feil hvis kopien er mistenkelig liten eller
`integrity_check` ikke sier `ok`, slik at man ikke sitter igjen med en fil
som *ser ut* som en sikkerhetskopi.

Hent en kopi tilbake:

```bash
npx wrangler r2 object get cure-crm-backup/manual/<fil>.db --remote --file crm.db
```

Filnavnet skrives ut av `npm run db:backup` når kopien tas. Trenger du en
oversikt over hva som ligger der, finnes den i dashbordet — `wrangler` kan
laste opp og ned enkeltfiler, men ikke liste innholdet i en bøtte:
<https://dash.cloudflare.com/d95d98e082afd7e756cea2e70a3c72f8/r2/default/buckets/cure-crm-backup>

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
