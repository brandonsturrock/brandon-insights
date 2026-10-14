# monthly-report

Generates the 4-page Dynatrace RUM "Current Month" review PDF (`assets/report-cm.html.tmpl`
+ `scripts/build-report.mjs`). See `SKILL.md` for the full dtctl-driven workflow.

## Previewing the template without a tenant

`assets/fixtures/sample.json` is a realistic `DATA` object (see the contract comment at the
top of `report-cm.html.tmpl`) plus sample findings markdown, committed so the layout can be
checked without running any `dtctl` queries.

```bash
node scripts/preview.mjs [outPath]   # default: $CLAUDE_SCRATCH_DIR/preview-cm.html or /tmp/preview-cm.html
```

Then either open the HTML directly, or render the PDF to check pagination and the print theme:

```bash
bash assets/render-pdf.sh <outPath> <outPath>.pdf
```

`preview.mjs` reuses `build-report.mjs`'s own `assembleHtml()`/`markdownToHtml()` exports —
editing the template's placeholder contract only requires updating `build-report.mjs`, not a
second copy of the substitution logic.
