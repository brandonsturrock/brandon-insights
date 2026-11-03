---
name: setup
description: One-time dependency setup for all brandon-insights tools skills. Installs Git for Windows (Windows only), dtctl, Claude skills, Node.js and a Chromium browser, then authenticates a Dynatrace environment. Run this before using any other skill in this plugin, or when a skill reports a missing dependency.
---

# Setup — brandon-insights tools

Single owner of every install for the skills in this plugin: Git for Windows (Windows only), `dtctl`, dtctl Claude skills, Node.js ≥ 18, a Chromium browser, a Dynatrace context.

Rules:
- Run steps in order. Stop and surface any error immediately; never skip a failing step.
- Everything runs non-interactively in the Bash tool. Claude never runs `sudo`; never redirect output (`>`, `&>`, `/dev/null`) on install commands — the error text is the diagnosis.
- Run every install command with the maximum Bash timeout (600000 ms); brew, winget and cask installs often exceed the 120 s default.
- Windows: the Bash tool must be Git Bash. Step 0 handles the case where it is not.
- Shell state does not persist between Bash calls; repeat any `export` or full path each time.
- Windows: `dtctl` and `node` installed during setup are not on PATH until a new terminal window is opened. Whenever `dtctl` is only found via the Step 1 fallback, or was just installed, use `"$(cygpath "$LOCALAPPDATA")/dtctl/dtctl.exe"` in place of `dtctl` in every later step (2, 5, 6).

---

## Step 0 — Shell check (Windows bootstrap)

```bash
uname -s
```

- Prints `Darwin`, `Linux`, `MINGW…` or `MSYS…` → remember it as `OS` (`MINGW*`/`MSYS*` = Windows) and continue to Step 1.
- Fails (`uname` is not recognized) → Claude is running PowerShell, meaning Git for Windows is missing or Claude Code cannot find it. These Step 0 commands and the Windows dtctl install in Step 1 are the only PowerShell in any skill. Check:

  ```powershell
  Test-Path "C:\Program Files\Git\bin\bash.exe"
  Test-Path "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
  ```

  - Neither exists → install Git for Windows (a Windows admin prompt may appear; tell the user to accept it):

    ```powershell
    winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
    ```

    If `winget` is not found, tell the user to install Git from https://git-scm.com/download/win instead.
  - One exists → tell the user to set the user environment variable `CLAUDE_CODE_GIT_BASH_PATH` to that `bash.exe` path (Start menu → "Edit environment variables for your account" → New).
  - Either way, tell the user to close this terminal window and open a new one before starting Claude Code again (desktop app: quit it fully and reopen; VS Code: close all windows), then run `/tools:setup` again. Stop here.

---

## Step 1 — dtctl (≥ 0.45.0)

```bash
dtctl version
```

Windows fallback (dtctl is not on PATH until a new terminal window is opened):

```bash
"$(cygpath "$LOCALAPPDATA")/dtctl/dtctl.exe" version
```

Missing, or older than `0.45.0` → install with the first applicable method:

**Any OS with Homebrew** (`command -v brew` prints a path):
```bash
brew install dynatrace-oss/tap/dtctl || brew upgrade dtctl
```

**macOS/Linux without Homebrew** (user-local, no sudo):
```bash
curl -fsSL https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.sh | DTCTL_INSTALL_DIR="$HOME/.local/bin" sh
export PATH="$HOME/.local/bin:$PATH"
```
Repeat the `export` at the start of each later Bash call, or use `"$HOME/.local/bin/dtctl"` in place of `dtctl`. Note that dtctl lives in `~/.local/bin`; Step 7 tells the user how to make the PATH change permanent.

**Windows:**
```bash
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.ps1 | iex"
```
For the rest of setup, use `"$(cygpath "$LOCALAPPDATA")/dtctl/dtctl.exe"` in place of `dtctl`.

Re-run the version check; it must show ≥ `0.45.0`. Otherwise stop and report the error.

---

## Step 2 — Register dtctl's Claude skills

```bash
dtctl skills install --for claude --global --force
```

