# Neon Snake Live

Snake for a TikTok LIVE stream, in two modes:

- **Autopilot** (default) — plays by itself and clears the board every round, so you can
  leave the stream running unattended.
- **Chat drives** — viewers type `up`, `down`, `left` or `right` and the snake turns.

Either way gifts drop a golden apple, likes fill a goal that doubles points, and a
leaderboard tracks the room.

![board](https://img.shields.io/badge/node-%3E%3D18-4ff0a8) ![license](https://img.shields.io/badge/use-personal-21c8ff)

---

## Quick start

```bash
npm install
```

```bash
node server.js --user=@your_tiktok_handle
```

Then open <http://localhost:8080> and click the board once (browsers need one click
before they allow sound).

You have to be **live on TikTok** for it to connect. If you are not live yet, start the
stream first, then start the server — it retries on its own either way.

To try the layout without going live:

```bash
npm run demo
```

That generates fake chat locally so you can see the whole thing move.

---

## The autopilot

The board is covered by a **Hamiltonian cycle** — one closed loop that passes through
every square exactly once. A snake that follows that loop can never box itself in: the
body always lies along a stretch of the loop, and the head always moves onto the square
the loop says comes next, which the tail has already left. Ride it long enough and the
snake eats every apple on the board and fills all 256 squares. That is the win, and it is
not luck — it is a property of the loop.

Riding the raw loop is slow, so while the snake is short the autopilot takes **shortcuts**:
it jumps ahead along the loop, but never past its own tail and never past the apple. Once
the snake covers half the board the shortcuts switch off and it rides the pure loop home.
Shortcuts roughly halve the time to a clear.

Measured over 420 simulated games (`node test/simulate.js`):

| Setup | Result | Steps to clear |
| --- | --- | --- |
| 16×16, loop + shortcuts | 300 / 300 cleared | 8,722 average, 9,883 worst |
| 16×16, pure loop | 60 / 60 cleared | 16,201 average |
| 20×20, loop + shortcuts | 60 / 60 cleared | 20,898 average |

At the **Normal** speed a clear takes about 11 minutes; **Turbo** about 7; **Hyper** about
4½. When a board is cleared the page shows the time, bumps the clear counter, and starts
the next round — so an unattended stream is a loop of perfect runs.

### Why the grid is 16×16

A Hamiltonian cycle only exists on a grid graph when the number of squares is even. 17×17
is 289 squares — odd — and no such loop exists, so the guarantee would be gone. Keep at
least one side even if you change the board size; `ai.js` throws rather than pretend.

### What the autopilot does not do

It does not find the *shortest* path to each apple — that problem is much harder, and the
greedy answer gets the snake killed. This one trades speed for a result that holds every
single time. If you want to watch it sweat, turn off **Loop + shortcuts** and it will ride
the bare loop.

While the autopilot drives, chat commands and the arrow keys are ignored — one stray turn
would break the loop and with it the guarantee. Flip to **Chat drives** to hand control
back; that starts a fresh round.

---

## Getting it onto your stream

**TikTok LIVE Studio (Windows)** — Add source → Browser → URL
`http://localhost:8080/?overlay=1` → set 1080×1920 (or whatever fits your scene).
The `?overlay=1` mode drops the page background and the side panel, so you get just the
board on a transparent layer you can put over your camera.

**OBS** — same thing: Sources → Browser → that URL, tick *Shutdown source when not
visible* off so the game keeps running while you cut away.

Useful URLs:

| URL | What it shows |
| --- | --- |
| `/` | Everything: board, autopilot panel, leaderboard, room feed, toggles |
| `/?afk=1&speed=turbo` | Forces autopilot on at turbo speed — good for an unattended scene |
| `/?overlay=1` | Board + vote bars only, transparent background — for OBS |
| `/?overlay=1&hidechat=1` | Same, without the room feed |

Keep the full view on a second monitor for yourself and put the overlay on the stream.

---

## How viewers play

| They type | What happens |
| --- | --- |
| `up` `down` `left` `right` | A vote for that direction |
| `w` `a` `s` `d` | Same thing |
| `u` `l` `r` | Same thing |
| `⬆️ ⬇️ ⬅️ ➡️` | Same thing |
| `go left!!` | Commands inside a sentence count too |

