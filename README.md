# Neon Snake Live

Snake, steered by your TikTok LIVE chat. Viewers type `up`, `down`, `left` or `right`
and the snake turns. Gifts drop a golden apple, likes fill a goal that doubles points,
and a leaderboard tracks who actually drove.

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
| `/` | Everything: board, votes, leaderboard, room feed, toggles |
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
| Chat votes / Last comment wins | How chat commands are applied |
| Auto restart | Starts the next round 5 seconds after a game over — leave on for unattended streams |
| Walls kill / Walls wrap | Wrap makes rounds much longer, which is kinder when chat is driving |
| Sound | Game audio (your stream mic picks this up if you have desktop audio on) |

You can always take over with the arrow keys or `WASD`. `Space` pauses.

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
- `public/game.js` is the game. It knows nothing about TikTok and runs fine on its own.
- `public/live.js` turns comments into moves, keeps the leaderboard, and draws the panels.

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
