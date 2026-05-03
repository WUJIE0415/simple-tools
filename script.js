const input = document.getElementById("link-input");
const appRoot = document.getElementById("appRoot");
const button = document.getElementById("glassActionButton");
const menu = document.getElementById("result-menu");
const title = document.querySelector("h1");
const titleText = document.getElementById("title-text");
const settingsWidget = document.getElementById("settings-widget");
const settingsButton = document.getElementById("glassMenuButton");
const settingsPopover = document.getElementById("settings-popover");
const settingsVersion = document.getElementById("settings-version");
const updateStatus = document.getElementById("update-status");
const backgroundChoiceTitle = document.getElementById("background-choice-title");
const backgroundSwatches = [...document.querySelectorAll("[data-background-choice]")];
const iconPaste = document.getElementById("icon-paste");
const iconDownload = document.getElementById("icon-download");
const iconCheck = document.getElementById("icon-check");
const progressRing = document.getElementById("progress-ring");
const ringArc = document.getElementById("ring-arc");

const circumference = 2 * Math.PI * 12;
const backgroundStorageKey = "simple-tools-background";
const backgrounds = new Set(["blue", "sakura"]);
const backgroundLabels = {
  blue: "Blue",
  sakura: "Green",
};
let mode = "paste";
let frameId = 0;
let currentJob = null;
let detectedUrl = "";
let selectedItem = null;
let mediaItems = [];
let resolveTimer = 0;
let resolveToken = 0;
let resolveController = null;
let menuTransitionTimer = 0;
let scrollbarReleaseTimer = 0;
let scrollbarPull = 0;
let scrollbarPullEdge = "";
let liquidGlassInstance = null;

const icons = {
  back: '<path d="M12.6 5.4 8 10l4.6 4.6" /><path d="M8.25 10H16" />',
  clear: '<circle cx="10" cy="10" r="7" /><path d="m7.55 7.55 4.9 4.9" /><path d="m12.45 7.55-4.9 4.9" />',
  image: '<rect x="3.15" y="4.15" width="13.7" height="11.7" rx="2.3" /><circle cx="8" cy="8.1" r="1.25" /><path d="m4.65 14.45 3.75-3.75 2.2 2.2 1.45-1.45 3.35 3.35" />',
  mp3: '<path d="M8 13.55V6.55l7-1.35v6.95" /><circle cx="6.2" cy="14.2" r="1.85" /><circle cx="13.2" cy="12.95" r="1.85" />',
  video: '<rect x="3" y="5" width="10.6" height="10" rx="2.1" /><path d="m13.6 8 3.4-2v8l-3.4-2" />',
  wav: '<path d="M3 10h2l1.4-4.25 2.5 8.5 2.2-6.85 1.6 4.15 1.35-2.45H17" />',
  download: '<path d="M10 3.35v8.2" /><path d="m6.75 8.35 3.25 3.3 3.25-3.3" /><path d="M5 16.45h10" />',
};

function smoothStep(a, b, value) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function roundedRectSdf(x, y, width, height, radius) {
  const qx = Math.abs(x) - width + radius;
  const qy = Math.abs(y) - height + radius;
  const outsideX = Math.max(qx, 0);
  const outsideY = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(outsideX * outsideX + outsideY * outsideY) - radius;
}

