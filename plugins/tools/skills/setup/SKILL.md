---
name: setup
description: One-time dependency setup for all brandon-insights tools skills. Installs dtctl, registers Claude skills, authenticates a Dynatrace environment, and verifies Node.js. Run this before using any other skill in this plugin, or when a skill reports a missing dependency.
---

# Setup — brandon-insights tools

Check and install all dependencies required by the skills in this plugin:
- `dtctl` binary
- dtctl Claude skills registration
- Dynatrace environment context (OAuth login)
- Node.js

Run each step in order. Stop and surface errors immediately — do not skip a failing step.

---

## Step 1 — Check dtctl binary

```bash
dtctl version
```

If the command fails, install using the first applicable method:

**Homebrew (Mac/Linux — check first):**
```bash
brew install dynatrace-oss/tap/dtctl
```

**Mac/Linux (no Homebrew):**
```bash
curl -fsSL https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.ps1 | iex
```

Verify with `dtctl version`. On Windows, if not found, open a new PowerShell session first — the installer may need a fresh session for PATH to take effect. If it still fails, stop and tell the user.

---

## Step 2 — Register Claude skills

```bash
dtctl skills install --for claude
```

Run unconditionally — safe to re-run, idempotent.

---

## Step 3 — Check Dynatrace environment context

```bash
dtctl config get-contexts
```

If one or more contexts exist, skip to Step 4.

If no contexts exist, ask the user for:
- A **context name** (e.g. `production`, `my-env`)
- Their **Dynatrace environment URL** (e.g. `https://abc12345.live.dynatrace.com`)

Then run:

```bash
dtctl auth login --environment "ENV_URL" --context-name "CONTEXT_NAME"
```

Tell the user to complete the browser OAuth flow and confirm when done.

---

## Step 4 — Run doctor

```bash
dtctl doctor
```

Show any failures. If all checks pass, continue.

---

## Step 5 — Check Node.js

```bash
node --version
```

If Node.js is not found, install it:

**Mac/Linux (Homebrew):**
```bash
brew install node
```

**Mac/Linux (no Homebrew):**
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs
```

**Windows:**
```
winget install OpenJS.NodeJS
```

Verify with `node --version`. If it still fails, tell the user to install from https://nodejs.org and stop.

---

## Step 6 — Report

Tell the user:
- `dtctl` version
- Active context name and environment URL
- Node.js version
- All skills are ready to use: `full-page-analysis`, `user-journeys`, `trending-report`, `monthly-report`
