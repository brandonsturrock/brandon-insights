# Strato Foundations Reference

## Layout
Source: https://developer.dynatrace.com/design/foundations/layout/

**Breakpoints:** Mobile 0–640px | Tablet 641–960px | Desktop 961–1920px | Min viewport 320px

**Layout types:**
- Centered — 960px max width, text-heavy content
- Full-width — data-intensive apps (prefer for observability UIs)

**Visual hierarchy (layer order):**
1. Base — background
2. Surfaces — primary containers; elevation: flat/raised/floating
3. Containers — highlighted sections; semantic: neutral/primary/success/warning/critical; 3 emphasis levels
4. Fields — small interactive elements
5. Dividers — separators, no background

**Inset spacing:** Surfaces 24px (16px dense) | Containers 16px | Fields ≤12px

**Spacing tokens:** Groups `Spacings.Size32` | Elements `Spacings.Size16` | Related `Spacings.Size8`

---

## Navigation
Source: https://developer.dynatrace.com/design/foundations/navigation/

**Hierarchies:** Flat (≤8 pages, no order) | Nested (ordered, link-shareable) | Combined (complex apps)

**Components:**
- App Header — horizontal tabs for primary nav, app title links home
- Breadcrumbs — path to current location, required for deep nesting
- Tabs — group related content within a page

---

## Interaction States
Source: https://developer.dynatrace.com/design/foundations/interaction-states/

**Exclusive (one at a time):** Rest | Hover | Active | Drag | Disabled

**Disable vs hide:** Always disable. Only hide if content is sensitive or interrupts flow.

**Read-only vs Disabled:**
- Read-only: can focus/copy, value included in form submission
- Disabled: can't focus, value excluded from form submission

**Additive (stack with exclusive):**
- Focus — keyboard nav; contrasting inner border
- Selected — primary color + line or checkmark indicator

**Interactivity signals:** Dotted underline = action | Solid underline = link | Color alone is NOT an indicator

---

## Data Visualization
Source: https://developer.dynatrace.com/design/foundations/data-visualization-basics/

| Data type | Component | Use case |
|-----------|-----------|----------|
| Time series | `TimeseriesChart` | Metrics over time; line/area/bar/band |
| Categorical | `CategoricalBarChart`, `PieChart` | Browser usage, top-10 lists |
| KPI | `SingleValue`, `MeterBar`, `MultiMeterBar` | Revenue, latency, load count |
| Geospatial | `@dynatrace/strato-geo` | Maps with dot/bubble/choropleth/connection layers |

**TimeseriesChart interactions:** Add `ChartInteractions` subcomponent for zoom/pan.

---

## Design Tokens
Source: https://developer.dynatrace.com/design/foundations/design-tokens-in-use/

```bash
npm install @dynatrace/strato-design-tokens
```

```typescript
import Colors from '@dynatrace/strato-design-tokens/colors';
import Borders from '@dynatrace/strato-design-tokens/borders';
import Spacings from '@dynatrace/strato-design-tokens/spacings';
import Typography from '@dynatrace/strato-design-tokens/typography';
```

**Naming:** `Category.Role.Semantic.State` e.g. `Colors.Text.Primary.Default`, `Colors.Background.Container.Success.Default`, `Borders.Radius.Container.Default`

**Why tokens:** Automatic light/dark theming | 4.5:1 text contrast | 3:1 border/bg contrast | platform consistency

**Custom component pattern:**
```typescript
<div style={{
  padding: Spacings.Size16,
  border: `${Borders.Width.Emphasized} ${Borders.Style.Default} ${Colors.Border.Success.Default}`,
  borderRadius: Borders.Radius.Container.Default,
  backgroundColor: Colors.Background.Container.Success.Default,
  color: Colors.Text.Success.Default,
}}>
```

---

## Content Rules
Source: https://developer.dynatrace.com/design/foundations/content-checklist/

- American English, Oxford commas, sentence case (not Title Case)
- Headings/buttons: no punctuation, no -ing verbs, no question marks
- Ampersands only in app names and menu labels
- Emoji avoided in UI
- Active voice, inclusive language, digits in UI (spell out 0–9 in docs)
- Components with their own content guidelines: Avatar, Button, DataTable, EmptyState, InformationOverlay, Modal, Toast, Tooltip

---

## Guided Interaction
Source: https://developer.dynatrace.com/design/foundations/guided-interaction/

**Persistent (non-dismissible):** Tooltips | Information overlays (neutral/primary/success/warning/critical) | Terminology overlays | Keyboard shortcuts | Expandable text | App help menu

**Dismissible:** Feature highlights (high-prominence, use sparingly) | Microguides (modal tutorials, max 5 steps) | Dismissible cards

**App Help Menu contents:** What's new | Docs links | Getting started | Keyboard shortcuts | Feedback | Version info
