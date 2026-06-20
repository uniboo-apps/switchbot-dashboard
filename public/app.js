const state = {
  configured: false,
  authRequired: false,
  authenticated: false,
  snapshot: null,
  filter: "all",
  autoRefreshSeconds: 300,
  refreshTimer: null,
  countdownTimer: null,
  nextRefreshAt: null
};

const elements = {
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  passwordInput: document.querySelector("#passwordInput"),
  loginError: document.querySelector("#loginError"),
  setupPanel: document.querySelector("#setupPanel"),
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
  autoRefreshToggle: document.querySelector("#autoRefreshToggle"),
  connectionState: document.querySelector("#connectionState"),
  lastUpdated: document.querySelector("#lastUpdated"),
  nextRefresh: document.querySelector("#nextRefresh"),
  deviceCount: document.querySelector("#deviceCount"),
  remoteCount: document.querySelector("#remoteCount"),
  statusCount: document.querySelector("#statusCount"),
  sceneCount: document.querySelector("#sceneCount"),
  deviceList: document.querySelector("#deviceList"),
  sceneList: document.querySelector("#sceneList"),
  eventLog: document.querySelector("#eventLog"),
  deviceFilter: document.querySelector("#deviceFilter"),
  deviceCardTemplate: document.querySelector("#deviceCardTemplate")
};

const sensorTypes = new Set([
  "Meter",
  "Meter Plus",
  "Outdoor Meter",
  "Weather Station",
  "Meter Pro",
  "Meter Pro CO2",
  "Motion Sensor",
  "Contact Sensor",
  "Presence Sensor",
  "Water Leak Detector",
  "Hub 2",
  "Hub 3",
  "Home Climate Panel"
]);

const controlCommands = new Map([
  ["Bot", [{ label: "押す", command: "press", primary: true }]],
  ["Plug", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Plug Mini (JP)", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Plug Mini (US)", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Plug Mini (EU)", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Color Bulb", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Strip Light", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Ceiling Light", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Ceiling Light Pro", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Humidifier", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Evaporative Humidifier", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Air Purifier VOC", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Air Purifier PM2.5", [{ label: "ON", command: "turnOn", primary: true }, { label: "OFF", command: "turnOff" }]],
  ["Lock", [{ label: "施錠", command: "lock", primary: true }, { label: "解錠", command: "unlock" }]],
  ["Lock Pro", [{ label: "施錠", command: "lock", primary: true }, { label: "解錠", command: "unlock" }]],
  ["Lock Ultra", [{ label: "施錠", command: "lock", primary: true }, { label: "解錠", command: "unlock" }]]
]);

init();

async function init() {
  bindEvents();
  await loadSession();

  if (state.authRequired && !state.authenticated) {
    showLogin();
    return;
  }

  await loadConfig();

  if (state.configured) {
    await refreshSnapshot();
    scheduleRefresh();
  }
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    login();
  });
  elements.logoutButton.addEventListener("click", logout);
  elements.refreshButton.addEventListener("click", () => refreshSnapshot());
  elements.autoRefreshToggle.addEventListener("change", scheduleRefresh);
  elements.deviceFilter.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) {
      return;
    }

    state.filter = button.dataset.filter;
    for (const item of elements.deviceFilter.querySelectorAll("button")) {
      item.classList.toggle("active", item === button);
    }
    renderDevices();
  });
}

async function loadSession() {
  const session = await apiGet("/api/session");
  state.authRequired = Boolean(session.authRequired);
  state.authenticated = Boolean(session.authenticated);
  elements.logoutButton.classList.toggle("hidden", !state.authRequired || !state.authenticated);
}

async function login() {
  const password = elements.passwordInput.value;
  elements.loginError.textContent = "";

  try {
    const result = await apiPost("/api/login", { password });
    state.authRequired = Boolean(result.authRequired);
    state.authenticated = Boolean(result.authenticated);
    elements.passwordInput.value = "";
    hideLogin();
    await loadConfig();
    if (state.configured) {
      await refreshSnapshot();
      scheduleRefresh();
    }
  } catch (error) {
    elements.loginError.textContent = "ログインできませんでした";
    addLog(error.message || String(error), true);
  }
}

async function logout() {
  await apiPost("/api/logout", {});
  state.authenticated = false;
  state.snapshot = null;
  window.clearTimeout(state.refreshTimer);
  window.clearInterval(state.countdownTimer);
  elements.deviceList.replaceChildren();
  elements.sceneList.replaceChildren();
  showLogin();
}

function showLogin() {
  elements.loginPanel.classList.remove("hidden");
  elements.logoutButton.classList.add("hidden");
  elements.setupPanel.classList.add("hidden");
  elements.connectionState.textContent = "ログイン待ち";
  elements.passwordInput.focus();
}

