# user-action-naming

Proposes cleaner Dynatrace RUM user action names for a web frontend and generates one OpenPipeline processor per new name: rule name, matching condition, processor definition, and real affected examples. Data comes from `dtctl` queries against `user.events`; no dt-app deployment. `SKILL.md` has the full workflow.

- Hard navigations → `Load <cleaned path>` (`Load /p/:product:`)
- Soft navigations → `Navigate to <cleaned view>` (`Navigate to /c/:category:`)
- Same-view actions → plain action names from the request path and element (`Add to Cart`), with a confidence level
- Unique values (product slugs, IDs) become `:name:` placeholders and are captured as `event_properties.<name>`

## Prerequisites

Run `/tools:setup` once. It installs `dtctl`, Node.js and a Chromium browser, and authenticates a Dynatrace environment.

## Usage

```
/tools:user-action-naming
```

Pick the frontend (or name it directly). Edit `review.csv` to adjust names, then ask Claude to rebuild the rules.

## Output

`~/Downloads/<frontend>-user-action-naming/`:

| File | Content |
|---|---|
| `review.csv` | Proposed names, confidence, matching conditions — edit this |
| `findings.md` | Capture gaps, existing custom names, noise |
| `openpipeline-rules.md` / `.pdf` | Every rule in full, with affected `old` → `new` examples and captured event properties |
| `raw.csv`, `groups.csv` | Query result and grouped candidates |

## Tests

```bash
node scripts/test-user-action-naming.mjs
```
