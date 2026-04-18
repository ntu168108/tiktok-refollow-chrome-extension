(function () {
  if (window.__tk_autofollow_done) return;
  window.__tk_autofollow_done = false;

  const ALREADY_TEXT = ["following", "friends", "dang theo doi", "ban be", "ban b"];
  const FOLLOW_TEXT = ["follow", "theo doi"];
  const MAX_WAIT_MS = 18000;
  const POLL_INTERVAL_MS = 250;
  const PRE_CLICK_MIN = 1600;
  const PRE_CLICK_MAX = 3200;
  const POST_CLICK_CHECK_MS = 900;

  function usernameFromUrl() {
    const m = location.pathname.match(/^\/@([^\/?#]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function normalize(text) {
    return (text || "")
      .trim()
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function report(status) {
    if (window.__tk_autofollow_done) return;
    window.__tk_autofollow_done = true;
    try {
      chrome.runtime.sendMessage({
        type: "FOLLOW_RESULT",
        status,
        username: usernameFromUrl(),
      });
    } catch (e) {}
  }

  function hasCaptcha() {
    if (document.getElementById("captcha_container")) return true;
    if (document.querySelector('[id*="captcha"][class*="container"], div[class*="captcha"][class*="mask"]')) return true;
    if (document.querySelector('iframe[src*="captcha"]')) return true;
    return false;
  }

  function isNotFound() {
    if (document.querySelector('[data-e2e="user-page-empty"]')) return true;
    const body = normalize(document.body ? document.body.innerText.slice(0, 500) : "");
    if (body.includes("couldn't find this account") || body.includes("khong tim thay tai khoan") || body.includes("not found")) {
      return true;
    }
    return false;
  }

  function findFollowButton() {
    const direct = document.querySelector('button[data-e2e="follow-button"]');
    if (direct) return direct;
    const subscribe = document.querySelector('[data-e2e="subscribe-button"] button, [data-e2e="follow-button-container"] button');
    if (subscribe) return subscribe;

    const buttons = Array.from(document.querySelectorAll('button'));
    for (const b of buttons) {
      const t = normalize(b.innerText);
      if (!t) continue;
      if (ALREADY_TEXT.some((w) => t === w || t.startsWith(w))) {
        b.dataset.__tkFollowState = "already";
        return b;
      }
    }
    for (const b of buttons) {
      const t = normalize(b.innerText);
      if (!t) continue;
      if (FOLLOW_TEXT.some((w) => t === w || t.startsWith(w))) {
        const hasAlready = ALREADY_TEXT.some((w) => t.includes(w));
        if (!hasAlready) {
          b.dataset.__tkFollowState = "follow";
          return b;
        }
      }
    }
    return null;
  }

  function classifyButton(btn) {
    if (!btn) return null;
    if (btn.dataset.__tkFollowState === "already") return "already_following";
    if (btn.dataset.__tkFollowState === "follow") return "pending_click";
    const txt = normalize(btn.innerText);
    if (ALREADY_TEXT.some((w) => txt === w || txt.startsWith(w))) return "already_following";
    if (FOLLOW_TEXT.some((w) => txt === w || txt.startsWith(w))) return "pending_click";
    return "pending_click";
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async function waitForReady() {
    const started = Date.now();
    while (Date.now() - started < MAX_WAIT_MS) {
      if (hasCaptcha()) return { kind: "captcha" };
      if (isNotFound()) return { kind: "not_found" };
      const btn = findFollowButton();
      if (btn) return { kind: "button", btn };
      await sleep(POLL_INTERVAL_MS);
    }
    return { kind: "timeout" };
  }

  async function run() {
    await sleep(randomDelay(PRE_CLICK_MIN, PRE_CLICK_MAX));
    const ready = await waitForReady();

    if (ready.kind === "captcha") {
      report("captcha");
      return;
    }
    if (ready.kind === "not_found") {
      report("not_found");
      return;
    }
    if (ready.kind === "timeout") {
      report("timeout");
      return;
    }

    const state = classifyButton(ready.btn);
    if (state === "already_following") {
      report("already");
      return;
    }

    try {
      ready.btn.scrollIntoView({ behavior: "instant", block: "center" });
    } catch (e) {}
    await sleep(randomDelay(250, 600));
    try {
      ready.btn.click();
    } catch (e) {
      report("error");
      return;
    }

    await sleep(POST_CLICK_CHECK_MS);
    if (hasCaptcha()) {
      report("captcha");
      return;
    }

    const after = findFollowButton();
    if (!after) {
      report("error");
      return;
    }
    const afterState = classifyButton(after);
    if (afterState === "already_following") {
      report("followed");
    } else {
      await sleep(600);
      const again = findFollowButton();
      const againState = classifyButton(again);
      if (againState === "already_following") {
        report("followed");
      } else {
        report("error");
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