function generateLiquidDisplacementMap(width, height) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;

  if (!context) return "";

  let maxScale = 1;
  const rawValues = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const uvX = x / Math.max(1, width - 1);
      const uvY = y / Math.max(1, height - 1);
      const ix = uvX - 0.5;
      const iy = uvY - 0.5;
      const distanceToEdge = roundedRectSdf(ix, iy, 0.3, 0.2, 0.6);
      const displacement = smoothStep(0.8, 0, distanceToEdge - 0.15);
      const scaled = smoothStep(0, 1, displacement);
      const projectedX = (ix * scaled + 0.5) * width;
      const projectedY = (iy * scaled + 0.5) * height;
      const dx = projectedX - x;
      const dy = projectedY - y;

      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
      rawValues.push(dx, dy);
    }
  }

  const imageData = context.createImageData(width, height);
  const data = imageData.data;
  let rawIndex = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = rawValues[rawIndex];
      const dy = rawValues[rawIndex + 1];
      const edgeDistance = Math.min(x, y, width - x - 1, height - y - 1);
      const edgeFactor = Math.min(1, edgeDistance / 2);
      const r = (dx * edgeFactor) / maxScale + 0.5;
      const g = (dy * edgeFactor) / maxScale + 0.5;
      const pixelIndex = (y * width + x) * 4;

      data[pixelIndex] = Math.max(0, Math.min(255, r * 255));
      data[pixelIndex + 1] = Math.max(0, Math.min(255, g * 255));
      data[pixelIndex + 2] = Math.max(0, Math.min(255, g * 255));
      data[pixelIndex + 3] = 255;
      rawIndex += 2;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function createLiquidFilter(defs, id, mapUrl, displacementScale, aberrationIntensity) {
  defs.insertAdjacentHTML(
    "beforeend",
    `<filter id="${id}" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
      <feImage x="0" y="0" width="100%" height="100%" result="DISPLACEMENT_MAP" href="${mapUrl}" preserveAspectRatio="none" />
      <feColorMatrix in="DISPLACEMENT_MAP" type="matrix" values="0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0 0 0 1 0" result="EDGE_INTENSITY" />
      <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
        <feFuncA type="discrete" tableValues="0 ${aberrationIntensity * 0.05} 1" />
      </feComponentTransfer>
      <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />
      <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="${displacementScale}" xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED" />
      <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="RED_CHANNEL" />
      <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="${displacementScale - aberrationIntensity * 2.4}" xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED" />
      <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="GREEN_CHANNEL" />
      <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="${displacementScale - aberrationIntensity * 4.8}" xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED" />
      <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="BLUE_CHANNEL" />
      <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
      <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
      <feGaussianBlur in="RGB_COMBINED" stdDeviation="${Math.max(0.01, 0.12 - aberrationIntensity * 0.02)}" result="ABERRATED_BLURRED" />
      <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />
      <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
        <feFuncA type="table" tableValues="1 0" />
      </feComponentTransfer>
      <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />
      <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
    </filter>`,
  );
}

function initLiquidGlass() {
  if (document.getElementById("liquid-glass-svg")) return;

  const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

  svgNode.id = "liquid-glass-svg";
  svgNode.setAttribute("aria-hidden", "true");
  svgNode.setAttribute("focusable", "false");
  svgNode.setAttribute("width", "0");
  svgNode.setAttribute("height", "0");
  svgNode.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
  svgNode.append(defs);
  document.body.prepend(svgNode);

  createLiquidFilter(defs, "liquid-glass-action", generateLiquidDisplacementMap(112, 112), 47, 0.4);
  createLiquidFilter(defs, "liquid-glass-panel", generateLiquidDisplacementMap(256, 96), 17, 0.2);
}

function positionGlassActionButton() {
  if (!appRoot || !button) return;

  const inputRow = document.querySelector(".input-row");
  if (!inputRow) return;

  const rootRect = appRoot.getBoundingClientRect();
  const rowRect = inputRow.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const left = rowRect.right - rootRect.left - buttonRect.width;
  const top = rowRect.top - rootRect.top + (rowRect.height - buttonRect.height) / 2;

  button.style.left = `${left}px`;
  button.style.top = `${top}px`;
}

function markLiquidGlassChanged(element) {
  liquidGlassInstance?.markChanged?.(element);
}

