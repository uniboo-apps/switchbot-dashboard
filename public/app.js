const state = {
  configured: false,
  authRequired: false,
  authenticated: false,
  snapshot: null,
  filter: "all",
  reorderMode: false,
  orders: loadOrders(),
  dragItem: null,
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
  reorderButton: document.querySelector("#reorderButton"),
  resetOrderButton: document.querySelector("#resetOrderButton"),
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
  sensorHighlights: document.querySelector("#sensorHighlights"),
  controlList: document.querySelector("#controlList"),
  remoteList: document.querySelector("#remoteList"),
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

const stateLabels = new Map([
  ["on", "ON"],
  ["off", "OFF"],
  ["locked", "施錠"],
  ["unlocked", "解錠"],
  ["jammed", "ジャム"],
  ["opened", "開"],
  ["closed", "閉"],
  ["open", "開"],
  ["close", "閉"],
  ["timeoutnotclose", "閉じず"],
  ["true", "あり"],
  ["false", "なし"],
  ["detected", "検知"],
  ["notdetected", "なし"]
]);

function translateState(value) {
  return stateLabels.get(String(value).toLowerCase()) ?? String(value);
}

// 各コマンドが「どの状態にする操作か」。現在状態と一致するボタンを点灯させる。
const commandStateMap = new Map([
  ["turnOn", "on"],
  ["turnOff", "off"],
  ["lock", "locked"],
  ["unlock", "unlocked"]
]);

// 「点灯（緑）」とみなす状態。off/unlocked はニュートラル表示にする。
const onLikeStates = new Set(["on", "locked"]);

function getCurrentToggleState(statusBody) {
  if (!statusBody) {
    return null;
  }
  if (statusBody.power !== undefined && statusBody.power !== null) {
    return String(statusBody.power).toLowerCase();
  }
  if (statusBody.lockState !== undefined && statusBody.lockState !== null) {
    return String(statusBody.lockState).toLowerCase();
  }
  return null;
}

init();

async function init() {
  bindEvents();
  updateOrderUi();
  await loadSession();

  if (state.authRequired && !state.authenticated) {
    showLogin();
    return;
  }

  await loadConfig();

  if (state.configured) {
    await refreshSnapshot();
  }
}

function bindEvents() {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  elements.reorderButton.addEventListener("click", toggleReorderMode);
  elements.resetOrderButton.addEventListener("click", resetOrders);
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

  for (const { list, kind } of getOrderLists()) {
    list.dataset.orderList = kind;
    list.addEventListener("dragstart", handleOrderDragStart);
    list.addEventListener("dragover", handleOrderDragOver);
    list.addEventListener("dragleave", handleOrderDragLeave);
    list.addEventListener("drop", handleOrderDrop);
    list.addEventListener("dragend", clearDragState);
  }
}

function toggleReorderMode() {
  state.reorderMode = !state.reorderMode;
  updateOrderUi();
  if (state.snapshot) {
    renderAll();
  }
}

function updateOrderUi() {
  document.body.classList.toggle("reorder-mode", state.reorderMode);
  elements.reorderButton.classList.toggle("active", state.reorderMode);
  elements.reorderButton.setAttribute("aria-pressed", String(state.reorderMode));
  elements.resetOrderButton.classList.toggle("hidden", !state.reorderMode);
}

function resetOrders() {
  state.orders = createEmptyOrders();
  saveOrders();
  if (state.snapshot) {
    renderAll();
  }
  addLog("並びをリセットしました");
}

function getOrderLists() {
  return [
    { list: elements.sensorHighlights, kind: "devices" },
    { list: elements.controlList, kind: "devices" },
    { list: elements.deviceList, kind: "devices" },
    { list: elements.sceneList, kind: "scenes" },
    { list: elements.remoteList, kind: "remotes" }
  ];
}

function handleOrderDragStart(event) {
  if (!state.reorderMode) {
    event.preventDefault();
    return;
  }

  const item = getOrderItem(event.target);
  if (!item || item.parentElement !== event.currentTarget) {
    event.preventDefault();
    return;
  }

  state.dragItem = {
    kind: item.dataset.orderKind,
    id: item.dataset.orderId,
    list: event.currentTarget
  };
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", state.dragItem.id);
}

function handleOrderDragOver(event) {
  if (!state.reorderMode || !state.dragItem || state.dragItem.list !== event.currentTarget) {
    return;
  }

  const target = getOrderItem(event.target);
  if (!target || target.dataset.orderKind !== state.dragItem.kind) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  clearDragOver(event.currentTarget);
  target.classList.add("drag-over");
}

function handleOrderDragLeave(event) {
  const target = getOrderItem(event.target);
  if (target && !target.contains(event.relatedTarget)) {
    target.classList.remove("drag-over");
  }
}

function handleOrderDrop(event) {
  if (!state.reorderMode || !state.dragItem || state.dragItem.list !== event.currentTarget) {
    return;
  }

  const target = getOrderItem(event.target);
  if (!target || target.dataset.orderKind !== state.dragItem.kind) {
    return;
  }

  event.preventDefault();
  moveOrderItemBefore(state.dragItem.kind, state.dragItem.id, target.dataset.orderId);
  clearDragState(event);
}

function clearDragState(event) {
  const list = event?.currentTarget || document;
  clearDragOver(list);
  for (const item of document.querySelectorAll(".dragging")) {
    item.classList.remove("dragging");
  }
  state.dragItem = null;
}

function clearDragOver(root) {
  for (const item of root.querySelectorAll?.(".drag-over") || []) {
    item.classList.remove("drag-over");
  }
}

function getOrderItem(target) {
  return target instanceof Element ? target.closest("[data-order-kind][data-order-id]") : null;
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
  stopRefreshTimers();
  clearDeviceLists();
  showLogin();
}

function clearDeviceLists() {
  elements.sensorHighlights.replaceChildren();
  elements.controlList.replaceChildren();
  elements.remoteList.replaceChildren();
  elements.deviceList.replaceChildren();
  elements.sceneList.replaceChildren();
}

function handleSessionExpired() {
  state.authenticated = false;
  state.snapshot = null;
  stopRefreshTimers();
  clearDeviceLists();
  showLogin();
  addLog("セッションが切れました。再ログインしてください", true);
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopRefreshTimers();
    return;
  }
  if (canAutoRefresh()) {
    refreshSnapshot();
  }
}

