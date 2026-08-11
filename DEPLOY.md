# Legge Cure CRM på et domene

Appen bruker SQLite som en fil på disk. Det betyr at den **ikke** kan kjøre på
Vercel eller andre serverless-plattformer, som har et filsystem som nullstilles
mellom forespørsler. Oppsettet her bruker Fly.io med et volum, som gir en disk
databasen kan bo på.

Alt av kode og config er klart. Det som gjenstår krever din innlogging.

## Steg 1 — installer Fly-CLI og logg inn

```bash
curl -L https://fly.io/install.sh | sh
```

Legg den i PATH (én gang):

```bash
echo 'export PATH="$HOME/.fly/bin:$PATH"' >> ~/.zprofile && export PATH="$HOME/.fly/bin:$PATH"
```

Logg inn (åpner nettleseren — Fly har gratis nivå, men ber om kort for å
hindre misbruk):

```bash
fly auth login
```

## Steg 2 — opprett appen

Kjør fra `crm`-mappen. Velg et ledig navn hvis `cure-crm` er tatt:

```bash
fly launch --no-deploy --name cure-crm --region arn
```

Svar **nei** hvis den spør om å endre konfigurasjonen — `fly.toml` er ferdig satt
opp med volum og region.

## Steg 3 — legg inn hemmeligheter

Disse to må settes, ellers starter ikke appen. Kommandoen genererer nye,
tilfeldige verdier:

```bash
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)" CRYPTO_KEY="$(openssl rand -hex 32)"
```

`SESSION_SECRET` signerer innloggingscookies. `CRYPTO_KEY` krypterer
e-postpassord. Merk: setter du en **ny** `CRYPTO_KEY` senere, blir lagrede
e-postpassord uleselige og må legges inn på nytt.

## Steg 4 — opprett volumet og deploy

```bash
fly volumes create crm_data --region arn --size 1
fly deploy
```

Første deploy tar noen minutter fordi `better-sqlite3` kompileres.

## Steg 5 — åpne og opprett første bruker

```bash
fly open
```

Appen starter med tom database og ber deg opprette administratorkontoen.
Deretter legger du til de andre under Innstillinger → Brukere.

## Eget domene

```bash
fly certs add crm.cure.no
```

Fly skriver ut hvilke DNS-poster som skal settes hos den som har cure.no-domenet
(en CNAME og en AAAA/A). Sertifikatet kommer automatisk når DNS er på plass.

---

## Om dataene

Deploy-en starter med **tom database** — den lokale fila følger ikke med
(`data/` er i `.dockerignore` og `.gitignore`).

Det er et bevisst valg. Den lokale databasen inneholder hele den reelle
pipelinen med kommentarer om navngitte personer («Drømmekunde. Kjenner …»,
«usikker på om der er bad blood»). Skal andre gi tilbakemelding på *verktøyet*,
trenger de ikke se det. To alternativer:

**A. Start tomt (anbefalt for tilbakemelding).** La dem opprette noen deals
selv. Da tester de også de delene som betyr mest — å legge inn nye leads.

**B. Ta med de ekte dataene.** Kopier fila opp etter deploy:

```bash
fly ssh console -C "mkdir -p /app/data"
fly sftp shell
# i sftp-skallet:
put data/crm.db /app/data/crm.db
```

Velger du B: husk at innloggingen er det eneste som skiller dataene fra
internett. Bruk sterke passord, og vurder om kommentarfeltene bør ryddes først.

## Tilbakemelding underveis

Alle brukere ser samme pipeline, men **e-postdialog er privat per bruker** — de
andre ser at det finnes e-poster på et selskap, og må be om innsyn som du
godkjenner. Det er verdt å si eksplisitt når du deler lenken, ellers tror folk
det er en feil.
