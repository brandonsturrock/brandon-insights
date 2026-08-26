---
name: dt-ui-wizard
description: Use when building or designing UI for Dynatrace AppEngine apps — any time you are writing React components, layouts, charts, icons, or custom UI inside a dt-app project. Covers Strato component selection, design tokens, layout, navigation, data visualization, content writing, and when/how to go custom.
---

# Dynatrace App UI (Strato Design System)

## Core Rule

**Strato first. Tokens for custom. Match Strato style.**

1. Use a Strato component if one exists — don't build what's already there
2. When no Strato component fits, build custom using design tokens for all visual properties
3. Custom components must be visually indistinguishable from Strato — same spacing, radius, color tokens, typography

---

## Packages

```bash
npm install @dynatrace/strato-components
npm install @dynatrace/strato-design-tokens
npm install @dynatrace/strato-icons
# Keep up to date:
npx dt-app update
```

---

## Component Decision Ladder

Before building anything custom, work through this in order:

| Step | Question | Action |
|---|---|---|
| 1 | Does Strato have a component for this? | Use it |
| 2 | Does Strato have something close? | Compose/extend it |
| 3 | Is this a specialized domain component? | Build custom with tokens (see below) |

**Never:** raw hex colors, hard-coded font sizes, arbitrary spacing values, custom border radii, or custom shadows in place of tokens.

---

## Design Tokens

Import only what you need:

```typescript
import Colors from '@dynatrace/strato-design-tokens/colors';
import Spacings from '@dynatrace/strato-design-tokens/spacings';
import Typography from '@dynatrace/strato-design-tokens/typography';
import Borders from '@dynatrace/strato-design-tokens/borders';
```

**Color token categories:**
- `Colors.Text.*` — text and icons (4.5:1 contrast guaranteed)
- `Colors.Background.Container.*` — semantic containers: Neutral, Primary, Success, Warning, Critical
- `Colors.Background.Surface.*` — page-level surfaces
- `Colors.Border.*` — borders

**Semantic container emphasis levels:** Default → Emphasized → Subdued

**Typography tokens:** `Typography.Heading.Level1–6`, `Typography.Body.*`, `Typography.Subtitle.*` — always pull `Size`, `Family`, `Weight`, `LineHeight` from tokens, never set these manually.

**Spacing standard (use tokens, not px):**
- Between element groups: `Spacings.Size32`
- Between individual elements: `Spacings.Size16`
- Between closely related items: `Spacings.Size8`
- Surface inset: `Spacings.Size24` (or `Size16` for dense)
- Container inset: `Spacings.Size16`
- Field inset: `Spacings.Size12` or less

---

## Layout

**Visual hierarchy (bottom to top):**
1. **Base** — app background
2. **Surfaces** — primary content containers; elevation: flat / raised / floating
3. **Containers** — highlighted sections with semantic color (neutral/primary/success/warning/critical)
4. **Fields** — small interactive elements
5. **Dividers** — visual separators only, no background

**Responsive breakpoints:**
- Mobile: 0–640px
- Tablet: 641–960px
- Desktop: 961–1920px
- Widescreen: 1921px+
- Minimum: 320px

**Layout choice:**
- Centered (max 960px) — text-heavy content
- Full-width — data-intensive apps (prefer for observability UIs)

---

## App Structure

Four regions:

```
┌─────────────────────────────────────┐
│           App Header                │  ← app name, primary nav, system actions
├──────────┬──────────────────────────┤
│          │     Title Bar            │  ← breadcrumbs, title, suffix actions
│ Sidebar  │──────────────────────────│
│ (filters)│     Main View            │  ← center stage
│          │──────────────────────────│
│          │     Detail View          │  ← supplementary, no nav required
└──────────┴──────────────────────────┘
```

**App Header always includes:** app name (home link), primary nav items, system-wide actions (settings, help, search, notifications).

**Title Bar regions:** navigation (breadcrumbs/back), prefix, title, subtitle, suffix (title-related actions only).

---

## Navigation