function canAutoRefresh() {
  return state.configured
    && elements.autoRefreshToggle.checked
    && (!state.authRequired || state.authenticated);
}

function stopRefreshTimers() {
  window.clearTimeout(state.refreshTimer);
  window.clearInterval(state.countdownTimer);
  state.nextRefreshAt = null;
  elements.nextRefresh.textContent = "-";
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

  renderSensorHighlights();
  renderControls();
  renderDevices();
  renderScenes();
  renderRemotes();
}

function renderSensorHighlights() {
  elements.sensorHighlights.replaceChildren();
  const sensors = getPhysicalDevices()
    .filter((device) => sensorTypes.has(device.deviceType))
    .map((device) => ({ device, status: getStatusForDevice(device.deviceId) }))
    .sort((left, right) => compareOrderedItems("devices", left.device, right.device, getDeviceId, sensorSortScore));

  if (!sensors.length) {
    elements.sensorHighlights.append(emptyMessage("センサーがありません"));
    return;
  }

  for (const item of sensors.slice(0, 8)) {
    elements.sensorHighlights.append(renderSensorCard(item.device, item.status));
  }
}

function renderSensorCard(device, status) {
  const card = document.createElement("article");
  card.className = "sensor-card";
  makeOrderable(card, "devices", device.deviceId);

  const statusBody = status?.body || null;
  const quickValues = getQuickValues(device, statusBody);
  const primary = quickValues[0] || { label: "状態", value: status?.message || "未取得" };
  const secondary = quickValues.slice(1, 4);

  const badge = document.createElement("span");
  badge.className = `sensor-badge ${status?.ok ? "ok" : "warn"}`;
  badge.textContent = getDeviceInitial(device);

  const body = document.createElement("div");
  body.className = "sensor-body";

  const label = document.createElement("span");
  label.className = "sensor-label";
  label.textContent = primary.label;

  const value = document.createElement("strong");
  value.className = "sensor-value";
  value.textContent = primary.value;

  const name = document.createElement("p");
  name.className = "sensor-name";
  name.textContent = device.deviceName || device.deviceId;

  body.append(label, value, name);

  const meta = document.createElement("div");
  meta.className = "sensor-meta";
  for (const item of secondary) {
    const chip = document.createElement("span");
    chip.textContent = `${item.label} ${item.value}`;
    meta.append(chip);
  }

  if (state.reorderMode) {
    card.append(orderControls("devices", device.deviceId));
  }

  card.append(badge, body);
  if (secondary.length) {
    card.append(meta);
  }
  return card;
}