function getSharedGlassConfig() {
  const isSakura = document.body.dataset.background === "sakura";
  const config = {
    bevelMode: 0,
    button: true,
    cornerRadius: 100,
    zRadius: 14,
    floating: true,
    blurAmount: 0,
    refraction: 1.24,
    chromAberration: 0.035,
    edgeHighlight: 0.37,
    specular: 0,
    fresnel: 2,
    distortion: 0,
    opacity: 1,
    brightness: 0.01,
    saturation: -0.11,
  };

  if (isSakura) {
    return {
      ...config,
      edgeHighlight: 0.25,
      opacity: 0.72,
      brightness: -0.06,
      saturation: -0.18,
    };
  }

  return config;
}

function syncLiquidGlassConfig() {
  const menuButton = document.querySelector("#glassMenuButton");
  const actionButton = document.querySelector("#glassActionButton");
  const config = getSharedGlassConfig();

  if (menuButton) menuButton.dataset.config = JSON.stringify(config);
  if (actionButton) actionButton.dataset.config = JSON.stringify(config);
}

async function loadLiquidGlassModule() {
  const localModulePath = "/node_modules/@ybouane/liquidglass/dist/index.js";
  const cdnModulePath = "https://cdn.jsdelivr.net/npm/@ybouane/liquidglass/dist/index.js";

  try {
    const response = await fetch(localModulePath, { method: "HEAD" });
    if (response.ok) return import(localModulePath);
  } catch {
    // Fall through to the official CDN build when running from packaged files.
  }

  return import(cdnModulePath);
}

async function initOfficialLiquidGlass() {
  const root = document.querySelector("#appRoot");
  const menuButton = document.querySelector("#glassMenuButton");
  const actionButton = document.querySelector("#glassActionButton");

  if (!root || !menuButton || !actionButton) return;

  positionGlassActionButton();
  syncLiquidGlassConfig();

  try {
    const { LiquidGlass } = await loadLiquidGlassModule();
    liquidGlassInstance = await LiquidGlass.init({
      root,
      glassElements: [menuButton, actionButton],
    });
  } catch (error) {
    console.warn("LiquidGlass init failed, fallback to CSS glass:", error);
    document.documentElement.classList.add("liquid-glass-fallback");
  }
}

function extractFirstUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match) return "";

  return match[0].replace(/[),.?!;:'"\]}，。！？；：、）】]+$/u, "");
}

function isUrl(value) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isImageSource(value) {
  return isUrl(value) || String(value || "").startsWith("/");
}

function getCurrentUrl() {
  return extractFirstUrl(input.value);
}

function normalizeInputValue() {
  const link = getCurrentUrl();

  if (link && input.value.trim() !== link) {
    input.value = link;
  }

  return link;
}

function shouldWaitForItemPicker(link) {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return host.endsWith("instagram.com") || host.endsWith("instagr.am");
  } catch {
    return false;
  }
}

function normalizeProviderPreviewItem(item, fallbackIndex) {
  const index = Number.isInteger(Number(item.index)) ? Number(item.index) : fallbackIndex + 1;
  const kind = item.type === "image" ? "image" : item.type === "video" ? "video" : "media";
  const caption = String(item.caption || "").replace(/\s+/g, " ").trim();

  return {
    index,
    title: item.filename || caption || `Item ${index}`,
    kind,
    thumbnail: item.thumb_url || "",
    extension: item.ext || "",
    filename: item.filename || "",
    caption,
  };
}

function setMode(nextMode) {
  mode = nextMode;
  button.dataset.state = nextMode;
  button.disabled = nextMode === "loading";
  button.setAttribute("aria-label", nextMode === "download" ? "Download media" : "Paste from clipboard");

  iconPaste.classList.toggle("off", nextMode !== "paste");
  iconDownload.classList.toggle("off", nextMode !== "download");
  progressRing.classList.toggle("off", nextMode !== "loading");
  iconCheck.classList.toggle("off", nextMode !== "done");
  markLiquidGlassChanged(button);
}

function setMenuOpen(isOpen) {
  menu.classList.toggle("open", isOpen);
  window.requestAnimationFrame(updateMenuScrollbar);
}

function setSettingsOpen(isOpen) {
  settingsPopover.hidden = !isOpen;
  settingsButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) setSettingsPanel("main");
  markLiquidGlassChanged(settingsButton);
}