function hideLogin() {
  elements.loginPanel.classList.add("hidden");
  elements.logoutButton.classList.toggle("hidden", !state.authRequired);
}

async function loadConfig() {
  const config = await apiGet("/api/config");
  state.configured = Boolean(config.configured);
  state.autoRefreshSeconds = config.autoRefreshSeconds || 300;
  elements.setupPanel.classList.toggle("hidden", state.configured);
  elements.connectionState.textContent = state.configured ? "API設定済み" : "未設定";
}

async function refreshSnapshot() {
  if (!state.configured) {
    await loadConfig();
    return;
  }

  setBusy(true);
  try {
    const snapshot = await apiGet("/api/snapshot");
    state.snapshot = snapshot;
    renderAll();
    addLog("更新しました");
    elements.connectionState.textContent = snapshot.ok ? "接続OK" : "一部エラー";
  } catch (error) {
    elements.connectionState.textContent = "取得失敗";
    addLog(error.message || String(error), true);
  } finally {
    setBusy(false);
    scheduleRefresh();
  }
}

function renderAll() {
  const physicalDevices = getPhysicalDevices();
  const remoteDevices = getRemoteDevices();
  const scenes = getScenes();
  const okStatuses = getStatuses().filter((status) => status.ok);

  elements.deviceCount.textContent = physicalDevices.length;
  elements.remoteCount.textContent = remoteDevices.length;
  elements.statusCount.textContent = `${okStatuses.length}/${physicalDevices.length}`;
  elements.sceneCount.textContent = scenes.length;
  elements.lastUpdated.textContent = formatTime(new Date(state.snapshot.generatedAt));

  renderDevices();
  renderScenes();
}

function renderDevices() {
  elements.deviceList.replaceChildren();
  const devices = getFilteredDevices();

  if (!devices.length) {
    elements.deviceList.append(emptyMessage("表示できるデバイスがありません"));
    return;
  }

  for (const device of devices) {
    const status = getStatusForDevice(device.deviceId);
    elements.deviceList.append(renderDeviceCard(device, status));
  }
}

function renderDeviceCard(device, status) {
  const fragment = elements.deviceCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".device-card");
  const title = fragment.querySelector("h3");
  const type = fragment.querySelector(".device-type");
  const pill = fragment.querySelector(".pill");
  const values = fragment.querySelector(".quick-values");
  const actions = fragment.querySelector(".actions");
  const raw = fragment.querySelector("pre");

  title.textContent = device.deviceName || device.remoteName || device.deviceId;
  type.textContent = `${device.deviceType || device.remoteType || "Unknown"} · ${device.deviceId}`;

  const statusBody = status?.body || null;
  pill.textContent = status?.ok ? "status OK" : status ? "status NG" : "no status";
  pill.classList.toggle("ok", Boolean(status?.ok));
  pill.classList.toggle("warn", !status?.ok);

  const quickValues = getQuickValues(device, statusBody);
  if (quickValues.length) {
    for (const item of quickValues) {
      values.append(valueTile(item.label, item.value));
    }
  } else {
    values.append(valueTile("状態", status?.message || "未取得"));
  }

  const commandSet = controlCommands.get(device.deviceType) || [];
  for (const command of commandSet) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = command.label;
    button.classList.toggle("primary", Boolean(command.primary));
    button.addEventListener("click", () => sendCommand(device, command, button));
    actions.append(button);
  }

  if (!commandSet.length) {
    actions.textContent = "操作コマンドなし";
  }

  raw.textContent = JSON.stringify(statusBody || status || device, null, 2);
  card.dataset.deviceType = device.deviceType || "";
  return fragment;
}

function renderScenes() {
  elements.sceneList.replaceChildren();
  const scenes = getScenes();

  if (!scenes.length) {
    elements.sceneList.append(emptyMessage("シーンがありません"));
    return;
  }

  for (const scene of scenes) {
    const item = document.createElement("div");
    item.className = "scene-item";

    const name = document.createElement("strong");
    name.textContent = scene.sceneName || scene.sceneId;

    const button = document.createElement("button");
    button.type = "button";
    button.title = "実行";
    button.setAttribute("aria-label", `${name.textContent} を実行`);
    button.textContent = "▶";
    button.addEventListener("click", () => executeScene(scene, button));

    item.append(name, button);
    elements.sceneList.append(item);
  }
}

