#!/usr/bin/env -S deno run -A
// run: deno run -A startup.js

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const INO_FILE = `${SCRIPT_DIR}stepper_websocket.ino`;
const ENV_FILE = `${SCRIPT_DIR}.env`;
const SERVER_FILE = `${SCRIPT_DIR}webserver_denojs.js`;
const TMP_DIR = "/tmp/stepper_websocket";
const TMP_INO = `${TMP_DIR}/stepper_websocket.ino`;

// ─── Helpers ────────────────────────────────────────────────────────

/** Run a command, return { success, stdout, stderr }. */
async function run(cmd, args = [], opts = {}) {
  const command = new Deno.Command(cmd, {
    args,
    stdout: opts.stdout ?? "piped",
    stderr: opts.stderr ?? "piped",
    stdin: opts.stdin ?? "null",
    ...opts,
  });
  const result = await command.output();
  return {
    success: result.success,
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

/** Run a command and stream output to the terminal. */
async function runLive(cmd, args = []) {
  const command = new Deno.Command(cmd, {
    args,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "null",
  });
  const result = await command.output();
  return result.success;
}

/** Check if a binary is available on PATH. */
async function hasBinary(name) {
  try {
    const result = await run("which", [name]);
    return result.success;
  } catch {
    return false;
  }
}

function log(msg) {
  console.log(`  ${msg}`);
}

function logStep(msg) {
  console.log(`\n  ▸ ${msg}`);
}

function logError(msg) {
  console.error(`\n  ✗ ${msg}`);
}

function logOk(msg) {
  console.log(`  ✓ ${msg}`);
}

// ─── Banner ─────────────────────────────────────────────────────────

console.log(`
  ╔══════════════════════════════════════╗
  ║   Microscope Motorization Setup      ║
  ║   ESP32 + Stepper Motor Control      ║
  ╚══════════════════════════════════════╝
`);

// ─── Step 1: Check / install arduino-cli ────────────────────────────

logStep("Checking prerequisites...");

let arduinoCliBin = "arduino-cli";

if (await hasBinary("arduino-cli")) {
  const ver = await run("arduino-cli", ["version"]);
  logOk(`arduino-cli found: ${ver.stdout.trim()}`);
} else {
  log("arduino-cli not found.");
  const install = confirm("  Install arduino-cli now?");
  if (!install) {
    logError("arduino-cli is required for flashing firmware. Exiting.");
    Deno.exit(1);
  }

  logStep("Installing arduino-cli...");
  const home = Deno.env.get("HOME");
  const binDir = `${home}/.local/bin`;

  // Ensure bin directory exists
  await Deno.mkdir(binDir, { recursive: true });

  const curlResult = await run("curl", [
    "-fsSL",
    "https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh",
  ]);
  if (!curlResult.success) {
    logError("Failed to download arduino-cli installer.");
    Deno.exit(1);
  }

  // Pipe the install script to sh with BINDIR set
  const shCmd = new Deno.Command("sh", {
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...Deno.env.toObject(), BINDIR: binDir },
  });
  const shProcess = shCmd.spawn();
  const writer = shProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode(curlResult.stdout));
  await writer.close();
  const shResult = await shProcess.output();

  if (!shResult.success) {
    logError("arduino-cli installation failed.");
    Deno.exit(1);
  }

  arduinoCliBin = `${binDir}/arduino-cli`;

  if (await hasBinary(arduinoCliBin)) {
    logOk("arduino-cli installed successfully.");
  } else {
    logError(`arduino-cli binary not found at ${arduinoCliBin}. Check your PATH.`);
    Deno.exit(1);
  }
}

// ─── Step 2: Ask about flashing ─────────────────────────────────────

let espIp = "";
let espPort = "";

const shouldFlash = confirm("\n  Flash ESP32 firmware? (skip if already flashed)");