| Pattern | When to use |
|---|---|
| App Header with tabs | Flat hierarchy, ≤6–8 main pages, any-order consumption |
| Breadcrumbs | Nested hierarchy, users need orientation |
| Tabs (within page) | Grouping related content within a single view |

**Flat hierarchy** — clearly differentiated pages, users can enter in any order.
**Nested hierarchy** — hierarchical content, consumed in order; always show breadcrumbs.
**Combined** — complex apps; apply both sets of rules.

---

## Data Visualization

| Data type | Component | Use case |
|---|---|---|
| Time series | `TimeseriesChart` | Metrics over time (line, area, bar, band variants) |
| Categorical | `CategoricalBarChart`, `PieChart` | Browser breakdown, top-N hosts, grouped/stacked |
| KPI / single value | `SingleValue`, `MeterBar`, `MultiMeterBar` | MRR, load time, action count |
| Geospatial | `@dynatrace/strato-geo` | Dot, bubble, choropleth, connection layers |

**Add `ChartInteractions` to TimeseriesChart** for zoom/pan/inspect when users need to explore data.

**Chart anatomy to always include:** axis labels, legend, tooltip. Axis description when units aren't obvious.

---

## Icons

```typescript
import { EditIcon, DeleteIcon, PlusIcon } from '@dynatrace/strato-icons';
// Usage: <EditIcon /> — always use Strato icons, never inline SVG for standard actions
```

**Common action → icon mapping:**
- New/Add top-level: `PlusIcon`
- Edit: `EditIcon`
- Delete: `DeleteIcon`
- AI triggers: `AiIcon`

**App icons** (when creating an app icon) use the 10 Dynatrace palette colors — 60% cold, 30% warm, 10% neutral. Minimalist 3D style, matte finish, well-defined contrast.

---

## Interaction States

| State | Meaning | Note |
|---|---|---|
| Rest | Default | All elements |
| Hover | Pointer over element | Color change only |
| Active | Pressing element | Any pointer device |
| Disabled | Not available right now | Disable, don't hide; excluded from form submission |
| Read-only | View but no edit | Focusable/copyable; included in form submission |
| Focus | Keyboard focus | Visually contrasting border inside element |
| Selected | Current selection | Primary color tokens + line or checkmark indicator |

**Key rule:** Color is NOT the sole indicator of interactivity. Use position, emphasized text, or context alongside color.

**Disable vs hide:** Always disable. Only hide if content is sensitive, provides no user value, or interrupts user flow.

---

## Status & Health

Five levels (use `HealthIndicator`, `Chip`, `MessageContainer`, `Toast`, `InformationOverlay`):

| Level | Meaning | Shape | Color |
|---|---|---|---|
| Ideal | No issues | Circle + checkmark | Success green |
| Good | Minor/informative | Circle + info | Info blue |
| Neutral | Inactive/unessential | Circle + slash | Neutral |
| Warning | Potential, non-critical | Triangle + exclamation | Warning yellow |
| Critical | Urgent, immediate | Diamond + X | Critical red |

**Never color alone** — always pair icon + shape + text. Always show warnings and critical. Prioritize negative over positive.

---

## Filtering

| Component | When to use |
|---|---|
| `FilterField` | Complex queries, 5+ categories, power users |
| `FilterBar` | Text + single/multi-select + boolean, ≤5 categories |
| `SegmentSelector` | Pre-defined top-level scope segments |
| `TimeframeSelector` | Time-based scoping |

**Layout order (L→R):** SegmentSelector → category filters → TimeframeSelector → action buttons (right-aligned).

**Starting state:** all selected if users typically eliminate; none selected if they add. Persist state across interactions until explicit reset.

---

## Error Messages

| Severity | Component |
|---|---|
| Field validation | Inline below input |
| Page/section persistent | `MessageContainer` at top |
| Temporary feedback | `Toast` |
| High-severity blocking | `Modal` |
| No data | `EmptyState` |
| Status indicator | `HealthIndicator` |

**Writing errors:** specific cause + way forward. No generic messages. No blame. No excessive apology. Never rely on color alone — always pair with icon.

