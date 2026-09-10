# Cure CRM

Internt CRM for Cure: selskaper, kontaktpersoner, deals i en pipeline,
e-postdialog per bruker, statistikk og et prisverktøy som sender pristilbud
på e-post.

Kjører live på **https://crm.cure.no**. Drift, miljøvariabler og
gjenoppretting er beskrevet i **[DEPLOY.md](DEPLOY.md)** — les den før du
endrer noe som har med databasen, Dockerfile eller Railway å gjøre.

## Teknisk

- **Next.js 16** (App Router) med React 19 og TypeScript. Alle mutasjoner er
  server actions; ingen egen API-flate.
- **SQLite** via `@libsql/client` og Drizzle ORM. Databasen er én fil på et
  Railway-volum (`/app/data/crm.db`), ikke en ekstern databasetjeneste.
  Datamengden er liten nok til at hvert oppslag er en funksjonskall-rask
  operasjon uten nettverkstur.
- **Railway** for drift, Docker-bygg, autodeploy fra `main`.
- **Cloudflare R2** for opplastede bilder og for kontinuerlig
  sikkerhetskopi (Litestream).
- Innlogging med bcrypt og signert cookie. IMAP for e-postsynk, nodemailer
  for utsending, `@react-pdf/renderer` for pristilbud.

## Kom i gang

```bash
npm install
cp .env.example .env.local   # finnes ikke? se variablene under
npm run dev
```

Minimum av miljøvariabler for å kjøre lokalt:

```
SESSION_SECRET=hva-som-helst-langt-og-tilfeldig
CRYPTO_KEY=0000000000000000000000000000000000000000000000000000000000000000
```

Databasen opprettes automatisk i `data/crm.db` ved første oppstart, med
tomme tabeller. Første bruker som registrerer seg blir administrator.

Vil du jobbe mot ekte data, hent en kopi av produksjonsbasen — se
«Sikkerhetskopi» i DEPLOY.md. **Setter du R2-nøklene lokalt, sett også
`R2_MEDIA_BUCKET=cure-crm-media-dev`**, ellers laster appen opp bilder rett
i produksjonsbøtta.

## Kommandoer

| Kommando | Hva den gjør |
| --- | --- |
| `npm run dev` | Utviklingsserver |
| `npm run build` | Produksjonsbygg |
| `npm run lint` | ESLint |
| `npm run perf:check` | Sjekker at sidene ikke har blitt store igjen (krever `npm run build` først) |
| `npm run db:backup` | Kopi av produksjonsdatabasen til R2 |
| `npm run migrate:images` | Flytter bilder fra databasen til R2 (skjer også automatisk ved oppstart) |

## Verdt å vite før du endrer kode

- **Hent aldri `users.avatarDataUrl` i en liste- eller sidespørring.** Bruk
  `userColumns` fra `src/lib/db/schema.ts`. Å gjøre dette feil er hva som
  gjorde appen treg: `/leads` sendte 153 MB per sidelasting. `npm run
  perf:check` fanger det opp.
- **Legg aldri bilder som base64 i en kolonne.** Bruk `putObject()` i
  `src/lib/objectStorage.ts`.
- **Server actions ligger i `src/lib/actions/`,** delt etter domene.
  `src/lib/actions.ts` er kun en re-eksport, så importene i komponentene er
  uendret.
- Denne Next-versjonen har brytende endringer mot det som er vanlig. Les
  `node_modules/next/dist/docs/` før du skriver ny kode — se `AGENTS.md`.
