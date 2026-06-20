// SwitchBot Dashboard 共通コア。
// ローカルの Node サーバー（server.js）と本番の Cloudflare Pages Functions
// （functions/api/[[path]].js）で共有する。Web 標準 API（fetch / crypto.subtle /
// crypto.randomUUID / btoa / TextEncoder）だけを使い、どちらのランタイムでも動く。
// node:* は import しないこと。

const SWITCHBOT_API = "https://api.switch-bot.com/v1.1";

export const AUTO_REFRESH_SECONDS = 300;
export const SESSION_COOKIE = "sbd_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function hmacBytes(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return new Uint8Array(signature);
}

// SwitchBot の sign は仕様上 標準 base64（パディングあり）。
async function hmacBase64(secret, text) {
  return btoa(String.fromCharCode(...(await hmacBytes(secret, text))));
}

// セッション署名は base64url（Cookie 安全文字）。
async function hmacBase64Url(secret, text) {
  return (await hmacBase64(secret, text)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function switchBotRequest(creds, method, apiPath, body) {
  const nonce = crypto.randomUUID();
  const timestamp = Date.now().toString();
  const sign = await hmacBase64(creds.secret, `${creds.token}${timestamp}${nonce}`);
  const headers = {
    Authorization: creds.token,
    sign,
    nonce,
    t: timestamp,
    "Content-Type": "application/json; charset=utf8"
  };

  const options = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${SWITCHBOT_API}${apiPath}`, options);
  const text = await response.text();
  const parsed = parseJson(text);
  const ok = response.ok && parsed?.statusCode === 100;

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

export async function getSnapshot(creds) {
  const [devices, scenes] = await Promise.all([
    switchBotRequest(creds, "GET", "/devices"),
    switchBotRequest(creds, "GET", "/scenes")
  ]);
  const deviceList = devices.body?.body?.deviceList || [];

  const statuses = await Promise.all(
    deviceList.map(async (device) => {
      const status = await switchBotRequest(creds, "GET", `/devices/${encodeURIComponent(device.deviceId)}/status`);
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

// デバイスコマンド POST のボディを正規化する。command が空なら null を返す。
export function buildCommandBody(body) {
  const command = String(body?.command || "");
  if (!command) {
    return null;
  }
  return {
    command,
    parameter: body.parameter === undefined ? "default" : body.parameter,
    commandType: body.commandType || "command"
  };
}

export function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
      })
  );
}

// 長さに依存しない比較（総当たり・タイミング攻撃対策）。
export function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;

  for (let i = 0; i < max; i += 1) {
    diff |= (a[i] || 0) ^ (b[i] || 0);
  }

  return diff === 0;
}

// 署名済みセッション Cookie 値（`<expires>.<sign>`）を作る。
export async function createSessionValue(secret) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  return `${expires}.${await hmacBase64Url(secret, `session:${expires}`)}`;
}

// Cookie ヘッダ文字列を検証し、セッションが有効なら true。
export async function verifySession(secret, cookieHeader) {
  const value = parseCookies(cookieHeader)[SESSION_COOKIE] || "";
  const [expiresText, signature] = value.split(".");
  const expires = Number(expiresText);

  if (!expires || !signature || expires < Math.floor(Date.now() / 1000)) {
    return false;
  }

  return timingSafeEqual(signature, await hmacBase64Url(secret, `session:${expires}`));
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