**Chat votes** (default): every comment in a 1.2 second window is a vote, and the
direction with the most votes wins. One vote per person per window — changing your mind
moves your vote instead of adding one. Everyone who voted for the winning direction gets
credit, so the leaderboard rewards the people who were actually steering.

**Last comment wins**: no voting, every valid command turns the snake immediately. Much
faster, much more chaotic. Toggle it with the *Chat votes* button.

### What else the room does

- **Gift** → drops a golden apple worth 50, and the gifter gets credit when it's eaten
- **Like** → fills the like goal; when it tops out, points double for 15 seconds
- **Follow / share** → points on the leaderboard and a line in the room feed

---

## Toggles

| Button | What it does |
| --- | --- |
| Autopilot / Chat drives | Who steers. Switching starts a fresh round |
| Loop + shortcuts / Pure loop | Shortcuts are faster; the pure loop is the slow, hypnotic version |
| Chill / Normal / Turbo / Hyper | Steps per second — 8, 13, 21 and 31 |
| Shiver | The body's idle wobble. It fades out as the board fills, and off is perfectly still |
| Chat votes / Last comment wins | How chat commands are applied, when chat is driving |
| Auto restart | Starts the next round 5 seconds after a game over — leave on for unattended streams |
| Walls kill / Walls wrap | Wrap makes rounds much longer, which is kinder when chat is driving |
| Sound | Game audio (your stream mic picks this up if you have desktop audio on) |

With the autopilot off you can take over with the arrow keys or `WASD`. `Space` pauses
either way.

---

## Configuration

Everything has a default; override what you need.

```bash
node server.js --user=@handle --port=9000
```

Or copy `config.example.json` to `config.json`:

```json
{
  "username": "@your_tiktok_handle",
  "port": 8080,
  "sessionId": "",
  "ttTargetIdc": ""
}
```

Or use environment variables: `TIKTOK_USERNAME`, `PORT`, `TIKTOK_SESSION_ID`,
`TIKTOK_TARGET_IDC`.

`config.json` is gitignored, so your session id never gets committed.

### About `sessionId`

Most rooms connect fine without it. You only need one if your room is age-restricted or
the connection is refused — it comes from the `sessionid` cookie on tiktok.com while
you're logged in. It is a login credential: keep it in `config.json` or an environment
variable, never in a commit or on screen while you're live.

---

## How it fits together

```
TikTok LIVE room
      │  (tiktok-live-connector, unofficial read-only client)
      ▼
  server.js ──── serves ./public ────► browser
      │                                   ▲
      └──── WebSocket /live ──────────────┘
            chat · gift · like · follow
```

- `server.js` only relays what the room says. It makes no gameplay decisions.
- `public/ai.js` builds the loop and picks each move. No DOM, no TikTok — it runs in plain
  Node, which is how the table above was measured.
- `public/game.js` is the game. It knows nothing about TikTok and nothing about the autopilot.
- `public/live.js` wires the three together and draws the panels.

Build a single self-contained HTML file with `node build-artifact.js` — it writes
`dist/neon-snake.html` (open it straight from disk, no server) and `dist/artifact.html`
(the same page without the document wrapper, for hosts that supply their own). With no
bridge to talk to, the page hides the room panels and just plays.

In the browser console, `__snake` is the live game object — `__snake.setDir("up")`,
`__snake.dropGold()`, `__snake.boostDouble(10000)` — handy for testing a scene before
you go live.

---

## Notes and limits

- `tiktok-live-connector` is an unofficial client for TikTok's public live chat. It isn't
  affiliated with TikTok, and TikTok can change the protocol at any time. If connecting
  suddenly breaks, update the package first: `npm update tiktok-live-connector`.
- Very large rooms send a lot of comments. Vote mode handles that better than last-comment
  mode, which gets unplayable past a few comments a second.
- Everything runs on your machine. Nothing is uploaded anywhere and nothing is stored
  between runs except the toggles and your best score, in the browser's own storage.