function setSettingsPanel(panelName) {
  for (const panel of settingsPopover.querySelectorAll("[data-settings-panel]")) {
    panel.hidden = panel.dataset.settingsPanel !== panelName;
  }
}

function applyBackground(choice, persist = true) {
  const nextChoice = backgrounds.has(choice) ? choice : "blue";
  const previousChoice = document.body.dataset.background;
  document.body.dataset.background = nextChoice;
  syncLiquidGlassConfig();

  for (const swatch of backgroundSwatches) {
    swatch.setAttribute("aria-checked", String(swatch.dataset.backgroundChoice === nextChoice));
  }

  if (backgroundChoiceTitle) {
    backgroundChoiceTitle.textContent = `Color - ${backgroundLabels[nextChoice] || "Blue"}`;
  }

  if (persist) {
    localStorage.setItem(backgroundStorageKey, nextChoice);
  }

  window.requestAnimationFrame(() => {
    liquidGlassInstance?.markChanged?.();
  });
  window.setTimeout(() => {
    liquidGlassInstance?.markChanged?.();
  }, 280);

  if (persist && previousChoice !== nextChoice) {
    window.setTimeout(() => {
      window.location.reload();
    }, 120);
  }
}

async function loadAppInfo() {
  try {
    const response = await fetch("/api/app-info", { cache: "no-store" });
    if (!response.ok) throw new Error("Version unavailable");
    const payload = await response.json();
    settingsVersion.textContent = payload.version || "Unknown";
  } catch {
    settingsVersion.textContent = "Unknown";
  }
}

function svg(iconName) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", "0 0 20 20");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("focusable", "false");
  node.innerHTML = icons[iconName] || icons.video;
  return node;
}

function menuStatus(label, active = false) {
  const status = document.createElement("div");
  const dot = document.createElement("span");
  const text = document.createElement("p");

  status.className = "menu-status";
  dot.className = active ? "status-dot active" : "status-dot";
  dot.setAttribute("aria-hidden", "true");
  text.className = "menu-title";
  text.textContent = label;

  status.append(dot, text);
  return status;
}

function separator() {
  const node = document.createElement("div");
  node.className = "menu-separator";
  node.setAttribute("aria-hidden", "true");
  return node;
}

function menuButton({ action, className = "", format, icon, kbd = "", label }) {
  const node = document.createElement("button");
  const text = document.createElement("span");
  const key = document.createElement("kbd");

  node.type = "button";
  node.setAttribute("role", "menuitem");
  if (action) node.dataset.action = action;
  if (format) node.dataset.format = format;
  if (className) node.className = className;
  text.textContent = label;
  key.textContent = kbd;

  node.append(svg(icon), text, key);
  return node;
}

function menuContent(nodes) {
  const content = document.createElement("div");
  content.className = "menu-content";
  content.append(...nodes);
  return content;
}

function createMenuScrollbar() {
  const track = document.createElement("div");
  const thumb = document.createElement("div");

  track.className = "menu-scrollbar";
  thumb.className = "menu-scrollbar-thumb";
  track.setAttribute("aria-hidden", "true");
  track.append(thumb);
  return track;
}

function getMenuContent() {
  return menu.querySelector(".menu-content");
}

function updateMenuScrollbar() {
  const content = getMenuContent();
  const track = menu.querySelector(".menu-scrollbar");
  const thumb = menu.querySelector(".menu-scrollbar-thumb");
  if (!content || !track || !thumb) return;

  const maxScroll = content.scrollHeight - content.clientHeight;
  const shouldShow = maxScroll > 1;
  track.classList.toggle("visible", shouldShow);
  if (!shouldShow) return;

  const trackHeight = track.clientHeight;
  const baseHeight = Math.max(30, Math.round((content.clientHeight / content.scrollHeight) * trackHeight));
  const pulledHeight = Math.max(18, baseHeight - scrollbarPull);
  const scrollProgress = maxScroll > 0 ? content.scrollTop / maxScroll : 0;
  const travel = Math.max(0, trackHeight - pulledHeight);
  const top = scrollbarPullEdge === "top" ? 0 : scrollbarPullEdge === "bottom" ? travel : travel * scrollProgress;

  thumb.style.height = `${pulledHeight}px`;
  thumb.style.transform = `translateY(${top}px)`;
}

