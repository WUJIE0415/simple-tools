const http = require("node:http");
const https = require("node:https");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const rootDir = __dirname;
const packageInfo = require("./package.json");
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 1024 * 1024;
const instagramProviderScriptPath = path.join(rootDir, "instagram_provider.py");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".mp4", "video/mp4"],
]);

function findOnPath(command) {
  return findAllOnPath(command)[0] || "";
}

function findAllOnPath(command) {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  const directories = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const matches = [];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (fs.existsSync(candidate)) matches.push(candidate);
    }
  }

  return matches;
}

function firstExistingFile(candidates) {
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || "";
}

function firstWorkingTool(candidates, probeArgs) {
  const seen = new Set();

  for (const candidate of candidates.filter(Boolean)) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const result = spawnSync(candidate, probeArgs, {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });

    if (!result.error && result.status === 0) return candidate;
  }

  return "";
}

const ytDlpPath = firstWorkingTool([
  process.env.YTDLP_PATH,
  path.join(rootDir, "tools", "yt-dlp.exe"),
  path.join(rootDir, "bin", "yt-dlp.exe"),
  ...findAllOnPath("yt-dlp"),
  "yt-dlp",
], ["--version"]) || "yt-dlp";
const ffmpegPath = firstWorkingTool([
  process.env.FFMPEG_PATH,
  path.join(rootDir, "tools", "ffmpeg.exe"),
  path.join(rootDir, "bin", "ffmpeg.exe"),
  ...findAllOnPath("ffmpeg"),
  "ffmpeg",
], ["-version"]);
const ffmpegLocation = process.env.FFMPEG_LOCATION || (ffmpegPath ? path.dirname(ffmpegPath) : "");
const cookiePath = process.env.YTDLP_COOKIE_PATH || firstExistingFile([
  path.join(rootDir, "bin", "cookie.txt"),
  path.join(rootDir, "tools", "cookie.txt"),
]);
const instagramProviderExePath = process.env.INSTAGRAM_PROVIDER_PATH || firstExistingFile([
  path.join(rootDir, "bin", "instagram_provider.exe"),
  path.join(rootDir, "tools", "instagram_provider.exe"),
]);

function extractFirstUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match) return "";

  return match[0].replace(/[),.?!;:'"\]}，。！？；：、）】]+$/u, "");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendZip(response, zipName, zipBuffer) {
  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Length": zipBuffer.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    "Cache-Control": "no-store",
  });
  response.end(zipBuffer);
}

function isSupportedUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function isInstagramUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am" || host.endsWith(".instagr.am");
  } catch {
    return false;
  }
}

function compactToolOutput(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join("\n");
}

function runTool(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, {
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timeout = null;

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Reading link details timed out."));
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(new Error(`Could not start yt-dlp. ${error.message}`));
    });

    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);

      if (code === 0) {
        resolve({ stdout, stderr, output: `${stdout}${stderr}` });
        return;
      }

      reject(new Error(compactToolOutput(`${stderr}${stdout}`) || `yt-dlp exited with code ${code}.`));
    });
  });
}

function runPythonProvider(args, options = {}) {
  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYTHON_PATH || process.env.PYTHON || "python";
    const providerCommand = instagramProviderExePath || pythonPath;
    const providerArgs = instagramProviderExePath ? args : [instagramProviderScriptPath, ...args];
    const child = spawn(providerCommand, providerArgs, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });

    let stdout = "";
    let stderr = "";
    let timeout = null;

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Reading Instagram media timed out."));
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(new Error(`Could not start Instagram provider. ${error.message}`));
    });

    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);

      if (code === 0) {
        resolve({ stdout, stderr, output: `${stdout}${stderr}` });
        return;
      }

      reject(new Error(compactToolOutput(`${stderr}${stdout}`) || `Instagram provider exited with code ${code}.`));
    });
  });
}

