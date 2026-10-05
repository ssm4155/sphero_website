// SPHERO site server (CommonJS, no dependencies).
// Serves the prebuilt pages in this folder and handles the sign-up form.
//
// Written as CommonJS on purpose: Hostinger's Node.js runner (LiteSpeed / Passenger
// style) loads the startup file with require(). An ES module (.mjs or "type": "module")
// cannot be require()d on Node 18, which crashed the app on start and caused HTTP 503.
// This file works both when required by the host and when run with `node server.js`.
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");

const ROOT = __dirname;

// Sign-ups are saved outside the site folder so a redeploy does not erase them.
const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), "sphero-data");
const CSV = path.join(DATA_DIR, "waitlist.csv");

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
const LONG_CACHE = new Set([".woff2", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".mp4"]);

// Never serve the server itself, config, dependencies, hidden files or PHP leftovers.
const BLOCKED = [
  /^\/server\.(js|mjs|cjs)$/i,
  /^\/package(-lock)?\.json$/i,
  /^\/node_modules(\/|$)/i,
  /^\/api(\/|$)/i,
  /(^|\/)\./,
  /\.php$/i,
];

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const gzCache = new Map();

function send(res, status, headers, body) {
  res.writeHead(status, Object.assign({}, SECURITY, headers));
  res.end(body);
}

async function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const full = path.join(ROOT, path.normalize("/" + decoded));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  try {
    const s = await fsp.stat(full);
    if (s.isDirectory()) {
      const idx = path.join(full, "index.html");
      return fs.existsSync(idx) ? idx : null;
    }
    return s.isFile() ? full : null;
  } catch {
    return null;
  }
}

async function serveStatic(req, res, pathname) {
  if (BLOCKED.some((re) => re.test(pathname))) {
    return send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
  }
  const file = await resolveFile(pathname);
  if (!file) {
    return send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
  }
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const isAsset = file.includes(path.sep + "assets" + path.sep) || LONG_CACHE.has(ext);
  const cache = ext === ".html" ? "public, max-age=300" : isAsset ? "public, max-age=31536000, immutable" : "public, max-age=3600";

  let body = await fsp.readFile(file);
  const headers = { "Content-Type": type, "Cache-Control": cache };
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
    let gz = gzCache.get(file);
    if (!gz || gz.size !== body.length) {
      gz = { size: body.length, data: zlib.gzipSync(body) };
      gzCache.set(file, gz);
    }
    body = gz.data;
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
  }
  headers["Content-Length"] = body.length;
  return send(res, 200, headers, req.method === "HEAD" ? undefined : body);
}

// ---- sign-up endpoint ----
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - 3600 * 1000);
  if (list.length >= 10) return true;
  list.push(now);
  hits.set(ip, list);
  return false;
}

function csvCell(v) {
  const s = String(v).replace(/\r?\n/g, " ");
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function handleSignup(req, res) {
  const json = (status, obj) =>
    send(res, status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify(obj));
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
  if (!d || typeof d !== "object") return json(400, { ok: false, error: "Invalid request." });

  const email = String(d.email == null ? "" : d.email).trim().toLowerCase();
  const role = String(d.role == null ? "" : d.role).trim();
  let count = Number.parseInt(d.companyCount == null ? 0 : d.companyCount, 10);
  const method = d.resumeMethod === "paste" ? "paste" : "skip";

  if (!/^[^@\s,"]+@[^@\s,"]+\.[^@\s,"]+$/.test(email) || email.length > 200) {
    return json(422, { ok: false, error: "Enter a valid email address." });
  }
  if (!role || role.length > 80) return json(422, { ok: false, error: "Choose a target role." });
  if (!Number.isFinite(count) || count < 0 || count > 20) count = 0;

  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "x").split(",")[0].trim();
  if (throttled(ip)) return json(429, { ok: false, error: "Too many attempts. Please try again later." });

  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    let existing = "";
    if (fs.existsSync(CSV)) existing = await fsp.readFile(CSV, "utf8");
    else await fsp.writeFile(CSV, "saved_at,email,role,company_count,resume_method\n");
    const already = existing.split("\n").some((line) => line.split(",")[1] === email);
    if (!already) {
      await fsp.appendFile(CSV, [new Date().toISOString(), email, role, count, method].map(csvCell).join(",") + "\n");
    }
    return json(200, { ok: true });
  } catch (err) {
    console.error("[sphero] could not save sign-up:", err && err.message);
    return json(500, { ok: false, error: "We could not save this right now. Please try again shortly." });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/api/waitlist.php" || url.pathname === "/api/waitlist") {
      return await handleSignup(req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed");
    }
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error("[sphero] request failed:", err);
    if (!res.headersSent) send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Server error");
    else res.end();
  }
});

server.on("error", (err) => {
  console.error("[sphero] server error:", err);
});

// PORT may be a number or (on some hosts) a socket path. When the host's runner
// manages the socket itself it intercepts listen(), so these arguments are ignored.
const rawPort = String(process.env.PORT || "3000");
if (/^\d+$/.test(rawPort)) {
  server.listen(Number(rawPort), "0.0.0.0", () => console.log("[sphero] listening on port " + rawPort));
} else {
  server.listen(rawPort, () => console.log("[sphero] listening on " + rawPort));
}

module.exports = server;
