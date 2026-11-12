#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRecords, markdownToHtml } from "./build-report.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpa-test-"));
const write = (name, content) => fs.writeFileSync(path.join(dir, name), content);

// A query matching zero rows comes back as kind: "records" with
// records: null, not []. That is a well-formed empty result, not a
// malformed envelope — the common case for e.g. instance-exceptions.json.
write("null-records.json", JSON.stringify({ result: { kind: "records", records: null } }));
assert.deepEqual(loadRecords(dir, "null-records.json"), []);

write("populated.json", JSON.stringify({ result: { kind: "records", records: [{ a: 1 }, { a: 2 }] } }));
assert.deepEqual(loadRecords(dir, "populated.json"), [{ a: 1 }, { a: 2 }]);

// --agent moves columns that are uniform across rows into result.constant.
write("constant.json", JSON.stringify({ result: { kind: "records", constant: { "device.type": "desktop" }, records: [{ b: "Chrome" }, { b: "Safari" }] } }));
assert.deepEqual(loadRecords(dir, "constant.json"), [{ "device.type": "desktop", b: "Chrome" }, { "device.type": "desktop", b: "Safari" }]);

write("bare-array.json", JSON.stringify([{ a: 1 }]));
assert.deepEqual(loadRecords(dir, "bare-array.json"), [{ a: 1 }]);

assert.deepEqual(loadRecords(dir, "missing.json"), []);

write("empty.json", "");
assert.deepEqual(loadRecords(dir, "empty.json"), []);

// A genuinely unexpected shape (no records array, not kind: "records" with
// null) must still throw — the null-records case above must not swallow it.
write("malformed.json", JSON.stringify({ result: { kind: "error", message: "boom" } }));
assert.throws(() => loadRecords(dir, "malformed.json"), /Unexpected JSON envelope shape/);

// kind: "records" with no records key at all (undefined, not JSON null) is
// still a malformed envelope and must throw, not be swallowed by the
// null-records branch above.
write("missing-records-key.json", JSON.stringify({ result: { kind: "records" } }));
assert.throws(() => loadRecords(dir, "missing-records-key.json"), /Unexpected JSON envelope shape/);

// Analyst notes render `code` and **bold**, after escaping, so markup cannot leak in.
assert.equal(markdownToHtml("- Defer `moment.min.js` **first** <b>x</b>"),
  "<ul><li>Defer <code>moment.min.js</code> <strong>first</strong> &lt;b&gt;x&lt;/b&gt;</li></ul>");

fs.rmSync(dir, { recursive: true, force: true });
console.log("test-build-report.mjs: all assertions passed");