function renderControls() {
  elements.controlList.replaceChildren();
  const controls = getPhysicalDevices()
    .filter((device) => controlCommands.has(device.deviceType))
    .sort((left, right) => compareOrderedItems("devices", left, right, getDeviceId, controlSortScore));

  if (!controls.length) {
    elements.controlList.append(emptyMessage("操作できるデバイスがありません"));
    return;
  }

  for (const device of controls) {
    elements.controlList.append(renderControlCard(device, getStatusForDevice(device.deviceId)));
  }
}

function renderControlCard(device, status) {
  const card = document.createElement("article");
  card.className = "control-card";
  makeOrderable(card, "devices", device.deviceId);

  const heading = document.createElement("div");
  heading.className = "control-heading";

  const titleBlock = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = device.deviceName || device.deviceId;
  const type = document.createElement("span");
  type.textContent = device.deviceType || "Unknown";
  titleBlock.append(title, type);

  const statePill = document.createElement("span");
  statePill.className = `state-pill ${status?.ok ? "ok" : "warn"}`;
  statePill.textContent = getControlStateLabel(device, status?.body);

  heading.append(titleBlock, statePill);

  const actions = document.createElement("div");
  actions.className = "control-actions";
  appendCommandButtons(device, actions, status);

  if (state.reorderMode) {
    card.append(orderControls("devices", device.deviceId));
  }

  card.append(heading, actions);
  return card;
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
  makeOrderable(card, "devices", device.deviceId);

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

  const commandSet = appendCommandButtons(device, actions, status);

  if (!commandSet.length) {
    actions.textContent = "操作コマンドなし";
  }

  raw.textContent = JSON.stringify(statusBody || status || device, null, 2);
  card.dataset.deviceType = device.deviceType || "";
  if (state.reorderMode) {
    card.prepend(orderControls("devices", device.deviceId));
  }
  return fragment;
}

function appendCommandButtons(device, actions, status) {
  const commandSet = controlCommands.get(device.deviceType) || [];
  const currentState = getCurrentToggleState(status?.body);

  for (const command of commandSet) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = command.label;

    const targetState = commandStateMap.get(command.command);
    const isActive = Boolean(targetState && currentState && targetState === currentState);

    if (isActive) {
      // いまの状態と一致するボタンだけ点灯。ON/施錠は緑、OFF/解錠はニュートラル。
      button.classList.add("active", onLikeStates.has(targetState) ? "on" : "off");
    } else if (command.primary && !targetState) {
      // 押す等の単発アクションはアクセント枠で示す（緑の塗りつぶしにはしない）。
      button.classList.add("primary");
    }

    button.addEventListener("click", () => sendCommand(device, command, button));
    actions.append(button);
  }
  return commandSet;
}

