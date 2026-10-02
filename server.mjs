// SPHERO site server. No dependencies: serves the prebuilt pages in this folder and
// handles the sign-up form. Start with `npm start`. Hostinger sets PORT automatically.
import { createServer } from "node:http";
import { readFile, stat, mkdir, appendFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";
import { homedir } from "node:os";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// Sign-ups are saved outside the site folder so a redeploy does not erase them.
const DATA_DIR = process.env.DATA_DIR || join(homedir(), "sphero-data");
const CSV = join(DATA_DIR, "waitlist.csv");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".xml", ".txt", ".svg"]);

// Never serve source, config, hidden files or the PHP leftovers.
const BLOCKED = [/^\/server\.mjs$/i, /^\/package(-lock)?\.json$/i, /^\/node_modules(\/|$)/i, /^\/api(\/|$)/i, /(^|\/)\./, /\.php$/i];

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const gzCache = new Map();

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}

async function resolveFile(pathname) {
  let p = normalize(decodeURIComponent(pathname));
  if (!p.startsWith(sep) && !p.startsWith("/")) p = "/" + p;
  const full = join(ROOT, p);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  try {
    const s = await stat(full);
    if (s.isDirectory()) {
      const idx = join(full, "index.html");
      return existsSync(idx) ? idx : null;
    }
    return full;
  } catch {
    return null;
  }
}

async function serveStatic(req, res, pathname) {
  if (BLOCKED.some((re) => re.test(pathname))) return send(res, 404, { "Content-Type": "text/plain" }, "Not found");
  const file = await resolveFile(pathname);
  if (!file) {
    const notFound = join(ROOT, "404.html");
    const body = existsSync(notFound) ? await readFile(notFound) : Buffer.from("Not found");
    return send(res, 404, { "Content-Type": existsSync(notFound) ? TYPES[".html"] : "text/plain" }, body);
  }
  const ext = extname(file).toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const isAsset = /\/assets\//.test(file) || [".woff2", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".mp4"].includes(ext);
  const cache = ext === ".html" ? "public, max-age=300" : isAsset ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  let body = await readFile(file);
  const headers = { "Content-Type": type, "Cache-Control": cache };
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
    let gz = gzCache.get(file);
    if (!gz || gz.size !== body.length) {
      gz = { size: body.length, data: gzipSync(body) };
      gzCache.set(file, gz);
    }
    body = gz.data;
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
  }
  headers["Content-Length"] = body.length;
  if (req.method === "HEAD") return send(res, 200, headers, undefined);
  return send(res, 200, headers, body);
}

// ---- sign-up endpoint (same behavior as the earlier PHP script) ----
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - 3600_000);
  if (list.length >= 10) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

function csvCell(v) {
  const s = String(v).replace(/\r?\n/g, " ");
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function handleSignup(req, res) {
  const json = (status, obj) => send(res, status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify(obj));
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed." });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) return json(413, { ok: false, error: "Request too large." });
  }
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "Invalid request." });
  }
  const email = String(d?.email ?? "").trim().toLowerCase();
  const role = String(d?.role ?? "").trim();
  let count = Number.parseInt(d?.companyCount ?? 0, 10);
  const method = d?.resumeMethod === "paste" ? "paste" : "skip";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return json(422, { ok: false, error: "Enter a valid email address." });
  if (!role || role.length > 80) return json(422, { ok: false, error: "Choose a target role." });
  if (!Number.isFinite(count) || count < 0 || count > 20) count = 0;

  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "x").split(",")[0].trim();
  if (throttled(ip)) return json(429, { ok: false, error: "Too many attempts. Please try again later." });

  try {
    await mkdir(DATA_DIR, { recursive: true });
    let existing = "";
    if (existsSync(CSV)) existing = readFileSync(CSV, "utf8");
    else await writeFile(CSV, "saved_at,email,role,company_count,resume_method\n");
    const already = existing.split("\n").some((line) => line.split(",")[1] === email);
    if (!already) {
      await appendFile(CSV, [new Date().toISOString(), email, role, count, method].map(csvCell).join(",") + "\n");
    }
    return json(200, { ok: true });
  } catch {
    return json(500, { ok: false, error: "We could not save this right now. Please try again shortly." });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/api/waitlist.php" || url.pathname === "/api/waitlist") return await handleSignup(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { "Content-Type": "text/plain" }, "Method not allowed");
    return await serveStatic(req, res, url.pathname);
  } catch {
    return send(res, 500, { "Content-Type": "text/plain" }, "Server error");
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`SPHERO site running on port ${PORT}`));
