import {
  AUTO_REFRESH_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  buildCommandBody,
  createSessionValue,
  delay,
  getSnapshot,
  switchBotRequest,
  timingSafeEqual,
  verifySession
} from "../_shared/switchbot-core.js";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");

  try {
    if (request.method === "POST" && path === "login") {
      return handleLogin(request, env);
    }

    if (request.method === "POST" && path === "logout") {
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
    }

    if (request.method === "GET" && path === "session") {
      return json({
        ok: true,
        authRequired: authRequired(env),
        authenticated: await isAuthenticated(request, env)
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

    const creds = credentials(env);

    if (request.method === "GET" && path === "devices") {
      return json(await switchBotRequest(creds, "GET", "/devices"));
    }

    if (request.method === "GET" && path === "scenes") {
      return json(await switchBotRequest(creds, "GET", "/scenes"));
    }

    if (request.method === "GET" && path === "snapshot") {
      return json(await getSnapshot(creds));
    }

    const segments = path.split("/").filter(Boolean).map(decodeURIComponent);

    if (request.method === "GET" && isRoute(segments, "devices", "status")) {
      return json(await switchBotRequest(creds, "GET", `/devices/${encodeURIComponent(segments[1])}/status`));
    }

    if (request.method === "POST" && isRoute(segments, "devices", "commands")) {
      const commandBody = buildCommandBody(await readJson(request));
      if (!commandBody) {
        return json({ ok: false, error: "missing_command" }, 400);
      }
      return json(await switchBotRequest(creds, "POST", `/devices/${encodeURIComponent(segments[1])}/commands`, commandBody));
    }

    if (request.method === "POST" && isRoute(segments, "scenes", "execute")) {
      return json(await switchBotRequest(creds, "POST", `/scenes/${encodeURIComponent(segments[1])}/execute`));
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

function isRoute(segments, resource, action) {
  return segments.length === 3 && segments[0] === resource && segments[2] === action;
}

async function handleLogin(request, env) {
  if (!authRequired(env)) {
    return json({ ok: true, authenticated: true, authRequired: false });
  }

  const body = await readJson(request);
  const password = String(body.password || "");
  if (!password || !timingSafeEqual(password, env.AUTH_PASSWORD)) {
    await delay(1000); // 総当たり対策の軽い遅延
    return json({ ok: false, error: "invalid_password", message: "Password is incorrect" }, 401);
  }

  const value = await createSessionValue(sessionSecret(env));
  return json({ ok: true, authenticated: true, authRequired: true }, 200, {
    "Set-Cookie": sessionCookie(value, SESSION_MAX_AGE)
  });
}

async function isAuthenticated(request, env) {
  if (!authRequired(env)) {
    return true;
  }
  return verifySession(sessionSecret(env), request.headers.get("Cookie") || "");
}

function credentials(env) {
  return { token: env.SWITCHBOT_TOKEN, secret: env.SWITCHBOT_SECRET };
}

function sessionSecret(env) {
  return env.AUTH_SECRET || env.AUTH_PASSWORD || env.SWITCHBOT_SECRET;
}

function hasCredentials(env) {
  return Boolean(env.SWITCHBOT_TOKEN && env.SWITCHBOT_SECRET);
}

function authRequired(env) {
  return Boolean(env.AUTH_PASSWORD);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function sessionCookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
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
