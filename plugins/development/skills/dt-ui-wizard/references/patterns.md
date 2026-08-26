# Strato Design Patterns Reference

## App Structure
Source: https://developer.dynatrace.com/design/patterns/app-structure/

**Required elements:** App header (title + primary nav) | Main content area

**App header anatomy:**
- App icon (left) — links to home
- App title — links to home
- Primary navigation tabs
- Secondary actions (right): help menu, user profile, settings

**Page structure:**
- Page title (H1)
- Optional subtitle
- Actions toolbar (right-aligned)
- Content area

**Empty states:** Required when no data. Must include: illustration + title + description + primary action. Use `EmptyState` component.

---

## Filtering
Source: https://developer.dynatrace.com/design/patterns/filtering/

**Filter bar:** Horizontal row of filter chips below page header. Add filters via "Add filter" button.

**Filter types:**
- Quick filters — predefined options (chips/toggles), visible by default
- Advanced filters — custom input, revealed on demand

**Filter persistence:** Filters applied to URL params for shareability.

**Filter chip states:** Default | Active (has value) | Disabled

**Timeframe picker:** Separate from filters, top-right of page or filter bar. Use `TimePicker` component.

---

## Status and Health
Source: https://developer.dynatrace.com/design/patterns/status-health/

**Semantic colors (use tokens, not raw hex):**
| Status | Token prefix | Use for |
|--------|-------------|---------|
| Success | `Colors.*.Success.*` | Healthy, passing |
| Warning | `Colors.*.Warning.*` | Degraded, at-risk |
| Critical | `Colors.*.Critical.*` | Failed, down |
| Neutral | `Colors.*.Neutral.*` | Unknown, inactive |
| Primary | `Colors.*.Primary.*` | Informational, in-progress |

**Status indicators:** `StatusBadge` for inline status | `MeterBar` for percentage health | Color-coded table rows

**Traffic light convention:** Green = good, Yellow = warning, Red = critical — always use semantic tokens, never raw colors.

---

## Error Messages
Source: https://developer.dynatrace.com/design/patterns/error-messages/

**Levels:**
- **Page-level errors** — full page failure; use `EmptyState` with critical variant + recovery action
- **Section-level errors** — part of page failed; inline `InformationOverlay` (critical) with retry
- **Field-level errors** — form validation; red text below field, `aria-describedby` linking to message
- **Toast notifications** — transient feedback for background ops; auto-dismiss for success (3–5s), manual dismiss for errors

**Error message rules:**
- Say what happened, not what the system did internally
- Always offer a next action (retry, go back, contact support)
- Avoid technical jargon in user-facing messages
- Don't say "An unexpected error occurred" — be specific

---

## Common Actions
Source: https://developer.dynatrace.com/design/patterns/common-actions/

**Button hierarchy:**
- Primary — one per page/section, main CTA
- Secondary — alternative actions
- Tertiary/Ghost — low-priority, destructive actions

**Placement:**
- Form actions: bottom-right (primary right of secondary)
- Destructive actions: left-aligned or separated from safe actions
- Toolbar actions: right-aligned

**Icon buttons:** Use when space-constrained; always include tooltip for accessibility.

**Confirmation dialogs:** Required for destructive/irreversible actions. Include: what will be deleted, warning text, Cancel (secondary) + Confirm (critical primary).

---

## App Naming
Source: https://developer.dynatrace.com/design/patterns/app-naming/

- Short, descriptive, noun-based (not verb-based)
- No "App" suffix — redundant in AppEngine context
- Sentence case, not title case
- Max ~20 chars for nav legibility
- Must have a corresponding app icon

---

## AI Presence
Source: https://developer.dynatrace.com/design/patterns/ai-presence/

**AI-generated content indicators:** Label AI outputs with "AI-generated" or Davis AI badge. Don't present AI content as ground truth without user confirmation.

**AI entry points:** Dedicated button/panel, not mixed into primary actions. Use `AiIconSmall` or `DavisAiIcon` from strato-icons.

**Confidence levels:** Surface uncertainty when relevant. Use qualitative language (likely, possibly) not false precision.

**AI loading states:** Use skeleton loaders or progress indicators during generation. Don't show empty containers.

**Feedback mechanisms:** Thumbs up/down for AI-generated content where quality matters.
