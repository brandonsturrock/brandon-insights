#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRecords } from "./build-report.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpa-test-"));
const write = (name, content) => fs.writeFileSync(path.join(dir, name), content);

// A query matching zero rows comes back as kind: "records" with
// records: null, not []. That is a well-formed empty result, not a
// malformed envelope — the common case for e.g. instance-exceptions.json.
write("null-records.json", JSON.stringify({ result: { kind: "records", records: null } }));
assert.deepEqual(loadRecords(dir, "null-records.json"), []);

write("populated.json", JSON.stringify({ result: { kind: "records", records: [{ a: 1 }, { a: 2 }] } }));
assert.deepEqual(loadRecords(dir, "populated.json"), [{ a: 1 }, { a: 2 }]);

write("bare-array.json", JSON.stringify([{ a: 1 }]));
assert.deepEqual(loadRecords(dir, "bare-array.json"), [{ a: 1 }]);

assert.deepEqual(loadRecords(dir, "missing.json"), []);

write("empty.json", "");
assert.deepEqual(loadRecords(dir, "empty.json"), []);

// A genuinely unexpected shape (no records array, not kind: "records" with
// null) must still throw — the null-records case above must not swallow it.
write("malformed.json", JSON.stringify({ result: { kind: "error", message: "boom" } }));
assert.throws(() => loadRecords(dir, "malformed.json"), /Unexpected JSON envelope shape/);

fs.rmSync(dir, { recursive: true, force: true });
console.log("test-build-report.mjs: all assertions passed");
