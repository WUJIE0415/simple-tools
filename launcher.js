const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const baseDir = path.dirname(process.execPath);
const serverPath = path.join(baseDir, "server.js");
const port = process.env.PORT || "4173";

function firstExistingDirectory(candidates) {
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  }) || "";
}

function openBrowser(url) {
  if (process.env.NO_BROWSER === "1") return;

  const child = spawn("cmd", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

const toolsDir = firstExistingDirectory([
  path.join(baseDir, "tools"),
  path.join(baseDir, "bin"),
]);

process.env.PORT = port;

if (toolsDir) {
  const ytDlpPath = path.join(toolsDir, "yt-dlp.exe");
  const ffmpegPath = path.join(toolsDir, "ffmpeg.exe");
  const cookiePath = path.join(toolsDir, "cookie.txt");
  const instagramProviderPath = path.join(toolsDir, "instagram_provider.exe");

  process.env.PATH = `${toolsDir}${path.delimiter}${process.env.PATH || ""}`;
  if (fs.existsSync(ytDlpPath)) process.env.YTDLP_PATH = ytDlpPath;
  if (fs.existsSync(cookiePath)) process.env.YTDLP_COOKIE_PATH = cookiePath;
  if (fs.existsSync(ffmpegPath)) {
    process.env.FFMPEG_PATH = ffmpegPath;
    process.env.FFMPEG_LOCATION = toolsDir;
  }
  if (fs.existsSync(instagramProviderPath)) process.env.INSTAGRAM_PROVIDER_PATH = instagramProviderPath;
}

process.chdir(baseDir);

setTimeout(() => {
  openBrowser(`http://127.0.0.1:${port}/`);
}, 500);

try {
  const externalRequire = createRequire(path.join(baseDir, "VideoDownloader.launcher.cjs"));
  externalRequire(serverPath);
} catch (error) {
  console.error("VideoDownloader failed to start.");
  console.error(error && error.stack ? error.stack : error);
  console.error("");
  console.error("Please check that VideoDownloader.exe is in the same folder as server.js.");
  process.exitCode = 1;
}
