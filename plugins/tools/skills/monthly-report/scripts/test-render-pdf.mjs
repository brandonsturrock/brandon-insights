#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromeArgs, cleanupTargets, expandHome, findBrowser, finalize, openCommand, pdfIsFresh, pickSource, savedCopies } from "./render-pdf.mjs";

// findBrowser (literal inputs: platform is injected, host path module must not matter)
const H = "/Users/x";
assert.equal(findBrowser("darwin", { HOME: H }, p => p === `${H}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`),
  `${H}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`);
assert.equal(findBrowser("darwin", { HOME: H }, p => p === "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser");
assert.equal(findBrowser("win32", { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, p => p.endsWith("Local\\Google\\Chrome\\Application\\chrome.exe")),
  "C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe");
assert.match(findBrowser("win32", {}, p => p.endsWith("msedge.exe")), /msedge\.exe$/);
assert.equal(findBrowser("win32", { ProgramFiles: "D:\\PF" }, p => p === "D:\\PF\\Google\\Chrome\\Application\\chrome.exe"),
  "D:\\PF\\Google\\Chrome\\Application\\chrome.exe");
assert.equal(findBrowser("win32", {}, p => p.includes("undefined")), null); // unset LOCALAPPDATA is skipped, not stringified
assert.equal(findBrowser("linux", { CHROME_PATH: "/opt/c" }, p => p === "/opt/c"), "/opt/c");
assert.equal(findBrowser("linux", { CHROME_PATH: "/opt/c" }, p => p === "/usr/bin/chromium"), "/usr/bin/chromium"); // stale CHROME_PATH falls through
assert.equal(findBrowser("linux", {}, p => p === "/snap/bin/chromium"), "/snap/bin/chromium");
assert.equal(findBrowser("linux", {}, () => false), null);

// chromeArgs (file URL depends on the host's path semantics)
if (process.platform === "win32")
  assert.equal(chromeArgs("C:\\Users\\John Smith\\r.html", "C:\\o.pdf", "dark", "C:\\p").at(-1), "file:///C:/Users/John%20Smith/r.html#theme=dark");
else
  assert.equal(chromeArgs("/Users/John Smith/r.html", "/o.pdf", "dark", "/p").at(-1), "file:///Users/John%20Smith/r.html#theme=dark");
const args = chromeArgs("/r.html", "/o.pdf", "light", "/p");
assert.ok(args.includes("--user-data-dir=/p") && args.includes("--print-to-pdf=/o.pdf"));
for (const f of ["--headless", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=8000"]) assert.ok(args.includes(f), f);

// openCommand / expandHome
assert.deepEqual(openCommand("win32", "C:\\a b.html"), { cmd: "cmd", args: ["/c", "start", "", "C:\\a b.html"] });
assert.deepEqual(openCommand("darwin", "/a.html"), { cmd: "open", args: ["/a.html"] });
assert.deepEqual(openCommand("linux", "/a.html"), { cmd: "xdg-open", args: ["/a.html"] });
assert.equal(expandHome("~/Downloads/a.pdf"), path.join(os.homedir(), "Downloads/a.pdf"));
assert.equal(expandHome("~"), os.homedir());
assert.equal(expandHome("~x/a"), "~x/a");
assert.equal(expandHome("/abs/~/a"), "/abs/~/a");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rp-"));
try {
  const dl = path.join(tmp, "dl");
  fs.mkdirSync(dl);
  const stem = "my.shop+eu-monthly-2026-10";
  const gen = path.join(tmp, `${stem}.html`);
  const touch = (file, secs) => {
    fs.writeFileSync(file, "x");
    const t = new Date(1_700_000_000_000 + secs * 1000);
    fs.utimesSync(file, t, t);
  };
  touch(gen, 0);
  touch(path.join(dl, `${stem}.html`), 30);
  touch(path.join(dl, `${stem} (1).html`), 60);   // newest matching
  touch(path.join(dl, `${stem}-other.html`), 120); // not a saved copy
  touch(path.join(dl, `${stem.replace(".", "X")} (2).html`), 120); // "." in stem is literal, not a wildcard

  // savedCopies / pickSource
  assert.deepEqual(savedCopies(stem, dl).sort(), [path.join(dl, `${stem} (1).html`), path.join(dl, `${stem}.html`)].sort());
  assert.deepEqual(savedCopies(stem, path.join(dl, "missing")), []);
  assert.equal(pickSource(gen, dl), path.join(dl, `${stem} (1).html`));
  assert.equal(pickSource(gen, path.join(dl, "missing")), gen);
  touch(gen, 90); // regenerated after the last save -> generated wins
  assert.equal(pickSource(gen, dl), gen);

  // finalize gating
  const emptyPdf = path.join(tmp, "empty.pdf"), realPdf = path.join(tmp, "real.pdf");
  fs.writeFileSync(emptyPdf, "");
  fs.writeFileSync(realPdf, "%PDF-1.4");
  const keep = path.join(tmp, "work");
  fs.mkdirSync(path.join(keep, "sub"), { recursive: true });
  fs.writeFileSync(path.join(keep, "sub", "f.json"), "{}");
  assert.equal(finalize(emptyPdf, [keep]), false);
  assert.ok(fs.existsSync(keep));
  assert.equal(finalize(path.join(tmp, "nope.pdf"), [keep]), false);
  assert.ok(fs.existsSync(keep));
  assert.equal(finalize(realPdf, [keep, path.join(tmp, "already-gone")]), true);
  assert.ok(!fs.existsSync(keep));
  assert.ok(fs.existsSync(realPdf));

  // pdfIsFresh: an old PDF at the same path must not pass for a new render
  assert.equal(pdfIsFresh(path.join(tmp, "absent.pdf"), 0), false);
  assert.equal(pdfIsFresh(emptyPdf, 0), false); // empty is never fresh
  const t0 = new Date(1_700_000_000_000);
  fs.utimesSync(realPdf, t0, t0);
  assert.equal(pdfIsFresh(realPdf, t0.getTime()), false); // unchanged mtime
  assert.equal(pdfIsFresh(realPdf, t0.getTime() + 1000), false); // older than before
  assert.equal(pdfIsFresh(realPdf, t0.getTime() - 1000), true);
  assert.equal(pdfIsFresh(realPdf, 0), true); // first render

  // cleanupTargets: blank args, the output PDF and its ancestors are never targets
  const root = path.resolve(tmp, "ct"), outPdf = path.join(root, "dl", "x.pdf");
  const warned = [];
  assert.deepEqual(
    cleanupTargets(["", "  ", path.join(root, "work"), path.join(root, "dl"), outPdf, root, path.join(root, "dl2"), path.join(root, "dl", "x.pdf.bak"), path.join(root, "dl", "..", "dl")], outPdf, w => warned.push(w)),
    [path.join(root, "work"), path.join(root, "dl2"), path.join(root, "dl", "x.pdf.bak")]);
  assert.equal(warned.length, 4); // dl, outPdf, root, dl/../dl
  assert.deepEqual(cleanupTargets(["~/x"], outPdf, () => {}), [path.join(os.homedir(), "x")]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
