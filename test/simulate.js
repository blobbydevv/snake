const ai = require('../public/ai.js');

function play(cols, rows, seed, opts) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const cycle = ai.buildCycle(cols, rows);
  const N = cycle.N;
  const snake = ai.startingSnake(cycle, 3);
  const occ = new Set(snake.map(p => p.y * cols + p.x));

  const place = () => {
    const free = [];
    for (let i = 0; i < N; i++) if (!occ.has(i)) free.push(i);
    if (!free.length) return null;
    const k = free[(rnd() * free.length) | 0];
    return { x: k % cols, y: (k / cols) | 0 };
  };
  let apple = place();
  let steps = 0;
  const maxSteps = N * N * 4;

  while (snake.length < N) {
    if (++steps > maxSteps) return { ok: false, why: 'stalled', len: snake.length, steps };
    const dir = ai.nextMove({ cols, rows, snake, apple }, cycle, opts);
    if (!dir) return { ok: false, why: 'no direction', len: snake.length, steps };
    const [dx, dy] = ai.DIRS[dir];
    const h = { x: snake[0].x + dx, y: snake[0].y + dy };
    if (h.x < 0 || h.y < 0 || h.x >= cols || h.y >= rows) return { ok: false, why: 'wall', len: snake.length, steps };
    const tail = snake[snake.length - 1];
    const eating = apple && h.x === apple.x && h.y === apple.y;
    // tail vacates this step unless the snake grows
    const hitsBody = snake.some((p, i) => p.x === h.x && p.y === h.y && !(i === snake.length - 1 && !eating));
    if (hitsBody) return { ok: false, why: 'self', len: snake.length, steps };

    snake.unshift(h); occ.add(h.y * cols + h.x);
    if (eating) { apple = place(); }
    else { const t = snake.pop(); occ.delete(t.y * cols + t.x); }
  }
  return { ok: true, len: snake.length, steps };
}

for (const cfg of [
  { name: '16x16 shortcuts on ', opts: { shortcuts: true,  shortcutLimit: 0.5 }, cols: 16, rows: 16, runs: 300 },
  { name: '16x16 pure cycle   ', opts: { shortcuts: false },                      cols: 16, rows: 16, runs: 60  },
  { name: '20x20 shortcuts on ', opts: { shortcuts: true,  shortcutLimit: 0.5 }, cols: 20, rows: 20, runs: 60  }
]) {
  let wins = 0, total = 0, worst = 0; const fails = [];
  for (let i = 0; i < cfg.runs; i++) {
    const r = play(cfg.cols, cfg.rows, i * 7919 + 13, cfg.opts);
    if (r.ok) { wins++; total += r.steps; worst = Math.max(worst, r.steps); }
    else fails.push(r);
  }
  console.log(cfg.name, '→', wins + '/' + cfg.runs, 'wins | avg steps', Math.round(total / Math.max(1, wins)),
              '| worst', worst, fails.length ? '| FAILURES: ' + JSON.stringify(fails.slice(0, 3)) : '');
}
