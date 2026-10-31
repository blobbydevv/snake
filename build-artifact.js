/*
 * Bundles public/ into one self-contained HTML file.
 *
 *   node build-artifact.js            -> dist/neon-snake.html
 *
 * Same game, same autopilot, no server: the page notices there is no bridge and
 * hides the room panels. Useful for sharing a playable link or dropping the file
 * straight into OBS as a local browser source.
 */
const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "public");
const read = f => fs.readFileSync(path.join(PUBLIC, f), "utf8");

let html = read("index.html");

html = html.replace(
  /<link rel="stylesheet" href="style\.css">/,
  "<style>\n" + read("style.css") + "\n</style>"
);

for (const script of ["ai.js", "game.js", "live.js"]) {
  html = html.replace(
    new RegExp('<script src="' + script.replace(".", "\\.") + '"></script>'),
    "<script>\n" + read(script) + "\n</script>"
  );
}

if (/<script src=|href="style\.css"/.test(html)) {
  console.error("Something was not inlined — check the filenames in index.html");
  process.exit(1);
}

const out = path.join(__dirname, "dist");
fs.mkdirSync(out, { recursive: true });

const standalone = path.join(out, "neon-snake.html");
fs.writeFileSync(standalone, html);
console.log("Wrote " + standalone + " (" + (html.length / 1024).toFixed(1) + " KB)");

// A second copy without the document wrapper, for hosts that supply their own
// <html>/<head>/<body> (Claude artifacts, some CMS embeds).
const fragment = html
  .replace(/<!doctype html>\s*/i, "")
  .replace(/<\/?html[^>]*>\s*/gi, "")
  .replace(/<\/?head[^>]*>\s*/gi, "")
  .replace(/<\/?body[^>]*>\s*/gi, "")
  .replace(/<meta charset="utf-8">\s*/i, "")
  .replace(/<meta name="viewport"[^>]*>\s*/i, '<meta name="claude:viewport-fit-sides" content="cover">\n')
  .trim();

const frag = path.join(out, "artifact.html");
fs.writeFileSync(frag, fragment);
console.log("Wrote " + frag + " (" + (fragment.length / 1024).toFixed(1) + " KB)");
