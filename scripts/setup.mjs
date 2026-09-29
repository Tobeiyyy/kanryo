#!/usr/bin/env node
// One-shot setup: creates the D1 database and R2 bucket, writes the database id into
// wrangler.jsonc, applies the schema, deploys, and sets the three secrets.
// Run `npx wrangler login` first. Safe to re-run: existing resources are reused, and
// secrets that already exist are kept, so a re-run never breaks your Claude connector.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import readline from "node:readline/promises";

const run = (cmd, opts = {}) =>
  execSync(cmd, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], ...opts });

/** Runs a command; on failure returns its combined output instead of throwing. */
function tryRun(cmd) {
  try { return { ok: true, out: run(cmd) }; }
  catch (e) { return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
}

function fail(step, output, hint) {
  console.error(`\n  ${step} failed.\n`);
  if (hint) console.error(`  ${hint}\n`);
  console.error("  Wrangler said:\n" + output.split("\n").slice(-15).map((l) => "    " + l).join("\n"));
  process.exit(1);
}

function findDatabaseId() {
  const created = tryRun("npx wrangler d1 create kanryo");
  if (created.ok) {
    const m = created.out.match(/"database_id":\s*"([0-9a-f-]{36})"/) ?? created.out.match(/([0-9a-f]{8}-[0-9a-f-]{27})/);
    if (m) return m[1];
  } else if (!/already exists/i.test(created.out)) {
    fail("Creating the D1 database", created.out, "Check that `npx wrangler login` worked and try again.");
  }
  const list = JSON.parse(run("npx wrangler d1 list --json"));
  const db = list.find((d) => d.name === "kanryo");
  if (!db) throw new Error("could not create or find a D1 database named 'kanryo'");
  return db.uuid ?? db.database_id;
}

console.log("== Kanryo setup ==\n");

console.log("1/5 D1 database");
const dbId = findDatabaseId();
const cfgPath = "wrangler.jsonc";
const cfg = readFileSync(cfgPath, "utf8");
writeFileSync(cfgPath, cfg.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${dbId}"`));
console.log(`    database_id ${dbId} written to wrangler.jsonc`);

console.log("2/5 R2 bucket");
const bucket = tryRun("npx wrangler r2 bucket create kanryo-files");
if (bucket.ok) console.log("    created kanryo-files");
else if (/already exists/i.test(bucket.out)) console.log("    kanryo-files already exists, fine");
else fail("Creating the R2 bucket", bucket.out,
  "R2 has to be switched on once per account: Cloudflare dashboard > R2 Object Storage.\n" +
  "  Cloudflare may ask for a payment method there even for the free tier. Then run npm run setup again.");

console.log("3/5 Schema");
const migrated = tryRun("npx wrangler d1 migrations apply kanryo --remote");
if (!migrated.ok) fail("Applying the schema", migrated.out);
console.log("    schema applied");

console.log("4/5 Deploy");
const deployed = tryRun("npm run build && npx wrangler deploy");
if (!deployed.ok) fail("Deploying", deployed.out,
  /subdomain/i.test(deployed.out)
    ? "This account has no workers.dev subdomain yet. Open the Cloudflare dashboard > Workers & Pages\n" +
      "  once, pick a subdomain, then run npm run setup again."
    : undefined);
const url = deployed.out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? "<your worker url>";
console.log(`    live at ${url}`);

console.log("5/5 Secrets");
const existing = tryRun("npx wrangler secret list");
const hasSecrets = existing.ok && existing.out.includes('"KANRYO_TOKEN"');
let password = null;
let token = null;
let generated = false;
if (hasSecrets) {
  console.log("    secrets already set, kept as they are (login and connector URL unchanged)");
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = (await rl.question("    App password (empty = generate one): ")).trim();
  rl.close();
  generated = !password;
  if (generated) password = "kanryo-" + randomBytes(6).toString("hex");
  token = randomBytes(32).toString("hex");
  const secrets = { APP_PASSWORD: password, AUTH_SECRET: randomBytes(32).toString("hex"), KANRYO_TOKEN: token };
  // bulk upload avoids the PowerShell newline-mangling of `wrangler secret put`
  const tmp = ".setup-secrets.json";
  writeFileSync(tmp, JSON.stringify(secrets));
  try {
    const set = tryRun(`npx wrangler secret bulk ${tmp}`);
    if (!set.ok) fail("Setting the secrets", set.out);
  } finally {
    unlinkSync(tmp);
  }
  console.log("    APP_PASSWORD, AUTH_SECRET and KANRYO_TOKEN set");
}

console.log(`
== Done ==

  App:            ${url}
  Login password: ${password ? `${password}${generated ? "   (generated, save it!)" : ""}` : "unchanged"}

  Claude connector URL (treat it like a password):
  ${token ? `${url}/mcp/${token}` : "unchanged, your existing connector keeps working"}

  New secrets can take up to a minute to reach the Worker, so if the first
  login fails, wait a moment and try again.

  Next: README > "Connect Claude" to add the connector and the skill.
`);
