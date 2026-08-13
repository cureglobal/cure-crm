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