function renderScenes() {
  elements.sceneList.replaceChildren();
  const scenes = orderItemsPreservingInput(getScenes(), "scenes", getSceneId);

  if (!scenes.length) {
    elements.sceneList.append(emptyMessage("シーンがありません"));
    return;
  }

  for (const scene of scenes) {
    const item = document.createElement("div");
    item.className = "scene-item";
    makeOrderable(item, "scenes", getSceneId(scene));

    const name = document.createElement("strong");
    name.textContent = scene.sceneName || scene.sceneId;

    const button = document.createElement("button");
    button.type = "button";
    button.title = "実行";
    button.setAttribute("aria-label", `${name.textContent} を実行`);
    button.textContent = "▶";
    button.addEventListener("click", () => executeScene(scene, button));

    if (state.reorderMode) {
      item.append(orderControls("scenes", getSceneId(scene)));
    }
    item.append(name, button);
    elements.sceneList.append(item);
  }
}

function renderRemotes() {
  elements.remoteList.replaceChildren();
  const remotes = orderItemsPreservingInput(getRemoteDevices(), "remotes", getRemoteId);

  if (!remotes.length) {
    elements.remoteList.append(emptyMessage("赤外線リモコンがありません"));
    return;
  }

  for (const remote of remotes) {
    const item = document.createElement("div");
    item.className = "remote-item";
    makeOrderable(item, "remotes", getRemoteId(remote));

    const type = document.createElement("span");
    type.textContent = remote.remoteType || "Remote";

    const name = document.createElement("strong");
    name.textContent = remote.remoteName || remote.deviceName || remote.deviceId;

    if (state.reorderMode) {
      item.append(orderControls("remotes", getRemoteId(remote)));
    }
    item.append(type, name);
    elements.remoteList.append(item);
  }
}

async function sendCommand(device, command, button) {
  button.disabled = true;
  button.classList.add("pending");
  const name = device.deviceName || device.deviceId;
  try {
    const result = await apiPost(`/api/devices/${encodeURIComponent(device.deviceId)}/commands`, {
      command: command.command,
      parameter: command.parameter ?? "default",
      commandType: command.commandType ?? "command"
    });

    if (!result.ok) {
      throw new Error(result.body?.message || "Command failed");
    }

    addLog(`${name}: ${command.label} 送信`);

    // 期待する状態に変わるまで確認（点灯が切り替われば成功が分かる）。
    const targetState = commandStateMap.get(command.command);
    const matched = await confirmDeviceState(device.deviceId, targetState);

    if (targetState && !matched) {
      addLog(`${name}: 状態を確認できませんでした（反映待ち）`, true);
    } else {
      addLog(`${name}: ${command.label} 完了`);
    }
  } catch (error) {
    addLog(`${name}: ${error.message || error}`, true);
  } finally {
    button.disabled = false;
    button.classList.remove("pending");
  }
}

async function refreshDeviceStatus(deviceId) {
  if (!state.snapshot) {
    await refreshSnapshot();
    return null;
  }

  const result = await apiGet(`/api/devices/${encodeURIComponent(deviceId)}/status`);
  const next = {
    deviceId,
    ok: result.ok,
    statusCode: result.body?.statusCode,
    message: result.body?.message,
    body: result.body?.body || null
  };

  const statuses = getStatuses();
  const index = statuses.findIndex((status) => status.deviceId === deviceId);
  if (index === -1) {
    statuses.push(next);
  } else {
    statuses[index] = next;
  }

  renderAll();
  return next.body;
}

// コマンド後、SwitchBot 側の反映には数秒かかることがあるため、
// 期待する状態になるまで数回ポーリングして UI を更新する。
async function confirmDeviceState(deviceId, targetState) {
  const waits = targetState ? [600, 1000, 1500] : [800];
  let matched = !targetState;

  for (const wait of waits) {
    await delay(wait);
    const body = await refreshDeviceStatus(deviceId);
    if (targetState && getCurrentToggleState(body) === targetState) {
      matched = true;
      break;
    }
  }

  return matched;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        value: formatter ? formatter(status[key]) : translateState(status[key])
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
    return devices
      .filter((device) => sensorTypes.has(device.deviceType))
      .sort((left, right) => compareOrderedItems("devices", left, right, getDeviceId, sensorSortScore));
  }
  if (state.filter === "control") {
    return devices
      .filter((device) => controlCommands.has(device.deviceType))
      .sort((left, right) => compareOrderedItems("devices", left, right, getDeviceId, controlSortScore));
  }
  return orderItems(devices, "devices", getDeviceId, deviceSortScore);
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

