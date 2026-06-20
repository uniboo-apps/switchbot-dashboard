const API_HOST = "https://api.switch-bot.com";
const API_BASE = "/v1.1";
const AUTO_REFRESH_SECONDS = 300;
const SESSION_COOKIE = "sbd_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");

  try {
    if (request.method === "POST" && path === "login") {
      return handleLogin(request, env);
    }

    if (request.method === "POST" && path === "logout") {
      return json({ ok: true }, 200, {
        "Set-Cookie": clearSessionCookie()
      });
    }

    if (request.method === "GET" && path === "session") {
      const authenticated = await isAuthenticated(request, env);
      return json({
        ok: true,
        authRequired: authRequired(env),
        authenticated
      });
    }

    if (authRequired(env) && !(await isAuthenticated(request, env))) {
      return json({ ok: false, error: "unauthorized", message: "Login required" }, 401);
    }

    if (request.method === "GET" && path === "config") {
      return json({
        ok: true,
        configured: hasCredentials(env),
        apiVersion: "v1.1",
        autoRefreshSeconds: AUTO_REFRESH_SECONDS
      });
    }

    if (!hasCredentials(env)) {
      return json({
        ok: false,
        error: "missing_credentials",
        message: "SWITCHBOT_TOKEN and SWITCHBOT_SECRET are required"
      }, 400);
    }

    if (request.method === "GET" && path === "devices") {
      return json(await switchBotRequest(env, "GET", "/devices"));
    }

    if (request.method === "GET" && path === "scenes") {
      return json(await switchBotRequest(env, "GET", "/scenes"));
    }

    if (request.method === "GET" && path === "snapshot") {
      return json(await getSnapshot(env));
    }

    const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
    if (request.method === "GET" && segments.length === 3 && segments[0] === "devices" && segments[2] === "status") {
      return json(await switchBotRequest(env, "GET", `/devices/${encodeURIComponent(segments[1])}/status`));
    }

    if (request.method === "POST" && segments.length === 3 && segments[0] === "devices" && segments[2] === "commands") {
      const body = await readJson(request);
      const commandBody = {
        command: String(body.command || ""),
        parameter: body.parameter === undefined ? "default" : body.parameter,
        commandType: body.commandType || "command"
      };

      if (!commandBody.command) {
        return json({ ok: false, error: "missing_command" }, 400);
      }

      return json(await switchBotRequest(env, "POST", `/devices/${encodeURIComponent(segments[1])}/commands`, commandBody));
    }

    if (request.method === "POST" && segments.length === 3 && segments[0] === "scenes" && segments[2] === "execute") {
      return json(await switchBotRequest(env, "POST", `/scenes/${encodeURIComponent(segments[1])}/execute`));
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    console.log("Function error", {
      method: request.method,
      path: url.pathname,
      message: error instanceof Error ? error.message : String(error)
    });
    return json({ ok: false, error: "server_error" }, 500);
  }
}

async function handleLogin(request, env) {
  if (!authRequired(env)) {
    return json({ ok: true, authenticated: true, authRequired: false });
  }

  const body = await readJson(request);
  const password = String(body.password || "");
  if (!password || !(await timingSafeEqual(password, env.AUTH_PASSWORD))) {
    return json({ ok: false, error: "invalid_password", message: "Password is incorrect" }, 401);
  }

  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const value = `${expires}.${await signSession(env, expires)}`;
  return json({ ok: true, authenticated: true, authRequired: true }, 200, {
    "Set-Cookie": `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`
  });
}

async function isAuthenticated(request, env) {
  if (!authRequired(env)) {
    return true;
  }

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const session = cookies[SESSION_COOKIE] || "";
  const [expiresText, signature] = session.split(".");
  const expires = Number(expiresText);

  if (!expires || !signature || expires < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = await signSession(env, expires);
  return timingSafeEqual(signature, expected);
}

async function getSnapshot(env) {
  const devices = await switchBotRequest(env, "GET", "/devices");
  const scenes = await switchBotRequest(env, "GET", "/scenes");
  const deviceList = devices.body?.body?.deviceList || [];
  const statuses = [];

  for (const device of deviceList) {
    const status = await switchBotRequest(env, "GET", `/devices/${encodeURIComponent(device.deviceId)}/status`);
    statuses.push({
      deviceId: device.deviceId,
      ok: status.ok,
      statusCode: status.body?.statusCode,
      message: status.body?.message,
      body: status.body?.body || null
    });
  }

  return {
    ok: devices.ok,
    generatedAt: new Date().toISOString(),
    devices: devices.body,
    scenes: scenes.body,
    statuses
  };
}

async function switchBotRequest(env, method, apiPath, body) {
  const nonce = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const sign = await hmacSha256Base64(env.SWITCHBOT_SECRET, `${env.SWITCHBOT_TOKEN}${timestamp}${nonce}`);
  const headers = {
    Authorization: env.SWITCHBOT_TOKEN,
    sign,
    nonce,
    t: timestamp,
    "Content-Type": "application/json; charset=utf8"
  };

  const options = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_HOST}${API_BASE}${apiPath}`, options);
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

async function hmacSha256Base64(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function signSession(env, expires) {
  return hmacSha256Base64(env.AUTH_SECRET || env.AUTH_PASSWORD || env.SWITCHBOT_SECRET, `session:${expires}`);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function hasCredentials(env) {
  return Boolean(env.SWITCHBOT_TOKEN && env.SWITCHBOT_SECRET);
}

function authRequired(env) {
  return Boolean(env.AUTH_PASSWORD);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
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

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < max; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }

  return diff === 0;
}