---

## Common Action Labels

| Action | Label | Icon |
|---|---|---|
| Create top-level item | "New" (preferred) or "Create" | `PlusIcon` |
| Add child item | "Add" | `PlusIcon` |
| Remove permanently | "Delete" | `DeleteIcon` |
| Break relationship | "Remove" or "Clear" | — |
| Full copy | "Duplicate" | — |
| Clipboard copy | "Copy" | — |
| Modify | "Edit" | `EditIcon` |

---

## AI Presence

- **Triggers:** `AiIcon` + capitalized verb + lowercase object — e.g. "Explain problem", "Write DQL"
- **Loading:** `AiLoadingIndicator` — pattern: capitalize -ing verb + lowercase object + ellipsis — e.g. "Analyzing logs..."
- **Generated content label:** `Chip` component
- **Required disclaimer:** "Dynatrace Intelligence uses AI. Always verify important information and decisions." — link "Dynatrace Intelligence" to docs

---

## Content Writing Rules

- American English spelling and grammar
- Sentence case everywhere except branded names and proper nouns
- No closing punctuation on headings or UI elements
- No "-ing" verbs or question marks in headings
- Serial (Oxford) commas required
- Active voice default: "Save changes" not "Submit"
- Emoji avoided in UI
- Numbers: digits in UI (`5 hosts`); spell out zero–nine in documentation
- Ampersands (`&`) only in app names and menu labels
- Action labels consistent end-to-end: if button says "Publish", toast says "Published"
- Errors: specific + actionable, no vague messages, no blame

---

## Custom Components (When Strato Has No Match)

When building a specialized component not in Strato:

1. **Use tokens for everything** — no raw values for color, spacing, typography, borders, shadows
2. **Match Strato border radius:** `Borders.Radius.Container.Default` for containers, `Borders.Radius.Field.Default` for fields
3. **Match Strato elevation:** use `box-shadow` from tokens, not custom shadows
4. **Match interaction states** — implement hover, active, focus, disabled using color tokens, not custom values
5. **Test in both light and dark theme** — tokens handle this automatically; custom raw values won't

**The test:** a custom component placed next to a Strato component should look like it came from the same system.

---

## Component Quick Reference

All components from `@dynatrace/strato-components`. Import from the sub-path shown.

### Buttons

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `Button` | `/buttons` | Trigger actions | `variant`, `color`, `size` (`default`/`condensed`), `loading`, `width`, `disabled` vs `aria-disabled` |
| `IntentButton` | `/buttons` | Send intents (AppShell only) | `IntentButton.Item` for menu items; `showMenu`, `onResponse`, `responseProperties` |
| `NotifyButton` | `/buttons` | Toggle resource notifications | `variant`, `size`, `readOnly`, `showLabel`, `NotifyButton.Content` |
| `RunQueryButton` | `/buttons` | Run/cancel queries | `queryState`: `idle`/`running`/`success`/`error` |

**Button usage rules:**
- Icon-only buttons require `aria-label`
- Prefer `aria-disabled` over `disabled` when maintaining focusability matters
- `loading` prevents interaction and shows `ProgressCircle`

---

### Content

