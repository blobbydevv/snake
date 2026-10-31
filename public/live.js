/* Bridges the TikTok room (via server.js) to the game. */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  const canvas = $("game");
  const game = window.createGame(canvas, { cols: 17, rows: 17, cell: 40 });

  /* ------------------------------------------------- settings (persisted) */
  const settings = {
    mode: "vote",            // "vote" = majority per window, "chaos" = last comment wins
    voteWindowMs: 1200,
    autoRestart: true,
    sound: true,
    wrap: false
  };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem("snakelive.settings") || "{}"));
  } catch (e) { /* defaults are fine */ }
  function saveSettings() {
    try { localStorage.setItem("snakelive.settings", JSON.stringify(settings)); } catch (e) {}
  }

  /* --------------------------------------------------------- command parse */
  const WORDS = {
    up: "up", u: "up", w: "up", north: "up", "⬆": "up", "⬆️": "up", "↑": "up", "^": "up",
    down: "down", d2: "down", s: "down", south: "down", "⬇": "down", "⬇️": "down", "↓": "down", v: "down",
    left: "left", l: "left", a: "left", west: "left", "⬅": "left", "⬅️": "left", "←": "left", "<": "left",
    right: "right", r: "right", east: "right", "➡": "right", "➡️": "right", "→": "right", ">": "right"
  };
  // "d" is ambiguous (down in wasd, right in udlr) — wasd wins, since that is what people type
  WORDS.d = "right";

  function parseCommand(text) {
    const clean = String(text).toLowerCase().trim().replace(/[.!?,]+$/g, "");
    if (WORDS[clean]) return WORDS[clean];
    // also catch a command inside a sentence: "go left!!" / "left left left"
    const tokens = clean.split(/[\s,./!]+/).filter(Boolean);
    for (const t of tokens) if (WORDS[t] && t.length > 1) return WORDS[t];
    return null;
  }

  /* ------------------------------------------------------------ scoreboard */
  const players = new Map();  // id -> { name, points, moves }
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
    const top = [...players.entries()]
      .sort((a, b) => b[1].points - a[1].points || b[1].moves - a[1].moves)
      .slice(0, 6);
    const el = $("leaders");
    if (!top.length) {
      el.innerHTML = '<li class="empty">Nobody has steered yet — type <b>up</b>, <b>down</b>, <b>left</b> or <b>right</b> in chat.</li>';
      return;
    }
    el.innerHTML = top.map((entry, i) => {
      const [, p] = entry;
      return '<li><span class="rank">' + (i + 1) + '</span>' +
             '<span class="who">' + escape(p.name) + '</span>' +
             '<span class="pts">' + p.points + '</span></li>';
    }).join("");
  }
  function escape(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ------------------------------------------------------------- event feed */
  function feed(kind, who, text) {
    const el = $("feed");
    const li = document.createElement("li");
    li.className = "ev " + kind;
    li.innerHTML = '<b>' + escape(who) + '</b> ' + escape(text);
    el.appendChild(li);
    while (el.children.length > 7) el.removeChild(el.firstChild);
  }

  /* ----------------------------------------------------------- vote tallies */
  let votes = new Map();      // direction -> Set of user ids
  let voters = new Map();     // userId -> { user, dir }
  let windowEnds = 0;

  function castVote(user, dir) {
    if (settings.mode === "chaos") {
      if (game.setDir(dir, user)) {
        credit(user, 1, 1);
        bumpBar(dir);
      }
      return;
    }
    const prev = voters.get(user.id);
    if (prev) {
      const set = votes.get(prev.dir);
      if (set) set.delete(user.id);
    }
    if (!votes.has(dir)) votes.set(dir, new Set());
    votes.get(dir).add(user.id);
    voters.set(user.id, { user, dir });
    if (!windowEnds) windowEnds = performance.now() + settings.voteWindowMs;
    renderVotes();
  }

  function resolveVotes() {
    if (!votes.size) { windowEnds = 0; return; }
    let bestDir = null, bestCount = 0;
    for (const [dir, set] of votes) {
      if (set.size > bestCount) { bestCount = set.size; bestDir = dir; }
    }
    if (bestDir) {
      const winners = [...votes.get(bestDir)].map(id => voters.get(id).user);
      const leader = winners[0];
      if (game.setDir(bestDir, leader)) {
        for (const w of winners) credit(w, 1, 1);
        bumpBar(bestDir);
      }
    }
    votes = new Map();
    voters = new Map();
    windowEnds = 0;
    renderVotes();
  }

  const BARS = { up: $("bar-up"), down: $("bar-down"), left: $("bar-left"), right: $("bar-right") };
  function renderVotes() {
    const total = [...votes.values()].reduce((n, s) => n + s.size, 0) || 1;
    for (const dir of ["up", "down", "left", "right"]) {
      const n = votes.has(dir) ? votes.get(dir).size : 0;
      const bar = BARS[dir];
      if (!bar) continue;
      bar.style.setProperty("--fill", Math.round(n / total * 100) + "%");
      bar.querySelector(".n").textContent = n;
      bar.classList.toggle("lead", n > 0 && n === Math.max(...["up", "down", "left", "right"]
        .map(d => votes.has(d) ? votes.get(d).size : 0)));
    }
  }
  function bumpBar(dir) {
    const bar = BARS[dir];
    if (!bar) return;
    bar.classList.add("hit");
    setTimeout(() => bar.classList.remove("hit"), 260);
  }

  setInterval(() => {
    if (settings.mode !== "vote") return;
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
  game.on("change", s => {
    $("scoreval").textContent = s.score;
    $("len").textContent = s.length;
    $("speed").textContent = s.level;
    $("combo").textContent = "COMBO ×" + s.combo;
    $("combo").classList.toggle("on", s.combo > 1);
    document.body.classList.toggle("doubling", !!s.doubleActive);
  });

  game.on("eat", e => {
    if (e.kind === "gold" && e.from) credit(e.from, 25, 0);
    if (e.by) credit(e.by, e.points, 0);
  });

  let best = 0;
  try { best = parseInt(localStorage.getItem("snakelive.best") || "0", 10) || 0; } catch (e) {}
  $("best").textContent = best;

  game.on("die", e => {
    if (e.score > best) {
      best = e.score;
      try { localStorage.setItem("snakelive.best", String(best)); } catch (err) {}
      $("best").textContent = best;
      feed("hype", "ROOM", "new record — " + best);
    }
    $("ovtitle").textContent = "Game over";
    $("ovtext").innerHTML = 'Score <span class="big">' + e.score + "</span>length " +
      e.length + " · speed " + e.level;
    $("overlay").hidden = false;

    if (settings.autoRestart) {
      let n = 5;
      $("ovcta").textContent = "Next round in " + n + "…";
      const t = setInterval(() => {
        n--;
        $("ovcta").textContent = n > 0 ? "Next round in " + n + "…" : "Go!";
        if (n <= 0) {
          clearInterval(t);
          votes = new Map(); voters = new Map(); windowEnds = 0; renderVotes();
          $("overlay").hidden = true;
          game.start();
        }
      }, 1000);
    } else {
      $("ovcta").textContent = "Play again";
    }
  });

  /* ----------------------------------------------------------- socket feed */
  let ws = null, retry = 1000;
  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/live");

    ws.onopen = () => { retry = 1000; setStatus("waiting", "Bridge connected"); };
    ws.onclose = () => {
      setStatus("off", "Bridge offline — is server.js running?");
      setTimeout(connect, retry);
      retry = Math.min(15000, retry * 1.6);
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
        if (dir) {
          castVote(msg.user, dir);
          feed("cmd", msg.user.name, "→ " + dir);
          if (game.state !== "playing") game.start();
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

      case "like":
        addHype(msg.count || 1);
        break;

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

  function setStatus(kind, text) {
    const el = $("status");
    el.className = "status " + kind;
    el.querySelector("span").textContent = text;
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
      else { $("overlay").hidden = true; game.start(); }
      return;
    }
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    game.initAudio();
    if (game.state !== "playing") { $("overlay").hidden = true; game.start(); }
    game.setDir(dir, null);
  }, { passive: false });

  $("overlay").addEventListener("click", () => {
    game.initAudio();
    $("overlay").hidden = true;
    game.start();
  });

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

  wireToggle("wrapbtn", "wrap", ["Walls kill", "Walls wrap"], v => game.setWrap(v));
  wireToggle("sfxbtn", "sound", ["Sound off", "Sound on"], v => game.setSound(v));
  wireToggle("autobtn", "autoRestart", ["Manual restart", "Auto restart"], null);

  const modeBtn = $("modebtn");
  function paintMode() {
    const vote = settings.mode === "vote";
    modeBtn.setAttribute("aria-pressed", String(vote));
    modeBtn.lastChild.textContent = vote ? "Chat votes" : "Last comment wins";
    $("votepanel").hidden = !vote;
  }
  modeBtn.addEventListener("click", () => {
    settings.mode = settings.mode === "vote" ? "chaos" : "vote";
    saveSettings();
    votes = new Map(); voters = new Map(); windowEnds = 0;
    renderVotes();
    paintMode();
  });
  paintMode();

  /* OBS overlay mode: ?overlay=1 drops the page background and the side panel */
  if (params.get("overlay") === "1") document.body.classList.add("overlay-mode");
  if (params.get("hidechat") === "1") document.body.classList.add("no-feed");

  window.__snake = game;   // handy in the browser console: __snake.setDir("up")

  renderBoard();
  renderVotes();
  connect();
})();
