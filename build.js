const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = __dirname;
const buildDir = path.join(projectDir, ".build");
const distDir = path.join(projectDir, "dist");
const packageDir = path.join(distDir, "VideoDownloader");
const outputZip = path.join(distDir, "VideoDownloader.zip");
const outputExe = path.join(projectDir, "VideoDownloader.exe");
const launcherPath = path.join(projectDir, "launcher.js");
const seaConfigPath = path.join(buildDir, "sea-config.json");
const seaBlobPath = path.join(buildDir, "video-downloader-launcher.blob");
const postjectCli = path.join(projectDir, "node_modules", "postject", "dist", "cli.js");
const providerDistDir = path.join(buildDir, "provider-dist");
const providerExe = path.join(providerDistDir, "instagram_provider.exe");

function step(message) {
  console.log(`[build] ${message}`);
}

function requireFile(filePath, message) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${message}\nMissing: ${filePath}`);
  }
}

function run(command, args) {
  step(`${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: projectDir,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${command} ${args.join(" ")}`);
  }
}

function copyFile(source, target) {
  requireFile(source, `Missing required package file: ${path.basename(source)}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(source, target) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Missing required package directory: ${source}`);
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function copyAssets(target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  for (const filename of [
    "figma-background.png",
    "sakura-rain-background.jpg",
    "test-thumb.jpg",
  ]) {
    copyFile(path.join(projectDir, "assets", filename), path.join(target, filename));
  }
}

function buildLauncherExe() {
  step("building launcher exe");

  requireFile(postjectCli, "postject is not installed. Run npm install before npm run build.");
  requireFile(launcherPath, "Missing launcher.js.");
  requireFile(path.join(projectDir, "server.js"), "Missing existing server.js.");
  requireFile(path.join(projectDir, "index.html"), "Missing existing index.html.");

  fs.writeFileSync(seaConfigPath, JSON.stringify({
    main: launcherPath,
    output: seaBlobPath,
    disableExperimentalSEAWarning: true,
  }, null, 2));

  step("creating SEA launcher blob");
  run(process.execPath, ["--experimental-sea-config", seaConfigPath]);

  step("copying Node runtime to VideoDownloader.exe");
  fs.copyFileSync(process.execPath, outputExe);

  step("injecting launcher into VideoDownloader.exe");
  run(process.execPath, [
    postjectCli,
    outputExe,
    "NODE_SEA_BLOB",
    seaBlobPath,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    "--overwrite",
  ]);
}

function buildInstagramProvider() {
  step("building bundled Instagram provider");

  requireFile(path.join(projectDir, "instagram_provider.py"), "Missing instagram_provider.py.");

  run("python", [
    "-m",
    "PyInstaller",
    "--clean",
    "--noconfirm",
    "--onefile",
    "--name",
    "instagram_provider",
    "--distpath",
    providerDistDir,
    "--workpath",
    path.join(buildDir, "provider-work"),
    "--specpath",
    path.join(buildDir, "provider-spec"),
    path.join(projectDir, "instagram_provider.py"),
  ]);

  requireFile(providerExe, "PyInstaller did not create instagram_provider.exe.");
}

function assemblePackage() {
  step("assembling portable package folder");

  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });

  for (const filename of [
    "VideoDownloader.exe",
    "server.js",
    "package.json",
    "index.html",
    "styles.css",
    "script.js",
    "start.bat",
    "start-server.bat",
    "start-server-hidden.vbs",
    "install-autostart.bat",
    "uninstall-autostart.bat",
    "使用说明和报错说明.txt",
  ]) {
    copyFile(path.join(projectDir, filename), path.join(packageDir, filename));
  }

  copyAssets(path.join(packageDir, "assets"));
  copyDirectory(path.join(projectDir, "bin"), path.join(packageDir, "bin"));
  copyFile(providerExe, path.join(packageDir, "bin", "instagram_provider.exe"));

  step("creating zip package");
  fs.rmSync(outputZip, { force: true });
  run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Compress-Archive -LiteralPath '${packageDir.replace(/'/g, "''")}' -DestinationPath '${outputZip.replace(/'/g, "''")}' -Force`,
  ]);
}

function main() {
  step("building complete one-click package");

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  buildLauncherExe();
  buildInstagramProvider();
  assemblePackage();

  step("build complete");
  console.log(packageDir);
  console.log(outputZip);
}

try {
  main();
} catch (error) {
  console.error("");
  console.error("[build] failed");
  console.error(error.message || error);
  process.exit(1);
}
