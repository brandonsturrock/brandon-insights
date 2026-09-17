# Report deck overhaul — trending & monthly

**Date:** 2026-09-10
**Scope:** `plugins/tools/skills/trending-report`, `plugins/tools/skills/monthly-report`
**Status:** HTML/PDF layouts done and verified from fixtures. Neither skill has been
run end to end against a tenant since the change.

## What this was

The `full-page-analysis` waterfall report had already been rebuilt onto Dynatrace
Strato design tokens and the brand specification. The trending and monthly decks had
not — they were still on raw hex (`#0f1117`, `#1c1e2e`, `#1496ff`), ad-hoc font sizes
from 9px to 32px, a gradient top-accent on every card, and a blue radial-dot page
texture. This brings both onto the same design system as the waterfall report, so the
three deliverables read as one family.

Two decisions were taken up front and should not be relitigated without a reason:

- **The fixed A4-landscape paged deck shape is kept.** One topic per page, `overflow:
  hidden` per page, deterministic pagination. Not converted to a continuous flowing
  document like the waterfall report — a monthly/trending review is read as a deck.
- **Dark on screen, light on paper.** The HTML review copy is dark; `@media print`
  re-declares the same ten Strato roles at their light values. Same as the waterfall
  report.

## The shared design layer

`docs/report-deck-design-layer.css` is the canonical copy. It is **pasted verbatim**
into both templates' `<style>` blocks rather than `@import`-ed, because each template
must stay a single self-contained file (opened off disk as `file://`, mailed around as
one artefact) and neither build script injects assets. If you change the design layer,
change it in the canonical file and re-paste into both templates — the two inlined
copies are expected to stay byte-identical in that region, and both currently resolve
to an identical palette.

Layer order: ten Strato roles → semantic aliases → one type ramp → components. Nothing
below the `:root` blocks holds a raw colour, which is what lets a single print override
invert the whole document.

Components: `.page` / masthead / `.ftr`, `.panel`, `.kpi-tile`, the CWV `.metric-tile`
with its threshold scale, `.rp-table`, bar-in-cell and `.flex-bars`, `.status` and
`.chip`, `.finding-row`, chart furniture, and the `--ct-*` chart token pairs.

## Per-deck changes

**Trending (4 pages).** Page 1 mixes plain KPI tiles with CWV metric tiles carrying
threshold scales. Page 2's traffic table moved to `.flex-bars` so rows fill the page.
Page 3 dropped the old three-metric bar table for a status row plus three
single-metric small multiples (a shared ms axis pinned INP to a flat line at the
bottom of an LCP-scaled chart — unreadable). Page 4 replaced a 6×4 mini-table that
needed 9px type with a visits sparkline plus LCP/INP/CLS status chips per panel, all
at or above the 10px floor.

**Monthly (5 pages).** Page 1's findings became a real 2×2 grid. Page 3 dropped the
standalone 100%-stacked tier bar — the good/NI/poor split now rides in each metric
tile's tail line, which freed a card's height for readable distribution histograms and
daily trend charts. Pages 4 and 5 use `.rp-table` with bar-in-cell counts and
status-graded LCP/INP/CLS cells. The error-type stack folds to top 5 + Other, with
`--rp-series-6` reserved for Other.

## Bugs found and fixed along the way

These were all found by rendering and looking, not by reading code. Three of them
would have shipped silently.

1. **Charts printed with dark-theme ink on light paper.** `beforeprint` fires *before*
   the print stylesheet applies — measured in this repo's own render path: the event
   fires, but `matchMedia("print").matches` is `false` inside the handler. So any
   `getComputedStyle()` read there returns the screen palette and bakes it into the
   PDF. There is no event that fires after print media applies but before capture.
   Fixed by declaring every chart-facing token twice at `:root` (`--ct-grid` /
   `--ct-grid-print`, etc.), always live in both media, with the caller passing an
   explicit `printing` boolean rather than sniffing the environment.

2. **`getComputedStyle().getPropertyValue()` on a `color-mix()` token returns its
   declared text**, not a computed colour, and canvas `strokeStyle` silently ignores
   what it cannot parse — keeping whatever colour was set before. Every gridline came
   out near-black. Resolve through a hidden probe element instead.

3. **Canvas transparency groups punch holes in the PDF under macOS Preview.** Chrome
   exports each `<canvas>` as a vector transparency-group form XObject. Poppler
   composites those correctly; Apple's CoreGraphics leaves the region fully
   transparent, which Preview paints white — and places the holes by group bbox, so
   they land over unrelated content like the masthead. Fixed with an opaque backing
   store (`getContext("2d", { alpha: false })` before Chart.js binds) plus a
   `beforeDraw` plugin filling `--ct-panel-bg` / `--ct-panel-bg-print`. It must be a
   plugin, not a one-off paint, so it survives Chart.js's own redraw passes, and it
   must be `source-over` — with an opaque context, `destination-over` has no
   transparent region to land in and leaves the canvases black.

4. **Bar-in-cell bars encoded nothing.** The bar column inherited `.num`'s `width: 1%`,
   collapsing every track to its min-width regardless of value, in both decks.

5. **INP was bucketed on LCP's scale.** `cm-cwv-distribution.dql` counted INP in
   1-second steps against a metric whose good threshold is 200ms and poor is 500ms, so
   every real sample landed in bucket 0 and the histogram was structurally incapable of
   showing a distribution. Re-bucketed to 100ms steps with both thresholds on bucket
   edges; `INP_BUCKETS` now sits beside `LCP_BUCKETS` and `CLS_BUCKETS`.

## Verifying a change to these decks

Each skill has a committed fixture and a preview script, so a layout can be checked
without a tenant:

```
node plugins/tools/skills/<skill>/scripts/preview.mjs
```

**Verify PDFs with `sips` (CoreGraphics), not `pdftoppm`.** Poppler composites the
transparency groups correctly and is structurally blind to bug 3 above — three rounds
of page-by-page review through poppler missed it, and it was caught by opening the file
in Preview. The check:

```
pdfseparate -f 3 -l 3 out.pdf p3.pdf
sips -s format png --resampleWidth 1400 p3.pdf --out p3.png
python3 -c "from PIL import Image; import numpy as np; \
a=np.asarray(Image.open('p3.png').convert('RGBA')); \
print('transparent', (a[:,:,3]<10).mean(), \
      'dark', ((a[:,:,:3].max(axis=2)<80)&(a[:,:,3]>=10)).mean())"
```

Both figures should be ~0.00 on every page that carries a chart. A few hundredths of a
percent of "dark" is anti-aliased text, not a black canvas.

## Known gaps

- **`plugins/tools/skills/trending-report/README.md` was never updated.** It should
  gain a line pointing at `node scripts/preview.mjs`. The file is a dehydrated OneDrive
  placeholder (`compressed,dataless`) that no reader on this machine can open — `cat`
  fails with `os error 60` and git cannot mmap its own pack. Hydrate the folder
  (Finder → right-click → Always keep on this device) and add the line.
- Neither skill has been run end to end against a live tenant since the change. The
  DQL edit in item 5 is static and unexercised.
- `monthly-report/references/queries.md` carries a duplicate copy of the distribution
  query; it was updated alongside the `.dql` file, but the duplication is still there
  to drift.
