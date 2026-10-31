/*
 * Perfect-play autopilot.
 *
 * The board is covered by a Hamiltonian cycle — a single closed loop that visits
 * every cell exactly once. A snake that follows that loop can never trap itself
 * and never collides, because the body always sits on a stretch of the loop and
 * the head always moves onto the cell the loop says comes next. Follow it long
 * enough and the snake eats every apple on the board, which is the win.
 *
 * Following the raw loop is safe but slow, so while the snake is still short the
 * autopilot takes shortcuts: it jumps forward along the loop, but never past its
 * own tail and never past the apple. Once the snake covers half the board the
 * shortcuts switch off and it rides the pure loop to the finish.
 *
 * Cycle construction needs an even number of rows. Column 0 is the return lane;
 * the rest of the board is covered row by row, boustrophedon.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SnakeAI = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  function buildCycle(cols, rows) {
    if (rows % 2 !== 0) {
      throw new Error("A Hamiltonian cycle needs an even number of rows; got " + rows);
    }
    const path = [];
    path.push({ x: 0, y: 0 });
    for (let y = 0; y < rows; y++) {
      if (y % 2 === 0) for (let x = 1; x < cols; x++) path.push({ x, y });
      else for (let x = cols - 1; x >= 1; x--) path.push({ x, y });
    }
    for (let y = rows - 1; y >= 1; y--) path.push({ x: 0, y });

    const N = cols * rows;
    if (path.length !== N) throw new Error("Cycle covered " + path.length + " of " + N + " cells");

    const order = new Int32Array(N);
    for (let i = 0; i < N; i++) order[path[i].y * cols + path[i].x] = i;

    // every consecutive pair, including the wrap, must be orthogonally adjacent
    for (let i = 0; i < N; i++) {
      const a = path[i], b = path[(i + 1) % N];
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) {
        throw new Error("Cycle breaks between index " + i + " and " + ((i + 1) % N));
      }
    }
    return { path, order, cols, rows, N };
  }

  function dirBetween(from, to) {
    for (const name in DIRS) {
      if (from.x + DIRS[name][0] === to.x && from.y + DIRS[name][1] === to.y) return name;
    }
    return null;
  }

  /**
   * Pick the next direction.
   * state: { cols, rows, snake: [head..tail], apple }
   * cycle: result of buildCycle
   * opts:  { shortcuts: boolean, shortcutLimit: 0..1 }
   */
  function nextMove(state, cycle, opts) {
    const { cols, snake, apple } = state;
    const { order, path, N } = cycle;
    const options = Object.assign({ shortcuts: true, shortcutLimit: 0.5 }, opts);

    const head = snake[0];
    const tail = snake[snake.length - 1];
    const headIdx = order[head.y * cols + head.x];
    const tailIdx = order[tail.y * cols + tail.x];

    const cycleNext = path[(headIdx + 1) % N];
    const fallback = dirBetween(head, cycleNext);

    if (!options.shortcuts || snake.length > N * options.shortcutLimit) return fallback;

    const dist = (a, b) => (b - a + N) % N;
    const occupied = new Set();
    for (const s of snake) occupied.add(s.y * cols + s.x);

    // never catch up with the tail
    let maxJump = dist(headIdx, tailIdx) - 1;
    // and never skip past the apple — the point of the shortcut is to reach it sooner
    if (apple) {
      const appleIdx = order[apple.y * cols + apple.x];
      const toApple = dist(headIdx, appleIdx);
      if (toApple < dist(headIdx, tailIdx)) maxJump = Math.min(maxJump, toApple);
    }
    if (maxJump < 1) return fallback;

    let bestDir = fallback, bestJump = 1;
    for (const name in DIRS) {
      const nx = head.x + DIRS[name][0], ny = head.y + DIRS[name][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= state.rows) continue;
      if (occupied.has(ny * cols + nx)) continue;
      const jump = dist(headIdx, order[ny * cols + nx]);
      if (jump < 1 || jump > maxJump) continue;
      if (jump > bestJump) { bestJump = jump; bestDir = name; }
    }
    return bestDir;
  }

  function startingSnake(cycle, length) {
    const body = [];
    for (let i = length - 1; i >= 0; i--) body.push({ x: cycle.path[i].x, y: cycle.path[i].y });
    return body; // head first, sitting on cycle index length-1
  }

  return { buildCycle, nextMove, startingSnake, dirBetween, DIRS };
});
