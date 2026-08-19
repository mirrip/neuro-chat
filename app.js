"use strict";

const DEFAULTS = window.CHAT_CONFIG || {
  apiUrl: "https://agent-hub-router.mirokearos.workers.dev/v1",
  token: "",
  model: "auto",
};

const store = {
  get settings() {
    try { return JSON.parse(localStorage.getItem("chat.settings")) || {}; }
    catch { return {}; }
  },
  set settings(v) { localStorage.setItem("chat.settings", JSON.stringify(v)); },
  get theme() { return localStorage.getItem("chat.theme") || "light"; },
  set theme(v) { localStorage.setItem("chat.theme", v); },
};

function cfg() {
  return Object.assign({}, DEFAULTS, store.settings);
}

const chatEl = document.getElementById("chat");
const emptyEl = document.getElementById("emptyState");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const modelBadge = document.getElementById("modelBadge");

let history = [];
let busy = false;

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  store.theme = t;
}
applyTheme(store.theme);

function refreshBadge() {
  modelBadge.textContent = cfg().model || "auto";
}
refreshBadge();

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderMd(src) {
  const blocks = [];
  let text = src.replace(/```(\w*)\n?([\s\S]*?)(?:```|$)/g, function (_, lang, code) {
    blocks.push("<pre><code>" + escapeHtml(code.replace(/\n$/, "")) + "</code></pre>");
    return "@@CB" + (blocks.length - 1) + "@@";
  });
  text = escapeHtml(text);
  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/@@CB(\d+)@@/g, function (_, i) {
    return blocks[Number(i)] || "";
  });
  return text;
}

function scrollBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addMessage(role, text) {
  emptyEl.style.display = "none";
  const row = document.createElement("div");
  row.className = "msg " + role;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "assistant") bubble.innerHTML = renderMd(text);
  else bubble.textContent = text;
  row.appendChild(bubble);
  chatEl.appendChild(row);
  scrollBottom();
  return bubble;
}

function addTyping() {
  emptyEl.style.display = "none";
  const row = document.createElement("div");
  row.className = "msg assistant";
  row.innerHTML = '<div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
  chatEl.appendChild(row);
  scrollBottom();
  return row;
}

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + "px";
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;

  const c = cfg();
  if (!c.token) {
    openSettings();
    return;
  }

  busy = true;
  sendBtn.disabled = true;
  inputEl.value = "";
  autoResize();

  addMessage("user", text);
  history.push({ role: "user", content: text });

  const typingRow = addTyping();
  let bubble = null;
  let answer = "";

  try {
    const resp = await fetch(c.apiUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + c.token,
      },
      body: JSON.stringify({ model: c.model || "auto", messages: history, stream: true }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error("HTTP " + resp.status + ": " + errText.slice(0, 300));
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices && json.choices[0] && json.choices[0].delta;
          if (delta && delta.content) {
            answer += delta.content;
            if (!bubble) {
              typingRow.remove();
              bubble = addMessage("assistant", answer);
            } else {
              bubble.innerHTML = renderMd(answer);
            }
            scrollBottom();
          }
        } catch { /* partial json chunk */ }
      }
    }

    if (!answer) throw new Error("Пустой ответ от модели");
    history.push({ role: "assistant", content: answer });
  } catch (err) {
    typingRow.remove();
    if (bubble) bubble.remove();
    history.pop();
    const row = document.createElement("div");
    row.className = "msg assistant error";
    const b = document.createElement("div");
    b.className = "bubble";
    b.textContent = "Ошибка: " + err.message;
    row.appendChild(b);
    chatEl.appendChild(row);
    scrollBottom();
  } finally {
    busy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

sendBtn.addEventListener("click", send);
inputEl.addEventListener("input", autoResize);
inputEl.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

document.getElementById("themeBtn").addEventListener("click", function () {
  applyTheme(store.theme === "dark" ? "light" : "dark");
});

document.getElementById("clearBtn").addEventListener("click", function () {
  history = [];
  chatEl.querySelectorAll(".msg").forEach(function (n) { n.remove(); });
  emptyEl.style.display = "";
  inputEl.focus();
});

const modal = document.getElementById("settingsModal");
const cfgApiUrl = document.getElementById("cfgApiUrl");
const cfgToken = document.getElementById("cfgToken");
const cfgModel = document.getElementById("cfgModel");

function openSettings() {
  const c = cfg();
  cfgApiUrl.value = c.apiUrl;
  cfgToken.value = c.token;
  cfgModel.value = c.model;
  modal.hidden = false;
}

document.getElementById("settingsBtn").addEventListener("click", openSettings);
document.getElementById("settingsClose").addEventListener("click", function () { modal.hidden = true; });
modal.addEventListener("click", function (e) { if (e.target === modal) modal.hidden = true; });

document.getElementById("cfgSave").addEventListener("click", function () {
  store.settings = {
    apiUrl: cfgApiUrl.value.trim(),
    token: cfgToken.value.trim(),
    model: cfgModel.value.trim() || "auto",
  };
  refreshBadge();
  modal.hidden = true;
  inputEl.focus();
});

document.getElementById("cfgReset").addEventListener("click", function () {
  localStorage.removeItem("chat.settings");
  openSettings();
  refreshBadge();
});
