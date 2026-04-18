const ALARM_NAME = "tk_refollow_next";
const LOG_MAX = 200;
const MAX_CONSECUTIVE_ERRORS = 3;
const TAB_TIMEOUT_MS = 25000;
const INTER_STEP_JITTER_MS = [1500, 3200];

let pendingTimeoutId = null;
let consecutiveErrors = 0;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getState() {
  return chrome.storage.local.get([
    "queue",
    "cursor",
    "followedToday",
    "lastDayKey",
    "settings",
    "status",
    "workingTabId",
    "currentUser",
    "logTail",
  ]);
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
  const state = await getState();
  try {
    await chrome.runtime.sendMessage({ type: "STATE_UPDATE", state });
  } catch (e) {
    // popup closed
  }
}

async function appendLog(entry) {
  const full = { ts: Date.now(), ...entry };
  const { logTail = [] } = await chrome.storage.local.get(["logTail"]);
  const next = logTail.concat([full]);
  if (next.length > LOG_MAX) next.splice(0, next.length - LOG_MAX);
  await chrome.storage.local.set({ logTail: next });
  try {
    await chrome.runtime.sendMessage({ type: "LOG_APPEND", entry: full });
  } catch (e) {}
}

async function ensureWorkingTab(url) {
  const { workingTabId } = await chrome.storage.local.get(["workingTabId"]);
  if (workingTabId) {
    try {
      const tab = await chrome.tabs.get(workingTabId);
      if (tab) {
        await chrome.tabs.update(workingTabId, { url });
        return workingTabId;
      }
    } catch (e) {
      // tab closed
    }
  }
  const tab = await chrome.tabs.create({ url, active: false });
  await chrome.storage.local.set({ workingTabId: tab.id });
  return tab.id;
}

async function resetDailyIfNeeded() {
  const { lastDayKey, followedToday = 0 } = await chrome.storage.local.get(["lastDayKey", "followedToday"]);
  const today = todayKey();
  if (lastDayKey !== today) {
    await chrome.storage.local.set({ lastDayKey: today, followedToday: 0 });
    await appendLog({ status: "info", username: `Reset daily counter (truoc: ${followedToday})` });
  }
}

async function scheduleNext(delayMs) {
  await chrome.alarms.clear(ALARM_NAME);
  const when = Date.now() + Math.max(1000, delayMs);
  await chrome.alarms.create(ALARM_NAME, { when });
}

async function stopPipeline(nextStatus) {
  await chrome.alarms.clear(ALARM_NAME);
  if (pendingTimeoutId) {
    clearTimeout(pendingTimeoutId);
    pendingTimeoutId = null;
  }
  await setState({ status: nextStatus, currentUser: null });
}