function makeOrderable(node, kind, id) {
  node.dataset.orderKind = kind;
  node.dataset.orderId = id;
  node.draggable = state.reorderMode;
  node.classList.toggle("orderable", state.reorderMode);
}

function orderControls(kind, id) {
  const controls = document.createElement("div");
  controls.className = "order-controls";

  const up = document.createElement("button");
  up.type = "button";
  up.title = "上へ";
  up.setAttribute("aria-label", "上へ");
  up.textContent = "↑";
  up.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    moveVisibleOrderItem(kind, id, -1, event.currentTarget);
  });

  const down = document.createElement("button");
  down.type = "button";
  down.title = "下へ";
  down.setAttribute("aria-label", "下へ");
  down.textContent = "↓";
  down.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    moveVisibleOrderItem(kind, id, 1, event.currentTarget);
  });

  controls.append(up, down);
  return controls;
}

function moveVisibleOrderItem(kind, id, direction, button) {
  const list = button.closest("[data-order-list]");
  if (!list) {
    return;
  }

  const visibleIds = getVisibleOrderIds(list, kind);
  const index = visibleIds.indexOf(id);
  const targetId = visibleIds[index + direction];
  if (!targetId) {
    return;
  }

  swapOrderItems(kind, id, targetId);
}

function moveOrderItemBefore(kind, movingId, targetId) {
  if (movingId === targetId) {
    return;
  }

  const ids = getCurrentOrderIds(kind).filter((id) => id !== movingId);
  const index = ids.indexOf(targetId);
  if (index === -1) {
    return;
  }

  ids.splice(index, 0, movingId);
  updateOrder(kind, ids);
}

function swapOrderItems(kind, leftId, rightId) {
  const ids = getCurrentOrderIds(kind);
  const leftIndex = ids.indexOf(leftId);
  const rightIndex = ids.indexOf(rightId);
  if (leftIndex === -1 || rightIndex === -1) {
    return;
  }

  ids[leftIndex] = rightId;
  ids[rightIndex] = leftId;
  updateOrder(kind, ids);
}

function updateOrder(kind, ids) {
  state.orders[getOrderKey(kind)] = ids;
  saveOrders();
  if (state.snapshot) {
    renderAll();
  }
}

function getVisibleOrderIds(list, kind) {
  return [...list.querySelectorAll(`[data-order-kind="${kind}"][data-order-id]`)]
    .map((item) => item.dataset.orderId)
    .filter(Boolean);
}

function getCurrentOrderIds(kind) {
  const config = getOrderConfig(kind);
  return orderItems(config.items(), kind, config.id, config.score).map(config.id);
}

function orderItems(items, kind, getId, fallbackScore) {
  return [...items].sort((left, right) => compareOrderedItems(kind, left, right, getId, fallbackScore));
}

function orderItemsPreservingInput(items, kind, getId) {
  return [...items].sort((left, right) => compareOrderedItems(kind, left, right, getId, () => 0));
}

function compareOrderedItems(kind, left, right, getId, fallbackScore) {
  const order = state.orders[getOrderKey(kind)] || [];
  const leftIndex = order.indexOf(getId(left));
  const rightIndex = order.indexOf(getId(right));

  if (leftIndex !== -1 && rightIndex !== -1) {
    return leftIndex - rightIndex;
  }
  if (leftIndex !== -1) {
    return -1;
  }
  if (rightIndex !== -1) {
    return 1;
  }
  return fallbackScore(left) - fallbackScore(right);
}

function getOrderConfig(kind) {
  if (kind === "scenes") {
    return { items: getScenes, id: getSceneId, score: () => 0 };
  }
  if (kind === "remotes") {
    return { items: getRemoteDevices, id: getRemoteId, score: () => 0 };
  }
  return { items: getPhysicalDevices, id: getDeviceId, score: deviceSortScore };
}

function getOrderKey(kind) {
  if (kind === "scenes") {
    return "sceneIds";
  }
  if (kind === "remotes") {
    return "remoteIds";
  }
  return "deviceIds";
}