| Component | Import path | Purpose | Key props / notes |
|---|---|---|---|
| `Accordion` | `/content` | Progressive disclosure of grouped content | `Accordion.Section`, `Accordion.SectionLabel`, `Accordion.SectionContent`; `multiple`, `defaultExpanded`, `keepMounted`, `triggerPosition` (`start`/`end`) |
| `AiLoadingIndicator` | `/content` | Indicate AI content loading | `AiLoadingIndicator.Icon` slot (include for recognition; omit to hide) |
| `AiResponse` | `/content` | Animate AI-generated content | `responseState`: `streaming`/`complete`/`static`; `onAnimationStateChange` |
| `Avatar` | `/content` | Visual user representation | `Avatar.Label`, `Avatar.Subtitle`; `size` (default = 2 letters, small = 1 letter) |
| `AvatarGroup` | `/content` | Group multiple avatars | Max 5 visible; overflow collapses to count menu; `AvatarGroup.Item` polymorphic |
| `Chip` | `/content` | Compact status/category labels | `color`, `variant`, `size`, `maxWidth` (default 250px); `Chip.Prefix`, `Chip.Suffix`, `Chip.DeleteButton`; polymorphic for interactivity |
| `ChipGroup` | `/content` | Expandable chip collection | `ChipGroup.Control` with `count`; `maxVisibleChips`, `expanded`/`onExpandedChange`, `disabled`, `loading` |
| `CodeSnippet` | `/content` | Read-only code display | `language`, `showLineNumbers`, `maxHeight`, `fullHeight`, `lineBreaks`, `size`, `onCopy`; syntax highlighting limited to first 100k chars |
| `EmptyState` | `/content` | No-data placeholder | `size`: `small`/`default`/`large`; `EmptyState.Visual` with `VisualPreset` |
| `ExpandableText` | `/content` | Collapsible inline text | `defaultExpanded`, `expandLabel`, `collapseLabel` |
| `FeatureHighlight` | `/content` | Introduce new features | Controlled via `open`/`onClose`; 12 `placement` positions; slots: Visual (400×250px), Content, Actions |
| `HealthIndicator` | `/content` | System/process status | `status`, `visual`; `HealthIndicator.Visual`, `HealthIndicator.Label`; add `aria-label` if no visible label |
| `InformationOverlay` | `/content` | Supplementary info overlay | `color`, `placement`, `defaultOpen`; `InformationOverlay.Icon` slot |
| `Markdown` | `/content` | Render markdown read-only | `customComponentMappings` to override element rendering |
| `MessageContainer` | `/content` | Persistent page/section messages | `variant`; `MessageContainer.Prefix`, `MessageContainer.Actions`; `onDismiss` for close button |
| `Microguide` | `/content` | Step-by-step onboarding | Controlled: `open`/`onClose`; `onStepChange`; placement: `bottom-right` (default), 4 options |
| `ProgressBar` | `/content` | Upload/save progress | Indeterminate (no value) or determinate (`min`/`max`); `color`; slots: Label, Icon, Value; `aria-valuetext` when not % |
| `ProgressCircle` | `/content` | Loading indicator (circular) | Same as ProgressBar; supports JSX children; `size`, `color` |
| `Skeleton` | `/content` | Loading placeholder (block) | `width`, `height`, `variant`; self-closing, expands to fill parent |
| `SkeletonText` | `/content` | Loading placeholder (text lines) | `width`, `lines` |

---

### Editors

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `CodeEditor` | `/editors` | Code editing with syntax highlighting | `language`, `readOnly`, `lineWrap`, `fullHeight`, `folding`/`onFoldingChange`, `diagnostics`, `showLintGutter`, controlled via `value`/`onChange` |
| `DQLEditor` | `/editors` | DQL query editing | All CodeEditor features + autocomplete, `DQLEditor.ActionsMenu` (copy/format/docs), `@dynatrace-sdk/dqlint` for format action |

---

### Filters

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `FilterBar` | `/filters` | Multi-filter bar (text + select + boolean) | `FilterBar.Item` (unique `name` required); `FilterBar.ResetButton`; `defaultPinnedState`: `pinned`/`pinned-optional`/`optional`; integrates with `useFilteredData` for DataTable |
| `FilterField` | `/filters` | Advanced query syntax filter | `validatorMap` for key/operator/value validation; tokenized output; `convertFilterFieldTreeToDql`; persistent recent filters |
| `SegmentSelector` | `/filters` | Top-level data scope selector | `SegmentsProvider` for defaults; `useSegments` hook: `addSegment`, `removeSegment`, `setSegments`; `SegmentSelector.CustomTrigger` |
| `TimeframeSelector` | `/filters` | Time range picker | `value`/`onChange` controlled; `clearable`, `precision`, `min`/`max` (ISO), `TimeframeSelector.Presets`; stepper navigation enabled by default |

**Filter layout order (L→R):** `SegmentSelector` → category filters → `TimeframeSelector` → action buttons (right-aligned)

