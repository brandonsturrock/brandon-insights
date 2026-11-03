#!/usr/bin/env node
// Runs every references/queries/*.dql through dtctl concurrently (no shell, no /tmp).
//   node run-queries.mjs --frontend <name> --out <dir> [--context <ctx>]
//   node run-queries.mjs --list-frontends [--context <ctx>]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOO_OLD = "unparseable dtctl output — dtctl too old? run the setup skill";
const NOT_FOUND = "dtctl not found — run the setup skill (/tools:setup), then restart Claude Code";

export function resolveDtctl(env = process.env, platform = process.platform, exists = fs.existsSync) {
  const p = platform === "win32" ? path.win32 : path.posix;
  for (const dir of (env.PATH || "").split(p.delimiter).filter(Boolean)) {
    if (exists(p.join(dir, "dtctl")) || exists(p.join(dir, "dtctl.exe"))) return "dtctl";
  }
  const fallbacks = platform === "win32"
    ? (env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, "dtctl", "dtctl.exe")] : [])
    : [path.join(os.homedir(), ".local/bin/dtctl"), "/usr/local/bin/dtctl", "/opt/homebrew/bin/dtctl"];
  return fallbacks.find(f => exists(f)) ?? null;
}

// Spawns dtctl (no shell) and resolves { stdout, stderr } — never rejects.
function exec({ cmd, prefixArgs }, args) {
  return new Promise(resolve => {
    let stdout = "", stderr = "";
    const child = spawn(cmd, [...prefixArgs, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8"); // else multi-byte chars split across pipe chunks become U+FFFD
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", d => (stdout += d));
    child.stderr.on("data", d => (stderr += d));
    child.on("error", e => resolve({ stdout, stderr: e.message }));
    child.on("close", () => resolve({ stdout, stderr }));
  });
}

const queryArgs = (file, context, set = []) =>
  ["query", "-f", file, ...set, "-o", "json", "--agent", "--spill=never", ...(context ? ["--context", context] : [])];

// Parses a dtctl envelope; returns { ok, records, error }.
function parseEnvelope({ stdout, stderr }) {
  let env;
  try { env = JSON.parse(stdout); } catch { env = null; }
  if (env?.ok === true && env.result?.kind === "records") {
    return { ok: true, records: env.result.records ?? [], error: null };
  }
  const error = env ? env.error?.message : null;
  return { ok: false, records: [], error: error ?? (stderr.split("\n")[0].trim() || TOO_OLD) };
}

export async function runQueries({ frontend, outDir, context, dtctl, queriesDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const names = fs.readdirSync(queriesDir).filter(f => f.endsWith(".dql")).sort().map(f => f.slice(0, -4));
  return Promise.all(names.map(async name => {
    const file = path.join(queriesDir, `${name}.dql`);
    const out = await exec(dtctl, queryArgs(file, context, ["--set", `frontend=${frontend}`]));
    fs.writeFileSync(path.join(outDir, `${name}.json`), out.stdout);
    const { ok, records, error } = parseEnvelope(out);
    return { name, ok, rows: records.length, error };
  }));
}

async function main() {
  const { values } = parseArgs({
    options: {
      frontend: { type: "string" }, out: { type: "string" }, context: { type: "string" },
      "list-frontends": { type: "boolean" },
    },
  });
  const found = resolveDtctl();
  if (!found) { console.error(NOT_FOUND); process.exit(2); }
  const dtctl = { cmd: found, prefixArgs: [] };

  if (values["list-frontends"]) {
    const out = await exec(dtctl, queryArgs(path.join(HERE, "..", "references", "frontends.dql"), values.context));
    const { ok, records, error } = parseEnvelope(out);
    if (!ok) { console.error(error); process.exit(1); }
    for (const r of records) console.log(`${r.page_loads}\t${r["frontend.name"]}`);
    return;
  }

  if (!values.frontend || !values.out) {
    console.error("usage: run-queries.mjs --frontend <name> --out <dir> [--context <ctx>] | --list-frontends [--context <ctx>]");
    process.exit(2);
  }
  const results = await runQueries({
    frontend: values.frontend, outDir: values.out, context: values.context,
    dtctl, queriesDir: path.join(HERE, "..", "references", "queries"),
  });
  for (const r of results) console.log(r.ok ? `${r.name}: ${r.rows} rows` : `${r.name}: FAILED ${r.error}`);
  if (results.some(r => !r.ok)) process.exit(1);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
