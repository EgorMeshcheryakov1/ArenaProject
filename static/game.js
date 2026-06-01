"use strict";

const CFG = {
  WS_URL:        `ws://${location.host}/ws`,
  ARENA_CX:      350,
  ARENA_CY:      350,
  ARENA_RADIUS:  280,          // будет переписан из сообщения "start"
  DASH_COOLDOWN: 1.2,
  TICK_MS:       50,
};

let ws        = null;
let myId      = null;          // id нашего игрока (присваивается при "joined")
let myColor   = null;
let gameState = {
  players: [],
  arena: { radius: CFG.ARENA_RADIUS, cx: 0, cy: 0 },
};
let animFrameId = null;
let hudSlotById = {};
const keys = { left: false, right: false };

const screens = {
  lobby:    document.getElementById("screen-lobby"),
  waiting:  document.getElementById("screen-waiting"),
  ready:    document.getElementById("screen-ready"),
  game:     document.getElementById("screen-game"),
  gameover: document.getElementById("screen-gameover"),
};

const canvas  = document.getElementById("canvas");
const ctx     = canvas.getContext("2d");

const $      = id => document.getElementById(id);
const nameInput   = $("name-input");
const btnConnect  = $("btn-connect");
const btnReady    = $("btn-ready");
const btnPlayAgain= $("btn-play-again");
const btnLeave    = $("btn-leave");
const waitingMsg  = $("waiting-msg");
const wsDot       = $("ws-dot");
const wsLabel     = $("ws-label");

function showScreen(name) {
  Object.values(screens).forEach(el => el.classList.remove("active"));
  if (screens[name]) screens[name].classList.add("active");
}

function connectWS() {
  ws = new WebSocket(CFG.WS_URL);

  ws.onopen = () => {
    wsDot.classList.add("connected");
    wsLabel.textContent = "подключён";
    const name = nameInput.value.trim() || "Player";
    send({ type: "join", name });
  };

  ws.onclose = () => {
    wsDot.classList.remove("connected");
    wsLabel.textContent = "не подключён";
    if (animFrameId) cancelAnimationFrame(animFrameId);
  };

  ws.onerror = () => {
    wsLabel.textContent = "ошибка соединения";
  };

  ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); }
    catch { return; }
    handleMessage(msg);
  };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

const handlers = {

  
  joined(msg) {
    myId    = msg.player_id;
    myColor = msg.color;
    $("waiting-name").innerHTML =
      `Вы: <span style="color:${myColor}; font-weight:700;">${msg.name}</span>`;
  },

  
  waiting(msg) {
    waitingMsg.textContent = msg.message || "Ожидание второго игрока...";
    showScreen("waiting");
  },

  
  room_full(msg) {
    alert(msg.message || "Комната заполнена. Попробуйте позже.");
    showScreen("lobby");
  },

  
  room_ready(msg) {
    $("ready-players").innerHTML = `
      <span class="badge badge-red">Игрок 1</span>
      <span class="badge badge-blue">Игрок 2</span>
    `;
    showScreen("ready");
  },

  
  start(msg) {
    gameState.players = msg.players;
    gameState.arena   = msg.arena;
    CFG.ARENA_RADIUS  = msg.arena.radius;

    syncHudSlots(msg.players);
    updateHUD(msg.players);

    showScreen("game");
    startRenderLoop();
  },

  
  state(msg) {
    gameState.players = msg.players;
    syncHudSlots(msg.players);
    updateHUD(msg.players);
  },

  
  game_over(msg) {
    if (msg.players) gameState.players = msg.players;

    stopRenderLoop();
    drawFrame();

    const winner = msg.players
      ? msg.players.find(p => p.id === msg.winner_id)
      : null;

    const title = $("gameover-title");
    const desc  = $("gameover-desc");

    if (msg.winner_id === null) {
      title.textContent = "НИЧЬЯ";
      title.className   = "gameover-title draw";
      desc.textContent  = "Оба игрока выбыли одновременно.";
    } else if (msg.winner_id === myId) {
      title.textContent = "ПОБЕДА!";
      title.className   = "gameover-title win";
      desc.textContent  = msg.reason === "disconnect"
        ? "Противник отключился."
        : "Вы вытолкнули противника за пределы арены!";
    } else {
      title.textContent = "ПОРАЖЕНИЕ";
      title.className   = "gameover-title lose";
      desc.textContent  = msg.reason === "disconnect"
        ? "Вы отключились. (Техническая победа противника)"
        : "Вас вытолкнули за пределы арены.";
    }
    if (msg.players) {
      $("gameover-players").innerHTML = msg.players.map(p => `
        <span class="badge ${p.id === msg.winner_id ? 'badge-gold' : 'badge-red'}"
              style="border-color:${p.color}; color:${p.color};">
          ${p.id === msg.winner_id ? "🏆 " : ""}${escHtml(p.name)}
        </span>
      `).join("");
    }

    showScreen("gameover");
  },

  
  lobby() {
    hudSlotById = {};
    btnReady.disabled = false;
    btnReady.textContent = "✓  Я ГОТОВ";
    btnReady.style.opacity = "1";
    showScreen("ready");
  },
};