async function runInstagramPreview(url) {
  const result = await runPythonProvider(["preview", url], { timeoutMs: 45000 });
  return JSON.parse(result.stdout.trim());
}

async function runInstagramDownload(url, itemIndex, jobDir) {
  const result = await runPythonProvider(["download", url, String(itemIndex || 1), jobDir], { timeoutMs: 120000 });
  return JSON.parse(result.stdout.trim());
}

async function runInstagramDownloadAll(url, jobDir) {
  const result = await runPythonProvider(["download_all", url, jobDir], { timeoutMs: 300000 });
  return JSON.parse(result.stdout.trim());
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

async function createZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  const { dosDate, dosTime } = dosDateTime();
  let offset = 0;

  for (const file of files) {
    const data = await fsp.readFile(file.filePath);
    const name = Buffer.from(file.filename, "utf8");
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endRecord]);
}

function proxyRemoteImage(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const remoteUrl = requestUrl.searchParams.get("url") || "";

  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    sendJson(response, 400, { error: "Missing thumbnail URL." });
    return;
  }

  if (parsed.protocol !== "https:") {
    sendJson(response, 400, { error: "Thumbnail URL must use HTTPS." });
    return;
  }

  const proxyRequest = https.get(parsed, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://www.instagram.com/",
    },
  }, (proxyResponse) => {
    if (!proxyResponse.statusCode || proxyResponse.statusCode >= 400) {
      sendJson(response, 502, { error: "Could not load thumbnail." });
      proxyResponse.resume();
      return;
    }

    response.writeHead(200, {
      "Content-Type": proxyResponse.headers["content-type"] || "image/jpeg",
      "Cache-Control": "private, max-age=900",
    });
    proxyResponse.pipe(response);
  });

  proxyRequest.setTimeout(30000, () => {
    proxyRequest.destroy(new Error("Thumbnail timed out."));
  });

  proxyRequest.on("error", (error) => {
    if (!response.headersSent) {
      sendJson(response, 502, { error: error.message || "Could not load thumbnail." });
    } else {
      response.destroy(error);
    }
  });
}

async function newestFile(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".part") || entry.name.endsWith(".ytdl")) continue;

    const filePath = path.join(directory, entry.name);
    const stats = await fsp.stat(filePath);
    files.push({ filePath, stats });
  }

  files.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
  return files[0] || null;
}

function baseArgs(outputTemplate, itemIndex = 0) {
  const args = [
    "--windows-filenames",
    "--no-mtime",
    "-o",
    outputTemplate,
  ];

  if (itemIndex > 0) {
    args.push("--playlist-items", String(itemIndex));
  } else {
    args.unshift("--no-playlist");
  }

  if (ffmpegLocation) {
    args.push("--ffmpeg-location", ffmpegLocation);
  }

  if (cookiePath) {
    args.push("--cookies", cookiePath);
  }

  return args;
}

function argsForJob(format, url, jobDir, itemIndex = 0) {
  const outputTemplate = path.join(jobDir, "download.%(ext)s");
  const args = baseArgs(outputTemplate, itemIndex);

  if (format === "mp3") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0", url);
    return args;
  }

  if (format === "wav") {
    args.push("-x", "--audio-format", "wav", url);
    return args;
  }

  if (format === "image") {
    args.push("--format", "best", url);
    return args;
  }

  args.push("--format", "bv*+ba/best", "--merge-output-format", "mp4", url);
  return args;
}

function safeDownloadName(format, generatedPath) {
  const extension = path.extname(generatedPath) || (format === "video" ? ".mp4" : `.${format}`);
  const stem = format === "video" ? "video-download" : format === "image" ? "image-download" : `audio-${format}`;
  return `${stem}${extension.toLowerCase()}`;
}

function contentTypeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  return new Map([
    [".mp3", "audio/mpeg"],
    [".wav", "audio/wav"],
    [".mp4", "video/mp4"],
    [".m4v", "video/mp4"],
    [".mov", "video/quicktime"],
    [".webm", "video/webm"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".webp", "image/webp"],
  ]).get(extension) || "application/octet-stream";
}

