# Deploy til Vercel

Koden er klar for dette — databasen bruker nå [libSQL](https://turso.tech)
(samme SQLite-dialekt som før, bare tilgjengelig over nett) i stedet for en
lokal fil, siden Vercels servere ikke har en disk som overlever mellom
kall. Alt annet i appen er uendret.

Repoet ligger som en lokal git-commit uten remote. Stegene under tar deg fra
der til en fungerende URL.

## 1. Push til GitHub

Opprett et **tomt** repo på [github.com/new](https://github.com/new) — ikke
huk av for README, .gitignore eller lisens (repoet har allerede alt det).
Kopier deretter URL-en GitHub viser deg (ser ut som
`https://github.com/dittbrukernavn/cure-crm.git`) og kjør:

```bash
cd "/Users/odd-erik/Desktop/Vibe codes/crm"
git remote add origin <URL du fikk fra GitHub>
git push -u origin main
```

Si gjerne URL-en til meg — da kjører jeg de to kommandoene for deg.

## 2. Importer i Vercel

Fra [vercel.com/new](https://vercel.com/new): velg **Import Git Repository**,
finn `cure-crm` (eller det navnet du ga repoet), og trykk **Import**. Vercel
kjenner igjen Next.js automatisk — du trenger ikke endre noe i
byggeinnstillingene. Trykk **Deploy** ennå ikke; gjør steg 3 og 4 først, ellers
feiler det første bygget fordi databasen mangler.

## 3. Opprett databasen (Turso)

I Vercel-dashbordet for prosjektet: fanen **Storage** → **Create Database** →
velg **Turso**. Vercel opprinner databasen og legger automatisk til
`DATABASE_URL` og `DATABASE_AUTH_TOKEN` som miljøvariabler på prosjektet — du
trenger ikke opprette egen Turso-konto eller kopiere noe manuelt.

Godkjenn integrasjonen om Vercel spør om tilgang.

## 4. Legg inn de to siste miljøvariablene

Under **Settings → Environment Variables**, legg til disse to (gjelder alle
miljøer — Production, Preview, Development):

```
SESSION_SECRET=9ff6aba3fb29c73b37050ce5dca479163aed1987dba21ca3a29e483915ab23e9
CRYPTO_KEY=a4925904153e7ed05c09237209b0547730cdd8d52d4f145c208a6d8908455de6
```

Disse er ferdig genererte og unike — bare lim inn. `SESSION_SECRET` signerer
innloggingscookies. `CRYPTO_KEY` krypterer e-postpassord som lagres i
databasen; sett den én gang og la den stå, ellers blir lagrede e-postpassord
uleselige.

## 5. Sett opp databaseskjemaet

Databasen er tom helt til tabellene er laget. Kopier `DATABASE_URL` og
`DATABASE_AUTH_TOKEN` fra **Storage**-fanen i Vercel (klikk inn på databasen
→ `.env.local`-knappen viser begge), og kjør fra din egen maskin:

```bash
cd "/Users/odd-erik/Desktop/Vibe codes/crm"
DATABASE_URL="libsql://…" DATABASE_AUTH_TOKEN="…" npm run db:migrate
```

Del verdiene med meg og jeg kjører det for deg. Dette lager alle tabellene i
den ekte databasen — samme skjema som den lokale, bare et annet sted.

Kjør denne kommandoen på nytt hver gang jeg endrer datamodellen senere (nye
felt/tabeller) — helt trygt, den endrer aldri eksisterende data.

## 6. Deploy

Tilbake i Vercel: trykk **Deploy**. Bygget tar et par minutter.

## 7. Opprett din bruker

Åpne URL-en Vercel gir deg. Databasen er tom, så du møtes av «Opprett
administratorkontoen din» — akkurat som første gang du startet appen lokalt.
Legg til de andre brukerne under Innstillinger → Brukere etterpå.

## Eget domene

**Settings → Domains** i Vercel-dashbordet, skriv inn f.eks. `crm.cure.no`.
Vercel viser hvilken DNS-post som må settes hos den som administrerer
cure.no-domenet — vanligvis en CNAME. Sertifikatet kommer automatisk.

---

## Vær obs på disse to tingene

**E-postsynk kan ta flere kjøringer for en konto med mye historikk.**
Vercel-funksjoner har en tidsgrense (10 sekunder på gratisnivået, opp til
60 hvis du oppgraderer til Pro — appen ber allerede om 60). Synken er derfor
delt opp: den henter maks 250 e-poster per klikk på «Synkroniser nå» og
sier tydelig fra når det er mer igjen. Kjør knappen flere ganger til den sier
«Synk ferdig» uten forbehold — det skjer bare første gang for en konto med
lang historikk, ikke ved vanlig daglig bruk.

**Import av svært store CSV-filer kan også treffe tidsgrensen**, spesielt
bedriftsimport siden hver rad kan slå opp i Brønnøysundregistrene. Samme
løsning: kjør importen på nytt med samme fil — allerede opprettede rader
gjenkjennes og hoppes over, så du fortsetter der det stoppet.

**Databasen på Vercel er tom, ikke en kopi av din lokale.** Det er bevisst
— den lokale filen har hele den reelle pipelinen med kommentarer om
navngitte personer. Vil du ha med de ekte dataene i stedet for å starte
tomt, si det, og jeg kan overføre dem inn i Turso-databasen på samme måte
som jeg kjørte skjemaoppsettet i steg 5.