function releaseScrollbarPull() {
  window.clearTimeout(scrollbarReleaseTimer);
  scrollbarReleaseTimer = window.setTimeout(() => {
    const track = menu.querySelector(".menu-scrollbar");
    if (track) track.classList.add("releasing");
    scrollbarPull = 0;
    scrollbarPullEdge = "";
    updateMenuScrollbar();
    window.setTimeout(() => track && track.classList.remove("releasing"), 180);
  }, 120);
}

function handleMenuWheel(event) {
  const content = event.currentTarget;
  const maxScroll = content.scrollHeight - content.clientHeight;
  if (maxScroll <= 1) return;

  const atTop = content.scrollTop <= 0;
  const atBottom = content.scrollTop >= maxScroll - 1;
  const pullingTop = atTop && event.deltaY < 0;
  const pullingBottom = atBottom && event.deltaY > 0;

  if (!pullingTop && !pullingBottom) {
    if (scrollbarPull) {
      scrollbarPull = 0;
      scrollbarPullEdge = "";
      updateMenuScrollbar();
    }
    return;
  }

  scrollbarPullEdge = pullingTop ? "top" : "bottom";
  scrollbarPull = Math.min(22, scrollbarPull + Math.abs(event.deltaY) * 0.08);
  updateMenuScrollbar();
  releaseScrollbarPull();
}

function replaceMenu(view, nodes, animate = true) {
  const wasOpen = menu.classList.contains("open");
  const oldRect = menu.getBoundingClientRect();
  const content = menuContent(nodes);

  window.clearTimeout(menuTransitionTimer);
  menu.classList.remove("is-switching");
  menu.style.width = "";
  menu.style.height = "";
  scrollbarPull = 0;
  scrollbarPullEdge = "";

  menu.dataset.view = view;
  menu.replaceChildren(content);

  if (view === "items") {
    content.addEventListener("scroll", updateMenuScrollbar, { passive: true });
    content.addEventListener("wheel", handleMenuWheel, { passive: true });
    menu.append(createMenuScrollbar());
  }

  const shouldAnimate = animate && wasOpen && oldRect.width > 0 && oldRect.height > 0;

  if (shouldAnimate) {
    const newRect = menu.getBoundingClientRect();
    menu.classList.add("is-switching");
    content.classList.add("is-entering");
    menu.style.width = `${oldRect.width}px`;
    menu.style.height = `${oldRect.height}px`;
    menu.offsetHeight;

    window.requestAnimationFrame(() => {
      menu.style.width = `${newRect.width}px`;
      menu.style.height = `${newRect.height}px`;
      content.classList.remove("is-entering");
      updateMenuScrollbar();
    });

    menuTransitionTimer = window.setTimeout(() => {
      menu.classList.remove("is-switching");
      menu.style.width = "";
      menu.style.height = "";
      updateMenuScrollbar();
    }, 240);
  } else {
    window.requestAnimationFrame(updateMenuScrollbar);
  }
}

function renderFormatMenu() {
  const isImage = selectedItem && selectedItem.kind === "image";
  const statusText = selectedItem ? `Item ${selectedItem.index} selected` : "Link detected";
  const items = [
    menuStatus(statusText),
    separator(),
    isImage
      ? menuButton({ format: "image", icon: "image", label: "Download Image" })
      : menuButton({ format: "video", icon: "video", kbd: "Ctrl D", label: "Download Video" }),
  ];

  if (!isImage) {
    items.push(
      menuButton({ format: "mp3", icon: "mp3", kbd: "Ctrl M", label: "Export as MP3" }),
      menuButton({ format: "wav", icon: "wav", kbd: "Ctrl W", label: "Export as WAV" }),
    );
  }

  if (mediaItems.length > 1) {
    items.push(separator(), menuButton({ action: "back-to-items", icon: "back", label: "Choose Another" }));
  }

  items.push(separator(), menuButton({ action: "clear", className: "danger", icon: "clear", label: "Clear Paste" }));
  replaceMenu("formats", items);
}

