#!/usr/bin/env node
// One-shot setup: creates the D1 database and R2 bucket, writes the database id into
// wrangler.jsonc, sets the three secrets, applies migrations and deploys.
// Run `npx wrangler login` first. Safe to re-run; existing resources are reused.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import readline from "node:readline/promises";

const run = (cmd, opts = {}) =>
  execSync(cmd, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], ...opts });

function findDatabaseId() {
  try {
    const out = run("npx wrangler d1 create kanryo");
    const m = out.match(/"database_id":\s*"([0-9a-f-]{36})"/) ?? out.match(/([0-9a-f]{8}-[0-9a-f-]{27})/);
    if (m) return m[1];
  } catch {
    // probably exists already; fall through to list
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
try { run("npx wrangler r2 bucket create kanryo-files"); console.log("    created kanryo-files"); }
catch { console.log("    kanryo-files already exists, fine"); }

console.log("3/5 Secrets");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let password = (await rl.question("    App password (empty = generate one): ")).trim();
rl.close();
const generated = !password;
if (generated) password = "kanryo-" + randomBytes(6).toString("hex");
const secrets = {
  APP_PASSWORD: password,
  AUTH_SECRET: randomBytes(32).toString("hex"),
  KANRYO_TOKEN: randomBytes(32).toString("hex"),
};
// bulk upload avoids the PowerShell newline-mangling of `wrangler secret put`
const tmp = ".setup-secrets.json";
writeFileSync(tmp, JSON.stringify(secrets));
try {
  run(`npx wrangler secret bulk ${tmp}`);
} finally {
  unlinkSync(tmp);
}
console.log("    APP_PASSWORD, AUTH_SECRET and KANRYO_TOKEN set");

console.log("4/5 Migrations");
run("npx wrangler d1 migrations apply kanryo --remote");
console.log("    schema applied");

console.log("5/5 Deploy");
const deployOut = run("npm run build && npx wrangler deploy");
const url = deployOut.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? "<your worker url>";

console.log(`
== Done ==

  App:            ${url}
  Login password: ${password}${generated ? "   (generated — save it!)" : ""}

  Claude connector URL (treat it like a password):
  ${url}/mcp/${secrets.KANRYO_TOKEN}

  Add it in claude.ai under Settings > Connectors, and see the README
  for the skill upload and the optional Google Calendar sync.
`);
