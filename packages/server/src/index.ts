import crypto from "node:crypto";
import fs from "node:fs";
import { createServer as createHttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendRoughdraftDocumentComment,
  extractRoughdraftReviewIndex,
} from "@roughdraft/rfm";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  captureSnapshot,
  commitDocumentWrite,
  HISTORY_DIR_NAME,
  listSnapshots,
  readSnapshot,
  refusesHistorySegment,
} from "./checkpoint-store.js";
import {
  DocumentRegistry,
  registryPathFromRequest,
} from "./document-registry.js";
import {
  hasNonLoopbackHost,
  ROUGHDRAFT_DEFAULT_PORT,
  ROUGHDRAFT_PUBLIC_HOST,
  resolveBindHosts,
} from "./network.js";
import { ReviewEventQueue } from "./review-events.js";
import { ReviewSummaryCache } from "./review-summary-cache.js";
import { resolveUpdateStatus } from "./update-status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, "../../app/dist");
const defaultServerRoot = path.resolve(__dirname, "../../..");

interface AssetPayload {
  filename?: string;
  mimeType?: string;
  dataBase64?: string;
}

interface DirectoryEntry {
  name: string;
  path: string;
}

interface DirectoryListing {
  path: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
}

/** A request's document, resolved and known to be inside the project. */
interface MarkdownTarget {
  relativePath: string;
  absolutePath: string;
  projectDir: string;
}

interface FileSystemEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

interface FileSystemListing {
  path: string;
  displayPath: string;
  parentPath: string | null;
  directories: FileSystemEntry[];
  files: FileSystemEntry[];
}

interface ProjectTreeListing {
  paths: string[];
}

interface CreateAppOptions {
  port?: number;
  projectDir?: string;
  serverRoot?: string;
  homeDir?: string;
  staticDirPath?: string;
  packageJsonPath?: string;
  fetchImpl?: typeof fetch;
  packageName?: string;
  remoteDocumentToken?: string;
}

interface CreateAppResult {
  app: Express;
  port: number;
}

interface OpenRequestClient {
  id: number;
  path: string | null;
  response: Response;
}

interface OpenRequestPayload {
  path?: string;
  url?: string;
}

export interface RemoteSession {
  id: string;
  originPath: string;
  content: string;
  version: string;
  saveClient: Response | null;
  viewers: Set<Response>;
  disconnectedAt: number | null;
}

interface RemoteDocumentRegisterPayload {
  sessionId?: string;
  originPath?: string;
  content?: string;
}

interface RemoteDocumentSavePayload {
  content?: string;
  expectedVersion?: string;
}

export const REMOTE_SESSION_TTL_MS = 5 * 60 * 1000;
const REMOTE_SESSION_SWEEP_INTERVAL_MS = 60 * 1000;
const REMOTE_SESSION_KEEPALIVE_MS = 15 * 1000;
const MAX_OVERALL_COMMENT_LENGTH = 4_000;

let nextOpenRequestClientId = 1;

function remoteSessionVersion(content: string): string {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return `${hash}:${crypto.randomUUID()}`;
}

function remoteSessionView(session: RemoteSession): {
  id: string;
  originPath: string;
  content: string;
  version: string;
} {
  return {
    id: session.id,
    originPath: session.originPath,
    content: session.content,
    version: session.version,
  };
}

function writeRemoteSessionEvent(
  response: Response,
  event: string,
  data: unknown,
): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Drop sessions whose CLI has been gone longer than the grace period.
 *
 * Ending each viewer stream is part of dropping the session, not a courtesy:
 * a viewer left attached to a session the server has forgotten keeps taking
 * keepalives, so its EventSource never errors, the browser's re-open loop
 * never runs, and the tab goes stale without ever saying so.
 */
export function sweepRemoteSessions(
  sessions: Map<string, RemoteSession>,
  now: number,
): void {
  for (const [id, session] of sessions) {
    if (
      session.disconnectedAt === null ||
      now - session.disconnectedAt <= REMOTE_SESSION_TTL_MS
    ) {
      continue;
    }
    for (const viewer of session.viewers) {
      viewer.end();
    }
    sessions.delete(id);
  }
}

