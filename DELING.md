# Dele Cure CRM med teamet

## Den raske veien — én kommando, ingen innlogging

```bash
npm run share
```

Kommandoen starter appen og åpner en offentlig lenke via Cloudflare. Den skriver
ut en adresse som ser slik ut:

```
https://noe-tilfeldig-her.trycloudflare.com
```

Den lenken kan du sende til kollegene. Testet og bekreftet: appen svarer og
krever innlogging.

**Slik fungerer det i praksis:**

- Lenken lever så lenge kommandoen kjører. Trykk `Ctrl+C` for å stenge — da er
  lenken død umiddelbart.
- Adressen er ny hver gang du starter. Send den på nytt ved omstart.
- Maskinen din må være på og våken. Skru av dvale mens du deler:
  `caffeinate -s npm run share`
- Ingen konto, ingen registrering, ingen kostnad.

Dette passer for en tilbakemeldingsrunde over noen timer eller en dag. Skal det
stå oppe over tid, bruk Fly-oppsettet i [DEPLOY.md](DEPLOY.md).

## Før du deler: lag brukere til dem

De trenger egen innlogging for at e-postskillet skal fungere. Under
**Innstillinger → Brukere** legger du dem inn med navn, e-post og et midlertidig
passord som de kan bytte senere.

Si dette til dem når du deler lenken, ellers tror de det er en feil:

> Alle ser samme pipeline, bedrifter og personer. **E-postdialog er privat per
> bruker** — dere ser at det finnes e-poster på et selskap, men må be om innsyn,
> og jeg godkjenner.

## Hva de kan teste på egenhånd

- Opprette deals, både på nye og eksisterende selskaper
- Flytte deals mellom faser i tavlen (prøv å dra en til Vunnet)
- Redigere navn, verdi, dato og kommentar rett i listetabellen
- Filtrere på eier, dato og fritekst, og sortere ved å klikke på kolonnene
- Slå opp bedrifter mot Enhetsregisteret
- Registrere møter og telefonsamtaler under Kontakthistorikk
- Importere egne CSV-filer

---

# Import fra CSV

Knappen **Importer** nederst til venstre i sidebaren tar tre typer filer.
Kolonnenavn gjenkjennes automatisk på norsk og engelsk, og både komma og
semikolon fungerer som skilletegn (Excel i Norge bruker semikolon).

## Deals

| Kolonne | Alternative navn | Merknad |
| --- | --- | --- |
| Selskap | Name, Navn, Company | Påkrevd. «Firma - Dealnavn» splittes automatisk |
| Deal | Dealnavn, Tittel, Title | Utelates den, brukes «Deal» |
| Verdi | Budget total, Value, Sum | «1 234,50» og «kr 1 234» tolkes riktig |
| Dato | Next action, Date, Oppfølging | `2026-08-14` eller `14.08.2026` |
| Kommentar | Comment, Notat | |
| Fase | Stage | Du kobler egne faser til CRM-fasene før import |

Duplikater hoppes over, så du kan importere samme fil flere ganger uten å få
doble deals.

## Bedrifter

| Kolonne | Alternative navn |
| --- | --- |
| Navn | Name, Selskap, Firma |
| Org.nr | Orgnr, Organisasjonsnummer |
| Nettside | Website, Web, URL, Hjemmeside |
| Telefon | Phone, Tlf, Mobil |

Etter import slås alle opp i Enhetsregisteret. Er orgnummer oppgitt, brukes det
direkte. Ellers gjettes selskapet ut fra navn og domene — bare sikre treff
lagres, resten får gul varseltrekant.

## Personer

| Kolonne | Alternative navn |
| --- | --- |
| Navn | Name, Fullt navn, Kontakt |
| E-post | Epost, Email, Mail |
| Telefon | Phone, Tlf, Mobil |
| Selskap | Company, Firma, Bedrift |
| Rolle | Role, Tittel, Stilling |

Personer kobles til selskapet på navn. Finnes ikke selskapet, opprettes det og
slås opp i Enhetsregisteret. Personer som finnes fra før (samme e-post) får bare
en ny selskapskobling — det er slik en person kan tilhøre flere selskaper.