async function processNext() {
  const state = await getState();
  if (state.status !== "running") return;

  await resetDailyIfNeeded();
  const { queue = [], cursor = 0, followedToday = 0, settings = {} } = await chrome.storage.local.get([
    "queue",
    "cursor",
    "followedToday",
    "settings",
  ]);

  const dailyCap = settings.dailyCap || 150;
  if (followedToday >= dailyCap) {
    await appendLog({ status: "info", username: `Dat daily cap (${dailyCap}). Tam dung toi ngay mai.` });
    await stopPipeline("paused");
    return;
  }

  if (cursor >= queue.length) {
    await appendLog({ status: "info", username: "Hoan tat toan bo queue." });
    await stopPipeline("done");
    return;
  }

  let idx = cursor;
  while (idx < queue.length && queue[idx].status && queue[idx].status !== "pending") {
    idx++;
  }
  if (idx !== cursor) {
    await chrome.storage.local.set({ cursor: idx });
  }
  if (idx >= queue.length) {
    await appendLog({ status: "info", username: "Hoan tat toan bo queue." });
    await stopPipeline("done");
    return;
  }

  const item = queue[idx];
  const username = item.username;
  await setState({ currentUser: username });
  const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`;

  let tabId;
  try {
    tabId = await ensureWorkingTab(url);
  } catch (e) {
    await appendLog({ status: "error", username: `${username} (tab error: ${e.message})` });
    await recordResult(idx, "error");
    return;
  }

  if (pendingTimeoutId) clearTimeout(pendingTimeoutId);
  pendingTimeoutId = setTimeout(async () => {
    pendingTimeoutId = null;
    const s = await getState();
    if (s.status !== "running" || s.currentUser !== username) return;
    await appendLog({ status: "timeout", username });
    await recordResult(idx, "timeout");
  }, TAB_TIMEOUT_MS);
}

async function recordResult(idx, status) {
  const { queue = [], followedToday = 0, settings = {} } = await chrome.storage.local.get([
    "queue",
    "followedToday",
    "settings",
  ]);
  if (!queue[idx]) return;

  queue[idx] = { ...queue[idx], status, processedAt: Date.now() };
  let newFollowed = followedToday;
  if (status === "followed") newFollowed += 1;

  const patch = {
    queue,
    cursor: idx + 1,
    followedToday: newFollowed,
    currentUser: null,
  };

  if (status === "captcha") {
    consecutiveErrors = 0;
    await chrome.storage.local.set(patch);
    await appendLog({ status: "info", username: "Gap captcha - tam dung. Mo tab TikTok giai xong roi Resume." });
    await stopPipeline("captcha");
    return;
  }

  if (status === "error" || status === "timeout") {
    consecutiveErrors += 1;
  } else {
    consecutiveErrors = 0;
  }

  await chrome.storage.local.set(patch);

  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    await appendLog({ status: "info", username: `Co ${consecutiveErrors} loi lien tiep - tam dung.` });
    await stopPipeline("error");
    consecutiveErrors = 0;
    return;
  }

  const s = await getState();
  if (s.status !== "running") return;

  const delayMin = (settings.delayMin || 15) * 1000;
  const delayMax = (settings.delayMax || 35) * 1000;
  const delay = rand(delayMin, delayMax);
  await appendLog({ status: "info", username: `Cho ${Math.round(delay / 1000)}s roi sang user ke tiep` });
  await scheduleNext(delay);
  await setState({});
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) processNext();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg) return;
    if (msg.type === "START") {
      consecutiveErrors = 0;
      const { queue = [] } = await chrome.storage.local.get(["queue"]);
      if (!queue.length) {
        await appendLog({ status: "error", username: "Chua nap file JSON." });
        sendResponse && sendResponse({ ok: false });
        return;
      }
      await chrome.storage.local.set({ settings: msg.settings, status: "running" });
      await resetDailyIfNeeded();
      await appendLog({ status: "info", username: "Bat dau chay." });
      await setState({});
      processNext();
      sendResponse && sendResponse({ ok: true });
    } else if (msg.type === "PAUSE") {
      await appendLog({ status: "info", username: "Pause." });
      await stopPipeline("paused");
      sendResponse && sendResponse({ ok: true });
    } else if (msg.type === "RESUME") {
      consecutiveErrors = 0;
      await appendLog({ status: "info", username: "Resume." });
      await setState({ status: "running" });
      processNext();
      sendResponse && sendResponse({ ok: true });
    } else if (msg.type === "RESET") {
      await chrome.alarms.clear(ALARM_NAME);
      if (pendingTimeoutId) {
        clearTimeout(pendingTimeoutId);
        pendingTimeoutId = null;
      }
      await chrome.storage.local.set({
        queue: [],
        cursor: 0,
        followedToday: 0,
        lastDayKey: todayKey(),
        status: "idle",
        currentUser: null,
        logTail: [],
      });
      await setState({});
      sendResponse && sendResponse({ ok: true });
    } else if (msg.type === "FOLLOW_RESULT") {
      if (pendingTimeoutId) {
        clearTimeout(pendingTimeoutId);
        pendingTimeoutId = null;
      }
      const s = await getState();
      if (s.status !== "running") return;
      const { queue = [], cursor = 0 } = await chrome.storage.local.get(["queue", "cursor"]);
      if (queue[cursor] && queue[cursor].username === msg.username) {
        await appendLog({ status: msg.status, username: msg.username });
        await recordResult(cursor, msg.status);
      } else {
        const idx = queue.findIndex((q) => q.username === msg.username && q.status === "pending");
        if (idx >= 0) {
          await appendLog({ status: msg.status, username: msg.username });
          await recordResult(idx, msg.status);
        }
      }
      sendResponse && sendResponse({ ok: true });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { workingTabId } = await chrome.storage.local.get(["workingTabId"]);
  if (tabId === workingTabId) {
    await chrome.storage.local.set({ workingTabId: null });
    const s = await getState();
    if (s.status === "running") {
      await appendLog({ status: "info", username: "Tab lam viec da bi dong - pause." });
      await stopPipeline("paused");
    }
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const { status } = await chrome.storage.local.get(["status"]);
  if (status === "running") {
    await chrome.storage.local.set({ status: "paused" });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const { status } = await chrome.storage.local.get(["status"]);
  if (status === "running") {
    await chrome.storage.local.set({ status: "paused" });
  }
});

self._tkHelpers = { INTER_STEP_JITTER_MS };
