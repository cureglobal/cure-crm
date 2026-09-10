// Vaktpost mot at sidene blir store igjen.
//
// Appen var på et tidspunkt oppe i 153 MB på /leads fordi listespørringene
// dro med seg profilbildene (base64 i databasen). Ingenting sa fra; det så
// helt normalt ut i koden. Denne sjekken bygger et syntetisk datasett med
// nettopp den fellen i seg — brukere med tunge bilder — og feiler hvis en
// side svulmer forbi budsjettet sitt.
//
//   npm run perf:check
//
// Datasettet lages fra bunnen hver gang, så sjekken trenger ingen
// produksjonsdata og gir samme svar på alle maskiner.
import { spawn } from "node:child_process";
import net from "node:net";
import { createClient } from "@libsql/client";
import { SignJWT } from "jose";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SECRET = "perf-check-secret";
const PORT = 3199;

// Budsjettene ligger godt over dagens tall, så vanlig vekst ikke gir
// falske alarmer. De fanger regresjoner i størrelsesorden — som er
// nøyaktig formen på feilen de er satt opp for.
const BUDGETS_KB = {
  "/": 400,
  "/leads": 900,
  "/companies": 1200,
  "/people": 900,
  "/statistikk": 500,
  "/settings": 300,
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-perf-"));
const dbPath = path.join(dir, "perf.db");
const dbUrl = `file:${dbPath}`;

async function seed() {
  const { migrate } = await import("../src/lib/db/migrate.ts");
  const c = createClient({ url: dbUrl });
  await c.execute("PRAGMA busy_timeout = 15000");
  await migrate(c);

  const now = Date.now();
  // Fella: et profilbilde på ~700 kB base64, slik ekte brukere har.
  // Havner dette i en listespørring igjen, sprenger budsjettet umiddelbart.
  const avatar = "data:image/jpeg;base64," + "A".repeat(700_000);
  for (let i = 1; i <= 8; i++) {
    await c.execute({
      sql: `INSERT INTO users (name, email, password_hash, is_admin, theme, created_at, avatar_data_url, avatar_updated_at)
            VALUES (?, ?, 'x', ?, 'lys', ?, ?, ?)`,
      args: [`Bruker ${i}`, `bruker${i}@test.no`, i === 1 ? 1 : 0, now, avatar, now],
    });
  }
  for (let i = 1; i <= 900; i++) {
    await c.execute({
      sql: `INSERT INTO companies (name, org_name, org_number, brreg_verified, owner_id, created_at)
            VALUES (?, ?, ?, 0, ?, ?)`,
      args: [`Selskap ${i}`, `Selskap ${i} AS`, String(900000000 + i), (i % 8) + 1, now - i * 1000],
    });
  }
  for (let i = 1; i <= 700; i++) {
    await c.execute({
      sql: "INSERT INTO people (name, email, created_at) VALUES (?, ?, ?)",
      args: [`Person ${i}`, `person${i}@test.no`, now],
    });
    await c.execute({
      sql: "INSERT INTO company_people (company_id, person_id, created_at) VALUES (?, ?, ?)",
      args: [(i % 900) + 1, i, now],
    });
  }
  const stages = await c.execute("SELECT id FROM stages ORDER BY sort_order");
  const stageIds = stages.rows.map((r) => String(r.id));
  for (let i = 1; i <= 400; i++) {
    await c.execute({
      sql: `INSERT INTO deals (company_id, title, stage, value, owner_id, comment, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        (i % 900) + 1,
        `Deal ${i}`,
        stageIds[i % stageIds.length],
        10000 + i * 37,
        (i % 8) + 1,
        `Kommentar på deal ${i}`,
        now - i * 1000,
        now - i * 500,
      ],
    });
    await c.execute({
      sql: "INSERT INTO activities (deal_id, user_id, type, content, created_at) VALUES (?, ?, 'comment', ?, ?)",
      args: [i, (i % 8) + 1, `Kommentar på deal ${i}`, now - i * 400],
    });
  }
  return c;
}

// Porten MÅ være ledig. Ligger det en server igjen fra en tidligere kjøring,
// svarer den på fetch-ene her og sjekken måler feil bygg — én gang ga det et
// falskt utslag på 313 MB, og like gjerne kunne den meldt «alt ok» om en ekte
// regresjon. Bedre å stoppe enn å måle noe annet enn det man tror.
function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => srv.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

function startServer() {
  // Kjører next-binæren direkte, ikke via npx: npx er bare et skall rundt
  // den ekte prosessen, og å drepe skallet etterlater serveren i live med
  // porten opptatt. detached gir i tillegg en egen prosessgruppe, slik at
  // hele treet kan felles under ett.
  return spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: dbUrl,
      SESSION_SECRET: SECRET,
      CRYPTO_KEY: "0".repeat(64),
    },
    stdio: "ignore",
    detached: true,
  });
}

function stopServer(proc) {
  if (!proc?.pid) return;
  // Negativ pid = hele prosessgruppen, ikke bare toppnoden.
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/login`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (!fs.existsSync(".next")) {
  console.error("Fant ingen .next — kjør `npm run build` først.");
  process.exit(1);
}

if (!(await portIsFree(PORT))) {
  console.error(
    `Port ${PORT} er opptatt — sannsynligvis en server som ble stående igjen.\n` +
      `Stopp den først:  lsof -ti:${PORT} | xargs kill`
  );
  process.exit(1);
}

let server;
try {
  process.stdout.write("Lager syntetisk datasett … ");
  await seed();
  console.log("ferdig (8 brukere med tunge bilder, 900 selskap, 700 personer, 400 deals)");

  server = startServer();
  if (!(await waitForServer())) throw new Error(`serveren kom ikke opp på port ${PORT}`);

  const token = await new SignJWT({ uid: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));

  console.log();
  let failed = 0;
  for (const [route, budgetKb] of Object.entries(BUDGETS_KB)) {
    const res = await fetch(`http://localhost:${PORT}${route}`, {
      headers: { cookie: `crm_session=${token}` },
    });
    const body = Buffer.from(await res.arrayBuffer());
    const kb = Math.round(body.length / 1024);
    const ok = res.status === 200 && kb <= budgetKb;
    if (!ok) {
      failed++;
      // Selve svaret lagres, ellers står man igjen med et tall og ingen
      // anelse om HVA som ble stort.
      const dump = path.join(os.tmpdir(), `perf-${route.replace(/\W+/g, "_")}.html`);
      fs.writeFileSync(dump, body);
      console.log(`      (svaret er lagret i ${dump})`);
    }
    console.log(
      `${ok ? "  ok  " : "FEIL  "}${route.padEnd(14)} ${String(kb).padStart(6)} kB   (budsjett ${budgetKb} kB, status ${res.status})`
    );
  }

  console.log();
  if (failed > 0) {
    console.error(
      `${failed} side(r) over budsjett.\n` +
        "Vanligste årsak: en spørring henter users.avatarDataUrl (eller en\n" +
        "annen stor kolonne) inn i en liste. Bruk userColumns fra\n" +
        "src/lib/db/schema.ts og avatarUrlFor() — se «Ytelse» i DEPLOY.md."
    );
    // IKKE process.exit() her: den avslutter med én gang og hopper over
    // finally-blokka, slik at serveren blir stående igjen med porten
    // opptatt — og da måler NESTE kjøring det gamle bygget i stedet.
    // Nøyaktig den feilen ga et falskt utslag mens denne sjekken ble laget.
    process.exitCode = 1;
  } else {
    console.log("Alle sider innenfor budsjett.");
  }
} finally {
  stopServer(server);
  fs.rmSync(dir, { recursive: true, force: true });
}