function deviceSortScore(device) {
  if (sensorTypes.has(device.deviceType)) {
    return sensorSortScore(device);
  }
  if (controlCommands.has(device.deviceType)) {
    return 100 + controlSortScore(device);
  }
  return 300 + nameScore(device);
}

function sensorSortScore(device) {
  const type = device.deviceType || "";
  if (type.includes("Meter") || type.includes("Climate") || type.includes("Hub")) {
    return 0 + nameScore(device);
  }
  if (type.includes("Contact") || type.includes("Motion") || type.includes("Presence")) {
    return 40 + nameScore(device);
  }
  if (type.includes("Leak") || type.includes("CO2")) {
    return 70 + nameScore(device);
  }
  return 90 + nameScore(device);
}

function controlSortScore(device) {
  const type = device.deviceType || "";
  if (type.includes("Lock")) {
    return 0 + nameScore(device);
  }
  if (type.includes("Plug") || type.includes("Bot")) {
    return 30 + nameScore(device);
  }
  return 60 + nameScore(device);
}

function nameScore(device) {
  const name = normalizeName(device);
  let score = 0;
  for (let index = 0; index < Math.min(name.length, 8); index += 1) {
    score += name.charCodeAt(index) / (index + 1);
  }
  return score / 10000;
}

function normalizeName(device) {
  return String(device.deviceName || device.remoteName || device.deviceId || "").toLowerCase();
}

function getDeviceId(device) {
  return device.deviceId || device.remoteId || normalizeName(device);
}

function getSceneId(scene) {
  return scene.sceneId || scene.sceneName || "";
}

function getRemoteId(remote) {
  return remote.deviceId || remote.remoteName || remote.remoteType || "";
}

function createEmptyOrders() {
  return {
    deviceIds: [],
    sceneIds: [],
    remoteIds: []
  };
}

function loadOrders() {
  try {
    const parsed = JSON.parse(localStorage.getItem("switchbotDashboard.order.v1") || "null");
    return {
      ...createEmptyOrders(),
      ...(parsed && typeof parsed === "object" ? parsed : {})
    };
  } catch {
    return createEmptyOrders();
  }
}

function saveOrders() {
  localStorage.setItem("switchbotDashboard.order.v1", JSON.stringify(state.orders));
}

function getDeviceInitial(device) {
  const type = device.deviceType || "";
  if (type.includes("Meter") || type.includes("Climate")) {
    return "°";
  }
  if (type.includes("CO2")) {
    return "CO2";
  }
  if (type.includes("Contact")) {
    return "開";
  }
  if (type.includes("Motion") || type.includes("Presence")) {
    return "動";
  }
  if (type.includes("Leak")) {
    return "水";
  }
  if (type.includes("Hub")) {
    return "H";
  }
  return "S";
}

function getControlStateLabel(device, status) {
  if (!status) {
    return "未取得";
  }
  const keys = ["power", "lockState", "doorState", "workingStatus", "deviceMode"];
  for (const key of keys) {
    if (status[key] !== undefined && status[key] !== null) {
      return translateState(status[key]);
    }
  }
  return device.enableCloudService ? "cloud" : "ready";
}

function emptyMessage(text) {
  const node = document.createElement("div");
  node.className = "empty";
  node.textContent = text;
  return node;
}

async function apiGet(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  return handleApiResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleApiResponse(response);
}

async function handleApiResponse(response) {
  const payload = await response.json().catch(() => ({}));

  // セッション切れ（30日経過など）を検知したらログイン画面へ戻す。
  // ログイン試行中（authenticated=false）は除外し、login() 側で扱う。
  if (response.status === 401 && state.authRequired && state.authenticated) {
    handleSessionExpired();
    throw new Error(payload.message || "ログインが必要です");
  }

  if (!response.ok) {
    throw new Error(payload.message || payload.error || response.statusText);
  }
  return payload;
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  window.clearInterval(state.countdownTimer);

  if (!elements.autoRefreshToggle.checked || !state.configured || document.hidden) {
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
