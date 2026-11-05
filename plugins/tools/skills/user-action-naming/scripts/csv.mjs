// Minimal RFC 4180 CSV read/write (quoted fields, "" escapes, embedded commas/newlines).
import fs from "node:fs";

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1 || r[0]);
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

export const readCsv = file => parseCsv(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));

const cell = v => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const toCsv = (head, rows) => [head, ...rows].map(r => r.map(cell).join(",")).join("\n") + "\n";