function renderInspectingMenu() {
  replaceMenu("loading", [menuStatus("Reading media", true)], false);
}

function renderItemsMenu(items) {
  const nodes = [menuStatus(`${items.length} items found`), separator()];

  for (const item of items) {
    const row = document.createElement("button");
    const thumb = document.createElement("span");
    const fallback = document.createElement("span");
    const copy = document.createElement("span");
    const label = document.createElement("strong");
    const meta = document.createElement("small");

    row.type = "button";
    row.className = "media-item";
    row.dataset.itemIndex = String(item.index);
    row.setAttribute("role", "menuitem");

    thumb.className = "media-thumb";
    fallback.textContent = item.kind === "image" ? "IMG" : "VID";
    if (item.thumbnail && isImageSource(item.thumbnail)) {
      const image = document.createElement("img");
      image.src = item.thumbnail;
      image.alt = "";
      image.loading = "lazy";
      thumb.append(image);
    } else {
      thumb.append(fallback);
    }

    copy.className = "media-copy";
    label.textContent = item.title || `Item ${item.index}`;
    meta.textContent = item.kind === "image" ? "Image" : item.kind === "video" ? "Video" : "Media";
    copy.append(label, meta);
    row.append(thumb, copy);
    nodes.push(row);
  }

  nodes.push(
    separator(),
    menuButton({ action: "download-all", icon: "download", label: "Download All" }),
    menuButton({ action: "clear", className: "danger", icon: "clear", label: "Clear Paste" }),
  );
  replaceMenu("items", nodes);
}

function syncFromInput(options = {}) {
  const link = options.normalize ? normalizeInputValue() : getCurrentUrl();
  const hasValidLink = isUrl(link);

  if (!hasValidLink) {
    detectedUrl = "";
    selectedItem = null;
    mediaItems = [];
    setMenuOpen(false);
    setMode("paste");
    renderFormatMenu();
    return;
  }

  setMode("download");

  if (detectedUrl !== link) {
    detectedUrl = link;
    selectedItem = null;
    mediaItems = [];
    if (shouldWaitForItemPicker(link)) {
      renderInspectingMenu();
    } else {
      renderFormatMenu();
    }
    queueResolve(link);
  }

  setMenuOpen(mode !== "loading");
}

function resetProgress() {
  ringArc.style.strokeDashoffset = circumference;
}

function startProgressLoop() {
  if (mode === "loading") return;

  window.cancelAnimationFrame(frameId);
  setMenuOpen(false);
  setMode("loading");
  resetProgress();

  let start = 0;

  function tick(timestamp) {
    if (!start) start = timestamp;
    const elapsed = timestamp - start;
    const progress = 0.12 + 0.8 * (1 - Math.exp(-elapsed / 4200));

    ringArc.style.strokeDashoffset = circumference * (1 - progress);
    frameId = window.requestAnimationFrame(tick);
  }

  frameId = window.requestAnimationFrame(tick);
}

function finishProgress() {
  window.cancelAnimationFrame(frameId);
  ringArc.style.strokeDashoffset = 0;
  setMode("done");
}

function clearInput() {
  window.cancelAnimationFrame(frameId);
  if (resolveController) resolveController.abort();
  window.clearTimeout(resolveTimer);
  input.value = "";
  detectedUrl = "";
  selectedItem = null;
  mediaItems = [];
  resetProgress();
  renderFormatMenu();
  setMenuOpen(false);
  setMode("paste");
}

