# trending-report

Generates a 4-page Dynatrace RUM trending PDF for a web frontend, covering the last 6 full calendar months: executive summary, traffic, Core Web Vitals over time, browser and device performance. Data comes from `dtctl` queries against Grail; no dt-app deployment. `SKILL.md` has the full workflow. For the last-month deep-dive use `monthly-report`.

## Prerequisites

Run `/tools:setup` once. It installs `dtctl`, Node.js and a Chromium browser, and authenticates a Dynatrace environment.

## Usage

```
/tools:trending-report
```

- Pick the frontend (or name it directly).
- Queries run through `scripts/run-queries.mjs`; Claude writes the findings from the resulting tables.
- A local review page opens in your browser: click any findings panel to edit (changes autosave), pick Light or Dark, then **Create PDF**. **Rewrite analysis** asks Claude to redo the findings.
- Add `--no-preview` to skip the review page and render the light-theme PDF directly.
- The Browser Performance page shows 6 browser x device panels (ranked by the latest month's visits); `build-report.mjs --max-browsers <N>` changes the count.

## Output

`~/Downloads/<frontend>-trending-<YYYY-MM>.pdf`. The working data in `~/.dt-reports/` is deleted once the PDF exists.

## Previewing the layout without a tenant

`assets/fixtures/sample.json` holds a realistic `DATA` object (see the contract comment at the top of `assets/report-trending.html.tmpl`), so the layout can be checked with no `dtctl` and no Dynatrace access. Use this when changing the template or the design layer. From this directory:

```bash
node scripts/preview.mjs --out "$HOME/.dt-reports/preview-trending.html"
node scripts/render-pdf.mjs --in "$HOME/.dt-reports/preview-trending.html" --out "$HOME/.dt-reports/preview-trending.pdf"
```

The first writes a standalone HTML file (`--out <path>` or a bare positional path; default `preview-trending.html` in `$CLAUDE_SCRATCH_DIR` or the OS temp dir). The second renders it to PDF; add `--theme dark` for the dark theme.

Verify the resulting PDF with `sips` (CoreGraphics), not `pdftoppm` — poppler
composites Chrome's canvas transparency groups correctly and is blind to a class of
bug that shows up as white blocks in macOS Preview. See
`docs/report-deck-overhaul.md` for the check.

## Queries

`references/queries.md` maps each `references/queries/*.dql` to its output file, columns and unit conversions.