function bestThumbnail(entry) {
  if (entry.thumbnail) return entry.thumbnail;
  if (!Array.isArray(entry.thumbnails) || entry.thumbnails.length === 0) return "";

  const sorted = [...entry.thumbnails].sort((left, right) => {
    const leftArea = Number(left.width || 0) * Number(left.height || 0);
    const rightArea = Number(right.width || 0) * Number(right.height || 0);
    return rightArea - leftArea;
  });

  return sorted[0].url || "";
}

function mediaKind(entry) {
  const extension = String(entry.ext || "").toLowerCase();
  const vcodec = String(entry.vcodec || "");

  if (["jpg", "jpeg", "png", "webp", "avif"].includes(extension)) return "image";
  if (vcodec && vcodec !== "none") return "video";
  if (entry.duration || entry.width || entry.height) return "video";
  return "media";
}

function normalizeMediaItem(entry, index) {
  const kind = mediaKind(entry);
  const title = String(entry.title || entry.description || entry.alt_title || `Item ${index + 1}`)
    .replace(/\s+/g, " ")
    .trim();

  return {
    index: index + 1,
    title: title.slice(0, 90),
    kind,
    thumbnail: bestThumbnail(entry),
    extension: entry.ext || "",
    duration: Number.isFinite(entry.duration) ? Math.round(entry.duration) : 0,
  };
}

async function resolveLinkItems(url) {
  const args = [
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    "--playlist-end",
    "24",
    url,
  ];

  if (cookiePath) {
    args.splice(0, 0, "--cookies", cookiePath);
  }

  const result = await runTool(args, { timeoutMs: 30000 });

  const metadata = JSON.parse(result.stdout.trim());
  const entries = Array.isArray(metadata.entries)
    ? metadata.entries.filter(Boolean)
    : [];

  return {
    url,
    title: metadata.title || metadata.description || "",
    items: entries.map(normalizeMediaItem),
  };
}

async function handleResolve(request, response) {
  try {
    const body = await readJsonBody(request);
    const url = extractFirstUrl([body.url, body.text].filter(Boolean).join(" "));

    if (!isSupportedUrl(url)) {
      sendJson(response, 400, { error: "Paste text that contains a valid video link." });
      return;
    }

    try {
      const resolved = await resolveLinkItems(url);
      sendJson(response, 200, resolved);
    } catch (error) {
      sendJson(response, 200, {
        url,
        title: "",
        items: [],
        warning: error.message || "Could not read media items.",
      });
    }
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Could not read link details." });
  }
}

async function handleProviderPreview(request, response) {
  try {
    const body = await readJsonBody(request);
    const url = extractFirstUrl([body.url, body.text].filter(Boolean).join(" "));

    if (!isSupportedUrl(url)) {
      sendJson(response, 400, { error: "Paste text that contains a valid video link." });
      return;
    }

    if (!isInstagramUrl(url)) {
      sendJson(response, 400, { error: "This provider only supports Instagram links." });
      return;
    }

    const items = await runInstagramPreview(url);
    sendJson(response, 200, items.map((item) => ({
      ...item,
      thumb_url: item.thumb_url
        ? `/api/provider/thumbnail?url=${encodeURIComponent(item.thumb_url)}`
        : "",
    })));
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Could not read provider preview." });
  }
}

