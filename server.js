/**
 * Neon Snake Live — bridge between a TikTok LIVE room and the game in the browser.
 *
 *   node server.js --user=@yourhandle
 *
 * It does two things:
 *   1. Serves ./public on http://localhost:<port>
 *   2. Opens a WebSocket at /live and forwards every chat message, gift,
 *      like and follow from the room to the page as JSON.
 *
 * The game itself lives entirely in the browser. This file never decides
 * anything about gameplay — it only relays what the room says.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

/* ---------------------------------------------------------------- config */

function loadConfig() {
  const cfg = {
    username: "",
    port: 8080,
    sessionId: "",
    ttTargetIdc: "",
    demo: false
  };

  const file = path.join(__dirname, "config.json");
  if (fs.existsSync(file)) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (err) {
      console.error("config.json is not valid JSON — ignoring it.", err.message);
    }
  }

  if (process.env.TIKTOK_USERNAME) cfg.username = process.env.TIKTOK_USERNAME;
  if (process.env.TIKTOK_SESSION_ID) cfg.sessionId = process.env.TIKTOK_SESSION_ID;
  if (process.env.TIKTOK_TARGET_IDC) cfg.ttTargetIdc = process.env.TIKTOK_TARGET_IDC;
  if (process.env.PORT) cfg.port = Number(process.env.PORT);

  for (const arg of process.argv.slice(2)) {
    const m = /^--([^=]+)=?(.*)$/.exec(arg);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "user" || key === "username") cfg.username = value;
    else if (key === "port") cfg.port = Number(value);
    else if (key === "demo") cfg.demo = true;
  }

  cfg.username = String(cfg.username || "").replace(/^@/, "").trim();
  return cfg;
}

const config = loadConfig();

/* ------------------------------------------------------------ http server */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
const PUBLIC = path.join(__dirname, "public");

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
  if (url.pathname === "/") file = path.join(PUBLIC, "index.html");

  // never serve anything outside ./public
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(body);
  });
});

/* ------------------------------------------------------------- websockets */

const wss = new WebSocketServer({ server, path: "/live" });
let roomState = { connected: false, username: config.username, viewers: 0, error: "" };

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "status", ...roomState }));
});

/* ------------------------------------------------------- tiktok connection */

function userOf(data) {
  const u = (data && data.user) || {};
  return {
    id: u.userId || u.uniqueId || "anon",
    name: u.nickname || u.uniqueId || "someone",
    handle: u.uniqueId || "",
    avatar:
      (u.profilePicture && u.profilePicture.url && u.profilePicture.url[0]) || ""
  };
}

function connectTikTok() {
  if (config.demo) {
    console.log("Demo mode: generating fake chat so you can test the layout.");
    roomState = { connected: true, username: "demo", viewers: 0, error: "" };
    broadcast({ type: "status", ...roomState });
    startDemo();
    return;
  }
  if (!config.username) {
    const msg = "No TikTok username set. Run: node server.js --user=@yourhandle";
    console.error(msg);
    roomState = { connected: false, username: "", viewers: 0, error: msg };
    broadcast({ type: "status", ...roomState });
    return;
  }

  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require("tiktok-live-connector");

  const options = {};
  if (config.sessionId) {
    options.sessionId = config.sessionId;
    options.ttTargetIdc = config.ttTargetIdc || undefined;
  }

  const conn = new TikTokLiveConnection(config.username, options);
  let backoff = 4000;

  conn.on(ControlEvent.CONNECTED, (state) => {
    backoff = 4000;
    roomState = {
      connected: true,
      username: config.username,
      viewers: (state && state.roomInfo && state.roomInfo.user_count) || 0,
      error: ""
    };
    console.log(`Connected to @${config.username}'s room.`);
    broadcast({ type: "status", ...roomState });
  });

  conn.on(ControlEvent.DISCONNECTED, () => {
    roomState = { ...roomState, connected: false, error: "Disconnected" };
    console.log("Disconnected. Retrying…");
    broadcast({ type: "status", ...roomState });
    retry();
  });

  conn.on(ControlEvent.ERROR, (err) => {
    console.error("Connection error:", (err && err.message) || err);
  });

  conn.on(WebcastEvent.CHAT, (data) => {
    broadcast({ type: "chat", user: userOf(data), text: String(data.comment || "") });
  });

  conn.on(WebcastEvent.GIFT, (data) => {
    // streakable gifts fire repeatedly; only count the final one
    const details = data.giftDetails || {};
    const streakable = details.giftType === 1;
    if (streakable && data.repeatEnd !== 1) return;
    broadcast({
      type: "gift",
      user: userOf(data),
      gift: details.giftName || `gift ${data.giftId}`,
      count: data.repeatCount || 1,
      diamonds: (details.diamondCount || 0) * (data.repeatCount || 1)
    });
  });

  conn.on(WebcastEvent.LIKE, (data) => {
    broadcast({ type: "like", user: userOf(data), count: data.likeCount || 1 });
  });

  conn.on(WebcastEvent.FOLLOW, (data) => {
    broadcast({ type: "follow", user: userOf(data) });
  });

  conn.on(WebcastEvent.SHARE, (data) => {
    broadcast({ type: "share", user: userOf(data) });
  });

  conn.on(WebcastEvent.ROOM_USER, (data) => {
    roomState.viewers = data.viewerCount || roomState.viewers;
    broadcast({ type: "status", ...roomState });
  });

  conn.on(WebcastEvent.STREAM_END, () => {
    roomState = { ...roomState, connected: false, error: "The stream ended" };
    broadcast({ type: "status", ...roomState });
  });

  function retry() {
    setTimeout(() => {
      conn.connect().catch(() => {});
      backoff = Math.min(60000, backoff * 1.6);
    }, backoff);
  }

  conn.connect().catch((err) => {
    const msg = (err && err.message) || String(err);
    console.error("Could not connect:", msg);
    roomState = { connected: false, username: config.username, viewers: 0, error: msg };
    broadcast({ type: "status", ...roomState });
    retry();
  });
}

/* ------------------------------------------------------------- demo mode */

function startDemo() {
  const names = ["pixel_rin", "maya", "00tonio", "sleepy_fox", "kiko", "vee", "mochi"];
  const words = ["up", "down", "left", "right", "w", "a", "s", "d", "nice", "go left!!"];
  setInterval(() => {
    const name = names[(Math.random() * names.length) | 0];
    broadcast({
      type: "chat",
      user: { id: name, name, handle: name, avatar: "" },
      text: words[(Math.random() * words.length) | 0]
    });
  }, 700);
  setInterval(() => {
    const name = names[(Math.random() * names.length) | 0];
    broadcast({
      type: "gift",
      user: { id: name, name, handle: name, avatar: "" },
      gift: "Rose",
      count: 1 + ((Math.random() * 4) | 0),
      diamonds: 5
    });
  }, 14000);
}

/* ------------------------------------------------------------------ boot */

server.listen(config.port, () => {
  console.log(`\n  Neon Snake Live`);
  console.log(`  Game:    http://localhost:${config.port}`);
  console.log(`  Overlay: http://localhost:${config.port}/?overlay=1  (transparent, for OBS)`);
  console.log(`  Room:    ${config.demo ? "demo mode" : config.username ? "@" + config.username : "not set"}\n`);
  connectTikTok();
});
