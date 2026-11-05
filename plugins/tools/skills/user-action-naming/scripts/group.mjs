#!/usr/bin/env node
// Group raw user-action rows into naming candidates.
//   node group.mjs raw.csv --segments                          # placeholder candidates
//   node group.mjs raw.csv --ph /p/=product --ph /c/=category  # groups CSV to stdout
// raw.csv = dtctl -o csv of the SKILL.md query (count, user_action.name, user_action.type,
// view.name, view.source.name, url.path). Always applied: ID-like path segments (digits,
// UUID/hex, 6+ char tokens with a digit) and 3+ digit runs in names -> :id:.
// --ph PREFIX=NAME replaces the segment right after PREFIX with :NAME:.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readCsv, toCsv } from "./csv.mjs";

const ID_SEG = /(?<=\/)(\d+|[0-9a-fA-F-]{16,}|(?=[^/\s?]*\d)[A-Za-z0-9_-]{6,})(?=\/|$|\s|\?)/g;
const DIGITS = /(?<![A-Za-z])\d{3,}(?![A-Za-z])/g;
const DEFAULT_NAME = /^(Load |\w+ on )/;
const FIELDS = ["view.name", "view.source.name", "url.path"];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function normalize(s, phs = []) {
  s = s ?? "";
  for (const [prefix, name] of phs) s = s.replace(new RegExp(esc(prefix) + "[^/\\s?]+", "g"), `${prefix}:${name}:`);
  return s.replace(ID_SEG, ":id:").replace(DIGITS, ":id:");
}

export function segments(rows, threshold = 3) {
  const seen = new Map();
  for (const r of rows) for (const f of FIELDS) {
    const parts = normalize(r[f]).split("/");
    for (let i = 2; i < parts.length; i++) { // never wildcard the first segment
      if (!parts[i] || parts[i] === ":id:") continue;
      const key = `${f}\t${parts.slice(0, i).join("/")}/*`;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(parts[i]);
    }
  }
  const out = [...seen].filter(([, v]) => v.size >= threshold).sort((a, b) => b[1].size - a[1].size)
    .map(([k, v]) => [...k.split("\t"), v.size, [...v].sort().slice(0, 6).join("; ")]);
  return toCsv(["field", "pattern", "distinct", "samples"], out);
}

export function group(rows, phs = []) {
  const g = new Map();
  for (const r of rows) {
    const key = [r["user_action.type"], normalize(r["user_action.name"], phs), ...FIELDS.map(f => normalize(r[f], phs))];
    const k = JSON.stringify(key);
    if (!g.has(k)) g.set(k, { key, count: 0, raw: new Map() });
    const e = g.get(k), n = Number(r.count) || 0, name = r["user_action.name"];
    e.count += n;
    e.raw.set(name, (e.raw.get(name) ?? 0) + n);
  }
  const out = [...g.values()]
    .sort((a, b) => a.key[0].localeCompare(b.key[0]) || b.count - a.count)
    .map(({ key, count, raw }) => {
      const flags = [];
      if (/ on  on |^\w+ on  /.test(key[1])) flags.push("blank-element");
      if (key[1].endsWith(" on ")) flags.push("blank-page");
      if (!DEFAULT_NAME.test(key[1])) flags.push("custom-name");
      if (key[2].includes(":id:")) flags.push("id-in-view");
      const top = [...raw].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join("; ");
      return [...key, count, raw.size, flags.join(" "), top];
    });
  return toCsv(["type", "name", "view", "source", "url_path", "count", "variants", "flags", "top_raw_names"], out);
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { ph: { type: "string", multiple: true, default: [] }, segments: { type: "boolean" }, threshold: { type: "string", default: "3" } },
  });
  if (!positionals[0]) { console.error("usage: node group.mjs raw.csv [--segments] [--ph PREFIX=NAME ...]"); process.exit(1); }
  const rows = readCsv(positionals[0]);
  const phs = values.ph.map(p => { const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1)]; });
  process.stdout.write(values.segments ? segments(rows, Number(values.threshold)) : group(rows, phs));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
