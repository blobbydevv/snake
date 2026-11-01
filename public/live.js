/* Wires the autopilot, the TikTok room (via server.js) and the page together. */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  const canvas = $("game");
  const game = window.createGame(canvas, { cols: 16, rows: 16, cell: 42 });
  const board = game.board;
  const cycle = window.SnakeAI.buildCycle(board.cols, board.rows);

  /* ------------------------------------------------- settings (persisted) */
  const SPEEDS = { chill: 120, normal: 75, turbo: 48, hyper: 32 };
  const settings = {
    autopilot: true,
    speed: "normal",
    shortcuts: true,
    wiggle: true,
    mode: "vote",            // "vote" = majority per window, "chaos" = last comment wins
    voteWindowMs: 1200,
    autoRestart: true,
    sound: true
  };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem("snakelive.settings") || "{}"));
  } catch (e) { /* defaults are fine */ }
  if (params.get("afk") === "1") settings.autopilot = true;
  if (params.get("speed") && SPEEDS[params.get("speed")]) settings.speed = params.get("speed");
  function saveSettings() {
    try { localStorage.setItem("snakelive.settings", JSON.stringify(settings)); } catch (e) {}
  }

  /* ------------------------------------------------------------- autopilot */
  game.on("beforestep", s => {
    if (!settings.autopilot) return;
    const dir = window.SnakeAI.nextMove(s, cycle, {
      shortcuts: settings.shortcuts,
      shortcutLimit: 0.5
    });
    if (dir) game.forceDir(dir);
  });

  function startRound() {
    $("overlay").hidden = true;
    votes = new Map(); voters = new Map(); windowEnds = 0; renderVotes();
    roundStarted = Date.now();
    // the autopilot's guarantee depends on starting on the cycle
    game.start(settings.autopilot ? window.SnakeAI.startingSnake(cycle, 3) : null);
    game.setStepMs(SPEEDS[settings.speed]);
    game.setAutoSpeed(!settings.autopilot);   // no mid-run speed ramp while the autopilot drives
  }

  /* ------------------------------------------------------------- scoreboard */
  const players = new Map();
  function credit(user, points, moves) {
    if (!user || !user.id) return;
    const p = players.get(user.id) || { name: user.name || user.handle || "someone", points: 0, moves: 0 };
    p.name = user.name || p.name;
    p.points += points || 0;
    p.moves += moves || 0;
    players.set(user.id, p);
    renderBoard();
  }
  function renderBoard() {
    const top = [...players.values()]
      .sort((a, b) => b.points - a.points || b.moves - a.moves)
      .slice(0, 6);
    const el = $("leaders");
    if (!top.length) {
      el.innerHTML = settings.autopilot
        ? '<li class="empty">Gifts, follows and likes land here while the autopilot drives.</li>'
        : '<li class="empty">Nobody has steered yet — type <b>up</b>, <b>down</b>, <b>left</b> or <b>right</b> in chat.</li>';
      return;
    }
    el.innerHTML = top.map((p, i) =>
      '<li><span class="rank">' + (i + 1) + '</span>' +
      '<span class="who">' + esc(p.name) + '</span>' +
      '<span class="pts">' + p.points + '</span></li>').join("");
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function feed(kind, who, text) {
    const el = $("feed");
    const li = document.createElement("li");
    li.className = "ev " + kind;
    li.innerHTML = "<b>" + esc(who) + "</b> " + esc(text);
    el.appendChild(li);
    while (el.children.length > 7) el.removeChild(el.firstChild);
  }

  /* ----------------------------------------------------------- vote tallies */
  let votes = new Map(), voters = new Map(), windowEnds = 0;

  function castVote(user, dir) {
    if (settings.autopilot) return;           // the autopilot is driving; chat cheers instead
    if (settings.mode === "chaos") {
      if (game.setDir(dir, user)) { credit(user, 1, 1); bumpBar(dir); }
      return;
    }
    const prev = voters.get(user.id);
    if (prev) { const set = votes.get(prev.dir); if (set) set.delete(user.id); }
    if (!votes.has(dir)) votes.set(dir, new Set());
    votes.get(dir).add(user.id);
    voters.set(user.id, { user, dir });
    if (!windowEnds) windowEnds = performance.now() + settings.voteWindowMs;
    renderVotes();
  }
  function resolveVotes() {
    if (!votes.size) { windowEnds = 0; return; }
    let bestDir = null, bestCount = 0;
    for (const [dir, set] of votes) if (set.size > bestCount) { bestCount = set.size; bestDir = dir; }
    if (bestDir) {
      const winners = [...votes.get(bestDir)].map(id => voters.get(id).user);
      if (game.setDir(bestDir, winners[0])) {
        for (const w of winners) credit(w, 1, 1);
        bumpBar(bestDir);
      }
    }
    votes = new Map(); voters = new Map(); windowEnds = 0;
    renderVotes();
  }

  const BARS = { up: $("bar-up"), down: $("bar-down"), left: $("bar-left"), right: $("bar-right") };
  function renderVotes() {
    const total = [...votes.values()].reduce((n, s) => n + s.size, 0) || 1;
    const counts = ["up", "down", "left", "right"].map(d => votes.has(d) ? votes.get(d).size : 0);
    const peak = Math.max.apply(null, counts);
    ["up", "down", "left", "right"].forEach((dir, i) => {
      const bar = BARS[dir];
      if (!bar) return;
      bar.style.setProperty("--fill", Math.round(counts[i] / total * 100) + "%");
      bar.querySelector(".n").textContent = counts[i];
      bar.classList.toggle("lead", counts[i] > 0 && counts[i] === peak);
    });
  }
  function bumpBar(dir) {
    const bar = BARS[dir];
    if (!bar) return;
    bar.classList.add("hit");
    setTimeout(() => bar.classList.remove("hit"), 260);
  }
  setInterval(() => {
    if (settings.autopilot || settings.mode !== "vote") return;
    if (windowEnds && performance.now() >= windowEnds) resolveVotes();
    const left = windowEnds ? Math.max(0, windowEnds - performance.now()) : 0;
    $("votetimer").style.width = (left / settings.voteWindowMs * 100) + "%";
  }, 60);

  /* --------------------------------------------------------- hype (likes) */
  let hype = 0;
  function addHype(n) {
    hype += n;
    if (hype >= 150) {
      hype = 0;
      game.boostDouble(15000);
      feed("hype", "CHAT", "hit the like goal — double points for 15s");
    }
    $("hypebar").style.width = Math.min(100, hype / 150 * 100) + "%";
  }

  /* ------------------------------------------------------------ game events */
  let roundStarted = Date.now();

  game.on("change", s => {
    $("scoreval").textContent = s.score.toLocaleString();
    $("len").textContent = s.length;
    $("cap").textContent = s.capacity;
    $("cap2").textContent = s.capacity;
    $("speedval").textContent = Math.round(1000 / s.stepMs) + "/s";
    $("combo").textContent = "COMBO ×" + s.combo;
    $("combo").classList.toggle("on", s.combo > 1);
    const pct = s.length / s.capacity * 100;
    $("fillbar").style.width = pct + "%";
    $("fillpct").textContent = Math.round(pct) + "%";
    document.body.classList.toggle("doubling", !!s.doubleActive);
  });

  game.on("eat", e => {
    if (e.kind === "gold" && e.from) credit(e.from, 25, 0);
    if (e.by) credit(e.by, e.points, 0);
  });

  let best = 0;
  try { best = parseInt(localStorage.getItem("snakelive.best") || "0", 10) || 0; } catch (e) {}
  $("best").textContent = best.toLocaleString();

  function recordBest(score) {
    if (score <= best) return;
    best = score;
    try { localStorage.setItem("snakelive.best", String(best)); } catch (e) {}
    $("best").textContent = best.toLocaleString();
  }

  function clock(ms) {
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
  }

  let wins = 0;
  try { wins = parseInt(localStorage.getItem("snakelive.wins") || "0", 10) || 0; } catch (e) {}
  $("wins").textContent = wins;

  game.on("win", e => {
    wins++;
    try { localStorage.setItem("snakelive.wins", String(wins)); } catch (err) {}
    $("wins").textContent = wins;
    recordBest(e.score);
    const took = clock(Date.now() - roundStarted);
    document.body.classList.add("perfect");
    $("ovtitle").textContent = "Board cleared";
    $("ovtext").innerHTML = 'All <span class="big">' + e.capacity + "</span>squares filled in " + took +
      " · score " + e.score.toLocaleString();
    $("overlay").hidden = false;
    feed("hype", "RUN", "perfect clear — " + e.capacity + " squares in " + took);
    countdown(8);
  });

  game.on("die", e => {
    recordBest(e.score);
    document.body.classList.remove("perfect");
    $("ovtitle").textContent = "Game over";
    $("ovtext").innerHTML = 'Score <span class="big">' + e.score.toLocaleString() + "</span>length " +
      e.length + " of " + board.capacity;
    $("overlay").hidden = false;
    if (settings.autopilot) {
      // should not happen: the cycle makes collisions impossible from a clean start
      feed("hype", "RUN", "autopilot ended a round on " + e.cause + " — please report this");
      console.warn("Autopilot died:", e);
    }
    countdown(settings.autopilot ? 5 : 5);
  });

  function countdown(seconds) {
    if (!settings.autoRestart) { $("ovcta").textContent = "Play again"; return; }
    let n = seconds;
    $("ovcta").textContent = "Next round in " + n + "…";
    const t = setInterval(() => {
      n--;
      $("ovcta").textContent = n > 0 ? "Next round in " + n + "…" : "Go!";
      if (n <= 0) {
        clearInterval(t);
        document.body.classList.remove("perfect");
        startRound();
      }
    }, 1000);
  }

  setInterval(() => {
    if (game.state !== "playing") return;
    $("elapsed").textContent = clock(Date.now() - roundStarted);
  }, 1000);

  /* ----------------------------------------------------------- socket feed */
  let ws = null, retry = 1000, everConnected = false;
  function connect() {
    // Opened as a plain file or from somewhere that is not the bridge? Then this is
    // just the game: hide the room panels and stop making noise about it.
    let socket;
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(proto + "//" + location.host + "/live");
    } catch (e) {
      goLocal();
      return;
    }
    ws = socket;
    ws.onopen = () => { retry = 1000; everConnected = true; document.body.classList.remove("local"); setStatus("waiting", "Bridge connected"); };
    ws.onclose = () => {
      if (!everConnected) goLocal();
      else setStatus("off", "Bridge offline — is server.js running?");
      setTimeout(connect, retry);
      retry = Math.min(30000, retry * 1.8);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    };
  }

  function handle(msg) {
    switch (msg.type) {
      case "status":
        if (msg.connected) setStatus("live", "@" + msg.username + " · " + (msg.viewers || 0) + " watching");
        else setStatus("off", msg.error || "Not connected to a room");
        break;
      case "chat": {
        const dir = parseCommand(msg.text);
        if (dir && !settings.autopilot) {
          castVote(msg.user, dir);
          feed("cmd", msg.user.name, "→ " + dir);
          if (game.state !== "playing") startRound();
        } else {
          feed("chat", msg.user.name, msg.text.slice(0, 60));
        }
        break;
      }
      case "gift": {
        const dropped = game.dropGold(msg.user, 10000);
        credit(msg.user, 20 * (msg.count || 1), 0);
        feed("gift", msg.user.name, "sent " + msg.gift + " ×" + msg.count +
          (dropped ? " — gold apple dropped" : ""));
        addHype(30);
        break;
      }
      case "like": addHype(msg.count || 1); break;
      case "follow":
        credit(msg.user, 15, 0);
        feed("follow", msg.user.name, "followed");
        addHype(15);
        break;
      case "share":
        credit(msg.user, 10, 0);
        feed("follow", msg.user.name, "shared the stream");
        addHype(10);
        break;
    }
  }

  function goLocal() {
    document.body.classList.add("local");
    setStatus("off", "Running on its own — no room connected");
  }

  function setStatus(kind, text) {
    const el = $("status");
    el.className = "status " + kind;
    el.querySelector("span").textContent = text;
  }

  /* --------------------------------------------------------- chat commands */
  const WORDS = {
    up: "up", u: "up", w: "up", north: "up", "⬆": "up", "⬆️": "up", "↑": "up", "^": "up",
    down: "down", s: "down", south: "down", "⬇": "down", "⬇️": "down", "↓": "down", v: "down",
    left: "left", l: "left", a: "left", west: "left", "⬅": "left", "⬅️": "left", "←": "left", "<": "left",
    right: "right", r: "right", d: "right", east: "right", "➡": "right", "➡️": "right", "→": "right", ">": "right"
  };
  function parseCommand(text) {
    const clean = String(text).toLowerCase().trim().replace(/[.!?,]+$/g, "");
    if (WORDS[clean]) return WORDS[clean];
    const tokens = clean.split(/[\s,./!]+/).filter(Boolean);
    for (const t of tokens) if (WORDS[t] && t.length > 1) return WORDS[t];
    return null;
  }

  /* -------------------------------------------------------------- controls */
  const KEYS = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right"
  };
  addEventListener("keydown", e => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      game.initAudio();
      if (game.state === "playing") { game.pause(); $("overlay").hidden = false; }
      else startRound();
      return;
    }
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    game.initAudio();
    if (settings.autopilot) return;   // keys do nothing while the autopilot drives
    if (game.state !== "playing") startRound();
    game.setDir(dir, null);
  }, { passive: false });

  $("overlay").addEventListener("click", () => { game.initAudio(); startRound(); });

  function wireToggle(id, key, labels, onChange) {
    const btn = $(id);
    if (!btn) return;
    const paint = () => {
      const on = !!settings[key];
      btn.setAttribute("aria-pressed", String(on));
      btn.lastChild.textContent = on ? labels[1] : labels[0];
    };
    btn.addEventListener("click", () => {
      settings[key] = !settings[key];
      saveSettings();
      paint();
      if (onChange) onChange(settings[key]);
    });
    paint();
    if (onChange) onChange(settings[key]);
  }

  wireToggle("sfxbtn", "sound", ["Sound off", "Sound on"], v => game.setSound(v));
  wireToggle("wigglebtn", "wiggle", ["Shiver off", "Shiver on"], v => game.setWiggle(v));
  wireToggle("autobtn", "autoRestart", ["Manual restart", "Auto restart"], null);
  wireToggle("shortbtn", "shortcuts", ["Pure loop", "Loop + shortcuts"], null);

  const aiBtn = $("aibtn");
  function paintAi() {
    const on = settings.autopilot;
    aiBtn.setAttribute("aria-pressed", String(on));
    aiBtn.lastChild.textContent = on ? "Autopilot on" : "Chat drives";
    document.body.classList.toggle("afk", on);
    $("votepanel").hidden = on;
    $("leadertitle").textContent = on ? "Top supporters" : "Top drivers";
    renderBoard();
  }
  aiBtn.addEventListener("click", () => {
    settings.autopilot = !settings.autopilot;
    saveSettings();
    paintAi();
    // the guarantee only holds from a clean start on the loop, so begin a fresh round
    startRound();
  });
  paintAi();

  const modeBtn = $("modebtn");
  function paintMode() {
    const vote = settings.mode === "vote";
    modeBtn.setAttribute("aria-pressed", String(vote));
    modeBtn.lastChild.textContent = vote ? "Chat votes" : "Last comment wins";
  }
  modeBtn.addEventListener("click", () => {
    settings.mode = settings.mode === "vote" ? "chaos" : "vote";
    saveSettings();
    votes = new Map(); voters = new Map(); windowEnds = 0;
    renderVotes();
    paintMode();
  });
  paintMode();

  document.querySelectorAll("[data-speed]").forEach(btn => {
    btn.addEventListener("click", () => {
      settings.speed = btn.dataset.speed;
      saveSettings();
      game.setStepMs(SPEEDS[settings.speed]);
      paintSpeeds();
    });
  });
  function paintSpeeds() {
    document.querySelectorAll("[data-speed]").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.speed === settings.speed)));
  }
  paintSpeeds();

  if (params.get("overlay") === "1") document.body.classList.add("overlay-mode");
  if (params.get("hidechat") === "1") document.body.classList.add("no-feed");

  window.__snake = game;      // console: __snake.setDir("up"), __snake.dropGold()
  window.__cycle = cycle;

  renderBoard();
  renderVotes();
  connect();
  startRound();               // AFK streams should never need a click to begin
})();
