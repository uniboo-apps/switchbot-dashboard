import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const apiHost = "https://api.switch-bot.com";
const apiBase = "/v1.1";
const sessionCookie = "sbd_session";
const sessionMaxAge = 60 * 60 * 24 * 30;

loadDotEnv(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 8090);
const token = process.env.SWITCHBOT_TOKEN || "";
const secret = process.env.SWITCHBOT_SECRET || "";
const authPassword = process.env.AUTH_PASSWORD || "";
const authSecret = process.env.AUTH_SECRET || authPassword || secret || "local-dev";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
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
    const password = String(body.password || "");
    if (authRequired() && !safeEqual(password, authPassword)) {
      await delay(1000); // 総当たり対策の軽い遅延
      sendJson(res, 401, { ok: false, error: "invalid_password", message: "Password is incorrect" });
      return;
    }

    const expires = Math.floor(Date.now() / 1000) + sessionMaxAge;
    sendJson(
      res,
      200,
      { ok: true, authenticated: true, authRequired: authRequired() },
      { "Set-Cookie": `${sessionCookie}=${expires}.${signSession(expires)}; Max-Age=${sessionMaxAge}; Path=/; HttpOnly; SameSite=Strict` }
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    sendJson(res, 200, { ok: true }, { "Set-Cookie": `${sessionCookie}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict` });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    sendJson(res, 200, {
      ok: true,
      authRequired: authRequired(),
      authenticated: isAuthenticated(req)
    });
    return;
  }

  if (authRequired() && !isAuthenticated(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized", message: "Login required" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      ok: true,
      configured: hasCredentials(),
      apiVersion: "v1.1",
      autoRefreshSeconds: 300
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
    sendJson(res, 200, await switchBotRequest("GET", "/devices"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scenes") {
    sendJson(res, 200, await switchBotRequest("GET", "/scenes"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/snapshot") {
    sendJson(res, 200, await getSnapshot());
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/status$/);
  if (req.method === "GET" && statusMatch) {
    const deviceId = decodeURIComponent(statusMatch[1]);
    sendJson(res, 200, await switchBotRequest("GET", `/devices/${encodeURIComponent(deviceId)}/status`));
    return;
  }

  const commandMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/commands$/);
  if (req.method === "POST" && commandMatch) {
    const deviceId = decodeURIComponent(commandMatch[1]);
    const body = await readJsonBody(req);
    const commandBody = {
      command: String(body.command || ""),
      parameter: body.parameter === undefined ? "default" : body.parameter,
      commandType: body.commandType || "command"
    };

    if (!commandBody.command) {
      sendJson(res, 400, { ok: false, error: "missing_command" });
      return;
    }

    sendJson(
      res,
      200,
      await switchBotRequest("POST", `/devices/${encodeURIComponent(deviceId)}/commands`, commandBody)
    );
    return;
  }

  const sceneMatch = url.pathname.match(/^\/api\/scenes\/([^/]+)\/execute$/);
  if (req.method === "POST" && sceneMatch) {
    const sceneId = decodeURIComponent(sceneMatch[1]);
    sendJson(res, 200, await switchBotRequest("POST", `/scenes/${encodeURIComponent(sceneId)}/execute`));
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
}

async function getSnapshot() {
  const [devices, scenes] = await Promise.all([
    switchBotRequest("GET", "/devices"),
    switchBotRequest("GET", "/scenes")
  ]);
  const deviceList = devices.body?.body?.deviceList || [];

  const statuses = await Promise.all(
    deviceList.map(async (device) => {
      const status = await switchBotRequest("GET", `/devices/${encodeURIComponent(device.deviceId)}/status`);
      return {
        deviceId: device.deviceId,
        ok: status.ok,
        statusCode: status.body?.statusCode,
        message: status.body?.message,
        body: status.body?.body || null
      };
    })
  );

  return {
    ok: devices.ok,
    generatedAt: new Date().toISOString(),
    devices: devices.body,
    scenes: scenes.body,
    statuses
  };
}

async function switchBotRequest(method, apiPath, body) {
  const nonce = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const sign = crypto
    .createHmac("sha256", secret)
    .update(`${token}${timestamp}${nonce}`)
    .digest("base64");

  const headers = {
    Authorization: token,
    sign,
    nonce,
    t: timestamp,
    "Content-Type": "application/json; charset=utf8"
  };

  const options = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${apiHost}${apiBase}${apiPath}`, options);
  const text = await response.text();
  const parsed = parseJson(text);
  const switchBotOk = parsed?.statusCode === 100;
  const ok = response.ok && switchBotOk;

  if (!ok) {
    console.log("SwitchBot API error", {
      method,
      path: apiPath,
      httpStatus: response.status,
      result: parsed?.statusCode,
      message: parsed?.message,
      body: parsed?.body || text
    });
  }

  return {
    ok,
    httpStatus: response.status,
    body: parsed || { raw: text }
  };
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
  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  return parsed;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasCredentials() {
  return Boolean(token && secret);
}

function authRequired() {
  return Boolean(authPassword);
}

function isAuthenticated(req) {
  if (!authRequired()) {
    return true;
  }

  const cookies = parseCookies(req.headers.cookie || "");
  const value = cookies[sessionCookie] || "";
  const [expiresText, signature] = value.split(".");
  const expires = Number(expiresText);

  if (!expires || !signature || expires < Math.floor(Date.now() / 1000)) {
    return false;
  }

  return safeEqual(signature, signSession(expires));
}

function signSession(expires) {
  return crypto.createHmac("sha256", authSecret).update(`session:${expires}`).digest("base64url");
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
      })
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;

  for (let i = 0; i < max; i += 1) {
    diff |= (a[i] || 0) ^ (b[i] || 0);
  }

  return diff === 0;
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
