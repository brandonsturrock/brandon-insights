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

// Grail stops a fetch at its scan limit and returns only the newest data it
// reached, as an ok result. dtctl flags it in context.warnings; treat it as a
// failure so a month report never silently shows one day.
const PARTIAL = /scan limit|execution was stopped after/i;

// Parses a dtctl envelope; returns { ok, records, error, scannedBytes }.
function parseEnvelope({ stdout, stderr }) {
  let env;
  try { env = JSON.parse(stdout); } catch { env = null; }
  if (env?.ok === true && env.result?.kind === "records") {
    const partial = (env.context?.warnings ?? []).find(w => PARTIAL.test(w));
    if (partial) return { ok: false, records: [], error: `PARTIAL result (scan limit reached): ${partial}` };
    return { ok: true, records: env.result.records ?? [], error: null, scannedBytes: Number(env.metadata?.scannedBytes) || 0 };
  }
  const error = env ? env.error?.message : null;
  return { ok: false, records: [], error: error ?? (stderr.split("\n")[0].trim() || TOO_OLD) };
}

// Raw-event queries (fetch user.events / user.sessions) are sampled when a full
// scan would exceed SCAN_BUDGET_BYTES. A probe reads the query's own fetch +
// frontend filter (its first two lines) at 1:PROBE_RATIO; scannedBytes x
// PROBE_RATIO estimates the full scan (overestimates ~1.5x at small volumes,
// the safe side). Grail only accepts powers of 10. Queries must scale counts
// with sum(dt.system.sampling_ratio); ratios of counts need no change.
export const SCAN_BUDGET_BYTES = 100e9;
const PROBE_RATIO = 1000;
const RATIOS = [1, 10, 100, 1000];
export const pickRatio = estimatedBytes => RATIOS.find(r => estimatedBytes / r <= SCAN_BUDGET_BYTES) ?? RATIOS.at(-1);

function probeText(dql) {
  const lines = dql.split(/\r?\n/).filter(l => l.trim());
  return /^fetch\s+user\./.test(lines[0] ?? "") ? `${lines.slice(0, 2).join("\n")}\n| summarize c = count()` : null;
}

export async function runQueries({ frontend, outDir, context, dtctl, queriesDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const names = fs.readdirSync(queriesDir).filter(f => f.endsWith(".dql")).sort().map(f => f.slice(0, -4));
  const set = ["--set", `frontend=${frontend}`];
  const probes = new Map(); // probe text -> Promise<ratio>, shared by queries with the same fetch + filter
  const ratioFor = text => {
    if (!probes.has(text)) {
      const file = path.join(outDir, `probe-${probes.size}.dql`);
      fs.writeFileSync(file, text);
      probes.set(text, exec(dtctl, queryArgs(file, context, [...set, "--default-sampling-ratio", String(PROBE_RATIO)]))
        .then(out => { fs.rmSync(file, { force: true }); const p = parseEnvelope(out); return p.ok ? pickRatio(p.scannedBytes * PROBE_RATIO) : 1; }));
    }
    return probes.get(text);
  };
  const results = await Promise.all(names.map(async name => {
    const file = path.join(queriesDir, `${name}.dql`);
    const probe = probeText(fs.readFileSync(file, "utf8"));
    const ratio = probe ? await ratioFor(probe) : 1;
    const sampling = ratio > 1 ? ["--default-sampling-ratio", String(ratio)] : [];
    const out = await exec(dtctl, queryArgs(file, context, [...set, ...sampling]));
    fs.writeFileSync(path.join(outDir, `${name}.json`), out.stdout);
    const { ok, records, error } = parseEnvelope(out);
    return { name, ok, rows: records.length, error, ratio };
  }));
  fs.writeFileSync(path.join(outDir, "sampling.json"), JSON.stringify(Object.fromEntries(results.map(r => [r.name, r.ratio]))));
  return results;
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
  for (const r of results) console.log(r.ok ? `${r.name}: ${r.rows} rows${r.ratio > 1 ? ` (sampled 1:${r.ratio})` : ""}` : `${r.name}: FAILED ${r.error}`);
  if (results.some(r => !r.ok)) process.exit(1);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