`--global` installs under `~/.claude/skills/` (not the current project); `--force` avoids the overwrite prompt. Safe to re-run.

---

## Step 3 — Node.js ≥ 18

```bash
node -e "process.exit(+process.versions.node.split('.')[0] >= 18 ? 0 : 1)"
```

Exit 0 → continue. Command not found or exit 1 → install:

- **Homebrew:** `brew install node`
- **Windows:**
  ```bash
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  ```
  Node lands in `C:\Program Files\nodejs`, which is not on PATH until a new terminal window is opened. Verify with `"/c/Program Files/nodejs/node.exe" --version`.
- **macOS without Homebrew:** tell the user to install the LTS from https://nodejs.org, then stop.
- **Linux without Homebrew:** tell the user to install Node.js ≥ 18 LTS in their own terminal (https://nodejs.org, NodeSource, or their package manager; distro default packages are often too old), confirm `node --version` shows ≥ 18, then run `/tools:setup` again. Stop.

---

## Step 4 — Chromium browser (PDF rendering)

Reports are rendered by headless Chrome, Edge, Chromium or Brave. Run the one `ls` for the current OS. `ls` prints "No such file" for each absent candidate and exits non-zero if any is missing; that is expected. At least one path printed = a browser is present (a set `CHROME_PATH` pointing at an existing file also counts).

**macOS:**
```bash
ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" "/Applications/Chromium.app/Contents/MacOS/Chromium" "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
```

**Windows (Git Bash):**
```bash
ls "/c/Program Files/Google/Chrome/Application/chrome.exe" "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" "$(cygpath "$LOCALAPPDATA")/Google/Chrome/Application/chrome.exe" "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" "/c/Program Files/Microsoft/Edge/Application/msedge.exe"
```

**Linux:**
```bash
ls /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium /usr/bin/microsoft-edge
```

None found:
- **macOS with Homebrew:** `brew install --cask google-chrome`
- **macOS without Homebrew:** tell the user to install Chrome from https://www.google.com/chrome, then stop.
- **Windows:** Edge ships with Windows 10/11, so a missing browser is unusual. Report it and point the user to https://www.google.com/chrome, then stop.
- **Linux:** tell the user to install Chrome or Chromium with their package manager, then stop.

---

## Step 5 — Dynatrace environment

```bash
dtctl config get-contexts
```

(Windows: use the full `dtctl.exe` path from Step 1.) At least one context listed → continue to Step 6.

None → ask the user for:
- a **context name** (e.g. `my-env`)
- their **environment URL**, in the `.apps.dynatrace.com` form (e.g. `https://abc12345.apps.dynatrace.com`, not `.live.dynatrace.com`)

Login blocks on a browser OAuth callback, so Claude cannot run it. Tell the user to run it themselves (the `!` prefix runs it in this session):

```
! dtctl auth login --context "<NAME>" --environment "<URL>"
```

Windows: `! "$(cygpath "$LOCALAPPDATA")/dtctl/dtctl.exe" auth login --context "<NAME>" --environment "<URL>"`.

Ask them to confirm when the browser login finishes, then re-run `dtctl config get-contexts` to confirm the context exists.

---

## Step 6 — Doctor

```bash
dtctl doctor
```

Surface any failures to the user verbatim and stop; otherwise continue.

---

## Step 7 — Report

Tell the user:
- shell (`uname -s` output)
- `dtctl` version
- Node.js version
- browser path (from Step 4)
- active context name and environment URL
- Windows only: tell the user to close this terminal window and open a new one before starting Claude Code again (desktop app: quit it fully and reopen; VS Code: close all windows), so `dtctl` and `node` are on PATH
- macOS/Linux, if dtctl was installed to `~/.local/bin` in Step 1 (curl path): without a permanent PATH entry, `dtctl` will be "not found" in every new session. Tell the user to add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` (macOS) or `~/.bashrc` (Linux), then restart Claude Code
- skills ready: `full-page-analysis`, `user-journeys`, `trending-report`, `monthly-report`