async function handleConvert(request, response) {
  let jobDir = "";

  try {
    const body = await readJsonBody(request);
    const url = extractFirstUrl([body.url, body.text].filter(Boolean).join(" "));
    const format = String(body.format || "video").toLowerCase();
    const allItems = Boolean(body.allItems);
    const itemIndex = Number.isInteger(Number(body.itemIndex)) && Number(body.itemIndex) > 0
      ? Number(body.itemIndex)
      : 0;

    if (!isSupportedUrl(url)) {
      sendJson(response, 400, { error: "Paste text that contains a valid video link." });
      return;
    }

    if (!["video", "mp3", "wav", "image"].includes(format)) {
      sendJson(response, 400, { error: "Choose video, image, mp3, or wav." });
      return;
    }

    jobDir = await fsp.mkdtemp(path.join(os.tmpdir(), "simple-tools-"));

    if (isInstagramUrl(url)) {
      if (allItems) {
        const generated = await runInstagramDownloadAll(url, jobDir);
        const files = Array.isArray(generated.files) ? generated.files : [];
        if (files.length === 0) throw new Error("No Instagram files were downloaded.");

        const zipBuffer = await createZipBuffer(files);
        const zipName = `${generated.shortcode || "instagram-media"}.zip`;
        sendZip(response, zipName, zipBuffer);
        return;
      }

      const generated = await runInstagramDownload(url, itemIndex || 1, jobDir);
      const filePath = generated.filePath;
      const stats = await fsp.stat(filePath);
      const downloadName = generated.filename || safeDownloadName(format, filePath);
      const contentType = contentTypeForFile(filePath);

      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": stats.size,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        "Cache-Control": "no-store",
      });

      await pipeline(fs.createReadStream(filePath), response);
      return;
    }

    await runTool(argsForJob(format, url, jobDir, itemIndex));

    const generated = await newestFile(jobDir);
    if (!generated) {
      throw new Error("The download finished, but no output file was created.");
    }

    const downloadName = safeDownloadName(format, generated.filePath);
    const contentType = contentTypeForFile(generated.filePath);

    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": generated.stats.size,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Cache-Control": "no-store",
    });

    await pipeline(fs.createReadStream(generated.filePath), response);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 500, { error: error.message || "Download failed." });
    } else {
      response.destroy(error);
    }
  } finally {
    if (jobDir) {
      fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(rootDir, normalizedPath);
  const relativePath = path.relative(rootDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || relativePath.startsWith(".git")) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }

  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile()) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    const range = request.headers.range;

    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);

      if (!match) {
        response.writeHead(416, {
          "Content-Range": `bytes */${stats.size}`,
          "Accept-Ranges": "bytes",
        });
        response.end();
        return;
      }

      const requestedStart = match[1];
      const requestedEnd = match[2];
      const suffixLength = !requestedStart && requestedEnd ? Number(requestedEnd) : 0;
      const start = suffixLength
        ? Math.max(0, stats.size - suffixLength)
        : Math.max(0, Number(requestedStart || 0));
      const end = suffixLength
        ? stats.size - 1
        : Math.min(stats.size - 1, requestedEnd ? Number(requestedEnd) : stats.size - 1);

      if (start > end || start >= stats.size) {
        response.writeHead(416, {
          "Content-Range": `bytes */${stats.size}`,
          "Accept-Ranges": "bytes",
        });
        response.end();
        return;
      }

      response.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Accept-Ranges": "bytes",
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      await pipeline(fs.createReadStream(filePath, { start, end }), response);
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Accept-Ranges": "bytes",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    await pipeline(fs.createReadStream(filePath), response);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      ytDlp: ytDlpPath,
      ffmpeg: ffmpegPath || "available through yt-dlp PATH lookup",
      cookies: cookiePath ? "loaded" : "not found",
      instagramProvider: instagramProviderExePath || "python script",
    });
    return;
  }

  if (request.method === "GET" && request.url === "/api/app-info") {
    sendJson(response, 200, {
      name: packageInfo.name || "simple-tools",
      version: packageInfo.version || "0.0.0",
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/convert") {
    handleConvert(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/resolve") {
    handleResolve(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/provider/preview") {
    handleProviderPreview(request, response);
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/api/provider/thumbnail")) {
    proxyRemoteImage(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    serveStatic(request, response);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
});

server.listen(port, () => {
  console.log(`Simple Tools is running at http://localhost:${port}`);
});