function handleMessage(msg) {
  const handler = handlers[msg.type];
  if (handler) handler(msg);
  else console.debug("[WS] Неизвестный тип:", msg.type);
}

document.addEventListener("keydown", e => {
  if (e.repeat) return;
  if (e.code === "Space") {
    e.preventDefault();
    send({ type: "dash" });
    return;
  }
  if (e.code === "KeyA" || e.code === "ArrowLeft") {
    if (!keys.left) {
      keys.left = true;
      send({ type: "rotate", direction: "left" });
    }
    return;
  }
  if (e.code === "KeyD" || e.code === "ArrowRight") {
    if (!keys.right) {
      keys.right = true;
      send({ type: "rotate", direction: "right" });
    }
    return;
  }
});

document.addEventListener("keyup", e => {
  if (e.code === "KeyA" || e.code === "ArrowLeft") {
    keys.left = false;
    if (!keys.right) send({ type: "rotate", direction: "stop" });
  }
  if (e.code === "KeyD" || e.code === "ArrowRight") {
    keys.right = false;
    if (!keys.left) send({ type: "rotate", direction: "stop" });
  }
});

function normalizeSlot(rawSlot) {
  const slot = Number(rawSlot);
  return (slot === 0 || slot === 1) ? slot : null;
}

function syncHudSlots(players) {
  const used = new Set();
  players.forEach(p => {
    const slot = normalizeSlot(p.slot);
    if (slot !== null) {
      hudSlotById[p.id] = slot;
      used.add(slot);
    }
  });
  players.forEach(p => {
    const known = normalizeSlot(hudSlotById[p.id]);
    if (known !== null) {
      used.add(known);
      return;
    }
    if (p.color === "#57b8ff") {
      hudSlotById[p.id] = 1;
      used.add(1);
      return;
    }
    if (p.color === "#ff5a7a") {
      hudSlotById[p.id] = 0;
      used.add(0);
      return;
    }
    const slot = used.has(0) ? 1 : 0;
    hudSlotById[p.id] = slot;
    used.add(slot);
  });
}

function resolveHudSlot(player, fallbackSlot = 0) {
  const explicit = normalizeSlot(player?.slot);
  if (explicit !== null) return explicit;

  const known = normalizeSlot(hudSlotById[player?.id]);
  if (known !== null) return known;
  const color = String(player?.color || "").toLowerCase();
  if (color === "#57b8ff") return 1;
  if (color === "#ff5a7a") return 0;

  return fallbackSlot;
}

function updateHUD(players) {
  [1, 2].forEach(num => {
    const nameEl = $(`hud-p${num}-name`);
    const cdEl   = $(`hud-p${num}-cd`);
    if (nameEl) nameEl.textContent = `Игрок ${num}`;
    if (nameEl) nameEl.style.textDecoration = "none";
    if (cdEl) cdEl.style.transform = "scaleX(0)";
  });
  players.forEach((player, idx) => {
    const slot = resolveHudSlot(player, idx === 0 ? 0 : 1);
    const num = slot + 1;
    const nameEl = $(`hud-p${num}-name`);
    const cdEl   = $(`hud-p${num}-cd`);
    if (!nameEl || !cdEl) return;

    hudSlotById[player.id] = slot;
    nameEl.textContent = player.name;

    const cooldown = Number(player.dash_cooldown) || 0;
    const maxCooldown = Number(CFG.DASH_COOLDOWN) || 1;
    const pct = cooldown > 0
      ? Math.max(0, Math.min(100, (1 - cooldown / maxCooldown) * 100))
      : 100;

    cdEl.style.transform = `scaleX(${pct / 100})`;
    nameEl.style.textDecoration = player.id === myId ? "underline" : "none";
  });
}