if (shouldFlash) {
  // ─── Step 3: Read .env for WiFi credentials ────────────────────────

  logStep("Reading WiFi credentials...");

  let wifiSsid = "";
  let wifiPassword = "";

  try {
    const envContent = await Deno.readTextFile(ENV_FILE);
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key === "wifi_ssid") wifiSsid = value;
      if (key === "wifi_password") wifiPassword = value;
    }
  } catch {
    log(".env file not found.");
  }

  if (!wifiSsid) {
    wifiSsid = prompt("  Enter WiFi SSID:") ?? "";
  }
  if (!wifiPassword) {
    wifiPassword = prompt("  Enter WiFi password:") ?? "";
  }

  if (!wifiSsid || !wifiPassword) {
    logError("WiFi SSID and password are required.");
    Deno.exit(1);
  }

  // Save to .env for next time
  await Deno.writeTextFile(ENV_FILE, `wifi_ssid=${wifiSsid}\nwifi_password=${wifiPassword}\n`);
  logOk(`WiFi credentials saved to .env (SSID: ${wifiSsid})`);

  // ─── Step 4: Install ESP32 board package + libraries ───────────────

  logStep("Updating arduino-cli core index...");
  await runLive(arduinoCliBin, ["core", "update-index"]);

  logStep("Installing ESP32 board package (this may take a few minutes)...");
  if (!await runLive(arduinoCliBin, ["core", "install", "esp32:esp32"])) {
    logError("Failed to install ESP32 board package.");
    Deno.exit(1);
  }
  logOk("ESP32 board package installed.");

  logStep("Installing required Arduino libraries...");

  // Remove old me-no-dev libs that conflict with ESP32 core 3.x
  const arduinoLibDir = `${Deno.env.get("HOME")}/Arduino/libraries`;
  for (const oldLib of ["ESPAsyncWebServer", "AsyncTCP", "ESPAsyncTCP"]) {
    try {
      await Deno.remove(`${arduinoLibDir}/${oldLib}`, { recursive: true });
      log(`Removed old conflicting library: ${oldLib}`);
    } catch { /* not present, fine */ }
  }

  // Install the ESP32Async forks (compatible with ESP32 core 3.x)
  // Note: 'Async TCP' must be listed explicitly — it is NOT pulled in automatically
  // as a dependency of ESP Async WebServer, and ESPAsyncWebServer.h includes AsyncTCP.h
  for (const lib of ["ESP Async WebServer", "Async TCP", "ArduinoJson"]) {
    log(`Installing ${lib}...`);
    await runLive(arduinoCliBin, ["lib", "install", lib]);
  }
  logOk("Libraries installed.");

  // ─── Step 5: Prepare firmware with WiFi credentials ────────────────

  logStep("Preparing firmware...");

  const inoSource = await Deno.readTextFile(INO_FILE);
  const inoPatched = inoSource
    .replace("{{wifi_ssid}}", wifiSsid)
    .replace("{{wifi_password}}", wifiPassword);

  await Deno.mkdir(TMP_DIR, { recursive: true });
  await Deno.writeTextFile(TMP_INO, inoPatched);
  logOk("Firmware prepared with WiFi credentials.");

  // ─── Step 6: Detect ESP32 board ────────────────────────────────────

  logStep("Detecting connected ESP32...");

  const boardListResult = await run(arduinoCliBin, ["board", "list", "--format", "json"]);
  if (!boardListResult.success) {
    logError("Failed to detect boards.");
    Deno.exit(1);
  }

  let boards = [];
  try {
    const parsed = JSON.parse(boardListResult.stdout);
    // arduino-cli returns either an array or { detected_ports: [...] }
    boards = Array.isArray(parsed) ? parsed : (parsed.detected_ports ?? []);
  } catch {
    logError("Failed to parse board list.");
    Deno.exit(1);
  }

  // Look for an ESP32 or any serial port
  for (const entry of boards) {
    const port = entry.port ?? entry;
    const address = port.address ?? port.port ?? "";
    if (address && (address.includes("ttyUSB") || address.includes("ttyACM"))) {
      espPort = address;
      break;
    }
  }

  if (!espPort) {
    logError("No ESP32 found on USB. Make sure it's connected.");
    log("Detected ports:");
    for (const entry of boards) {
      const port = entry.port ?? entry;
      log(`  - ${port.address ?? port.port ?? JSON.stringify(port)}`);
    }
    Deno.exit(1);
  }

  logOk(`ESP32 detected on ${espPort}`);

  // ─── Step 6b: Ensure serial port is accessible ─────────────────────

  try {
    await Deno.open(espPort, { read: true });
  } catch {
    log(`${espPort} is not readable — fixing permissions with sudo...`);
    if (!await runLive("sudo", ["chmod", "666", espPort])) {
      logError(`Could not set permissions on ${espPort}.`);
      log("Permanent fix: sudo usermod -aG dialout $USER  (then log out and back in)");
      Deno.exit(1);
    }
    logOk("Serial port permissions set.");
  }

  // ─── Step 7: Compile + upload ──────────────────────────────────────

  logStep("Compiling firmware (this may take a while on first run)...");
  if (!await runLive(arduinoCliBin, [
    "compile",
    "--fqbn", "esp32:esp32:esp32s3",
    TMP_DIR,
  ])) {
    logError("Compilation failed.");
    Deno.exit(1);
  }
  logOk("Compilation successful.");

  logStep(`Uploading firmware to ${espPort}...`);
  if (!await runLive(arduinoCliBin, [
    "upload",
    "--fqbn", "esp32:esp32:esp32s3",
    "-p", espPort,
    TMP_DIR,
  ])) {
    logError("Upload failed.");
    Deno.exit(1);
  }
  logOk("Firmware uploaded successfully!");

  // ─── Step 8: Read ESP32 IP from serial ─────────────────────────────

  logStep("Waiting for ESP32 to connect to WiFi...");
  log("(reading serial output, timeout 20s)");

  try {
    espIp = await readEspIpFromSerial(espPort, 20_000);
    logOk(`ESP32 connected! IP: ${espIp}`);
  } catch {
    log("Could not detect ESP32 IP automatically.");
    const manualIp = prompt("  Enter ESP32 IP manually (or leave blank to skip):");
    if (manualIp) espIp = manualIp;
  }
}