async function pasteFromClipboard() {
  input.focus();

  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      return;
    }

    const clipboardText = await navigator.clipboard.readText();
    if (!clipboardText.trim()) return;

    const link = extractFirstUrl(clipboardText);
    input.value = link || clipboardText.trim();
    syncFromInput({ normalize: Boolean(link) });

    if (isUrl(getCurrentUrl())) {
      setMenuOpen(true);
    }
  } catch {
    input.focus();
  }
}

function filenameFromHeader(header, fallback) {
  if (!header) return fallback;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);

  const asciiMatch = header.match(/filename="([^"]+)"/i);
  return asciiMatch ? asciiMatch[1] : fallback;
}

function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
}

function queueResolve(link) {
  window.clearTimeout(resolveTimer);

  resolveTimer = window.setTimeout(() => {
    resolveMediaItems(link, shouldWaitForItemPicker(link));
  }, 260);
}

async function resolveMediaItems(link, showLoading = false) {
  const token = resolveToken + 1;
  resolveToken = token;

  if (resolveController) resolveController.abort();
  resolveController = new AbortController();

  if (showLoading) {
    renderInspectingMenu();
    setMenuOpen(true);
  }

  try {
    const useProviderPreview = shouldWaitForItemPicker(link);
    const response = await fetch(useProviderPreview ? "/api/provider/preview" : "/api/resolve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: input.value, url: link }),
      signal: resolveController.signal,
    });

    if (!response.ok) throw new Error("Could not read media items.");

    const payload = await response.json();
    if (token !== resolveToken || detectedUrl !== link) return;

    mediaItems = Array.isArray(payload)
      ? payload.map(normalizeProviderPreviewItem)
      : Array.isArray(payload.items) ? payload.items : [];
    selectedItem = null;

    if (mediaItems.length > 1) {
      renderItemsMenu(mediaItems);
    } else {
      renderFormatMenu();
    }
  } catch (error) {
    if (error.name === "AbortError" || token !== resolveToken) return;
    mediaItems = [];
    selectedItem = null;
    renderFormatMenu();
  }
}

async function runJob(format) {
  const link = getCurrentUrl();
  if (currentJob || !isUrl(link)) return;

  const fallbackNames = {
    image: "image-download.jpg",
    video: "video-download.mp4",
    mp3: "audio-mp3.mp3",
    wav: "audio-wav.wav",
  };

  currentJob = { format };
  startProgressLoop();

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input.value.trim(),
        url: link,
        format,
        itemIndex: selectedItem ? selectedItem.index : 0,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Download failed.");
    }

    const blob = await response.blob();
    const filename = filenameFromHeader(response.headers.get("Content-Disposition"), fallbackNames[format]);

    downloadBlob(blob, filename);
    finishProgress();
    window.setTimeout(clearInput, 3400);
  } catch (error) {
    window.cancelAnimationFrame(frameId);
    resetProgress();
    setMode(isUrl(getCurrentUrl()) ? "download" : "paste");
    setMenuOpen(isUrl(getCurrentUrl()));
    input.setCustomValidity(error.message || "Download failed");
    input.reportValidity();
    input.setCustomValidity("");
  } finally {
    currentJob = null;
  }
}

async function runAllJob() {
  const link = getCurrentUrl();
  if (currentJob || !isUrl(link) || mediaItems.length === 0) return;

  currentJob = { format: "all" };
  startProgressLoop();

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input.value.trim(),
        url: link,
        format: "video",
        allItems: true,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Download failed.");
    }

    const blob = await response.blob();
    const filename = filenameFromHeader(response.headers.get("Content-Disposition"), "instagram-media.zip");

    downloadBlob(blob, filename);
    finishProgress();
    window.setTimeout(clearInput, 3400);
  } catch (error) {
    window.cancelAnimationFrame(frameId);
    resetProgress();
    setMode(isUrl(getCurrentUrl()) ? "download" : "paste");
    setMenuOpen(isUrl(getCurrentUrl()));
    input.setCustomValidity(error.message || "Download failed");
    input.reportValidity();
    input.setCustomValidity("");
  } finally {
    currentJob = null;
  }
}

