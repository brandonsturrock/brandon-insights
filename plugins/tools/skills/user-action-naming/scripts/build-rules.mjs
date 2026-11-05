#!/usr/bin/env node
// Reviewed naming CSV -> OpenPipeline rules (markdown, optional themed PDF).
//   node build-rules.mjs review.csv --frontend "EasyShop" --md rules.md [--context "<ctx>"] [--pdf rules.pdf]
// review.csv columns used: keep, type, proposed_name, match, extract, current_names, count
//   keep           y/n - only y rows become rules
//   match          type-specific condition, e.g. matchesValue(view.name, "/p/*")
//   extract        optional, ';;'-separated "field|DPL pattern", e.g. view.name|'/p/' LD:event_properties.product
//   current_names  ';'-separated raw names (examples when --context is not given)
// Rows sharing (type, proposed_name) merge into one rule with conditions OR'd.
// --context dry-runs every rule on the last 7 days via dtctl; the top 3 results become
// `old` -> `new` examples with the extracted event properties.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readCsv } from "./csv.mjs";
import { renderPdf } from "./render-pdf.mjs";

const LABEL = { hard_navigation: "Load", soft_navigation: "Navigate", same_view: "Same view" };
const PREFIX = { hard_navigation: "Load ", soft_navigation: "Navigate to " };
const HERE = path.dirname(fileURLToPath(import.meta.url));

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

export function buildRules(rows, frontend) {
  const rules = new Map();
  for (const r of rows) {
    if ((r.keep ?? "").trim().toLowerCase() !== "y") continue;
    const k = `${r.type}\t${r.proposed_name}`;
    if (!rules.has(k)) rules.set(k, { type: r.type, name: r.proposed_name, match: [], extract: [], names: [], count: 0 });
    const rule = rules.get(k);
    rule.count += Number(r.count) || 0;
    const m = (r.match ?? "").trim();
    if (m && !rule.match.includes(m)) rule.match.push(m);
    for (const e of (r.extract ?? "").split(";;").map(x => x.trim()).filter(Boolean)) if (!rule.extract.includes(e)) rule.extract.push(e);
    for (const n of (r.current_names ?? "").split(";").map(x => x.trimStart()).filter(Boolean)) if (!rule.names.includes(n)) rule.names.push(n);
  }
  return [...rules.values()].map(rule => {
    const match = rule.match.length === 1 ? rule.match[0] : `(${rule.match.map(x => `(${x})`).join(" or ")})`;
    const parts = [`user_action.name = "${rule.name}"`, ...rule.extract.map(e => {
      const i = e.indexOf("|");
      return `parse(${e.slice(0, i)}, "${e.slice(i + 1)}")`;
    })];
    return {
      ...rule,
      title: `${frontend} | ${LABEL[rule.type]} | ${rule.name.replace(PREFIX[rule.type] ?? "", "")}`,
      condition: `characteristics.has_user_action == true and frontend.name == "${frontend}" and user_action.type == "${rule.type}" and ${match}`,
      processor: `fieldsAdd ${parts.join(",\n  ")}`,
      props: rule.extract.flatMap(e => [...e.matchAll(/:(event_properties\.[\w.]+)/g)].map(x => x[1])),
    };
  });
}

// Returns [{ from, to, count, props: [[field, value]] }] or { error }.
export function dryRun(rule, context, dtctl, run = spawnSync) {
  const by = ["original_name", "user_action.name", ...rule.props].join(", ");
  const q = `fetch user.events, from: now()-7d\n| filter ${rule.condition}\n| fieldsAdd original_name = user_action.name\n` +
    `| ${rule.processor}\n| summarize count=count(), by: {${by}}\n| sort count desc\n| limit 3`;
  const res = run(dtctl, ["query", q, "--context", context, "-o", "json"], { encoding: "utf8" });
  try {
    const result = JSON.parse(res.stdout).result;
    const recs = result.records.map(r => ({ ...(result.constant ?? {}), ...r })); // dtctl hoists constant columns
    if (!recs.length) return { error: "dry run matched no actions in the last 7 days" };
    return recs.map(r => ({ from: r.original_name, to: r["user_action.name"], count: Number(r.count), props: rule.props.map(p => [p, r[p]]) }));
  } catch {
    return { error: `dry run failed: ${String(res.stderr || res.stdout || res.error?.message || "").trim().slice(0, 300)}` };
  }
}

