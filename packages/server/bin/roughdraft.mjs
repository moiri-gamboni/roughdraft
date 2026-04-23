#!/usr/bin/env node

import { createServer } from "../dist/index.js";
import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { findAvailablePort } from "../dist/ports.js";

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
  const url = new URL(`http://localhost:${port}`);
  const normalizedPath = openPath.replace(/\\/g, "/");
  url.pathname = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  return url.toString();
}

async function findRunningRoughdraftPort(port) {
  try {
    const response = await fetch(`http://localhost:${port}/api/status`, {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return null;

    const payload = await response.json();
    if (payload?.backend === "local-files") {
      return port;
    }
  } catch {
    return null;
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

const preferredPort = parseInt(process.env.PORT || "3000", 10);
const { projectDir, openPath } = resolveTargetPath(process.argv[2]);
const runningPort = await findRunningRoughdraftPort(preferredPort);
const port = runningPort ?? (await findAvailablePort(preferredPort));

if (runningPort) {
  console.log(
    `Reusing Roughdraft already running at http://localhost:${runningPort}`,
  );
} else if (port !== preferredPort) {
  console.log(
    `Preferred port ${preferredPort} is busy, using ${port} instead.`,
  );
  createServer(port, projectDir);
  await waitForServer(port);
} else {
  createServer(port, projectDir);
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
