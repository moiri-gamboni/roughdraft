#!/usr/bin/env node

import { createServer } from "../dist/index.js";
import {
  ROUGHDRAFT_BIND_HOST,
  ROUGHDRAFT_LOOPBACK_HOSTS,
  ROUGHDRAFT_PUBLIC_HOST,
} from "../dist/network.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { findAvailablePort } from "../dist/ports.js";

const PACKAGE_SPEC = process.env.ROUGHDRAFT_PACKAGE_SPEC || "roughdraft@latest";
const MARKER_START = "<!-- roughdraft:start -->";
const MARKER_END = "<!-- roughdraft:end -->";
const CONFIG_FILES = ["CLAUDE.md", "AGENTS.md"];
const GUIDANCE_BLOCK = `<!-- roughdraft:start -->
## Roughdraft

When the user wants to open, review, comment on, or compare Markdown files, prefer Roughdraft over reading raw markdown in the terminal.

Use \`roughdraft "<absolute path to a markdown file or folder>"\` to open the relevant file or directory for the user.

If Roughdraft is not already running, start it with that command. After the user finishes reviewing in Roughdraft, continue the workflow by reading the markdown files from disk and making the requested changes there.

<!-- roughdraft:end -->`;

function logInstall(message) {
  console.log(`[roughdraft-install] ${message}`);
}

function failInstall(message) {
  console.error(`roughdraft install error: ${message}`);
  process.exit(1);
}

function installCommandOnPath() {
  const locator = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(locator, ["roughdraft"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return null;
  }

  const commandPath = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return commandPath || null;
}

function writeGuidanceBlock(targetFile) {
  const existing = fs.existsSync(targetFile)
    ? fs.readFileSync(targetFile, "utf8")
    : "";
  const filteredLines = [];
  let skipping = false;

  for (const line of existing.split(/\r?\n/)) {
    if (line === MARKER_START) {
      skipping = true;
      continue;
    }

    if (line === MARKER_END) {
      skipping = false;
      continue;
    }

    if (!skipping) {
      filteredLines.push(line);
    }
  }

  while (
    filteredLines.length > 0 &&
    filteredLines[filteredLines.length - 1] === ""
  ) {
    filteredLines.pop();
  }

  const nextContents =
    filteredLines.length > 0
      ? `${filteredLines.join("\n")}\n\n${GUIDANCE_BLOCK}\n`
      : `${GUIDANCE_BLOCK}\n`;

  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, nextContents);
}

function printHelp() {
  console.log("Usage:");
  console.log("  roughdraft [path]");
  console.log("  roughdraft install");
}

function runInstall() {
  logInstall(`Installing ${PACKAGE_SPEC}`);

  const installResult = spawnSync(
    "npm",
    ["install", "--global", PACKAGE_SPEC],
    {
      stdio: "inherit",
    },
  );

  if (installResult.status !== 0) {
    failInstall(`npm install --global ${PACKAGE_SPEC} failed`);
  }

  for (const filename of CONFIG_FILES) {
    const targetFile = path.join(os.homedir(), filename);
    writeGuidanceBlock(targetFile);
    logInstall(`Updated ${targetFile}`);
  }

  const installedPath = installCommandOnPath();
  if (installedPath) {
    logInstall(`Roughdraft is ready: ${installedPath}`);
    return;
  }

  logInstall(
    "Roughdraft installed, but the command is not on PATH in this shell yet.",
  );
  logInstall(
    "You may need to restart your terminal so your global npm bin directory is picked up.",
  );
}

function resolveTargetPath(inputPath) {
  const fallbackDir = process.cwd();
  if (!inputPath) {
    const projectDir = path.resolve(fallbackDir);
    return { projectDir, openPath: projectDir };
  }

  const resolvedPath = path.resolve(inputPath);
  const looksLikeMarkdownFile = resolvedPath.toLowerCase().endsWith(".md");

  try {
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return { projectDir: resolvedPath, openPath: resolvedPath };
    }

    if (stat.isFile()) {
      return {
        projectDir: path.dirname(resolvedPath),
        openPath: looksLikeMarkdownFile
          ? resolvedPath
          : path.dirname(resolvedPath),
      };
    }
  } catch {
    if (looksLikeMarkdownFile) {
      return {
        projectDir: path.dirname(resolvedPath),
        openPath: resolvedPath,
      };
    }
  }

  return { projectDir: resolvedPath, openPath: resolvedPath };
}

function hasChromeAppMode() {
  if (process.platform !== "darwin") return false;
  return (
    spawnSync("open", ["-Ra", "Google Chrome"], { stdio: "ignore" }).status ===
    0
  );
}

function openDetached(command, args) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function openRoughdraftUrl(url) {
  if (process.env.ROUGHDRAFT_NO_OPEN === "1") {
    return "disabled";
  }

  if (hasChromeAppMode()) {
    openDetached("open", ["-na", "Google Chrome", "--args", `--app=${url}`]);
    return "chrome-app";
  }

  if (process.platform === "darwin") {
    openDetached("open", [url]);
    return "browser";
  }

  if (process.platform === "linux") {
    openDetached("xdg-open", [url]);
    return "browser";
  }

  if (process.platform === "win32") {
    openDetached("cmd", ["/c", "start", "", url]);
    return "browser";
  }

  return "none";
}

function buildTargetUrl(port, openPath) {
  const url = new URL(`http://${ROUGHDRAFT_PUBLIC_HOST}:${port}`);
  const normalizedPath = openPath.replace(/\\/g, "/");
  url.pathname = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  return url.toString();
}

function buildLoopbackUrl(host, port, pathname = "/") {
  const baseHost = host.includes(":") ? `[${host}]` : host;
  return new URL(`http://${baseHost}:${port}${pathname}`);
}

async function findRunningRoughdraftPort(port) {
  for (const host of [ROUGHDRAFT_BIND_HOST, ...ROUGHDRAFT_LOOPBACK_HOSTS]) {
    try {
      const response = await fetch(
        buildLoopbackUrl(host, port, "/api/status"),
        {
          signal: AbortSignal.timeout(750),
        },
      );
      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      if (payload?.backend === "local-files") {
        return port;
      }
    } catch {}
  }

  return null;
}

async function waitForServer(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const runningPort = await findRunningRoughdraftPort(port);
    if (runningPort) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

const args = process.argv.slice(2);
const command = args[0];

if (command === "install") {
  runInstall();
  process.exit(0);
}

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

const preferredPort = parseInt(process.env.PORT || "3000", 10);
const { projectDir, openPath } = resolveTargetPath(command);
const runningPort = await findRunningRoughdraftPort(preferredPort);
const port = runningPort ?? (await findAvailablePort(preferredPort));

if (runningPort) {
  console.log(
    `Reusing Roughdraft already running at http://${ROUGHDRAFT_PUBLIC_HOST}:${runningPort}`,
  );
} else if (port !== preferredPort) {
  console.log(
    `Preferred port ${preferredPort} is busy, using ${port} instead.`,
  );
  await createServer(port, projectDir);
  await waitForServer(port);
} else {
  await createServer(port, projectDir);
  await waitForServer(port);
}

const targetUrl = buildTargetUrl(port, openPath);
const openMode = openRoughdraftUrl(targetUrl);

if (openMode === "chrome-app") {
  console.log(`Opened Roughdraft in a Chrome app window: ${targetUrl}`);
} else if (openMode === "browser") {
  console.log(`Opened Roughdraft in the default browser: ${targetUrl}`);
} else if (openMode === "disabled") {
  console.log(`Roughdraft is running at ${targetUrl}`);
} else {
  console.log(`Roughdraft is running at ${targetUrl}`);
}
