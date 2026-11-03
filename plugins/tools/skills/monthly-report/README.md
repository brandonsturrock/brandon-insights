# monthly-report

Generates a 4-page Dynatrace RUM "Current Month" review PDF for a web frontend, covering the last full calendar month: executive summary, traffic and top pages, Core Web Vitals, top errors. Data comes from `dtctl` queries against Grail; no dt-app deployment. `SKILL.md` has the full workflow.

## Prerequisites

Run `/tools:setup` once. It installs `dtctl`, Node.js and a Chromium browser, and authenticates a Dynatrace environment.

## Usage

```
/tools:monthly-report
```

- Pick the frontend (or name it directly).
- Queries run through `scripts/run-queries.mjs`; Claude writes the findings from the resulting tables.
- A local review page opens in your browser: click any findings panel to edit (changes autosave), pick Light or Dark, then **Create PDF**. **Rewrite analysis** asks Claude to redo the findings.
- Add `--no-preview` to skip the review page and render the light-theme PDF directly.

## Output

`~/Downloads/<frontend>-monthly-<YYYY-MM>.pdf`. The working data in `~/.dt-reports/` is deleted once the PDF exists.

## Previewing the template without a tenant

`assets/fixtures/sample.json` is a realistic `DATA` object (see the contract comment at the top of `assets/report-cm.html.tmpl`) plus sample findings, so the layout can be checked with no `dtctl` and no Dynatrace access. From this directory:

```bash
node scripts/preview.mjs --out "$HOME/.dt-reports/preview-monthly.html"
node scripts/render-pdf.mjs --in "$HOME/.dt-reports/preview-monthly.html" --out "$HOME/.dt-reports/preview-monthly.pdf"
```

The first writes a standalone HTML file (`--out <path>` or a bare positional path; default `preview-cm.html` in `$CLAUDE_SCRATCH_DIR` or the OS temp dir). The second renders it to PDF to check pagination; add `--theme dark` for the dark theme.

`preview.mjs` reuses `build-report.mjs`'s own `assembleHtml()`/`markdownToHtml()` exports, so a change to the template's placeholder contract only needs updating in `build-report.mjs`.

## Queries

`references/queries.md` maps each `references/queries/*.dql` to its output file, columns and unit conversions.
