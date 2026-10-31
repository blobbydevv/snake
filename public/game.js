/* Neon Snake — the game itself. Knows nothing about TikTok. */
(function (global) {
  "use strict";

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const lerp = (a, b, t) => a + (b - a) * t;

  function createGame(canvas, options) {
    const opts = Object.assign({ cols: 17, rows: 17, cell: 40, startSpeed: 150, minSpeed: 72 }, options);
    const COLS = opts.cols, ROWS = opts.rows, CELL = opts.cell;
    const ctx = canvas.getContext("2d");
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;

    /* ---- static board ---- */
    const bg = document.createElement("canvas");
    bg.width = canvas.width;
    bg.height = canvas.height;
    (function paintBoard() {
      const c = bg.getContext("2d");
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          c.fillStyle = (x + y) % 2 ? "#13242a" : "#0f1d22";
          c.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
      c.strokeStyle = "rgba(255,255,255,.028)";
      c.lineWidth = 1;
      for (let i = 1; i < Math.max(COLS, ROWS); i++) {
        c.beginPath(); c.moveTo(i * CELL + .5, 0); c.lineTo(i * CELL + .5, bg.height); c.stroke();
        c.beginPath(); c.moveTo(0, i * CELL + .5); c.lineTo(bg.width, i * CELL + .5); c.stroke();
      }
      const v = c.createRadialGradient(bg.width / 2, bg.height / 2, bg.height * .28,
                                       bg.width / 2, bg.height / 2, bg.height * .8);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0,.5)");
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
    let pendingCredit = null, movedBy = null, doubleUntil = 0;
    const listeners = {};

    function emit(name, payload) {
      (listeners[name] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
    }

    function freeCells() {
      const out = [];
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (snake.some(s => s.x === x && s.y === y)) continue;
          if (apple && apple.x === x && apple.y === y) continue;
          if (gold && gold.x === x && gold.y === y) continue;
          out.push({ x, y });
        }
      }
      return out;
    }
    function placeApple() {
      const f = freeCells();
      apple = f.length ? f[(Math.random() * f.length) | 0] : null;
    }

    function reset() {
      snake = [{ x: (COLS / 2) | 0, y: (ROWS / 2) | 0 }];
      snake.push({ x: snake[0].x - 1, y: snake[0].y }, { x: snake[0].x - 2, y: snake[0].y });
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
        score, level, combo, length: snake ? snake.length : 0,
        eaten, state, wrapMode, doubleActive: performance.now() < doubleUntil
      };
    }

    /* ---- controls ---- */
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

    /* ---- one step ---- */
    function step() {
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
        burst(hx, hy, "#ff3b5c", 18);
        pops.push({ x: hx, y: hy, text: "+" + gain, life: 1, color: combo > 1 ? "#ffc63d" : "#ffffff" });
        shake = Math.min(9, 4 + combo);
        flash = .3;
        beep(520 + combo * 70, .11, "triangle", .13);
        setTimeout(() => beep(780 + combo * 80, .09, "sine", .09), 65);
        placeApple();
        if (eaten % 5 === 0) {
          level++;
          stepMs = Math.max(opts.minSpeed, stepMs - 9);
          pops.push({ x: hx, y: Math.max(0, hy - 1), text: "SPEED UP", life: 1.3, color: "#4ff0a8" });
          beep(300, .2, "sawtooth", .07);
        }
        emit("eat", { points: gain, by: movedBy, combo, kind: "apple" });
      }

      if (gold && hx === gold.x && hy === gold.y) {
        grew = true;
        const gain = performance.now() < doubleUntil ? 100 : 50;
        score += gain;
        burst(hx, hy, "#ffc63d", 28);
        pops.push({ x: hx, y: hy, text: "+" + gain, life: 1.3, color: "#ffc63d" });
        shake = 11; flash = .5;
        const from = gold.from;
        gold = null;
        beep(660, .1, "square", .11);
        setTimeout(() => beep(990, .15, "square", .09), 85);
        emit("eat", { points: gain, by: movedBy, combo, kind: "gold", from });
      }

      if (!grew) snake.pop();
      if (performance.now() > comboUntil) combo = 1;
      emit("change", snapshot());
    }

    function die(cause) {
      state = "over";
      shake = 16; flash = .65;
      beep(200, .3, "sawtooth", .11);
      setTimeout(() => beep(120, .45, "sawtooth", .09), 110);
      for (const s of snake) burst(s.x, s.y, "#4ff0a8", 3);
      emit("change", snapshot());
      emit("die", { cause, score, length: snake.length, eaten, level });
    }

    /* ---- effects ---- */
    function burst(cx, cy, color, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1.4 + Math.random() * 4.4;
        particles.push({
          x: (cx + .5) * CELL, y: (cy + .5) * CELL,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
          life: 1, size: 2 + Math.random() * 3.4, color
        });
      }
    }

    /* ---- drawing ---- */
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
    function strokePath(pts, width, style, glow) {
      if (pts.length < 2) return;
      ctx.save();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.lineWidth = width; ctx.strokeStyle = style;
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 22; }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.restore();
    }
    function drawApple(a, time) {
      const pulse = 1 + Math.sin(time / 250) * .07;
      ctx.save();
      ctx.translate((a.x + .5) * CELL, (a.y + .5) * CELL);
      ctx.scale(pulse, pulse);
      ctx.shadowColor = "rgba(255,59,92,.95)"; ctx.shadowBlur = 18;
      const g = ctx.createRadialGradient(-4, -5, 1, 0, 1, 12);
      g.addColorStop(0, "#ff9fb0"); g.addColorStop(.5, "#ff3b5c"); g.addColorStop(1, "#b5102f");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 1, 11, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#6fd37e"; ctx.lineWidth = 2.6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.quadraticCurveTo(5, -15, 12, -14); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.beginPath(); ctx.ellipse(-4, -4, 2.6, 3.4, -.5, 0, 7); ctx.fill();
      ctx.restore();
    }
    function drawGold(time) {
      if (!gold) return;
      if (gold.until && gold.until - time <= 0) { gold = null; return; }
      if (gold.until && gold.until - time < 2000 && Math.floor(time / 140) % 2) return;
      ctx.save();
      ctx.translate((gold.x + .5) * CELL, (gold.y + .5) * CELL);
      ctx.rotate(Math.sin(time / 420) * .22);
      ctx.shadowColor = "rgba(255,198,61,.95)"; ctx.shadowBlur = 28;
      const g = ctx.createRadialGradient(-4, -5, 1, 0, 0, 14);
      g.addColorStop(0, "#fff7d2"); g.addColorStop(.55, "#ffc63d"); g.addColorStop(1, "#cf8900");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 1, 11.5, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.beginPath(); ctx.arc(-3.6, -3.6, 2.7, 0, 7); ctx.fill();
      ctx.restore();
    }
    function drawSnake(t, time) {
      const pts = snakePoints(t);
      const head = pts[0], tail = pts[pts.length - 1];
      const w = CELL * .76;
      const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      g.addColorStop(0, "#1a9ad6"); g.addColorStop(.5, "#21c8ff"); g.addColorStop(1, "#4ff0a8");

      strokePath(pts, w + 7, "rgba(0,0,0,.45)");
      strokePath(pts, w, g, "rgba(79,240,168,.75)");
      ctx.save(); ctx.globalAlpha = .33;
      strokePath(pts.map(p => ({ x: p.x, y: p.y - w * .18 })), w * .28, "rgba(255,255,255,.95)");
      ctx.restore();
      ctx.save(); ctx.globalAlpha = .16; ctx.fillStyle = "#042019";
      for (let i = 1; i < pts.length; i++) {
        ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, w * .21, 0, 7); ctx.fill();
      }
      ctx.restore();

      const [dx, dy] = DIRS[dir];
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.shadowColor = "rgba(79,240,168,.9)"; ctx.shadowBlur = 24;
      ctx.fillStyle = "#6bffc0";
      ctx.beginPath(); ctx.arc(0, 0, w * .52, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      const ex = dy ? w * .23 : dx * w * .16, ey = dx ? w * .23 : dy * w * .16;
      for (const sgn of [1, -1]) {
        const px = dy ? ex * sgn : ex, py = dx ? ey * sgn : ey;
        ctx.fillStyle = "#06211a"; ctx.beginPath(); ctx.arc(px, py, w * .155, 0, 7); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(px + dx * 2, py + dy * 2, w * .075, 0, 7); ctx.fill();
      }
      if (Math.floor(time / 420) % 4 === 0) {
        ctx.strokeStyle = "#ff3b5c"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(dx * w * .5, dy * w * .5);
        ctx.lineTo(dx * w * .98, dy * w * .98);
        ctx.stroke();
      }
      ctx.restore();
    }

    function draw(time, t) {
      ctx.save();
      if (shake > .2) {
        ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
        shake *= .86;
      }
      ctx.drawImage(bg, 0, 0);
      if (apple) drawApple(apple, time);
      drawGold(time);
      drawSnake(t, time);

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
      ctx.font = "20px 'Bungee', system-ui, sans-serif";
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.life -= .018;
        if (p.life <= 0) { pops.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, p.life * 1.6);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 14;
        ctx.fillText(p.text, (p.x + .5) * CELL, (p.y + .4) * CELL - (1 - p.life) * 34);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      if (flash > .01) {
        ctx.fillStyle = "rgba(255,255,255," + (flash * .32) + ")";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        flash *= .82;
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
      start() {
        if (state === "playing") return;
        if (state === "paused") { state = "playing"; emit("change", snapshot()); return; }
        reset();
        state = "playing";
        initAudio();
        beep(440, .08, "triangle", .1);
        setTimeout(() => beep(660, .12, "triangle", .1), 85);
        emit("change", snapshot());
        emit("start", {});
      },
      pause() {
        if (state !== "playing") return;
        state = "paused";
        emit("change", snapshot());
      },
      setDir,
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
      speedNudge(delta) {
        stepMs = Math.max(opts.minSpeed, Math.min(opts.startSpeed + 40, stepMs + delta));
      },
      setWrap(on) { wrapMode = !!on; emit("change", snapshot()); },
      setSound(on) { sfx = !!on; if (on) initAudio(); },
      get state() { return state; },
      get stats() { return snapshot(); },
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