input.addEventListener("input", () => syncFromInput());
input.addEventListener("focus", () => syncFromInput());
input.addEventListener("paste", () => window.setTimeout(() => syncFromInput({ normalize: true }), 0));

button.addEventListener("click", (event) => {
  event.stopPropagation();

  if (mode === "paste") {
    pasteFromClipboard();
    return;
  }

  if (mode === "download") {
    if (mediaItems.length > 1 && !selectedItem) {
      renderItemsMenu(mediaItems);
      setMenuOpen(true);
      return;
    }

    runJob(selectedItem && selectedItem.kind === "image" ? "image" : "video");
    return;
  }

  if (mode === "done") {
    clearInput();
  }
});

menu.addEventListener("click", (event) => {
  const item = event.target.closest("button");
  if (!item) return;

  if (item.dataset.action === "clear") {
    clearInput();
    return;
  }

  if (item.dataset.action === "back-to-items") {
    selectedItem = null;
    renderItemsMenu(mediaItems);
    setMenuOpen(true);
    return;
  }

  if (item.dataset.action === "download-all") {
    runAllJob();
    return;
  }

  if (item.dataset.itemIndex) {
    selectedItem = mediaItems.find((entry) => entry.index === Number(item.dataset.itemIndex)) || null;
    renderFormatMenu();
    setMenuOpen(true);
    return;
  }

  if (item.dataset.format) {
    runJob(item.dataset.format);
  }
});

settingsButton.addEventListener("click", () => {
  setSettingsOpen(settingsPopover.hidden);
});

settingsPopover.addEventListener("click", (event) => {
  const action = event.target.closest("[data-settings-action]");
  const swatch = event.target.closest("[data-background-choice]");

  if (action) {
    if (action.dataset.settingsAction === "background") {
      setSettingsPanel("background");
      return;
    }

    if (action.dataset.settingsAction === "main") {
      setSettingsPanel("main");
      return;
    }

    if (action.dataset.settingsAction === "check-update") {
      updateStatus.textContent = "Coming soon";
    }
  }

  if (swatch) {
    applyBackground(swatch.dataset.backgroundChoice);
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".settings-widget") && !event.target.closest("#glassMenuButton")) {
    setSettingsOpen(false);
  }

  if (!event.target.closest(".tool-cluster") && input.value.trim() === "") {
    setMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  const isCommand = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (isCommand && (key === "d" || key === "m" || key === "w") && isUrl(getCurrentUrl())) {
    if (mediaItems.length > 1 && !selectedItem) return;
    event.preventDefault();
    runJob(key === "m" ? "mp3" : key === "w" ? "wav" : "video");
  }

  if (event.key === "Escape") {
    setSettingsOpen(false);
  }
});

initLiquidGlass();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOfficialLiquidGlass, { once: true });
} else {
  initOfficialLiquidGlass();
}
applyBackground(localStorage.getItem(backgroundStorageKey), false);
loadAppInfo();
renderFormatMenu();
resetProgress();
setMode("paste");

window.addEventListener("resize", () => {
  positionGlassActionButton();
  liquidGlassInstance?.markChanged?.();
});

const fullTitle = "Simple tools, nothing more.";
let titleTimer = 0;
let typeTimer = 0;

function playTitleTypewriter() {
  window.clearTimeout(titleTimer);
  window.clearTimeout(typeTimer);

  title.classList.add("is-typing");
  titleText.textContent = "";

  let index = 0;

  function typeNext() {
    titleText.textContent = fullTitle.slice(0, index);
    index += 1;

    if (index <= fullTitle.length) {
      typeTimer = window.setTimeout(typeNext, 48);
    } else {
      title.classList.remove("is-typing");
      titleTimer = window.setTimeout(playTitleTypewriter, 5000);
    }
  }

  typeNext();
}

window.setTimeout(() => {
  titleTimer = window.setTimeout(playTitleTypewriter, 5000);
}, 1300);