// If we didn't flash but user might know the IP
if (!espIp && !shouldFlash) {
  const manualIp = prompt("\n  Enter ESP32 IP address (or leave blank to enter in UI):");
  if (manualIp) espIp = manualIp;
}

// ─── Step 9: Open browser + start server ────────────────────────────

logStep("Starting web server...");

const port = 8000;

// Open browser in background (non-blocking, ignore errors)
setTimeout(async () => {
  try {
    await run("xdg-open", [`http://localhost:${port}`]);
  } catch {
    log(`Open http://localhost:${port} in your browser.`);
  }
}, 1000);

// Start the Deno web server as the foreground process
// -A: the server also spawns python/arduino-cli (--allow-run) and reads HOME (--allow-env)
const serverArgs = ["run", "-A", SERVER_FILE, "--port", String(port)];
if (espIp) {
  serverArgs.push("--esp", espIp);
}

const serverCmd = new Deno.Command(Deno.execPath(), {
  args: serverArgs,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const serverProcess = serverCmd.spawn();
await serverProcess.output();

// ─── Serial IP reader ───────────────────────────────────────────────

async function readEspIpFromSerial(port, timeoutMs) {
  const command = new Deno.Command(arduinoCliBin, {
    args: ["monitor", "-p", port, "--raw", "-c", "baudrate=115200"],
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });

  const process = command.spawn();
  const reader = process.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), timeoutMs)
  );

  const readLoop = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // The firmware prints: "Connected!  IP: 192.168.x.x"
      const match = buffer.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/);
      if (match) {
        process.kill("SIGTERM");
        return match[1];
      }
    }
    throw new Error("Serial closed without IP");
  })();

  try {
    return await Promise.race([readLoop, timeout]);
  } finally {
    try {
      process.kill("SIGTERM");
    } catch { /* already dead */ }
  }
}