---

### Forms

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `Checkbox` | `/forms` | Single/multi select or confirm | Three states: checked/unchecked/indeterminate; `onChange`/`checked`; `controlState` for react-hook-form |
| `DateTimePicker` | `/forms` | Date/time input | Auto locale/timezone from user settings; `type`: `date`/`time`/`datetime`; `precision`, `min`/`max` (ISO); `controlState` |
| `FormField` | `/forms` | Layout wrapper for inputs | Auto label connection; `FormFieldMessages` for errors/hints; passes `required`/`disabled`/`id` to child; responsive (label above on small, left on wide) |
| `NumberInput` | `/forms` | Numeric input | **Deprecated** — migrate to `NumberInputV2` |
| `Radio` | `/forms` | Single-choice from mutually exclusive options | `name` required to link group; `disabled` on `RadioGroup` or individual `Radio`; `controlState` |
| `SearchInput` | `/forms` | Search with clear button | `variant`: `default`/`minimal`; `SearchInput.Suffix`; `SearchInput.Stepper` for match navigation (not in forms) |
| `Select` | `/forms` | Dropdown single/multi select | `Select.Option`, `Select.Group`, `Select.Filter`, `Select.DisplayValue`; `showSelectedOptionsFirst`, virtualization for large lists; `controlState` |
| `Switch` | `/forms` | Immediate binary toggle | `on`/`onChange`; effect is immediate, no confirm step; `controlState` |
| `TextArea` | `/forms` | Multi-line text input | `resize`: `none`/`horizontal`/`vertical`; `cols`/`rows`; `defaultValue` or controlled; `controlState` |
| `TextInput` | `/forms` | Single-line text input | `variant`: `default`/`minimal`; `readOnly`; prefix/suffix slots; `controlState` |
| `ToggleButtonGroup` | `/forms` | Toggle between related options | `ToggleButtonGroup.Item`; `width`: `content`/`full`/custom; icon-only needs tooltip; `disabled` on group or item |

**Form integration pattern:** Wrap in `FormField` → `react-hook-form` `register`/`controlState` → `FormFieldMessages` for errors.

---

### Layouts

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `AppHeader` | `/layouts` | Persistent app header + nav | `AppHeader.Navigation`, `AppHeader.NavigationItem` (`isSelected`); `AppHeader.Logo` (`releasePhase`); `AppHeader.ActionItems` (max 2); `AppHeader.Menus` for HelpMenu |
| `Container` | `/layouts` | Semantic content container | `variant`, `color` (neutral/primary/success/warning/critical); default padding 16px; polymorphic |
| `Divider` | `/layouts` | Visual content separator | `orientation`: `horizontal`/`vertical`; `variant`, `color`; `flexItem` (default true) |
| `Flex` | `/layouts` | Flexbox layout | CSS flexbox props (e.g., `flexDirection`); children use `flexItem` prop |
| `Grid` | `/layouts` | CSS Grid layout | CSS grid props (e.g., `gridTemplateColumns`); children use `gridItem` prop |
| `HelpMenu` | `/layouts` | Prebuilt help menu | Place inside `AppHeader.Menus`; some entries use `'default'` value for built-in behavior |
| `InputGroup` | `/layouts` | Visually group inputs | Wraps Button, Select, TextInput, DateTimePicker, TimeframeSelector, Menu; `inputGroupClassName` for unsupported components |
| `Page` | `/layouts` | Full-page layout | **Deprecated** — migrate to `PageLayout` |
| `PageLayout` | `/layouts` | Full-page layout with panels | `PageLayout.Sidebar` (auto-collapses below breakpoint); `PageLayout.Details` (`ControlBar`, `defaultCollapsed`); `resizable`, `width`/`onResize`; content never unmounts |
| `Surface` | `/layouts` | Content container with elevation | `elevation`: `flat` (default)/`raised`/`floating`; `color` for selection styling; default padding 24px; polymorphic — avoid nesting interactive elements in interactive surfaces |
| `TitleBar` | `/layouts` | Page/section title area | Slots: Navigation (breadcrumbs), Title, Subtitle, Prefix (icon), Suffix (buttons), Action (icon button) |

