#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickRatio, resolveDtctl, runQueries, SCAN_BUDGET_BYTES } from "./run-queries.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rq-"));
try {
  const fake = (name, body) => {
    const file = path.join(tmp, `${name}.mjs`);
    fs.writeFileSync(file, body);
    return { cmd: process.execPath, prefixArgs: [file] };
  };
  const ok = fake("ok", `console.log(JSON.stringify({ ok: true, result: { kind: "records", records: [{ argv: process.argv.slice(2) }] } }));`);
  const boom = fake("boom", `console.log(JSON.stringify({ ok: false, error: { message: "boom" } })); process.exit(1);`);
  const garbage = fake("garbage", `console.log("not json");`);
  // >64 KB of 2-byte chars: a pipe chunk boundary will split one mid-character
  const bigUtf8 = fake("big", `console.log(JSON.stringify({ ok: true, result: { kind: "records", records: [{ s: "é".repeat(200000) }] } }));`);
  const stderrOnly = fake("stderr", `console.error("first line\\nsecond"); process.exit(1);`);

  const queriesDir = path.join(tmp, "queries");
  fs.mkdirSync(queriesDir);
  for (const n of ["b", "a"]) fs.writeFileSync(path.join(queriesDir, `${n}.dql`), "fetch logs");
  fs.writeFileSync(path.join(queriesDir, "notes.txt"), "ignored");

  const run = (dtctl, name, context) =>
    runQueries({ frontend: 'Shop "EU"/web app', outDir: path.join(tmp, name), context, dtctl, queriesDir });
  const argvOf = (dir, q) =>
    JSON.parse(fs.readFileSync(path.join(tmp, dir, `${q}.json`), "utf8")).result.records[0].argv;

  // success: sorted, one result per .dql, args verbatim, --context last
  const res = await run(ok, "out", "prod");
  assert.deepEqual(res.map(r => [r.name, r.ok, r.rows]), [["a", true, 1], ["b", true, 1]]);
  assert.ok(fs.existsSync(path.join(tmp, "out", "a.json")));
  assert.ok(!fs.existsSync(path.join(tmp, "out", "notes.json")));
  assert.ok(argvOf("out", "a").includes('frontend=Shop "EU"/web app')); // verbatim, one arg
  assert.deepEqual(argvOf("out", "a").slice(-2), ["--context", "prod"]);
  assert.deepEqual(argvOf("out", "a").slice(0, 3), ["query", "-f", path.join(queriesDir, "a.dql")]);
  assert.ok(argvOf("out", "a").includes("--spill=never"));

  // no context -> no flag
  await run(ok, "out-noctx");
  assert.ok(!argvOf("out-noctx", "a").includes("--context"));

  // failures
  const failRes = await run(boom, "out-fail");
  assert.equal(failRes[0].ok, false);
  assert.equal(failRes[0].rows, 0);
  assert.equal(failRes[0].error, "boom");
  assert.match((await run(garbage, "out-garbage"))[0].error, /dtctl too old/);
  assert.equal((await run(stderrOnly, "out-stderr"))[0].error, "first line");
  const missing = await run({ cmd: path.join(tmp, "nope"), prefixArgs: [] }, "out-missing");
  assert.equal(missing[0].ok, false);
  assert.match(missing[0].error, /ENOENT/);

  // multi-byte UTF-8 survives chunked stdout
  await run(bigUtf8, "out-utf8");
  const written = fs.readFileSync(path.join(tmp, "out-utf8", "a.json"), "utf8");
  assert.ok(written.length > 200000);
  assert.ok(!written.includes("\uFFFD"));

  // sampling: ratio picks the smallest power of 10 under the budget, capped at 1000
  assert.equal(pickRatio(0), 1);
  assert.equal(pickRatio(SCAN_BUDGET_BYTES), 1);
  assert.equal(pickRatio(SCAN_BUDGET_BYTES * 5), 10);
  assert.equal(pickRatio(SCAN_BUDGET_BYTES * 50), 100);
  assert.equal(pickRatio(SCAN_BUDGET_BYTES * 1e6), 1000);

  // probe: a user.* fetch is probed at 1:1000 (shared by queries with the same fetch + filter),
  // the estimate (scannedBytes x 1000) sets the ratio; non-event queries are never probed or sampled
  const evDir = path.join(tmp, "ev-queries");
  fs.mkdirSync(evDir);
  const ev = 'fetch user.events, from: now()-1d\n| filter frontend.name == "{{.frontend}}"\n';
  fs.writeFileSync(path.join(evDir, "e1.dql"), ev + "| summarize c = count()");
  fs.writeFileSync(path.join(evDir, "e2.dql"), ev + "| summarize n = count()");
  fs.writeFileSync(path.join(evDir, "m.dql"), "timeseries x = avg(y)");
  const sampler = fake("sampler", `
    import fs from "node:fs";
    const a = process.argv.slice(2), i = a.indexOf("--default-sampling-ratio");
    const ratio = i < 0 ? 1 : Number(a[i + 1]);
    if (ratio === 1000) fs.appendFileSync(${JSON.stringify(path.join(tmp, "probes.log"))}, "x");
    console.log(JSON.stringify({ ok: true, result: { kind: "records", records: [{ ratio }] },
      metadata: { scannedBytes: ratio === 1000 ? ${SCAN_BUDGET_BYTES} / 1000 * 30 : 1 } }));`.replace(/^\s+/gm, ""));
  const sres = await runQueries({ frontend: "Shop", outDir: path.join(tmp, "out-sample"), dtctl: sampler, queriesDir: evDir });
  assert.deepEqual(sres.map(r => [r.name, r.ratio]), [["e1", 100], ["e2", 100], ["m", 1]]);
  assert.equal(fs.readFileSync(path.join(tmp, "probes.log"), "utf8"), "x"); // one probe for both e1 and e2
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, "out-sample", "sampling.json"), "utf8")), { e1: 100, e2: 100, m: 1 });
  assert.ok(!fs.readdirSync(path.join(tmp, "out-sample")).some(f => f.startsWith("probe-")));

  // scan-limit warning on an ok envelope is a failure, not a partial month
  const partial = fake("partial", `console.log(JSON.stringify({ ok: true, result: { kind: "records", records: [{}] },
    context: { warnings: ["Your execution was stopped after 500 gigabytes of data were scanned."] } }));`);
  const pres = await run(partial, "out-partial");
  assert.equal(pres[0].ok, false);
  assert.match(pres[0].error, /PARTIAL/);

  // resolveDtctl (literal inputs: platform is injected, host path module must not matter)
  assert.equal(resolveDtctl({ PATH: "/opt/bin" }, "darwin", p => p === "/opt/bin/dtctl"), "dtctl");
  assert.equal(resolveDtctl({ PATH: "/x:/opt/bin" }, "linux", p => p === "/opt/bin/dtctl.exe"), "dtctl");
  assert.equal(resolveDtctl({ PATH: "C:\\Windows;C:\\tools" }, "win32", p => p === "C:\\tools\\dtctl.exe"), "dtctl");
  assert.equal(resolveDtctl({ PATH: "", LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "win32",
    p => p === "C:\\Users\\x\\AppData\\Local\\dtctl\\dtctl.exe"), "C:\\Users\\x\\AppData\\Local\\dtctl\\dtctl.exe");
  assert.equal(resolveDtctl({ PATH: "" }, "darwin", p => p === "/opt/homebrew/bin/dtctl"), "/opt/homebrew/bin/dtctl");
  assert.equal(resolveDtctl({ PATH: "" }, "linux", () => false), null);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
