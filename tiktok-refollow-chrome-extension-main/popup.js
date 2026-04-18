const els = {
  fileInput: document.getElementById("fileInput"),
  fileLabelText: document.getElementById("fileLabelText"),
  loadInfo: document.getElementById("loadInfo"),
  delayMin: document.getElementById("delayMin"),
  delayMax: document.getElementById("delayMax"),
  dailyCap: document.getElementById("dailyCap"),
  order: document.getElementById("order"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  dailyText: document.getElementById("dailyText"),
  currentUser: document.getElementById("currentUser"),
  statusBadge: document.getElementById("statusBadge"),
  btnStart: document.getElementById("btnStart"),
  btnPause: document.getElementById("btnPause"),
  btnResume: document.getElementById("btnResume"),
  btnReset: document.getElementById("btnReset"),
  btnExport: document.getElementById("btnExport"),
  btnClearLog: document.getElementById("btnClearLog"),
  log: document.getElementById("log"),
};

const STATE_KEYS = ["queue", "cursor", "followedToday", "lastDayKey", "settings", "status", "logTail"];

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function appendLogEntry(entry) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<span class="t">${formatTime(entry.ts)}</span><span class="u">${entry.username || ""}</span><span class="s ${entry.status}">${entry.status}</span>`;
  els.log.appendChild(row);
  els.log.scrollTop = els.log.scrollHeight;
}

function renderLog(logTail = []) {
  els.log.innerHTML = "";
  logTail.forEach(appendLogEntry);
}

function setStatusBadge(status) {
  const s = status || "idle";
  els.statusBadge.className = `badge ${s}`;
  els.statusBadge.textContent = s;
  const running = s === "running";
  const paused = s === "paused" || s === "captcha" || s === "error";
  els.btnStart.disabled = running || paused;
  els.btnPause.disabled = !running;
  els.btnResume.disabled = !paused;
}

function renderState(state) {
  const queue = state.queue || [];
  const cursor = state.cursor || 0;
  const cap = (state.settings && state.settings.dailyCap) || 0;
  const followedToday = state.followedToday || 0;
  const total = queue.length;
  const pct = total ? Math.round((cursor / total) * 100) : 0;
  els.progressFill.style.width = pct + "%";
  els.progressText.textContent = `${cursor} / ${total}`;
  els.dailyText.textContent = `${followedToday} / ${cap} hom nay`;
  if (total) {
    els.loadInfo.textContent = `Da nap ${total} username`;
    els.fileLabelText.textContent = "Doi file khac";
  }
  if (state.currentUser) {
    els.currentUser.textContent = `Dang xu ly: @${state.currentUser}`;
  } else if (cursor >= total && total > 0) {
    els.currentUser.textContent = "Hoan tat";
  } else {
    els.currentUser.textContent = total ? "San sang" : "Chua co du lieu";
  }
  setStatusBadge(state.status);
  renderLog(state.logTail || []);
}

async function loadState() {
  const state = await chrome.storage.local.get(STATE_KEYS);
  renderState(state);
}

function extractFollowingList(json) {
  if (!json || typeof json !== "object") return null;
  const candidatePaths = [
    ["Profile And Settings", "Following", "Following"],
    ["Profile and Settings", "Following", "Following"],
    ["Activity", "Following", "Following"],
    ["Following", "Following"],
  ];
  for (const path of candidatePaths) {
    let cur = json;
    let ok = true;
    for (const key of path) {
      if (cur && typeof cur === "object" && key in cur) {
        cur = cur[key];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && Array.isArray(cur)) return cur;
  }
  const stack = [json];
  const visited = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || visited.has(node)) continue;
    visited.add(node);
    if (Array.isArray(node)) {
      if (
        node.length > 0 &&
        node.every((it) => it && typeof it === "object" && "UserName" in it)
      ) {
        return node;
      }
      for (const v of node) stack.push(v);
      continue;
    }
    if (
      Array.isArray(node.Following) &&
      node.Following.length &&
      node.Following[0] &&
      typeof node.Following[0] === "object" &&
      "UserName" in node.Following[0]
    ) {
      return node.Following;
    }
    for (const k of Object.keys(node)) stack.push(node[k]);
  }
  return null;
}

function parseFollowing(json) {
  const list = extractFollowingList(json);
  if (!Array.isArray(list)) {
    throw new Error("Khong tim thay danh sach Following trong file JSON.");
  }
  return list
    .filter((it) => it && it.UserName)
    .map((it) => ({ username: String(it.UserName).trim(), date: it.Date || "", status: "pending" }));
}

function sortQueue(queue, order) {
  const copy = queue.slice();
  if (order === "newest") {
    copy.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  } else if (order === "oldest") {
    copy.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  } else if (order === "random") {
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
  }
  return copy;
}

els.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const rawQueue = parseFollowing(json);
    const order = els.order.value;
    const queue = sortQueue(rawQueue, order);
    await chrome.storage.local.set({
      queue,
      cursor: 0,
      followedToday: 0,
      lastDayKey: todayKey(),
      status: "idle",
      logTail: [],
    });
    els.loadInfo.textContent = `Da nap ${queue.length} username (thu tu: ${order}).`;
    els.fileLabelText.textContent = file.name;
    await loadState();
  } catch (err) {
    els.loadInfo.textContent = "Loi: " + err.message;
  }
});

els.order.addEventListener("change", async () => {
  const { queue } = await chrome.storage.local.get(["queue"]);
  if (!queue || !queue.length) return;
  const pending = queue.filter((it) => it.status === "pending" || !it.status);
  const processed = queue.filter((it) => it.status && it.status !== "pending");
  const sortedPending = sortQueue(pending, els.order.value);
  const newQueue = processed.concat(sortedPending);
  await chrome.storage.local.set({ queue: newQueue });
  await loadState();
});

function readSettings() {
  return {
    delayMin: Math.max(1, parseInt(els.delayMin.value, 10) || 15),
    delayMax: Math.max(1, parseInt(els.delayMax.value, 10) || 35),
    dailyCap: Math.max(1, parseInt(els.dailyCap.value, 10) || 150),
    order: els.order.value,
  };
}

els.btnStart.addEventListener("click", async () => {
  const settings = readSettings();
  if (settings.delayMax < settings.delayMin) {
    els.loadInfo.textContent = "Delay max phai >= delay min.";
    return;
  }
  await chrome.runtime.sendMessage({ type: "START", settings });
});

els.btnPause.addEventListener("click", () => chrome.runtime.sendMessage({ type: "PAUSE" }));
els.btnResume.addEventListener("click", () => chrome.runtime.sendMessage({ type: "RESUME" }));
els.btnReset.addEventListener("click", async () => {
  if (!confirm("Reset toan bo tien trinh va queue?")) return;
  await chrome.runtime.sendMessage({ type: "RESET" });
});

els.btnExport.addEventListener("click", async () => {
  const { queue } = await chrome.storage.local.get(["queue"]);
  const data = {
    exportedAt: new Date().toISOString(),
    total: queue ? queue.length : 0,
    items: queue || [],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tiktok-refollow-report-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

els.btnClearLog.addEventListener("click", async () => {
  await chrome.storage.local.set({ logTail: [] });
  els.log.innerHTML = "";
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "STATE_UPDATE") renderState(msg.state);
  else if (msg && msg.type === "LOG_APPEND") appendLogEntry(msg.entry);
});

(async () => {
  const { settings } = await chrome.storage.local.get(["settings"]);
  if (settings) {
    if (settings.delayMin) els.delayMin.value = settings.delayMin;
    if (settings.delayMax) els.delayMax.value = settings.delayMax;
    if (settings.dailyCap) els.dailyCap.value = settings.dailyCap;
    if (settings.order) els.order.value = settings.order;
  }
  await loadState();
})();
