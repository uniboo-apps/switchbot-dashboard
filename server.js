import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTO_REFRESH_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  buildCommandBody,
  createSessionValue,
  delay,
  getSnapshot,
  parseJson,
  switchBotRequest,
  timingSafeEqual,
  verifySession
} from "./functions/_shared/switchbot-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

loadDotEnv(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 8091);
const token = process.env.SWITCHBOT_TOKEN || "";
const secret = process.env.SWITCHBOT_SECRET || "";
const authPassword = process.env.AUTH_PASSWORD || "";
const sessionSecret = process.env.AUTH_SECRET || authPassword || secret || "local-dev";
const creds = { token, secret };

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".ico", "image/x-icon"]
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    console.log("Server error", {
      method: req.method,
      url: req.url,
      message: error instanceof Error ? error.message : String(error)
    });
    sendJson(res, 500, { ok: false, error: "server_error" });
  }
});

server.listen(port, () => {
  console.log(`SwitchBot dashboard listening on http://localhost:${port}`);
  if (!hasCredentials()) {
    console.log("SwitchBot credentials are not configured. Create .env from .env.example.");
  }
});

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJsonBody(req);
    if (authRequired() && !timingSafeEqual(String(body.password || ""), authPassword)) {
      await delay(1000); // 総当たり対策の軽い遅延
      sendJson(res, 401, { ok: false, error: "invalid_password", message: "Password is incorrect" });
      return;
    }

    const value = await createSessionValue(sessionSecret);
    sendJson(
      res,
      200,
      { ok: true, authenticated: true, authRequired: authRequired() },
      { "Set-Cookie": sessionCookie(value, SESSION_MAX_AGE) }
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    sendJson(res, 200, {
      ok: true,
      authRequired: authRequired(),
      authenticated: await isAuthenticated(req)
    });
    return;
  }

  if (authRequired() && !(await isAuthenticated(req))) {
    sendJson(res, 401, { ok: false, error: "unauthorized", message: "Login required" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      ok: true,
      configured: hasCredentials(),
      apiVersion: "v1.1",
      autoRefreshSeconds: AUTO_REFRESH_SECONDS
    });
    return;
  }

  if (!hasCredentials()) {
    sendJson(res, 400, {
      ok: false,
      error: "missing_credentials",
      message: "SWITCHBOT_TOKEN and SWITCHBOT_SECRET are required in .env"
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/devices") {
    sendJson(res, 200, await switchBotRequest(creds, "GET", "/devices"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scenes") {
    sendJson(res, 200, await switchBotRequest(creds, "GET", "/scenes"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/snapshot") {
    sendJson(res, 200, await getSnapshot(creds));
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/status$/);
  if (req.method === "GET" && statusMatch) {
    const deviceId = decodeURIComponent(statusMatch[1]);
    sendJson(res, 200, await switchBotRequest(creds, "GET", `/devices/${encodeURIComponent(deviceId)}/status`));
    return;
  }

  const commandMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/commands$/);
  if (req.method === "POST" && commandMatch) {
    const deviceId = decodeURIComponent(commandMatch[1]);
    const commandBody = buildCommandBody(await readJsonBody(req));
    if (!commandBody) {
      sendJson(res, 400, { ok: false, error: "missing_command" });
      return;
    }
    sendJson(res, 200, await switchBotRequest(creds, "POST", `/devices/${encodeURIComponent(deviceId)}/commands`, commandBody));
    return;
  }

  const sceneMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/execute$/);
  if (req.method === "POST" && sceneMatch) {
    const sceneId = decodeURIComponent(sceneMatch[1]);
    sendJson(res, 200, await switchBotRequest(creds, "POST", `/scenes/${encodeURIComponent(sceneId)}/execute`));
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
}

async function serveStatic(res, requestedPath) {
  const cleanPath = requestedPath === "/" ? "/index.html" : requestedPath;
  const decoded = decodeURIComponent(cleanPath);
  const resolved = path.normalize(path.join(publicDir, decoded));

  if (!resolved.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(resolved);
  } catch {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  if (stat.isDirectory()) {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, {
    "Content-Type": mimeTypes.get(ext) || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(resolved).pipe(res);
}

// ローカルは http なので Secure は付けない（本番 Functions 側は Secure 付き）。
function sessionCookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict`;
}

async function isAuthenticated(req) {
  if (!authRequired()) {
    return true;
  }
  return verifySession(sessionSecret, req.headers.cookie || "");
}

function sendJson(res, status, payload, extraHeaders = {}) {
  sendText(res, status, JSON.stringify(payload), "application/json; charset=utf-8", extraHeaders);
}

function sendText(res, status, text, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  const parsed = parseJson(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function hasCredentials() {
  return Boolean(token && secret);
}

function authRequired() {
  return Boolean(authPassword);
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