const examplesOf = (rule, context, dtctl) => context
  ? dryRun(rule, context, dtctl)
  : rule.names.slice(0, 3).map(n => ({ from: n, to: rule.name, count: null, props: [] }));

export function toMarkdown(frontend, rules) {
  const out = [`# ${frontend} — OpenPipeline user action naming rules`, "",
    `${rules.length} rules. Actions = matching user actions in the analyzed 7 days.`, "",
    "| # | Type | New name | Actions |", "|---|---|---|---|",
    ...rules.map((r, i) => `| ${i + 1} | ${LABEL[r.type]} | \`${r.name}\` | ${r.count.toLocaleString("en-US")} |`), ""];
  rules.forEach((r, i) => {
    out.push(`## ${i + 1}. \`${r.title}\``, "", "**Matching condition**", "", "```", r.condition, "```", "",
      "**Processor definition**", "", "```", r.processor, "```", "", "**Affected user actions (examples)**", "");
    if (r.examples.error) out.push(`- ${r.examples.error}`);
    else for (const e of r.examples) {
      out.push(`- \`${e.from}\` → \`${e.to}\`${e.count == null ? "" : ` (${e.count.toLocaleString("en-US")})`}`);
      for (const [k, v] of e.props) out.push(`  - \`${k} = "${v}"\``);
    }
    out.push("");
  });
  return out.join("\n");
}

const h = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const c = s => `<code>${h(s)}</code>`;

export function toHtml(frontend, rules, css) {
  const rows = rules.map((r, i) => `<tr><td>${i + 1}</td><td>${LABEL[r.type]}</td><td>${c(r.name)}</td><td class="num">${r.count.toLocaleString("en-US")}</td></tr>`).join("");
  const sections = rules.map((r, i) => {
    const ex = r.examples.error ? `<li>${h(r.examples.error)}</li>` : r.examples.map(e =>
      `<li>${c(e.from)} → ${c(e.to)}${e.count == null ? "" : ` (${e.count.toLocaleString("en-US")})`}` +
      (e.props.length ? `<ul>${e.props.map(([k, v]) => `<li>${c(`${k} = "${v}"`)}</li>`).join("")}</ul>` : "") + "</li>").join("");
    return `<section class="rule"><h2>${i + 1}. ${c(r.title)}</h2><p><strong>Matching condition</strong></p><pre><code>${h(r.condition)}</code></pre>` +
      `<p><strong>Processor definition</strong></p><pre><code>${h(r.processor)}</code></pre>` +
      `<p><strong>Affected user actions (examples)</strong></p><ul>${ex}</ul></section>`;
  }).join("\n");
  const title = `${frontend} — OpenPipeline user action naming rules`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${h(title)}</title><style>${css}</style></head><body>` +
    `<h1>${h(title)}</h1><p>${rules.length} rules. Actions = matching user actions in the analyzed 7 days.</p>` +
    `<table><thead><tr><th>#</th><th>Type</th><th>New name</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>\n${sections}</body></html>`;
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { frontend: { type: "string" }, context: { type: "string" }, md: { type: "string" }, pdf: { type: "string" } },
  });
  if (!positionals[0] || !values.frontend || !values.md) {
    console.error('usage: node build-rules.mjs review.csv --frontend "<name>" --md <out.md> [--context "<ctx>"] [--pdf <out.pdf>]');
    process.exit(1);
  }
  let dtctl = null;
  if (values.context && !(dtctl = resolveDtctl())) { console.error("dtctl not found — run the setup skill (/tools:setup)"); process.exit(2); }
  const rules = buildRules(readCsv(positionals[0]), values.frontend)
    .map(r => ({ ...r, examples: examplesOf(r, values.context, dtctl) }));
  fs.writeFileSync(values.md, toMarkdown(values.frontend, rules));
  const failed = rules.filter(r => r.examples.error);
  console.log(`rules: ${rules.length}${failed.length ? `, dry-run problems: ${failed.map(r => r.title).join("; ")}` : ""}`);
  console.log(`md: ${values.md}`);
  if (values.pdf) {
    const html = values.pdf.replace(/\.pdf$/i, "") + ".html";
    fs.writeFileSync(html, toHtml(values.frontend, rules, fs.readFileSync(path.join(HERE, "../assets/style.css"), "utf8")));
    const res = renderPdf({ inHtml: html, outPdf: values.pdf, theme: "light" });
    fs.rmSync(html, { force: true });
    if (!res.ok) { console.error(res.error); process.exit(1); }
    console.log(`pdf: ${values.pdf}`);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