function listMdFiles(projectDir: string): string[] {
  try {
    return fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

function titleFromContent(content: string, fallback: string): string {
  const firstLine = content.split("\n")[0] || "";
  return firstLine.replace(/^#*\s*/, "").trim() || fallback;
}

function fileVersionFromContent(stats: fs.Stats, content: string): string {
  const contentHash = crypto.createHash("sha256").update(content).digest("hex");
  return `${stats.mtimeMs}:${stats.size}:${contentHash}`;
}

/**
 * The bytes and the version from a single read, for the handlers that need
 * both — a version check followed by a separate read could compare against one
 * state and then write over another.
 *
 * Every version in the server comes from here or from `markdownPageFromFile`,
 * and both hash the *decoded* string. Hashing raw bytes anywhere would make a
 * document containing invalid UTF-8 unsaveable: it decodes to U+FFFD, so the
 * version a client is handed and the version its save is checked against stop
 * matching, and every version-quoting save 409s against its own version.
 */
function readFileWithVersion(filePath: string): {
  content: string;
  version: string;
} {
  const content = fs.readFileSync(filePath, "utf-8");
  const stats = fs.statSync(filePath);
  return { content, version: fileVersionFromContent(stats, content) };
}

function fileVersionFromFile(filePath: string): string {
  return readFileWithVersion(filePath).version;
}

/**
 * The version of a file that may no longer be there, `null` if it has gone.
 *
 * Reading a version is two syscalls, so the file can disappear between them —
 * a reviewer deleting or moving it, or a branch switch. Request handlers can
 * let that throw and answer 500, but the file watcher cannot: its callback runs
 * outside any request, so an exception there takes the whole server down and
 * every open document with it.
 */
export function fileVersionIfPresent(filePath: string): string | null {
  try {
    return fileVersionFromFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function normalizeOverallComment(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function markdownPageFromFile(
  relativePath: string,
  absolutePath: string,
): {
  id: string;
  title: string;
  content: string;
  version: string;
} {
  const content = fs.readFileSync(absolutePath, "utf-8");
  const stats = fs.statSync(absolutePath);
  const fallbackTitle = path.basename(relativePath, ".md");

  return {
    id: pageIdFromRelativePath(relativePath),
    title: titleFromContent(content, fallbackTitle),
    content,
    version: fileVersionFromContent(stats, content),
  };
}

function pageIdFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "").split(path.sep).join("/");
}

function nextUntitledId(projectDir: string): string {
  const existing = listMdFiles(projectDir);
  let i = 1;
  while (existing.includes(`untitled-${i}`)) i++;
  return `untitled-${i}`;
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function ensureProjectPath(
  projectDir: string,
  relativePath: string,
): string | null {
  const normalized = relativePath.replace(/^\.?\//, "");
  const absolute = path.resolve(projectDir, normalized);
  const relative = path.relative(projectDir, absolute);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolute;
}

/** The 4xx an error carries when middleware refused the request, else `null`. */
function clientErrorStatus(error: unknown): number | null {
  const carried = error as { status?: unknown; statusCode?: unknown };
  const status = carried.status ?? carried.statusCode;
  if (typeof status !== "number" || status < 400 || status >= 500) return null;
  return status;
}

function pageFilePathFromId(projectDir: string, id: string): string | null {
  const absolutePath = ensureProjectPath(projectDir, `${id}.md`);
  // Express matches `:id` against the encoded path and decodes afterwards, so
  // `%2F` puts a whole sidecar path in here without ever passing through the
  // document resolver that would otherwise refuse it.
  if (!absolutePath || refusesHistorySegment(absolutePath)) return null;
  return absolutePath;
}

function nextAssetPath(projectDir: string, filename: string): string {
  const assetsDir = path.join(projectDir, ".roughdraft-assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const safeName = sanitizeFilename(filename);
  const extensionIndex = safeName.lastIndexOf(".");
  const basename =
    extensionIndex > 0 ? safeName.slice(0, extensionIndex) : safeName;
  const extension = extensionIndex > 0 ? safeName.slice(extensionIndex) : "";

  let counter = 0;
  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const relativePath = `.roughdraft-assets/${basename}${suffix}${extension}`;
    const absolutePath = path.join(projectDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return relativePath;
    }
    counter += 1;
  }
}

function ensureDirectoryExists(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function isExistingDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function listDirectories(dir: string): DirectoryListing {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(dir, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const parentPath = path.dirname(dir);

  return {
    path: dir,
    parentPath: parentPath === dir ? null : parentPath,
    directories: entries,
  };
}

function formatDisplayPath(targetPath: string, homeDir: string): string {
  const normalizedHome = path.resolve(homeDir);
  const normalizedTarget = path.resolve(targetPath);

  if (normalizedTarget === normalizedHome) {
    return "~";
  }

  const relativeToHome = path.relative(normalizedHome, normalizedTarget);
  if (!relativeToHome.startsWith("..") && !path.isAbsolute(relativeToHome)) {
    return `~/${relativeToHome.split(path.sep).join("/")}`;
  }

  return normalizedTarget;
}

function listFileSystem(dir: string, homeDir: string): FileSystemListing {
  const normalizedDir = path.resolve(dir);
  const normalizedHome = path.resolve(homeDir);

  let rawEntries: fs.Dirent[];
  try {
    rawEntries = fs.readdirSync(normalizedDir, { withFileTypes: true });
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === "EACCES" || errorCode === "EPERM") {
      throw new Error("Directory is not readable.");
    }
    throw error;
  }

  const directories = rawEntries
    .filter((entry) => entry.isDirectory())
    .map<FileSystemEntry>((entry) => ({
      name: entry.name,
      path: path.join(normalizedDir, entry.name),
      kind: "directory",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const files = rawEntries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    )
    .map<FileSystemEntry>((entry) => ({
      name: entry.name,
      path: path.join(normalizedDir, entry.name),
      kind: "file",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return {
    path: normalizedDir,
    displayPath: formatDisplayPath(normalizedDir, normalizedHome),
    parentPath:
      normalizedDir === normalizedHome ? null : path.dirname(normalizedDir),
    directories,
    files,
  };
}

function toCanonicalRelativePath(
  projectDir: string,
  absolutePath: string,
  isDirectory: boolean,
): string {
  const relativePath = path.relative(projectDir, absolutePath);
  const canonicalPath = relativePath.split(path.sep).join("/");
  return isDirectory ? `${canonicalPath}/` : canonicalPath;
}

function listProjectTree(projectDir: string): ProjectTreeListing {
  const paths: string[] = [];

  const visitDirectory = (dir: string) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .slice()
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, {
          numeric: true,
        });
      });

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // A document's history is an implementation detail of the document
        // beside it, not part of the project a reviewer browses. This is the
        // one enumerator that recurses, so it is the one that would find it.
        if (entry.name.toLowerCase() === HISTORY_DIR_NAME) continue;
        paths.push(toCanonicalRelativePath(projectDir, absolutePath, true));
        visitDirectory(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        paths.push(toCanonicalRelativePath(projectDir, absolutePath, false));
      }
    }
  };

  visitDirectory(projectDir);

  return { paths };
}

export function createApp(options: CreateAppOptions = {}): CreateAppResult {
  const port = options.port ?? ROUGHDRAFT_DEFAULT_PORT;
  const homeDir = options.homeDir ?? os.homedir();
  const serverRoot = path.resolve(options.serverRoot ?? defaultServerRoot);
  const staticDirPath = options.staticDirPath ?? staticDir;
  const fetchImpl = options.fetchImpl ?? fetch;
  const remoteDocumentToken =
    typeof options.remoteDocumentToken === "string" &&
    options.remoteDocumentToken.length > 0
      ? options.remoteDocumentToken
      : null;
  const app = express();
  const openRequestClients = new Set<OpenRequestClient>();
  const reviewEvents = new ReviewEventQueue();
  const documentRegistry = new DocumentRegistry();
  const reviewSummaries = new ReviewSummaryCache();
  const remoteSessions = new Map<string, RemoteSession>();

  function isAuthorizedRemoteDocumentRequest(req: Request): boolean {
    if (!remoteDocumentToken) return true;

    const header =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : "";
    if (header.startsWith("Bearer ")) {
      const supplied = header.slice("Bearer ".length).trim();
      if (supplied === remoteDocumentToken) return true;
    }

    const acceptsQueryToken =
      req.method === "GET" &&
      req.path.startsWith("/api/remote-document/") &&
      req.path.endsWith("/events");
    const queryToken =
      acceptsQueryToken && typeof req.query.token === "string"
        ? req.query.token
        : "";
    return queryToken === remoteDocumentToken;
  }

  function rejectUnauthorizedRemoteDocumentRequest(res: Response): void {
    res.status(401).json({
      error:
        "Remote document endpoints require a valid token. Set ROUGHDRAFT_TOKEN on the client; browser event streams may include ?token=... in the URL.",
    });
  }

  const remoteSessionSweeper = setInterval(() => {
    sweepRemoteSessions(remoteSessions, Date.now());
  }, REMOTE_SESSION_SWEEP_INTERVAL_MS);
  remoteSessionSweeper.unref?.();

  app.use(express.json({ limit: "50mb" }));

  function requestedProjectPath(req: Request): string | null {
    const queryPath =
      typeof req.query.projectPath === "string"
        ? req.query.projectPath.trim()
        : "";
    const bodyPath =
      typeof req.body?.projectPath === "string"
        ? req.body.projectPath.trim()
        : "";
    const nextPath = queryPath || bodyPath;
    return nextPath.length > 0 ? nextPath : null;
  }

  function projectDirFromRequest(
    req: Request,
    res: Response,
    options?: { mustExist?: boolean },
  ): string | null {
    const nextProjectPath = requestedProjectPath(req);
    if (!nextProjectPath) {
      res.status(400).json({ error: "projectPath is required" });
      return null;
    }

    const resolvedProjectDir = path.resolve(nextProjectPath);
    const mustExist = options?.mustExist ?? true;

    if (mustExist && !isExistingDirectory(resolvedProjectDir)) {
      res.status(404).json({ error: "Project directory not found" });
      return null;
    }

    return resolvedProjectDir;
  }

  /**
   * Where a request points, without asking whether anything is there — the
   * history of a document outlives the document, so recovery after a deletion
   * needs a resolver that a missing file does not turn into a 404.
   */
  function resolveMarkdownPath(
    req: Request,
    res: Response,
  ): MarkdownTarget | null {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return null;

    const relativePath =
      typeof req.query.path === "string"
        ? req.query.path
        : typeof req.body?.path === "string"
          ? req.body.path
          : "";
    const absolutePath = ensureProjectPath(projectDir, relativePath);

    if (!absolutePath?.toLowerCase().endsWith(".md")) {
      res.status(404).json({ error: "Markdown file not found" });
      return null;
    }

    // This covers every route that resolves a document path; the pages routes
    // resolve their own and refuse the same segment there. It is not a claim
    // that snapshot bytes are unreachable — `GET /api/files` serves any
    // in-project path, and the MCP tools reach documents by their own route.
    if (refusesHistorySegment(absolutePath)) {
      res.status(404).json({ error: "Markdown file not found" });
      return null;
    }

    return { relativePath, absolutePath, projectDir };
  }

  function markdownPathFromRequest(
    req: Request,
    res: Response,
  ): MarkdownTarget | null {
    const target = resolveMarkdownPath(req, res);
    if (!target) return null;

    if (!fs.existsSync(target.absolutePath)) {
      res.status(404).json({ error: "Markdown file not found" });
      return null;
    }

    return target;
  }

  // --- API routes ---

  app.get("/api/pages", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const ids = listMdFiles(projectDir);
    const pages = ids.map((id) => {
      const content = fs.readFileSync(
        path.join(projectDir, `${id}.md`),
        "utf-8",
      );
      return { id, title: titleFromContent(content, id), content };
    });
    res.json(pages);
  });

  app.get("/api/pages/:id", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const id = req.params.id;
    const filePath = pageFilePathFromId(projectDir, id);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ id, title: titleFromContent(content, id), content });
  });

  app.get("/api/markdown-file", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;

    documentRegistry.noteOpened(target.absolutePath);
    res.json(markdownPageFromFile(target.relativePath, target.absolutePath));
  });

  /**
   * The snapshots of a document, newest first. Resolve-only, so a document that
   * has been deleted still lists the history it left behind — that is the whole
   * recovery path after a clobber that removed the file.
   */
  app.get("/api/markdown-file/history", (req, res) => {
    const target = resolveMarkdownPath(req, res);
    if (!target) return;

    const listing = listSnapshots(target.absolutePath);
    if (listing.status === "error") {
      // These routes are unauthenticated and the reason is a raw fs message
      // carrying absolute paths, so it stays in the server log.
      console.warn(
        `[roughdraft:history] could not list ${target.absolutePath}: ${listing.reason}`,
      );
      res.status(500).json({ error: "History unavailable" });
      return;
    }
    // No history is an empty history, not an error: a document nobody has saved
    // yet and one whose snapshots are gone read the same to a client.
    if (listing.status === "absent") {
      res.json({ path: target.relativePath, snapshots: [], unreadable: 0 });
      return;
    }

    res.json({
      path: target.relativePath,
      snapshots: listing.snapshots.map((snapshot) => ({
        ...snapshot,
        createdAt: snapshot.createdAt.toISOString(),
      })),
      unreadable: listing.unreadable,
    });
  });

  app.get("/api/markdown-file/history/:id", (req, res) => {
    const target = resolveMarkdownPath(req, res);
    if (!target) return;

    // The store refuses any id that is not a canonical snapshot id, so a
    // traversal-shaped one reads as missing rather than as a path.
    let content: string | null;
    try {
      content = readSnapshot(target.absolutePath, req.params.id);
    } catch (error) {
      // A readable id over an unreadable file throws. Left to Express that
      // answers with a stack trace naming real paths, on an unauthenticated
      // route — so it is logged and reported the same way the list route is.
      console.warn(
        `[roughdraft:history] could not read snapshot ${req.params.id} of ${target.absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.status(500).json({ error: "Snapshot unavailable" });
      return;
    }
    if (content === null) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }

    res.json({ id: req.params.id, content });
  });

  app.get("/api/markdown-file/events", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;
    const { absolutePath, relativePath } = target;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write("retry: 1000\n\n");

    const sendChange = (stats: fs.Stats) => {
      // The poll said the file was there; the read is what decides, because it
      // happens later and the file may have gone in between.
      const version =
        stats.nlink > 0 ? fileVersionIfPresent(absolutePath) : null;
      res.write(
        `event: change\ndata: ${JSON.stringify({
          path: relativePath,
          exists: version !== null,
          version,
        })}\n\n`,
      );
    };

    const listener = (current: fs.Stats, previous: fs.Stats) => {
      if (
        current.mtimeMs === previous.mtimeMs &&
        current.size === previous.size &&
        current.nlink === previous.nlink
      ) {
        return;
      }

      sendChange(current);
    };

    fs.watchFile(absolutePath, { interval: 500 }, listener);

    req.on("close", () => {
      fs.unwatchFile(absolutePath, listener);
    });
  });

  app.get("/api/review-index", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;

    const markdown = fs.readFileSync(target.absolutePath, "utf-8");
    res.json({
      documentPath: target.absolutePath,
      projectPath: target.projectDir,
      relativePath: target.relativePath,
      fileVersion: fileVersionFromFile(target.absolutePath),
      ...extractRoughdraftReviewIndex(markdown),
    });
  });

  app.post("/api/review-events", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;

    const overallComment = normalizeOverallComment(req.body?.overallComment);
    if (
      overallComment !== undefined &&
      overallComment.length > MAX_OVERALL_COMMENT_LENGTH
    ) {
      res.status(400).json({
        error: `overallComment must be ${MAX_OVERALL_COMMENT_LENGTH} characters or fewer`,
      });
      return;
    }

    const markdown = fs.readFileSync(target.absolutePath, "utf-8");
    const persistedMarkdown = overallComment
      ? appendRoughdraftDocumentComment(markdown, {
          message: overallComment,
          author: "user",
        })
      : markdown;
    if (persistedMarkdown !== markdown) {
      commitDocumentWrite(target.absolutePath, persistedMarkdown, {
        priorContent: markdown,
        trigger: "review",
      });
    } else {
      // Finishing a review without an overall comment writes nothing, but the
      // reviewed state still has to reach the history: the `review` label is
      // what pins it against later eviction.
      captureSnapshot(target.absolutePath, markdown, "review");
    }

    const index = extractRoughdraftReviewIndex(persistedMarkdown);
    const result = reviewEvents.emit({
      documentPath: target.absolutePath,
      projectPath: target.projectDir,
      relativePath: target.relativePath,
      version: fileVersionFromFile(target.absolutePath),
      summary: index.summary,
      overallComment,
    });
    documentRegistry.noteReviewCompleted(target.absolutePath);

    res.status(201).json(result);
  });

  app.post("/api/review-events/watch", async (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;

    documentRegistry.noteOpened(target.absolutePath);

    const fromNow = req.body?.fromNow !== false;
    const timeoutSeconds =
      typeof req.body?.timeoutSeconds === "number"
        ? req.body.timeoutSeconds
        : undefined;
    const batchWindowSeconds =
      typeof req.body?.batchWindowSeconds === "number"
        ? req.body.batchWindowSeconds
        : 0.25;
    const afterSequence =
      typeof req.body?.afterSequence === "number" ? req.body.afterSequence : 0;

    // Express 5 fires `req.on("close")` ~1 ms into every POST with a JSON body
    // (the body is already consumed), so the liveness hook lives on the
    // response. A closed response with nothing written yet is a client that
    // hung up: abort the wait so the queue stops holding a dead waiter.
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    const result = await reviewEvents.wait({
      documentPath: target.absolutePath,
      afterSequence: fromNow ? reviewEvents.latestSequence() : afterSequence,
      timeoutMs:
        timeoutSeconds !== undefined ? timeoutSeconds * 1000 : undefined,
      batchWindowMs: batchWindowSeconds * 1000,
      signal: abort.signal,
    });

    // `writableEnded` is false on a hang-up, so it would write to a dead
    // socket; `closed` is the abort-safe guard.
    if (!res.closed) res.json(result);
  });

  app.get("/api/review-events/status", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;

    const watcherCount = reviewEvents.waiterCountForDocument(
      target.absolutePath,
    );
    res.json({
      documentPath: target.absolutePath,
      projectPath: target.projectDir,
      relativePath: target.relativePath,
      watching: watcherCount > 0,
      watcherCount,
    });
  });

  app.get("/api/dashboard", (_req, res) => {
    const now = new Date().toISOString();

    const registryEntries = documentRegistry.list();
    const knownPaths = new Set(
      registryEntries.map((entry) => entry.absolutePath),
    );
    // A blocked agent's document must always render, even if the registry
    // evicted it: union the live waiters in with null timestamps.
    const rows = [...registryEntries];
    for (const waitingPath of reviewEvents.waitingDocumentPaths()) {
      if (!knownPaths.has(waitingPath)) {
        rows.push({
          absolutePath: waitingPath,
          lastActivityAt: now,
          lastOpenedAt: null,
          lastReviewedAt: null,
        });
      }
    }

    const documents = rows
      .sort(
        (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
      )
      .map((row) => ({
        ...row,
        ...reviewSummaries.read(row.absolutePath),
        waiterCount: reviewEvents.waiterCountForDocument(row.absolutePath),
      }));

    const recentReviews = reviewEvents.recentEvents(10).map((event) => ({
      sequence: event.sequence,
      createdAt: event.createdAt,
      absolutePath: event.documentPath,
      summary: event.summary,
      hasOverallComment:
        typeof event.overallComment === "string" &&
        event.overallComment.length > 0,
      deliveredToWaiter: event.delivered,
    }));

    res.json({
      server: { port, startedAt: documentRegistry.startedAt, now },
      documents,
      recentReviews,
    });
  });

  app.put("/api/markdown-file", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;
    const { absolutePath, relativePath } = target;

    const { content, expectedVersion } = req.body as {
      content: string;
      expectedVersion?: string;
    };
    // Read, check and write with nothing awaited in between: two tabs, the MCP
    // process and the remote pump all write here, so a suspension point between
    // the version check and the write is a lost update.
    const current = readFileWithVersion(absolutePath);

    if (expectedVersion && expectedVersion !== current.version) {
      res.status(409).json({
        error: "Markdown file changed on disk",
        current: markdownPageFromFile(relativePath, absolutePath),
      });
      return;
    }

    commitDocumentWrite(absolutePath, content, {
      // A save quoting a version has accounted for what is on disk. One that
      // does not is overwriting blind, so those bytes are unclaimed and the
      // store keeps them as `replaced`.
      priorContent: expectedVersion ? current.content : undefined,
      trigger: "save",
    });
    res.json(markdownPageFromFile(relativePath, absolutePath));
  });

  app.post("/api/pages", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const { title, content: bodyContent } = req.body as {
      title?: string;
      content?: string;
    };
    const id = nextUntitledId(projectDir);
    const content = bodyContent || `# ${title || "Untitled"}\n`;
    const filePath = path.join(projectDir, `${id}.md`);
    // create-only: name always free, so this write replaces nothing and has no
    // history to preserve.
    fs.writeFileSync(filePath, content);

    res.status(201).json(markdownPageFromFile(`${id}.md`, filePath));
  });

  app.delete("/api/pages/:id", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const id = req.params.id;
    const filePath = pageFilePathFromId(projectDir, id);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    fs.unlinkSync(filePath);

    res.json({ ok: true });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      backend: "local-files",
      pid: process.pid,
      port,
      projectDir: options.projectDir
        ? path.resolve(options.projectDir)
        : undefined,
      serverRoot,
      stateless: true,
      capabilities: {
        projectPathRequired: true,
        fileSystemBrowsing: true,
        remoteDocuments: true,
        remoteDocumentTokenRequired: remoteDocumentToken !== null,
      },
    });
  });

  app.get("/api/open-requests", (req, res) => {
    const requestedPath =
      typeof req.query.path === "string" && req.query.path.trim().length > 0
        ? req.query.path.trim()
        : null;
    const registryPath = registryPathFromRequest(requestedPath);
    if (registryPath) documentRegistry.noteOpened(registryPath);
    const client: OpenRequestClient = {
      id: nextOpenRequestClientId,
      path: requestedPath,
      response: res,
    };
    nextOpenRequestClientId += 1;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(
      `event: connected\ndata: ${JSON.stringify({ id: client.id })}\n\n`,
    );

    openRequestClients.add(client);
    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      openRequestClients.delete(client);
    });
  });

  app.post("/api/open-request", (req, res) => {
    const payload = req.body as OpenRequestPayload;
    const targetPath =
      typeof payload.path === "string" && payload.path.trim().length > 0
        ? payload.path.trim()
        : null;
    const targetUrl =
      typeof payload.url === "string" && payload.url.trim().length > 0
        ? payload.url.trim()
        : null;

    if (!targetPath || !targetUrl) {
      res.status(400).json({ error: "path and url are required" });
      return;
    }

    const registryPath = registryPathFromRequest(targetPath);
    if (registryPath) documentRegistry.noteOpened(registryPath);

    const matchingClient = Array.from(openRequestClients)
      .reverse()
      .find((client) => client.path === targetPath);

    if (!matchingClient) {
      res.json({ delivered: false });
      return;
    }

    matchingClient.response.write(
      `event: open-request\ndata: ${JSON.stringify({
        path: targetPath,
        url: targetUrl,
      })}\n\n`,
    );
    res.json({ delivered: true });
  });

  app.post("/api/remote-document", (req, res) => {
    if (!isAuthorizedRemoteDocumentRequest(req)) {
      rejectUnauthorizedRemoteDocumentRequest(res);
      return;
    }
    const payload = req.body as RemoteDocumentRegisterPayload;
    const sessionId =
      typeof payload.sessionId === "string" &&
      payload.sessionId.trim().length > 0
        ? payload.sessionId.trim()
        : null;
    const originPath =
      typeof payload.originPath === "string" &&
      payload.originPath.trim().length > 0
        ? payload.originPath.trim()
        : null;
    const content =
      typeof payload.content === "string" ? payload.content : null;

    if (!sessionId || !originPath || content === null) {
      res
        .status(400)
        .json({ error: "sessionId, originPath, and content are required" });
      return;
    }

    if (remoteSessions.has(sessionId)) {
      res.status(409).json({ error: "session already exists" });
      return;
    }

    const session: RemoteSession = {
      id: sessionId,
      originPath,
      content,
      version: remoteSessionVersion(content),
      saveClient: null,
      viewers: new Set<Response>(),
      disconnectedAt: null,
    };
    remoteSessions.set(sessionId, session);

    const host = req.get("host");
    const viewerUrl =
      host !== undefined
        ? `${req.protocol}://${host}/?session=${encodeURIComponent(sessionId)}`
        : null;

    res.status(201).json({
      id: session.id,
      version: session.version,
      viewerUrl,
    });
  });

  app.get("/api/remote-document/:id", (req, res) => {
    if (!isAuthorizedRemoteDocumentRequest(req)) {
      rejectUnauthorizedRemoteDocumentRequest(res);
      return;
    }
    const session = remoteSessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Remote document session not found" });
      return;
    }
    res.json(remoteSessionView(session));
  });

  app.put("/api/remote-document/:id", (req, res) => {
    if (!isAuthorizedRemoteDocumentRequest(req)) {
      rejectUnauthorizedRemoteDocumentRequest(res);
      return;
    }
    const session = remoteSessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Remote document session not found" });
      return;
    }

    const payload = req.body as RemoteDocumentSavePayload;
    const content =
      typeof payload.content === "string" ? payload.content : null;

    if (content === null) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    if (
      typeof payload.expectedVersion === "string" &&
      payload.expectedVersion !== session.version
    ) {
      res.status(409).json({
        error: "Remote document changed",
        current: remoteSessionView(session),
      });
      return;
    }

    // Content and version both wait for delivery, and each for its own reason.
    // The version: moving it on a failed save would make the browser's retry
    // (which carries the same expectedVersion) look like a stale write. The
    // content: echoing undelivered bytes back on the bootstrap GET makes the
    // browser's localStorage draft — the only durable copy of that unsent
    // work — look redundant, and the restore policy then discards it.
    const nextVersion = remoteSessionVersion(content);

    let deliveredToClient = true;
    if (session.saveClient) {
      try {
        writeRemoteSessionEvent(session.saveClient, "save", {
          content,
          version: nextVersion,
        });
      } catch {
        deliveredToClient = false;
        session.saveClient = null;
        session.disconnectedAt = Date.now();
      }
    } else {
      deliveredToClient = false;
    }

    if (!deliveredToClient) {
      res.status(503).json({
        error: "No active CLI session; save not delivered to disk.",
        version: session.version,
      });
      return;
    }

    session.content = content;
    session.version = nextVersion;

    res.json({ id: session.id, version: session.version });
  });

  app.get("/api/remote-document/:id/events", (req, res) => {
    if (!isAuthorizedRemoteDocumentRequest(req)) {
      rejectUnauthorizedRemoteDocumentRequest(res);
      return;
    }
    const session = remoteSessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Remote document session not found" });
      return;
    }

    // Only the literal role=cli attaches as the CLI: that role receives saves
    // and displaces the incumbent, so an absent or mistyped role must degrade
    // to the unprivileged viewer rather than take the document over.
    const role = req.query.role === "cli" ? "cli" : "viewer";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    if (role === "cli") {
      if (session.saveClient) {
        session.saveClient.end();
      }

      session.saveClient = res;
      session.disconnectedAt = null;

      writeRemoteSessionEvent(res, "connected", {
        id: session.id,
        role,
        version: session.version,
      });
      for (const viewer of session.viewers) {
        writeRemoteSessionEvent(viewer, "connected", {
          id: session.id,
          role: "viewer",
          version: session.version,
        });
      }
    } else {
      session.viewers.add(res);
      writeRemoteSessionEvent(
        res,
        session.saveClient ? "connected" : "disconnected",
        {
          id: session.id,
          role,
          version: session.version,
        },
      );
    }

    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, REMOTE_SESSION_KEEPALIVE_MS);

    req.on("close", () => {
      clearInterval(keepAlive);
      if (role === "cli" && session.saveClient === res) {
        session.saveClient = null;
        session.disconnectedAt = Date.now();
        for (const viewer of session.viewers) {
          writeRemoteSessionEvent(viewer, "disconnected", {
            id: session.id,
            role: "viewer",
            version: session.version,
          });
        }
      } else if (role === "viewer") {
        session.viewers.delete(res);
      }
    });
  });

  app.get("/api/update-status", async (_req, res) => {
    const updateStatus = await resolveUpdateStatus({
      fetchImpl,
      packageJsonPath: options.packageJsonPath,
      packageName: options.packageName,
    });
    res.json(updateStatus);
  });

  app.get("/api/directories", (req, res) => {
    const requestedPath =
      typeof req.query.path === "string" && req.query.path.trim().length > 0
        ? path.resolve(req.query.path)
        : homeDir;

    if (!isExistingDirectory(requestedPath)) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    res.json(listDirectories(requestedPath));
  });

  app.get("/api/fs/list", (req, res) => {
    const requestedPath =
      typeof req.query.path === "string" && req.query.path.trim().length > 0
        ? path.resolve(req.query.path)
        : homeDir;

    if (!fs.existsSync(requestedPath)) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    if (!isExistingDirectory(requestedPath)) {
      res.status(400).json({ error: "Path is not a directory" });
      return;
    }

    try {
      res.json(listFileSystem(requestedPath, homeDir));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to read directory listing";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/file-tree", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    res.json(listProjectTree(projectDir));
  });

  app.post("/api/project/open", (req, res) => {
    const requestedPath =
      typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!requestedPath) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const absolutePath = path.resolve(requestedPath);
    if (!isExistingDirectory(absolutePath)) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    res.json({
      backend: "local-files",
      projectDir: absolutePath,
      port,
    });
  });

  app.post("/api/project/create", (req, res) => {
    const requestedPath =
      typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!requestedPath) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const absolutePath = path.resolve(requestedPath);
    ensureDirectoryExists(absolutePath);

    res.status(201).json({
      backend: "local-files",
      projectDir: absolutePath,
      port,
    });
  });

  app.get("/api/files", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const relativePath =
      typeof req.query.path === "string" ? req.query.path : "";
    const absolutePath = ensureProjectPath(projectDir, relativePath);

    if (!absolutePath || !fs.existsSync(absolutePath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.sendFile(absolutePath);
  });

  app.post("/api/assets", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const payload = req.body as AssetPayload;
    if (!payload.filename || !payload.dataBase64) {
      res.status(400).json({ error: "filename and dataBase64 are required" });
      return;
    }

    const relativePath = nextAssetPath(projectDir, payload.filename);
    const absolutePath = ensureProjectPath(projectDir, relativePath);
    if (!absolutePath) {
      res.status(400).json({ error: "Invalid asset path" });
      return;
    }

    const buffer = Buffer.from(payload.dataBase64, "base64");
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);

    res.status(201).json({
      markdownPath: `./${relativePath}`,
      previewUrl: `/api/files?projectPath=${encodeURIComponent(projectDir)}&path=${encodeURIComponent(relativePath)}`,
      mimeType: payload.mimeType || "application/octet-stream",
    });
  });

  // --- Static files & SPA fallback ---

  // Unknown /api routes would otherwise fall through to the SPA fallback and
  // answer 200 HTML, which confuses the next client written against a
  // not-yet-deployed route.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unknown API route" });
  });

  app.use(express.static(staticDirPath));

  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticDirPath, "index.html"));
  });

  /**
   * Express's default handler answers a stack trace naming absolute paths, the
   * server's own sources and its dependency versions — on routes that need no
   * credentials. The routes above report their own failures; this catches what
   * they cannot, including the router's own decode failure, which runs before
   * any handler and so cannot be caught inside one.
   */
  app.use(
    (error: Error, _req: Request, res: Response, next: NextFunction): void => {
      if (res.headersSent) {
        next(error);
        return;
      }
      console.warn(`[roughdraft] request failed: ${error.message}`);
      // A URIError is the router failing to decode a param, which is the
      // caller's malformed request rather than anything wrong here.
      if (error instanceof URIError) {
        res.status(400).json({ error: "Bad request" });
        return;
      }
      // `express.json` marks its own refusals with a 4xx status — a malformed
      // body is 400, one over the size limit 413. Answering 500 for those
      // would blame the server for the request, and an asset upload big
      // enough to cross the limit is a real thing a reviewer does. The body
      // stays the fixed string, so honouring the status discloses nothing.
      const status = clientErrorStatus(error);
      if (status !== null) {
        res.status(status).json({ error: "Bad request" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return { app, port };
}

export const ROUGHDRAFT_TOKEN_ENV = "ROUGHDRAFT_TOKEN";

export async function createServer(
  port = ROUGHDRAFT_DEFAULT_PORT,
  projectDir?: string,
): Promise<void> {
  const bindHosts = resolveBindHosts();
  const remoteDocumentToken = process.env[ROUGHDRAFT_TOKEN_ENV] ?? "";

  if (hasNonLoopbackHost(bindHosts) && remoteDocumentToken.length === 0) {
    throw new Error(
      [
        `Roughdraft refuses to bind ${bindHosts.join(", ")} without a token.`,
        "A non-loopback binding exposes the remote-document endpoints (which can",
        "rewrite files on every connected CLI machine) and leaves the",
        "unauthenticated local-file routes and the dashboard readable by anyone",
        "who can reach the host. Set ROUGHDRAFT_TOKEN to a strong secret and pass",
        "the same value to your CLI before retrying, or remove ROUGHDRAFT_BIND_HOST",
        "to keep loopback-only.",
      ].join(" "),
    );
  }

  const { app } = createApp({
    port,
    projectDir,
    remoteDocumentToken:
      remoteDocumentToken.length > 0 ? remoteDocumentToken : undefined,
  });
  const listeningHosts: string[] = [];

  await Promise.all(
    bindHosts.map(
      (host) =>
        new Promise<void>((resolve, reject) => {
          const server = createHttpServer(app);

          server.once("error", (error: NodeJS.ErrnoException) => {
            if (
              error.code === "EAFNOSUPPORT" ||
              error.code === "EADDRNOTAVAIL"
            ) {
              resolve();
              return;
            }

            reject(error);
          });

          server.listen(port, host, () => {
            listeningHosts.push(host);
            resolve();
          });
        }),
    ),
  );

  if (listeningHosts.length === 0) {
    throw new Error(
      `Roughdraft could not bind to any host (tried: ${bindHosts.join(", ")}).`,
    );
  }

  console.log(
    `\n  Roughdraft running at http://${ROUGHDRAFT_PUBLIC_HOST}:${port}`,
  );
  console.log("  No active project is stored on the server.\n");
}
