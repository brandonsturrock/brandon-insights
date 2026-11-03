#!/usr/bin/env node
// Cross-platform report -> PDF via headless Chromium (Chrome, Edge, Chromium, Brave).
//   node render-pdf.mjs --find-browser
//   node render-pdf.mjs --open <file>
//   node render-pdf.mjs --in <generated.html> --out <file.pdf> [--theme light|dark] [--source <html>] [--cleanup <path>...]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const NO_BROWSER = "No Chromium-based browser found (Chrome, Edge, Chromium). Install Google Chrome or set CHROME_PATH.";

export function findBrowser(platform = process.platform, env = process.env, exists = fs.existsSync) {
  let list = [];
  if (platform === "darwin") {
    const home = env.HOME ?? os.homedir();
    const app = (n, b) => `${n}.app/Contents/MacOS/${b}`;
    list = [
      `/Applications/${app("Google Chrome", "Google Chrome")}`,
      path.posix.join(home, "Applications", app("Google Chrome", "Google Chrome")),
      `/Applications/${app("Microsoft Edge", "Microsoft Edge")}`,
      `/Applications/${app("Chromium", "Chromium")}`,
      `/Applications/${app("Brave Browser", "Brave Browser")}`,
    ];
  } else if (platform === "win32") {
    const pf = env.ProgramFiles ?? "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const chrome = "Google\\Chrome\\Application\\chrome.exe", edge = "Microsoft\\Edge\\Application\\msedge.exe";
    list = [
      path.win32.join(pf, chrome), path.win32.join(pf86, chrome),
      ...(env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, chrome)] : []),
      path.win32.join(pf86, edge), path.win32.join(pf, edge),
    ];
  } else {
    list = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
      "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge"];
  }
  if (env.CHROME_PATH) list.unshift(env.CHROME_PATH);
  return list.find(p => exists(p)) ?? null;
}

// Fresh --user-data-dir keeps the headless run off the user's already-open Chrome.
export function chromeArgs(inHtml, outPdf, theme, profileDir) {
  return ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profileDir}`, "--no-pdf-header-footer", "--virtual-time-budget=8000",
    `--print-to-pdf=${outPdf}`, `${pathToFileURL(inHtml).href}#theme=${theme}`];
}

// "Save changes" in the report downloads <stem>.html (then "<stem> (1).html", ...) to the browser's download folder.
export function savedCopies(stem, downloadsDir) {
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\(\\d+\\))?\\.html$`);
  try {
    return fs.readdirSync(downloadsDir).filter(f => re.test(f)).sort().map(f => path.join(downloadsDir, f));
  } catch {
    return [];
  }
}

// Newest wins; a tie keeps the generated file.
export function pickSource(generatedHtml, downloadsDir) {
  const candidates = [generatedHtml, ...savedCopies(path.basename(generatedHtml, ".html"), downloadsDir)];
  return candidates.reduce((best, f) => (fs.statSync(f).mtimeMs > fs.statSync(best).mtimeMs ? f : best));
}

// Deletes only after a non-empty PDF exists, so a failed render never costs the user their work dir.
export function finalize(pdfPath, cleanupPaths) {
  let ok = false;
  try { ok = fs.statSync(pdfPath).size > 0; } catch { /* missing */ }
  if (ok) for (const p of cleanupPaths) fs.rmSync(p, { recursive: true, force: true });
  return ok;
}

export function openCommand(platform, file) {
  if (platform === "darwin") return { cmd: "open", args: [file] };
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", file] };
  return { cmd: "xdg-open", args: [file] };
}

export function expandHome(p) {
  return /^~([\\/]|$)/.test(p) ? path.join(os.homedir(), p.slice(1)) : p;
}

function main() {
  // --cleanup swallows every remaining arg, so split it off before parseArgs
  const argv = process.argv.slice(2);
  const ci = argv.indexOf("--cleanup");
  const { values } = parseArgs({
    args: ci < 0 ? argv : argv.slice(0, ci),
    options: {
      "find-browser": { type: "boolean" }, open: { type: "string" }, in: { type: "string" },
      out: { type: "string" }, theme: { type: "string" }, source: { type: "string" },
    },
  });
  const abs = p => path.resolve(expandHome(p));

  if (values["find-browser"]) {
    const found = findBrowser();
    if (!found) { console.error(NO_BROWSER); process.exit(2); }
    console.log(found);
    return;
  }

  if (values.open) {
    const { cmd, args } = openCommand(process.platform, abs(values.open));
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", e => console.error(e.message)).unref();
    return;
  }

  const theme = values.theme ?? "light";
  if (!values.in || !values.out || (theme !== "light" && theme !== "dark")) {
    console.error("usage: render-pdf.mjs --find-browser | --open <file> | --in <generated.html> --out <file.pdf> [--theme light|dark] [--source <html>] [--cleanup <path>...]");
    process.exit(2);
  }
  const browser = findBrowser();
  if (!browser) { console.error(NO_BROWSER); process.exit(2); }

  const inHtml = abs(values.in), outPdf = abs(values.out);
  const downloads = path.join(os.homedir(), "Downloads");
  if (!fs.existsSync(inHtml)) { console.error(`Input not found: ${inHtml}`); process.exit(1); }
  const source = values.source ? abs(values.source) : pickSource(inHtml, downloads);
  // a missing file would render Chrome's error page into a non-empty PDF and pass the gate
  if (!fs.existsSync(source)) { console.error(`Source not found: ${source}`); process.exit(1); }
  console.log(`Source: ${source}`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dt-pdf-"));
  let run;
  try {
    run = spawnSync(browser, chromeArgs(source, outPdf, theme, profile), { timeout: 120000, encoding: "utf8" });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }

  const cleanup = [
    ...(ci < 0 ? [] : argv.slice(ci + 1).map(abs)),
    ...savedCopies(path.basename(inHtml, ".html"), downloads),
  ];
  if (finalize(outPdf, cleanup)) {
    console.log(`PDF: ${outPdf}`);
    return;
  }
  const lines = (run.error ? run.error.message : run.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-5);
  console.error([`PDF not written: ${outPdf}`, ...lines, "Nothing was deleted."].join("\n"));
  process.exit(1);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
