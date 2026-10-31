/* Neon Snake — the game itself. Knows nothing about TikTok and nothing about the autopilot. */
(function (global) {
  "use strict";

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const lerp = (a, b, t) => a + (b - a) * t;

  function createGame(canvas, options) {
    const opts = Object.assign(
      { cols: 16, rows: 16, cell: 42, startSpeed: 150, minSpeed: 70, speedStep: 9 },
      options
    );
    const COLS = opts.cols, ROWS = opts.rows, CELL = opts.cell, CAPACITY = COLS * ROWS;
    const ctx = canvas.getContext("2d");
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;

    /* ---- stone floor, painted once ---- */
    const bg = document.createElement("canvas");
    bg.width = canvas.width;
    bg.height = canvas.height;
    (function paintFloor() {
      const c = bg.getContext("2d");
      c.fillStyle = "#2b323c";
      c.fillRect(0, 0, bg.width, bg.height);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const px = x * CELL, py = y * CELL;
          c.fillStyle = (x + y) % 2 ? "#303742" : "#272d36";
          c.fillRect(px, py, CELL, CELL);
          // a shallow bevel on each slab
          c.fillStyle = "rgba(255,255,255,.035)";
          c.fillRect(px + 1, py + 1, CELL - 2, 1.5);
          c.fillStyle = "rgba(0,0,0,.28)";
          c.fillRect(px + 1, py + CELL - 2.5, CELL - 2, 1.5);
        }
      }
      const v = c.createRadialGradient(bg.width / 2, bg.height / 2, bg.height * .3,
                                       bg.width / 2, bg.height / 2, bg.height * .8);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0,.45)");
      c.fillStyle = v;
      c.fillRect(0, 0, bg.width, bg.height);
    })();

    /* ---- sound ---- */
    let actx = null, sfx = true;
    function initAudio() {
      if (actx) return;
      try { actx = new (global.AudioContext || global.webkitAudioContext)(); } catch (e) { actx = null; }
    }
    function beep(freq, dur, type, vol) {
      if (!actx || !sfx) return;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol || .12, actx.currentTime + .012);
      g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + dur + .02);
    }

    /* ---- state ---- */
    let snake, prev, dir, queue, apple, gold, score, level, combo, comboUntil, eaten;
    let state = "ready", stepMs = opts.startSpeed, acc = 0, last = 0;
    let shake = 0, flash = 0, particles = [], pops = [], wrapMode = false;
    let pendingCredit = null, movedBy = null, doubleUntil = 0, autoSpeed = false;
    const listeners = {};

    function emit(name, payload) {
      (listeners[name] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
    }

    function freeCells() {
      const taken = new Set();
      for (const s of snake) taken.add(s.y * COLS + s.x);
      if (apple) taken.add(apple.y * COLS + apple.x);
      if (gold) taken.add(gold.y * COLS + gold.x);
      const out = [];
      for (let i = 0; i < CAPACITY; i++) if (!taken.has(i)) out.push({ x: i % COLS, y: (i / COLS) | 0 });
      return out;
    }
    function placeApple() {
      const f = freeCells();
      apple = f.length ? f[(Math.random() * f.length) | 0] : null;
    }

    function reset(startBody) {
      if (startBody && startBody.length) {
        snake = startBody.map(p => ({ x: p.x, y: p.y }));
      } else {
        const cy = (ROWS / 2) | 0, cx = (COLS / 2) | 0;
        snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
      }
      prev = snake.map(s => ({ x: s.x, y: s.y }));
      dir = "right"; queue = []; gold = null;
      score = 0; level = 1; combo = 1; comboUntil = 0; eaten = 0;
      stepMs = opts.startSpeed; acc = 0; particles = []; pops = [];
      pendingCredit = null; movedBy = null; doubleUntil = 0;
      placeApple();
      emit("change", snapshot());
    }

    function snapshot() {
      return {
        score, level, combo, length: snake ? snake.length : 0, capacity: CAPACITY,
        eaten, state, wrapMode, stepMs, doubleActive: performance.now() < doubleUntil
      };
    }

    function setDir(d, credit) {
      if (!DIRS[d]) return false;
      const cur = queue.length ? queue[queue.length - 1] : dir;
      if (d === cur) return false;
      if (DIRS[d][0] === -DIRS[cur][0] && DIRS[d][1] === -DIRS[cur][1]) return false;
      if (queue.length >= 2) return false;
      queue.push(d);
      if (credit) pendingCredit = credit;
      return true;
    }
    function forceDir(d) {
      if (!DIRS[d]) return false;
      queue = [d];
      return true;
    }

    /* ---- one step ---- */
    function step() {
      emit("beforestep", { cols: COLS, rows: ROWS, snake, apple, gold, dir });

      if (queue.length) {
        dir = queue.shift();
        movedBy = pendingCredit;
        pendingCredit = null;
      }
      prev = snake.map(s => ({ x: s.x, y: s.y }));
      const [dx, dy] = DIRS[dir];
      let hx = snake[0].x + dx, hy = snake[0].y + dy;

      if (wrapMode) {
        hx = (hx + COLS) % COLS;
        hy = (hy + ROWS) % ROWS;
      } else if (hx < 0 || hy < 0 || hx >= COLS || hy >= ROWS) {
        return die("wall");
      }
      if (snake.some((s, i) => i < snake.length - 1 && s.x === hx && s.y === hy)) return die("self");

      snake.unshift({ x: hx, y: hy });
      let grew = false;

      if (apple && hx === apple.x && hy === apple.y) {
        grew = true;
        eaten++;
        const now = performance.now();
        combo = now < comboUntil ? Math.min(9, combo + 1) : 1;
        comboUntil = now + 2600;
        let gain = 10 * combo;
        if (now < doubleUntil) gain *= 2;
        score += gain;
        burst(hx, hy, "#ff4d4d", 16);
        pops.push({ x: hx, y: hy, text: "+" + gain, life: 1, color: combo > 1 ? "#ffc63d" : "#ffffff" });
        shake = Math.min(8, 3 + combo);
        flash = .22;
        beep(520 + combo * 70, .11, "triangle", .13);
        setTimeout(() => beep(780 + combo * 80, .09, "sine", .09), 65);
        placeApple();
        if (autoSpeed && eaten % 5 === 0) {
          level++;
          stepMs = Math.max(opts.minSpeed, stepMs - opts.speedStep);
          pops.push({ x: hx, y: Math.max(0, hy - 1), text: "SPEED UP", life: 1.3, color: "#ffc63d" });
          beep(300, .2, "sawtooth", .07);
        }
        emit("eat", { points: gain, by: movedBy, combo, kind: "apple" });
        if (snake.length >= CAPACITY) return won();
      }

      if (gold && hx === gold.x && hy === gold.y) {
        grew = true;
        const gain = performance.now() < doubleUntil ? 100 : 50;
        score += gain;
        burst(hx, hy, "#ffc63d", 26);
        pops.push({ x: hx, y: hy, text: "+" + gain, life: 1.3, color: "#ffc63d" });
        shake = 10; flash = .4;
        const from = gold.from;
        gold = null;
        beep(660, .1, "square", .11);
        setTimeout(() => beep(990, .15, "square", .09), 85);
        emit("eat", { points: gain, by: movedBy, combo, kind: "gold", from });
        if (snake.length >= CAPACITY) return won();
      }

      if (!grew) snake.pop();
      if (performance.now() > comboUntil) combo = 1;
      emit("change", snapshot());
    }

    function won() {
      state = "won";
      flash = .9;
      for (let i = 0; i < 10; i++) {
        const s = snake[(Math.random() * snake.length) | 0];
        burst(s.x, s.y, "#ffc63d", 8);
      }
      [0, 120, 240, 420].forEach((d, i) => setTimeout(() => beep(523 * Math.pow(1.26, i), .18, "triangle", .12), d));
      emit("change", snapshot());
      emit("win", { score, length: snake.length, eaten, capacity: CAPACITY });
    }

    function die(cause) {
      state = "over";
      shake = 16; flash = .6;
      beep(200, .3, "sawtooth", .11);
      setTimeout(() => beep(120, .45, "sawtooth", .09), 110);
      for (const s of snake) burst(s.x, s.y, "#e8a45c", 2);
      emit("change", snapshot());
      emit("die", { cause, score, length: snake.length, eaten, level });
    }

    function burst(cx, cy, color, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1.4 + Math.random() * 4.2;
        particles.push({
          x: (cx + .5) * CELL, y: (cy + .5) * CELL,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
          life: 1, size: 2 + Math.random() * 3.2, color
        });
      }
    }

    /* ---------------------------------------------------------- drawing ---- */

    function snakePoints(t) {
      const pts = [];
      for (let i = 0; i < snake.length; i++) {
        const a = prev[Math.min(i, prev.length - 1)] || snake[i];
        const b = snake[i];
        const far = Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1;
        const tt = far ? 1 : t;
        pts.push({ x: (lerp(a.x, b.x, tt) + .5) * CELL, y: (lerp(a.y, b.y, tt) + .5) * CELL });
      }
      return pts;
    }
    function tracePath(pts) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    }

    /* Timber-coloured body: dark outline, warm fill, highlight along the top. */
    function drawBody(pts) {
      if (pts.length < 2) return;
      const w = CELL * .82;
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.lineWidth = w + 7;
      tracePath(pts); ctx.stroke();

      ctx.strokeStyle = "#5a3115";
      ctx.lineWidth = w;
      tracePath(pts); ctx.stroke();

      const fill = ctx.createLinearGradient(0, 0, 0, canvas.height);
      fill.addColorStop(0, "#f0b574");
      fill.addColorStop(.5, "#e3a25f");
      fill.addColorStop(1, "#c8813d");
      ctx.strokeStyle = fill;
      ctx.lineWidth = w - 7;
      tracePath(pts); ctx.stroke();

      ctx.strokeStyle = "rgba(255,240,215,.45)";
      ctx.lineWidth = w * .2;
      tracePath(pts.map(p => ({ x: p.x, y: p.y - w * .2 })));
      ctx.stroke();
      ctx.restore();
    }

    /* The oversized cartoon head, always upright. */
    function drawHead(head, time) {
      const r = CELL * .62;
      const bob = Math.sin(time / 220) * 1.2;
      ctx.save();
      ctx.translate(head.x, head.y + bob);

      ctx.fillStyle = "rgba(0,0,0,.4)";
      ctx.beginPath(); ctx.ellipse(0, r * .82, r * .78, r * .3, 0, 0, 7); ctx.fill();

      const skin = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r);
      skin.addColorStop(0, "#fff6e6");
      skin.addColorStop(.7, "#f3dec0");
      skin.addColorStop(1, "#d9bd96");
      ctx.fillStyle = skin;
      ctx.strokeStyle = "#4a2d12";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();

      // eyes — they lean the way the snake is heading
      const [dx, dy] = DIRS[dir];
      const gx = dx * r * .12, gy = dy * r * .12;
      for (const sgn of [-1, 1]) {
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#3b2208";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(sgn * r * .36, -r * .18, r * .27, r * .33, 0, 0, 7);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#231405";
        ctx.beginPath(); ctx.arc(sgn * r * .36 + gx, -r * .18 + gy, r * .13, 0, 7); ctx.fill();
      }

      // open mouth
      ctx.fillStyle = "#4a1510";
      ctx.strokeStyle = "#3b2208";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, r * .42, r * .3, r * .24, 0, 0, 7);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ff7a85";
      ctx.beginPath(); ctx.ellipse(0, r * .5, r * .16, r * .1, 0, 0, 7); ctx.fill();
      ctx.restore();
    }

    function drawCherries(a, time) {
      const pulse = 1 + Math.sin(time / 260) * .06;
      ctx.save();
      ctx.translate((a.x + .5) * CELL, (a.y + .5) * CELL);
      ctx.scale(pulse, pulse);
      ctx.strokeStyle = "#5f9d3f";
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-5, -4); ctx.quadraticCurveTo(0, -15, 7, -6);
      ctx.stroke();
      for (const ox of [-6, 6]) {
        const g = ctx.createRadialGradient(ox - 2.5, -1, 1, ox, 2, 9);
        g.addColorStop(0, "#ff8a8a");
        g.addColorStop(.55, "#e0303a");
        g.addColorStop(1, "#901a22");
        ctx.fillStyle = g;
        ctx.strokeStyle = "#5c1016";
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(ox, 3, 7, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.7)";
        ctx.beginPath(); ctx.ellipse(ox - 2.4, .4, 1.5, 2.1, -.5, 0, 7); ctx.fill();
      }
      ctx.restore();
    }

    function drawGold(time) {
      if (!gold) return;
      if (gold.until && gold.until - time <= 0) { gold = null; return; }
      if (gold.until && gold.until - time < 2000 && Math.floor(time / 140) % 2) return;
      ctx.save();
      ctx.translate((gold.x + .5) * CELL, (gold.y + .5) * CELL);
      ctx.rotate(Math.sin(time / 420) * .2);
      ctx.shadowColor = "rgba(255,198,61,.9)";
      ctx.shadowBlur = 24;
      const g = ctx.createRadialGradient(-4, -5, 1, 0, 0, 14);
      g.addColorStop(0, "#fff7d2");
      g.addColorStop(.55, "#ffc63d");
      g.addColorStop(1, "#c98100");
      ctx.fillStyle = g;
      ctx.strokeStyle = "#6b4400";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 1, 11.5, 0, 7); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.beginPath(); ctx.arc(-3.6, -3.6, 2.6, 0, 7); ctx.fill();
      ctx.restore();
    }

    function draw(time, t) {
      ctx.save();
      if (shake > .2) {
        ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
        shake *= .86;
      }
      ctx.drawImage(bg, 0, 0);
      if (apple) drawCherries(apple, time);
      drawGold(time);

      const pts = snakePoints(t);
      drawBody(pts);
      drawHead(pts[0], time);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += .22; p.vx *= .98; p.life -= .026;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.textAlign = "center";
      ctx.font = "19px 'Bungee', system-ui, sans-serif";
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.life -= .018;
        if (p.life <= 0) { pops.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, p.life * 1.6);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = "rgba(0,0,0,.6)";
        ctx.lineWidth = 4;
        const tx = (p.x + .5) * CELL, ty = (p.y + .4) * CELL - (1 - p.life) * 34;
        ctx.strokeText(p.text, tx, ty);
        ctx.fillText(p.text, tx, ty);
      }
      ctx.globalAlpha = 1;

      if (flash > .01) {
        ctx.fillStyle = "rgba(255,240,210," + (flash * .3) + ")";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        flash *= .85;
      }
      ctx.restore();
    }

    function frame(now) {
      const dt = Math.min(64, now - last);
      last = now;
      if (state === "playing") {
        acc += dt;
        while (acc >= stepMs && state === "playing") { acc -= stepMs; step(); }
      }
      draw(now, state === "playing" ? Math.min(1, acc / stepMs) : 1);
      requestAnimationFrame(frame);
    }

    /* ---- public api ---- */
    const api = {
      start(startBody) {
        if (state === "playing") return;
        if (state === "paused") { state = "playing"; emit("change", snapshot()); return; }
        reset(startBody);
        state = "playing";
        initAudio();
        beep(440, .08, "triangle", .1);
        setTimeout(() => beep(660, .12, "triangle", .1), 85);
        emit("change", snapshot());
        emit("start", {});
      },
      pause() { if (state === "playing") { state = "paused"; emit("change", snapshot()); } },
      setDir,
      forceDir,
      initAudio,
      dropGold(from, ttlMs) {
        if (gold || !snake) return false;
        const f = freeCells();
        if (!f.length) return false;
        gold = f[(Math.random() * f.length) | 0];
        gold.until = performance.now() + (ttlMs || 9000);
        gold.from = from || null;
        burst(gold.x, gold.y, "#ffc63d", 10);
        return true;
      },
      boostDouble(ms) {
        doubleUntil = Math.max(doubleUntil, performance.now()) + (ms || 15000);
        emit("change", snapshot());
      },
      setStepMs(ms) { stepMs = Math.max(20, Math.min(400, ms)); emit("change", snapshot()); },
      setAutoSpeed(on) { autoSpeed = !!on; },
      setWrap(on) { wrapMode = !!on; emit("change", snapshot()); },
      setSound(on) { sfx = !!on; if (on) initAudio(); },
      get state() { return state; },
      get stats() { return snapshot(); },
      get board() { return { cols: COLS, rows: ROWS, cell: CELL, capacity: CAPACITY }; },
      on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return api; }
    };

    reset();
    state = "ready";
    last = performance.now();
    requestAnimationFrame(frame);
    return api;
  }

  global.createGame = createGame;
})(window);