async function sendCommand(device, command, button) {
  button.disabled = true;
  try {
    const result = await apiPost(`/api/devices/${encodeURIComponent(device.deviceId)}/commands`, {
      command: command.command,
      parameter: command.parameter ?? "default",
      commandType: command.commandType ?? "command"
    });

    if (!result.ok) {
      throw new Error(result.body?.message || "Command failed");
    }

    addLog(`${device.deviceName}: ${command.label}`);
    await refreshSnapshot();
  } catch (error) {
    addLog(`${device.deviceName}: ${error.message || error}`, true);
  } finally {
    button.disabled = false;
  }
}

async function executeScene(scene, button) {
  button.disabled = true;
  try {
    const result = await apiPost(`/api/scenes/${encodeURIComponent(scene.sceneId)}/execute`, {});
    if (!result.ok) {
      throw new Error(result.body?.message || "Scene failed");
    }
    addLog(`${scene.sceneName || scene.sceneId} を実行しました`);
  } catch (error) {
    addLog(`${scene.sceneName || scene.sceneId}: ${error.message || error}`, true);
  } finally {
    button.disabled = false;
  }
}

function getQuickValues(device, status) {
  if (!status) {
    return [{ label: "状態", value: "未取得" }];
  }

  const candidates = [
    ["temperature", "温度", (value) => `${value}°C`],
    ["humidity", "湿度", (value) => `${value}%`],
    ["CO2", "CO2", (value) => `${value} ppm`],
    ["co2", "CO2", (value) => `${value} ppm`],
    ["battery", "電池", (value) => `${value}%`],
    ["power", "電源"],
    ["voltage", "電圧", (value) => `${value} V`],
    ["electricCurrent", "電流", (value) => `${value} A`],
    ["doorState", "ドア"],
    ["lockState", "ロック"],
    ["openState", "開閉"],
    ["moveDetected", "動体"],
    ["brightness", "照度"],
    ["nebulizationEfficiency", "加湿"],
    ["deviceMode", "モード"],
    ["workingStatus", "稼働"],
    ["slidePosition", "位置", (value) => `${value}%`]
  ];

  const values = [];
  for (const [key, label, formatter] of candidates) {
    if (status[key] !== undefined && status[key] !== null) {
      values.push({
        label,
        value: formatter ? formatter(status[key]) : String(status[key])
      });
    }
  }

  if (!values.length && device.enableCloudService !== undefined) {
    values.push({
      label: "Cloud",
      value: device.enableCloudService ? "有効" : "無効"
    });
  }

  return values.slice(0, 6);
}

function valueTile(label, value) {
  const tile = document.createElement("div");
  tile.className = "value-tile";

  const labelNode = document.createElement("span");
  labelNode.textContent = label;

  const valueNode = document.createElement("strong");
  valueNode.textContent = value;

  tile.append(labelNode, valueNode);
  return tile;
}

function getFilteredDevices() {
  const devices = getPhysicalDevices();
  if (state.filter === "sensor") {
    return devices.filter((device) => sensorTypes.has(device.deviceType));
  }
  if (state.filter === "control") {
    return devices.filter((device) => controlCommands.has(device.deviceType));
  }
  return devices;
}

function getPhysicalDevices() {
  return state.snapshot?.devices?.body?.deviceList || [];
}

function getRemoteDevices() {
  return state.snapshot?.devices?.body?.infraredRemoteList || [];
}

function getScenes() {
  return state.snapshot?.scenes?.body || [];
}

function getStatuses() {
  return state.snapshot?.statuses || [];
}

function getStatusForDevice(deviceId) {
  return getStatuses().find((status) => status.deviceId === deviceId);
}

function emptyMessage(text) {
  const node = document.createElement("div");
  node.className = "empty";
  node.textContent = text;
  return node;
}

async function apiGet(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || response.statusText);
  }
  return payload;
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || response.statusText);
  }
  return payload;
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  window.clearInterval(state.countdownTimer);

  if (!elements.autoRefreshToggle.checked || !state.configured) {
    state.nextRefreshAt = null;
    elements.nextRefresh.textContent = "-";
    return;
  }

  state.nextRefreshAt = Date.now() + state.autoRefreshSeconds * 1000;
  state.refreshTimer = window.setTimeout(refreshSnapshot, state.autoRefreshSeconds * 1000);
  updateCountdown();
  state.countdownTimer = window.setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  if (!state.nextRefreshAt) {
    elements.nextRefresh.textContent = "-";
    return;
  }

  const seconds = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  elements.nextRefresh.textContent = `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function setBusy(isBusy) {
  elements.refreshButton.disabled = isBusy;
}

function addLog(message, isError = false) {
  const entry = document.createElement("div");
  entry.className = `log-entry${isError ? " error" : ""}`;
  entry.textContent = `${formatTime(new Date())} ${message}`;
  elements.eventLog.prepend(entry);

  while (elements.eventLog.children.length > 8) {
    elements.eventLog.lastElementChild.remove();
  }
}

function formatTime(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}
