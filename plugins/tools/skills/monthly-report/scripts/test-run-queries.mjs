#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDtctl, runQueries } from "./run-queries.mjs";

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

  // resolveDtctl
  const binDir = path.join(tmp, "bin");
  assert.equal(resolveDtctl({ PATH: binDir }, "darwin", p => p === path.join(binDir, "dtctl")), "dtctl");
  assert.equal(resolveDtctl({ PATH: `/x${path.delimiter}${binDir}` }, "linux", p => p === path.join(binDir, "dtctl.exe")), "dtctl");
  assert.equal(resolveDtctl({ PATH: "", LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "win32",
    p => p === "C:\\Users\\x\\AppData\\Local\\dtctl\\dtctl.exe"), "C:\\Users\\x\\AppData\\Local\\dtctl\\dtctl.exe");
  assert.equal(resolveDtctl({ PATH: "" }, "darwin", p => p === "/opt/homebrew/bin/dtctl"), "/opt/homebrew/bin/dtctl");
  assert.equal(resolveDtctl({ PATH: "" }, "linux", () => false), null);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