---

### Navigation

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `AppLink` | `/navigation` | Link to another Dynatrace app | Renders link pointing to specified app |
| `Breadcrumbs` | `/navigation` | Hierarchy navigation (3+ levels) | `Breadcrumbs.Item` (`disabled`, polymorphic for React Router); set `flexGrow`/`minWidth` inside Flex |
| `Menu` | `/navigation` | Action dropdown menu | `Menu.Prefix`/`Menu.Suffix` for icons; nested menus; `alignment`; `Menu.Intent` |
| `Tabs` | `/navigation` | Tab-panel navigation | `Tab`, `Tabs`; `prefixIcon`, `disabled`, `keepMounted` (preserves DOM), `panelOverflow` |

---

### Notifications

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `Toast` | — (use `showToast()`) | Time-sensitive status messages | Types: `info`/`success` (auto-close 8s), `warning`/`critical` (manual); `showToast()`, `dismissToast()`, `dismissAllToasts()`; max 5 visible; `position`: `bottom-left` (default)/`bottom-center`/`bottom-right` |

---

### Overlays

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `Modal` | `/overlays` | Blocking overlay for important content | `useOverlayWithTrigger` hook; `size` (default medium); `dismissible`; nesting supported; requires ≥1 focusable element |
| `Overlay` | `/overlays` | Non-blocking content overlay | Controlled only (`isOpen`); `useOverlayWithTrigger`; `placement`, `offset`, `widthStrategy`; `trapFocus` option |
| `Sheet` | `/overlays` | Slide-in content panel | `show`/`onDismiss` controlled; requires ≥1 focusable element; `title` or `aria-label`/`aria-labelledby` required |
| `Tooltip` | `/overlays` | Hover info on interactive element | `placement` (default top); trigger must be interactive; link to trigger via `aria-describedby` (context) or `aria-labelledby` (name) |

---

### Tables

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `DataTable` | `/tables` | Full-featured data table | Columns need `id`/`accessor`; built-in types: `text`, `datetime`, `number`, `meterbar`, `sparkline`, `gantt` etc.; `density`: `default`/`condensed`/`comfortable`; sorting, filtering, pagination, row selection, sub-rows, drag-and-drop; `useFilteredData` for FilterBar integration |
| `SimpleTable` | `/tables` | Static small-dataset table | No sorting/resizing/filtering; `variant`, `alignment`; semantic HTML table |

**When to use which:** `DataTable` for interactive/large data; `SimpleTable` for compact static tables or Markdown-sourced content.

---

### Typography

| Component | Import path | Purpose | Key props |
|---|---|---|---|
| `Heading` | `/typography` | Semantic HTML headings h1–h6 | `level` controls visual style (default 1); `as` prop controls semantic tag — decouple visual and semantic independently |
| `Link` | `/typography` | Internal navigation links | Inherits surrounding styles; polymorphic via `as` for React Router |
| `Paragraph` | `/typography` | Block text with default styling | `maxLines` for truncation with ellipsis |
| `Text` | `/typography` | Inline text without semantic markup | `textStyle`, `fontStyle` (variable/monospace); inherits parent CSS when unset |
| `TextEllipsis` | `/typography` | Text truncation with ellipsis | `truncationMode`: `start`/`middle`/`end`; pair with `Tooltip` via `onTextOverflow` for full-text on hover |

**Also available:** `Blockquote`, `Code`, `Emphasis`, `ExternalLink`, `Highlight`, `List`, `Strikethrough`, `Strong` — all from `/typography`

---

## Reference Files

- [foundations.md](references/foundations.md) — layout, navigation, interaction states, data viz, design tokens, content rules, guided interaction
- [patterns.md](references/patterns.md) — app structure, filtering, status/health, error messages, common actions, app naming, AI presence
- [icons.md](references/icons.md) — functional icon imports, common icon-to-action mapping, app icon requirements
