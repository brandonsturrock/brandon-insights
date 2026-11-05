#!/usr/bin/env node
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "./csv.mjs";
import { normalize, group } from "./group.mjs";
import { buildRules, dryRun, toMarkdown } from "./build-rules.mjs";

// csv round trip with quotes, commas and a trailing-space value
const csv = toCsv(["a", "b"], [['x, "y"', "click on span on "]]);
assert.deepEqual(parseCsv(csv), [{ a: 'x, "y"', b: "click on span on " }]);

// placeholders: explicit prefix, auto IDs in paths and element names, real pages untouched
assert.equal(normalize("click on add-to-cart on /p/yoga-mat", [["/p/", "product"]]), "click on add-to-cart on /p/:product:");
assert.equal(normalize("/broker-service/v1/balance/17/deposit"), "/broker-service/v1/balance/:id:/deposit");
assert.equal(normalize("/order/es-01ij75"), "/order/:id:");
assert.equal(normalize("click on mui-p-18623-T-quick-sell"), "click on mui-p-:id:-T-quick-sell");
assert.equal(normalize("/credit-card/active"), "/credit-card/active");

// grouping merges product variants and flags a blank element
const raw = [
  { count: "5", "user_action.name": "click on  on /p/a", "user_action.type": "soft_navigation", "view.name": "/cart", "view.source.name": "/p/a", "url.path": "" },
  { count: "3", "user_action.name": "click on  on /p/b", "user_action.type": "soft_navigation", "view.name": "/cart", "view.source.name": "/p/b", "url.path": "" },
];
const groups = parseCsv(group(raw, [["/p/", "product"]]));
assert.equal(groups.length, 1);
assert.equal(groups[0].count, "8");
assert.equal(groups[0].variants, "2");
assert.match(groups[0].flags, /blank-element/);

// rules: keep=n skipped, same type+name merged without duplicate conditions, parse() in fieldsAdd
const rules = buildRules([
  { keep: "y", type: "same_view", proposed_name: "Sign In", match: 'url.path == "/a"', extract: "", current_names: "click on x on /login", count: "2" },
  { keep: "y", type: "same_view", proposed_name: "Sign In", match: 'url.path == "/b"', extract: "", current_names: "", count: "3" },
  { keep: "y", type: "same_view", proposed_name: "Sign In", match: 'url.path == "/b"', extract: "", current_names: "", count: "1" },
  { keep: "y", type: "hard_navigation", proposed_name: "Load /p/:product:", match: 'matchesValue(view.name, "/p/*")', extract: "view.name|'/p/' LD:event_properties.product", current_names: "Load /p/a", count: "9" },
  { keep: "n", type: "hard_navigation", proposed_name: "Load /cart", match: 'view.name == "/cart"', extract: "", current_names: "", count: "1" },
], "Shop");
assert.equal(rules.length, 2);
assert.equal(rules[0].count, 6);
assert.match(rules[0].condition, /^characteristics\.has_user_action == true and frontend\.name == "Shop" and user_action\.type == "same_view" and \(\(url\.path == "\/a"\) or \(url\.path == "\/b"\)\)$/);
assert.equal(rules[1].title, "Shop | Load | /p/:product:");
assert.equal(rules[1].processor, `fieldsAdd user_action.name = "Load /p/:product:",\n  parse(view.name, "'/p/' LD:event_properties.product")`);
assert.deepEqual(rules[1].props, ["event_properties.product"]);

// dry run merges dtctl's hoisted constant columns into each record
const fake = () => ({ stdout: JSON.stringify({ result: { constant: { "user_action.name": "Load /p/:product:" },
  records: [{ count: "4", original_name: "Load /p/a", "event_properties.product": "a" }] } }) });
const ex = dryRun(rules[1], "ctx", "dtctl", fake);
assert.deepEqual(ex, [{ from: "Load /p/a", to: "Load /p/:product:", count: 4, props: [["event_properties.product", "a"]] }]);
assert.match(dryRun(rules[1], "ctx", "dtctl", () => ({ stdout: "", stderr: "boom" })).error, /dry run failed: boom/);

const md = toMarkdown("Shop", [{ ...rules[1], examples: ex }]);
assert.match(md, /- `Load \/p\/a` → `Load \/p\/:product:` \(4\)\n  - `event_properties\.product = "a"`/);

console.log("ok");