function startRenderLoop() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  const loop = () => {
    drawFrame();
    animFrameId = requestAnimationFrame(loop);
  };
  animFrameId = requestAnimationFrame(loop);
}

function stopRenderLoop() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function drawFrame() {
  const W = canvas.width;
  const H = canvas.height;
  const cx = CFG.ARENA_CX;
  const cy = CFG.ARENA_CY;
  const R  = gameState.arena.radius || CFG.ARENA_RADIUS;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#05060e";
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();
  ctx.restore();
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  grad.addColorStop(0,   "#24345f");
  grad.addColorStop(0.6, "#1a2450");
  grad.addColorStop(1,   "#0c1128");
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  for (let r = R * 0.3; r <= R; r += R * 0.3) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(80,80,140,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(231,76,60,0.5)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 6, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(231,76,60,0.2)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.save();
  ctx.strokeStyle = "rgba(80,80,140,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.restore();
  for (const player of gameState.players) {
    drawPlayer(player, cx, cy);
  }
}

function drawPlayer(p, cx, cy) {
  const px = cx + p.x;
  const py = cy + p.y;
  const r  = p.radius;

  if (!p.alive) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = "#6c748a";
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.shadowColor = `${p.color}88`;
  ctx.shadowBlur = 26;

  const bodyGrad = ctx.createRadialGradient(px - r*0.45, py - r*0.55, 1, px, py, r * 1.2);
  bodyGrad.addColorStop(0, lightenColor(p.color, 70));
  bodyGrad.addColorStop(0.7, p.color);
  bodyGrad.addColorStop(1, darkenColor(p.color, 45));

  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.stroke();
  ctx.restore();

  const nx = px + Math.cos(p.angle) * (r - 2);
  const ny = py + Math.sin(p.angle) * (r - 2);
  const tx = px + Math.cos(p.angle + Math.PI * 0.55) * (r * 0.62);
  const ty = py + Math.sin(p.angle + Math.PI * 0.55) * (r * 0.62);
  const bx = px + Math.cos(p.angle - Math.PI * 0.55) * (r * 0.62);
  const by = py + Math.sin(p.angle - Math.PI * 0.55) * (r * 0.62);

  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(tx, ty);
  ctx.lineTo(bx, by);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(nx, ny, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "700 13px 'Inter', 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(244,247,255,0.96)";
  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = 5;
  ctx.fillText(p.name, px, py - r - 8);
  ctx.restore();
}

function lightenColor(hex, amount) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xFF) + amount);
  const b = Math.min(255, (num & 0xFF) + amount);
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex, amount) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xFF) - amount);
  const b = Math.max(0, (num & 0xFF) - amount);
  return `rgb(${r},${g},${b})`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

btnConnect.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = "#e74c3c";
    setTimeout(() => nameInput.style.borderColor = "", 1200);
    return;
  }
  connectWS();
  showScreen("waiting");
});

nameInput.addEventListener("keydown", e => {
  if (e.code === "Enter") btnConnect.click();
});

btnReady.addEventListener("click", () => {
  send({ type: "ready" });
  btnReady.disabled     = true;
  btnReady.textContent  = "⏳  Ожидание второго игрока...";
  btnReady.style.opacity = "0.6";
});

btnPlayAgain.addEventListener("click", () => {
  send({ type: "restart" });
  btnReady.disabled     = false;
  btnReady.textContent  = "✓  Я ГОТОВ";
  btnReady.style.opacity = "1";
});

btnLeave.addEventListener("click", () => {
  if (ws) ws.close();
  location.reload();
});

(function initCanvas() {
  ctx.fillStyle = "#05060e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
})();
