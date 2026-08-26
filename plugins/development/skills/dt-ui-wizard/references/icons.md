# Strato Icons Reference

## Import
```typescript
import { /* icon name */ } from '@dynatrace/strato-icons';
```

## App Icons
Source: https://developer.dynatrace.com/design/icons/app-icons/

App icons identify apps in the Dynatrace platform nav and launcher. Each app should have a unique icon.

**Requirements:**
- Use SVG format
- 40×40px canvas, icon artwork in center
- Single color (monochrome) — platform applies color theming
- Filled style (not outline)
- Rounded corners on shapes

**Usage:** Set in app manifest (`app.config.ts` or `dt-app.json`), not rendered directly in React components.

---

## Functional Icons
Source: https://developer.dynatrace.com/design/icons/functional-icons/

Functional icons communicate actions, status, and concepts in the UI.

**Import pattern:**
```typescript
import { PlusIcon, EditIcon, DeleteIcon, FilterIcon } from '@dynatrace/strato-icons';
```

**Usage with Button:**
```typescript
<Button prefixIcon={<PlusIcon />}>Add item</Button>
```

**Usage standalone (icon button):**
```typescript
<Button variant="emphasized" prefixIcon={<EditIcon />} aria-label="Edit" />
```

**Common icons:**
| Icon | Name | Use |
|------|------|-----|
| + | `PlusIcon` | Add, create |
| ✏️ | `EditIcon` | Edit, modify |
| 🗑 | `DeleteIcon` | Delete, remove |
| ⟳ | `RefreshIcon` | Refresh, reload |
| ⚙️ | `SettingsIcon` | Settings, configure |
| 🔍 | `SearchIcon` | Search |
| ✕ | `CloseIcon` | Close, dismiss |
| ↓ | `DownloadIcon` | Download, export |
| ↑ | `UploadIcon` | Upload, import |
| ⋮ | `MoreVerticalIcon` | More actions overflow |
| ▶ | `PlayIcon` | Run, start |
| ⏸ | `PauseIcon` | Pause |
| ⬛ | `StopIcon` | Stop |
| ✓ | `CheckmarkIcon` | Success, done |
| ⚠ | `WarningIcon` | Warning |
| ✖ | `ErrorIcon` | Error, critical |
| ℹ | `InfoIcon` | Information |
| ← | `ArrowLeftIcon` | Back, previous |
| → | `ArrowRightIcon` | Forward, next |
| ↗ | `ExternalLinkIcon` | Opens in new tab |
| 📋 | `CopyIcon` | Copy to clipboard |
| 🔗 | `LinkIcon` | Link, URL |
| 👁 | `ViewIcon` | Show, preview |
| 🚫 | `BlockedIcon` | Blocked, forbidden |
| 🤖 | `AiIconSmall` | AI feature |
| Davis | `DavisAiIcon` | Davis AI specifically |

**Sizing:** Icons inherit from surrounding text by default. Use `width`/`height` props for explicit sizes. Standard sizes: 16px (inline), 20px (button), 24px (standalone).

**Accessibility:** Always provide `aria-label` on icon-only buttons. Decorative icons in labeled buttons: `aria-hidden` handled automatically by Strato Button.
