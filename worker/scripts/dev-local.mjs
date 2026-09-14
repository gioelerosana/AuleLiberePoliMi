#!/usr/bin/env node
/**
 * Local development stack for AuleLiberePoliMi.
 *
 * Starts:
 *   1. a static server for webapp/settings on WEBAPP_PORT (repo-relative path)
 *   2. a Cloudflare quick tunnel exposing the Mini App over HTTPS
 *   3. `wrangler dev` for the Telegram Worker on WORKER_PORT
 *   4. a Cloudflare quick tunnel exposing the Worker over HTTPS
 *   5. the Telegram webhook of the test bot, pointed at the Worker tunnel
 *
 * The production bot is never touched: the token comes from worker/.dev.vars
 * and the webhook is deleted again on exit (unless KEEP_WEBHOOK=1).
 *
 * Usage:
 *   npm run dev:local            full stack
 *   npm run dev:webapp           Mini App only (browser, no Telegram)
 *   npm run dev:local -- --no-webhook   start everything but skip setWebhook
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(scriptDir, "..");
const repoRoot = resolve(workerDir, "..");
const webappDir = resolve(repoRoot, "webapp", "settings");
const toolsDir = join(workerDir, ".tools");
const cloudflaredLocalPath = join(
  toolsDir,
  process.platform === "win32" ? "cloudflared.exe" : "cloudflared",
);

const WORKER_PORT = Number(process.env.WORKER_PORT ?? 8787);
const WEBAPP_PORT = Number(process.env.WEBAPP_PORT ?? 8788);
const SECRET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const IS_WEBAPP_ONLY = process.argv.includes("--webapp-only");
const SKIP_WEBHOOK = process.argv.includes("--no-webhook");
const KEEP_WEBHOOK = process.env.KEEP_WEBHOOK === "1";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const children = new Set();
const servers = [];
let shuttingDown = false;

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

function log(message) {
  console.log(message);
}

function fatal(message) {
  console.error(`\n✖ ${message}\n`);
  for (const child of children) child.kill("SIGTERM");
  for (const server of servers) server.close();
  process.exit(1);
}

function createPrefixer(name) {
  let partial = "";
  return {
    push(chunk) {
      if (!chunk) return;
      const lines = (partial + chunk).split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) console.log(`[${name}] ${line}`);
    },
    flush() {
      if (partial) console.log(`[${name}] ${partial}`);
      partial = "";
    },
  };
}

function prefixStream(name, stream) {
  const prefixer = createPrefixer(name);
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => prefixer.push(chunk));
  stream.on("end", () => prefixer.flush());
}

function spawnChild(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.add(child);
  prefixStream(name, child.stdout);
  prefixStream(name, child.stderr);
  child.on("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    void shutdown(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[${name}] exited unexpectedly (code ${code ?? signal})`);
      void shutdown(1);
    }
  });
  return child;
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("\nArresto ambiente locale…");

  if (!KEEP_WEBHOOK && !SKIP_WEBHOOK) {
    const { BOT_TOKEN } = await readDevVars().catch(() => ({}));
    if (BOT_TOKEN) {
      await telegramCall(BOT_TOKEN, "deleteWebhook", {}).catch((error) =>
        console.warn(`[webhook] deleteWebhook non riuscito: ${error.message}`),
      );
    }
  }

  for (const child of children) {
    child.kill("SIGTERM");
  }
  for (const server of servers) {
    server.close();
  }

  setTimeout(() => process.exit(code), 300).unref();
}

async function readDevVars() {
  const content = await readFile(join(workerDir, ".dev.vars"), "utf8");
  const vars = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) vars[key] = value;
  }
  return vars;
}

async function telegramCall(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.description ?? `HTTP ${response.status}`);
  }
  return payload.result;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForPublicUrl(url, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "nessuna risposta";
  log(`Attendo che ${label} sia raggiungibile…`);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await delay(500);
  }
  throw new Error(`${label} non raggiungibile su ${url} entro 15s (${lastError})`);
}

async function registerWebhook(token, payload) {
  const attempts = 12;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await telegramCall(token, "setWebhook", payload);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(
        `[webhook] tentativo ${attempt}/${attempts} non riuscito (${error.message}), riprovo tra 5s…`,
      );
      await delay(5_000);
    }
  }
}

function startWebappServer(port) {
  const root = normalize(webappDir);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const requested = decodeURIComponent(url.pathname);
    const relative = requested === "/" ? "/index.html" : requested;
    const filePath = normalize(join(root, relative));
    if (!filePath.startsWith(root + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    stat(filePath)
      .then((info) => {
        if (!info.isFile()) throw new Error("not a file");
        response.writeHead(200, {
          "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        createReadStream(filePath).pipe(response);
      })
      .catch(() => {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      });
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      servers.push(server);
      resolvePromise(server);
    });
  });
}

function cloudflaredAssetName() {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  if (process.platform === "darwin") return `cloudflared-darwin-${arch}.tgz`;
  if (process.platform === "win32") return `cloudflared-windows-${arch}.exe`;
  return `cloudflared-linux-${arch}`;
}

async function ensureCloudflared() {
  if (process.env.CLOUDFLARED) return process.env.CLOUDFLARED;

  const onPath = spawnSync("sh", ["-c", "command -v cloudflared"], {
    encoding: "utf8",
  }).stdout?.trim();
  if (onPath) return onPath;

  try {
    await stat(cloudflaredLocalPath);
    return cloudflaredLocalPath;
  } catch {
    // Not downloaded yet.
  }

  if (process.platform === "win32") {
    fatal(
      "cloudflared non trovato. Installalo manualmente oppure imposta CLOUDFLARED=/percorso/cloudflared.",
    );
  }

  const asset = cloudflaredAssetName();
  if (asset.endsWith(".tgz")) {
    fatal("Su macOS installa cloudflared con Homebrew e riprova: brew install cloudflared");
  }
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  log(`cloudflared non trovato: lo scarico una volta sola in ${cloudflaredLocalPath}`);
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await mkdir(toolsDir, { recursive: true });
    await writeFile(cloudflaredLocalPath, buffer);
  } catch (error) {
    fatal(
      `Download di cloudflared fallito (${error.message}).\n` +
        "Installa cloudflared e riprova, oppure imposta CLOUDFLARED=/percorso/cloudflared.",
    );
  }
  return cloudflaredLocalPath;
}

function startTunnel(cloudflared, name, target) {
  const child = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--url", target], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);

  return new Promise((resolvePromise, reject) => {
    let output = "";
    let settled = false;
    let stopping = false;
    const prefixer = createPrefixer(name);
    const pattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
    const timeout = setTimeout(() => {
      if (settled) return;
      stopping = true;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Tunnel ${name}: URL non ricevuto entro 30s`));
    }, 30_000);

    const onChunk = (chunk) => {
      const text = chunk.toString();
      if (!settled) {
        output += text;
        const match = output.match(pattern);
        if (match) {
          settled = true;
          clearTimeout(timeout);
          resolvePromise(match[0]);
        }
      }
      prefixer.push(text);
    };

    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", (error) => {
      if (settled) return;
      stopping = true;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) {
        if (!stopping && !shuttingDown) {
          console.error(`[${name}] tunnel terminato inaspettatamente (code ${code})`);
          void shutdown(1);
        }
        return;
      }
      stopping = true;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Tunnel ${name}: cloudflared terminato (code ${code})`));
    });
  });
}

async function findWranglerCommand() {
  const localBinary = join(
    workerDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  try {
    await stat(localBinary);
    return localBinary;
  } catch {
    return "npx";
  }
}

async function waitForWorkerHealth(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Worker not ready yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Worker non pronto su http://127.0.0.1:${port}/health entro 30s`);
}

function startWebappOnly() {
  return startWebappServer(WEBAPP_PORT).then(() => {
    log(`Mini App in locale: http://127.0.0.1:${WEBAPP_PORT}`);
    log("Fuori da Telegram viene usato localStorage come fallback.");
    log("Ctrl+C per fermare.");
  });
}

async function startFullStack() {
  const vars = await readDevVars().catch(() => {
    fatal(
      "File worker/.dev.vars mancante.\n" +
        "  cp .dev.vars.example .dev.vars\n" +
        "poi inserisci il token del bot di test.",
    );
  });

  const botToken = vars.BOT_TOKEN;
  if (!botToken || !/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    fatal("BOT_TOKEN in worker/.dev.vars mancante o non valido (atteso formato 123456:ABC…).");
  }

  let webhookSecret = vars.WEBHOOK_SECRET;
  if (webhookSecret && !SECRET_PATTERN.test(webhookSecret)) {
    fatal("WEBHOOK_SECRET deve avere 16-128 caratteri tra A-Z a-z 0-9 _ -.");
  }
  const secretFromVars = Boolean(webhookSecret);
  webhookSecret ||= randomBytes(24).toString("base64url");

  const me = await telegramCall(botToken, "getMe", {}).catch((error) =>
    fatal(`Il token del bot di test non funziona: ${error.message}`),
  );
  const cloudflared = await ensureCloudflared();

  await startWebappServer(WEBAPP_PORT);
  const webappTunnel = await startTunnel(
    cloudflared,
    "tunnel:webapp",
    `http://127.0.0.1:${WEBAPP_PORT}`,
  );

  const workerTunnel = await startTunnel(
    cloudflared,
    "tunnel:worker",
    `http://127.0.0.1:${WORKER_PORT}`,
  );

  const webappReachable = waitForPublicUrl(`${webappTunnel}/`, "la Mini App").catch(() => {
    console.warn("La Mini App non risponde ancora dal tunnel, continuo comunque.");
  });

  const wrangler = await findWranglerCommand();
  const wranglerArgs = [
    ...(wrangler === "npx" ? ["wrangler"] : []),
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    String(WORKER_PORT),
    "--var",
    `WEBAPP_URL:${webappTunnel}`,
  ];
  if (!secretFromVars) {
    wranglerArgs.push("--var", `WEBHOOK_SECRET:${webhookSecret}`);
  }
  spawnChild("worker", wrangler, wranglerArgs, { cwd: workerDir, env: process.env });

  try {
    await Promise.all([waitForWorkerHealth(WORKER_PORT), webappReachable]);
  } catch (error) {
    fatal(error.message);
  }

  const webhookUrl = `${workerTunnel}/telegram/webhook`;
  let webhookLine = "saltato (--no-webhook)";
  if (!SKIP_WEBHOOK) {
    await waitForPublicUrl(`${workerTunnel}/health`, "il Worker").catch((error) =>
      console.warn(`[webhook] ${error.message}: provo comunque a registrarlo.`),
    );
    await registerWebhook(botToken, {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }).catch((error) => fatal(`setWebhook fallito: ${error.message}`));
    webhookLine = webhookUrl;
    if (!KEEP_WEBHOOK) {
      webhookLine += "  (rimosso all'uscita)";
    }
  }

  const username = me.username ? `@${me.username}` : me.first_name;
  log("");
  log("───────────────────────────────────────────────────────────");
  log("  AuleLiberePoliMi — ambiente locale");
  log("───────────────────────────────────────────────────────────");
  log(`  Bot di test   ${username}  (da worker/.dev.vars)`);
  log(`  Mini App      ${webappTunnel}`);
  log(`                http://127.0.0.1:${WEBAPP_PORT}`);
  log(`  Worker        ${workerTunnel}`);
  log(`                http://127.0.0.1:${WORKER_PORT}/health`);
  log(`  Webhook       ${webhookLine}`);
  log("");
  log("  Apri Telegram sul bot di test e premi /start.");
  log("  Ctrl+C ferma tutto e rimuove il webhook del bot di test.");
  log("───────────────────────────────────────────────────────────");
  log("");
}

if (IS_WEBAPP_ONLY) {
  startWebappOnly().catch((error) => fatal(error.message));
} else {
  startFullStack().catch((error) => fatal(error.message));
}
