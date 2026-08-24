import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createApp,
  REMOTE_SESSION_TTL_MS,
  type RemoteSession,
  sweepRemoteSessions,
} from "./index";

const SSE_READ_TIMEOUT_MS = 2_000;

interface SseStream {
  /** Resolves with everything read so far, once `marker` appears in it. */
  waitFor(marker: string): Promise<string>;
  cancel(): Promise<void>;
}

async function openSseStream(url: string): Promise<SseStream> {
  const response = await fetch(url, {
    headers: { Accept: "text/event-stream" },
  });
  if (response.status !== 200 || !response.body) {
    throw new Error(`Expected an SSE stream at ${url}, got ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";

  return {
    async waitFor(marker: string) {
      while (!received.includes(marker)) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(
                new Error(
                  `Timed out waiting for ${JSON.stringify(marker)}; stream held ${JSON.stringify(received)}`,
                ),
              );
            }, SSE_READ_TIMEOUT_MS);
          }),
        ]).finally(() => clearTimeout(timer));
        if (chunk.done) {
          throw new Error(
            `Stream closed before ${JSON.stringify(marker)}; stream held ${JSON.stringify(received)}`,
          );
        }
        received += decoder.decode(chunk.value, { stream: true });
      }
      return received;
    },
    cancel: () => reader.cancel(),
  };
}

/**
 * Runs `body` against a really-listening app, so SSE streams behave the way
 * they do in production. Supertest requests against the same app object share
 * the session state, so only the streams need the real socket.
 */
async function withListeningApp<T>(
  app: ReturnType<typeof createApp>["app"],
  body: (context: {
    openStream(pathAndQuery: string): Promise<SseStream>;
  }) => Promise<T>,
): Promise<T> {
  const server = app.listen(0);
  const streams: SseStream[] = [];
  try {
    const { port } = server.address() as AddressInfo;
    return await body({
      async openStream(pathAndQuery: string) {
        const stream = await openSseStream(
          `http://127.0.0.1:${port}${pathAndQuery}`,
        );
        streams.push(stream);
        return stream;
      },
    });
  } finally {
    await Promise.all(streams.map((stream) => stream.cancel()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("createApp", () => {
  let projectDir: string;
  let homeDir: string;
  const serverRoot = path.resolve(
    fileURLToPath(new URL("../../..", import.meta.url)),
  );

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-server-"));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-home-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("creates a markdown page on disk", async () => {
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app)
      .post("/api/pages")
      .send({ title: "Draft", projectPath: projectDir });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: "untitled-1",
      title: "Draft",
      content: "# Draft\n",
    });
    expect(response.body.version).toEqual(expect.any(String));

    const filePath = path.join(projectDir, "untitled-1.md");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("# Draft\n");
  });

  it("reads nested markdown files inside the project", async () => {
    const nestedDir = path.join(projectDir, "notes");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, "draft.md"), "# Nested draft\n");

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).get("/api/markdown-file").query({
      projectPath: projectDir,
      path: "notes/draft.md",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "notes/draft",
      title: "Nested draft",
      content: "# Nested draft\n",
    });
    expect(response.body.version).toEqual(expect.any(String));
  });

  it("lists, updates, and deletes page-backed markdown files", async () => {
    fs.writeFileSync(path.join(projectDir, "alpha.md"), "# Alpha\n");

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const listResponse = await request(app).get("/api/pages").query({
      projectPath: projectDir,
    });
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual([
      { id: "alpha", title: "Alpha", content: "# Alpha\n" },
    ]);

    const readResponse = await request(app).get("/api/pages/alpha").query({
      projectPath: projectDir,
    });
    expect(readResponse.status).toBe(200);
    expect(readResponse.body).toEqual({
      id: "alpha",
      title: "Alpha",
      content: "# Alpha\n",
    });

    const updateResponse = await request(app)
      .put("/api/pages/alpha")
      .query({ projectPath: projectDir })
      .send({ content: "# Beta\n" });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toEqual({
      id: "alpha",
      title: "Beta",
      content: "# Beta\n",
    });
    expect(fs.readFileSync(path.join(projectDir, "alpha.md"), "utf-8")).toBe(
      "# Beta\n",
    );

    const deleteResponse = await request(app).delete("/api/pages/alpha").query({
      projectPath: projectDir,
    });
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ ok: true });
    expect(fs.existsSync(path.join(projectDir, "alpha.md"))).toBe(false);
  });

  it("saves a markdown file when the expected version matches", async () => {
    fs.writeFileSync(path.join(projectDir, "draft.md"), "# Original\n");

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const readResponse = await request(app).get("/api/markdown-file").query({
      projectPath: projectDir,
      path: "draft.md",
    });

    const saveResponse = await request(app)
      .put("/api/markdown-file")
      .query({ projectPath: projectDir, path: "draft.md" })
      .send({
        content: "# Saved\n",
        expectedVersion: readResponse.body.version,
      });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body).toMatchObject({
      id: "draft",
      title: "Saved",
      content: "# Saved\n",
    });
    expect(saveResponse.body.version).toEqual(expect.any(String));
    expect(fs.readFileSync(path.join(projectDir, "draft.md"), "utf-8")).toBe(
      "# Saved\n",
    );
  });

  it("rejects stale markdown-file writes", async () => {
    const nestedDir = path.join(projectDir, "notes");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, "draft.md"), "# Original\n");

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const readResponse = await request(app).get("/api/markdown-file").query({
      projectPath: projectDir,
      path: "notes/draft.md",
    });

    fs.writeFileSync(path.join(nestedDir, "draft.md"), "# External change\n");

    const staleWriteResponse = await request(app)
      .put("/api/markdown-file")
      .query({
        projectPath: projectDir,
        path: "notes/draft.md",
      })
      .send({
        content: "# Roughdraft change\n",
        expectedVersion: readResponse.body.version,
      });

    expect(staleWriteResponse.status).toBe(409);
    expect(staleWriteResponse.body).toMatchObject({
      error: "Markdown file changed on disk",
      current: {
        id: "notes/draft",
        title: "External change",
        content: "# External change\n",
      },
    });
    expect(staleWriteResponse.body.current.version).toEqual(expect.any(String));
    expect(fs.readFileSync(path.join(nestedDir, "draft.md"), "utf-8")).toBe(
      "# External change\n",
    );
  });

  it("rejects stale markdown-file writes when file metadata is unchanged", async () => {
    const filePath = path.join(projectDir, "draft.md");
    const fixedTimestamp = new Date("2026-01-01T00:00:00.000Z");
    fs.writeFileSync(filePath, "# Original\n");
    fs.utimesSync(filePath, fixedTimestamp, fixedTimestamp);

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const readResponse = await request(app).get("/api/markdown-file").query({
      projectPath: projectDir,
      path: "draft.md",
    });

    fs.writeFileSync(filePath, "# External\n");
    fs.utimesSync(filePath, fixedTimestamp, fixedTimestamp);

    const staleWriteResponse = await request(app)
      .put("/api/markdown-file")
      .query({
        projectPath: projectDir,
        path: "draft.md",
      })
      .send({
        content: "# Roughdraft\n",
        expectedVersion: readResponse.body.version,
      });

    expect(staleWriteResponse.status).toBe(409);
    expect(staleWriteResponse.body).toMatchObject({
      error: "Markdown file changed on disk",
      current: {
        id: "draft",
        title: "External",
        content: "# External\n",
      },
    });
    expect(fs.readFileSync(filePath, "utf-8")).toBe("# External\n");
  });

  it("rejects markdown-file reads outside the project directory", async () => {
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).get("/api/markdown-file").query({
      projectPath: projectDir,
      path: "../secrets.md",
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Markdown file not found" });
  });

  it("accepts review completed events for a markdown file inside the project", async () => {
    fs.writeFileSync(
      path.join(projectDir, "draft.md"),
      [
        "# Draft",
        "",
        'Needs {==support==}{>>Add a source<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}.',
      ].join("\n"),
    );
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).post("/api/review-events").send({
      projectPath: projectDir,
      path: "draft.md",
      overallComment: "Please address the risk section.",
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      delivered: false,
      event: {
        type: "review.completed",
        documentPath: path.join(projectDir, "draft.md"),
        projectPath: projectDir,
        relativePath: "draft.md",
        sequence: 1,
        overallComment: "Please address the risk section.",
        summary: {
          comments: 2,
          replies: 0,
          suggestions: 0,
          unresolved: 2,
        },
      },
    });
    expect(response.body.event.version).toEqual(expect.any(String));
    expect(response.body.event.createdAt).toEqual(expect.any(String));
  });

  it("persists an overall review comment as document-level YAML feedback before emitting the event", async () => {
    const filePath = path.join(projectDir, "draft.md");
    fs.writeFileSync(
      filePath,
      [
        "# Draft",
        "",
        "Needs {==support==}{>>Add a source<<}{#c1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "workflow:",
        "  owner: editorial",
        "",
      ].join("\n"),
    );
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).post("/api/review-events").send({
      projectPath: projectDir,
      path: "draft.md",
      overallComment: "Please address the risk section.",
    });

    const saved = fs.readFileSync(filePath, "utf-8");
    expect(response.status).toBe(201);
    expect(saved).toContain("workflow:\n  owner: editorial");
    expect(saved).toContain("  c1:");
    expect(saved).toContain("  c2:");
    expect(saved).toContain("    body: Please address the risk section.");
    expect(saved).toContain("    by: user");
    expect(response.body.event.summary).toMatchObject({
      comments: 2,
      replies: 0,
      suggestions: 0,
      unresolved: 2,
    });
  });

  it("omits whitespace-only overall comments from review events", async () => {
    fs.writeFileSync(path.join(projectDir, "draft.md"), "# Draft\n");
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).post("/api/review-events").send({
      projectPath: projectDir,
      path: "draft.md",
      overallComment: "   \n\t  ",
    });

    expect(response.status).toBe(201);
    expect(response.body.event).not.toHaveProperty("overallComment");
  });

  it("rejects over-limit overall comments", async () => {
    fs.writeFileSync(path.join(projectDir, "draft.md"), "# Draft\n");
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app)
      .post("/api/review-events")
      .send({
        projectPath: projectDir,
        path: "draft.md",
        overallComment: "x".repeat(4001),
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "overallComment must be 4000 characters or fewer",
    });
  });

  it("rejects review events without a projectPath", async () => {
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app)
      .post("/api/review-events")
      .send({ path: "draft.md" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "projectPath is required" });
  });

  it("rejects review events outside the project", async () => {
    const outsideFile = path.join(homeDir, "outside.md");
    fs.writeFileSync(outsideFile, "# Outside\n");
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app)
      .post("/api/review-events")
      .send({ projectPath: projectDir, path: "../outside.md" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Markdown file not found" });
  });

  it("returns retained review events to watchers", async () => {
    fs.writeFileSync(path.join(projectDir, "draft.md"), "# Draft\n");
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const emitted = await request(app)
      .post("/api/review-events")
      .send({ projectPath: projectDir, path: "draft.md" });
    const watchResponse = await request(app)
      .post("/api/review-events/watch")
      .send({
        projectPath: projectDir,
        path: "draft.md",
        fromNow: false,
        timeoutSeconds: 1,
        batchWindowSeconds: 0,
      });

    expect(emitted.body.delivered).toBe(false);
    expect(watchResponse.status).toBe(200);
    expect(watchResponse.body).toMatchObject({
      timedOut: false,
      events: [
        {
          type: "review.completed",
          documentPath: path.join(projectDir, "draft.md"),
          relativePath: "draft.md",
        },
      ],
    });
  });

  it("reports active review watchers for a markdown file", async () => {
    fs.writeFileSync(path.join(projectDir, "draft.md"), "# Draft\n");
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const waiting = request(app).post("/api/review-events/watch").send({
      projectPath: projectDir,
      path: "draft.md",
      timeoutSeconds: 1,
      batchWindowSeconds: 0,
    });
    const waitingPromise = waiting.then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const statusResponse = await request(app)
      .get("/api/review-events/status")
      .query({ projectPath: projectDir, path: "draft.md" });

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body).toMatchObject({
      watching: true,
      watcherCount: 1,
      documentPath: path.join(projectDir, "draft.md"),
    });

    await request(app)
      .post("/api/review-events")
      .send({ projectPath: projectDir, path: "draft.md" });
    await waitingPromise;
  });

  it("rejects page ids that resolve outside the project directory", async () => {
    const outsideName = `${path.basename(projectDir)}-secret`;
    const outsideFilePath = path.join(
      path.dirname(projectDir),
      `${outsideName}.md`,
    );
    fs.writeFileSync(outsideFilePath, "# Secret\n");

    try {
      const { app } = createApp({
        homeDir,
        staticDirPath: projectDir,
      });
      const traversalPath = `/api/pages/${encodeURIComponent(`../${outsideName}`)}`;

      const readResponse = await request(app).get(traversalPath).query({
        projectPath: projectDir,
      });
      const updateResponse = await request(app)
        .put(traversalPath)
        .query({
          projectPath: projectDir,
        })
        .send({ content: "# Updated\n" });
      const deleteResponse = await request(app).delete(traversalPath).query({
        projectPath: projectDir,
      });

      expect(readResponse.status).toBe(404);
      expect(readResponse.body).toEqual({ error: "Page not found" });
      expect(updateResponse.status).toBe(404);
      expect(updateResponse.body).toEqual({ error: "Page not found" });
      expect(deleteResponse.status).toBe(404);
      expect(deleteResponse.body).toEqual({ error: "Page not found" });
      expect(fs.readFileSync(outsideFilePath, "utf-8")).toBe("# Secret\n");
    } finally {
      fs.rmSync(outsideFilePath, { force: true });
    }
  });

  it("requires projectPath on project-backed routes", async () => {
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).get("/api/pages");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "projectPath is required" });
  });

  it("reports neutral server status without an active project", async () => {
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
      port: 4312,
    });

    const response = await request(app).get("/api/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      backend: "local-files",
      pid: process.pid,
      port: 4312,
      serverRoot,
      stateless: true,
      capabilities: {
        projectPathRequired: true,
        fileSystemBrowsing: true,
        remoteDocuments: true,
        remoteDocumentTokenRequired: false,
      },
    });
    expect(response.body).not.toHaveProperty("projectDir");
  });

  it("reports update status from npm metadata", async () => {
    const packageJsonPath = path.join(projectDir, "package.json");
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: "roughdraft", version: "0.1.0" }),
    );

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
      packageJsonPath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ version: "0.2.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const response = await request(app).get("/api/update-status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      packageName: "roughdraft",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      updateCommand: "npm i -g roughdraft@latest",
    });
  });

  it("lists directories from the home directory when no path is provided", async () => {
    fs.mkdirSync(path.join(homeDir, "docs"));

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).get("/api/directories");

    expect(response.status).toBe(200);
    expect(response.body.path).toBe(homeDir);
    expect(response.body.directories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "docs",
          path: path.join(homeDir, "docs"),
        }),
      ]),
    );
  });

  it("lists markdown files and directories for the file picker", async () => {
    fs.mkdirSync(path.join(homeDir, "docs"));
    fs.writeFileSync(path.join(homeDir, "draft.md"), "# Draft\n");
    fs.writeFileSync(path.join(homeDir, "ignored.txt"), "Nope\n");

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).get("/api/fs/list");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      path: homeDir,
      displayPath: "~",
      parentPath: null,
    });
    expect(response.body.directories).toEqual([
      {
        name: "docs",
        path: path.join(homeDir, "docs"),
        kind: "directory",
      },
    ]);
    expect(response.body.files).toEqual([
      {
        name: "draft.md",
        path: path.join(homeDir, "draft.md"),
        kind: "file",
      },
    ]);
  });

  it("returns project tree paths with directories before files", async () => {
    fs.mkdirSync(path.join(projectDir, "notes", "nested"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(projectDir, "zeta.md"), "# Zeta\n");
    fs.writeFileSync(path.join(projectDir, "notes", "alpha.md"), "# Alpha\n");

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).get("/api/file-tree").query({
      projectPath: projectDir,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      paths: ["notes/", "notes/nested/", "notes/alpha.md", "zeta.md"],
    });
  });

  it("opens and creates project directories", async () => {
    const createdDir = path.join(projectDir, "created", "workspace");

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
      port: 4321,
    });

    const openResponse = await request(app)
      .post("/api/project/open")
      .send({ path: projectDir });
    expect(openResponse.status).toBe(200);
    expect(openResponse.body).toEqual({
      backend: "local-files",
      projectDir,
      port: 4321,
    });

    const createResponse = await request(app)
      .post("/api/project/create")
      .send({ path: createdDir });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual({
      backend: "local-files",
      projectDir: createdDir,
      port: 4321,
    });
    expect(fs.statSync(createdDir).isDirectory()).toBe(true);
  });

  it("reports an undelivered open request when no matching window is listening", async () => {
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
      port: 4312,
    });

    const response = await request(app)
      .post("/api/open-request")
      .send({
        path: path.join(projectDir, "draft.md"),
        url: "http://localhost:4312/?path=/tmp/draft.md",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ delivered: false });
  });

  it("serves local files and stores uploaded assets inside the project", async () => {
    fs.writeFileSync(path.join(projectDir, "image.txt"), "asset text\n");

    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
    });

    const fileResponse = await request(app).get("/api/files").query({
      projectPath: projectDir,
      path: "image.txt",
    });
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.text).toBe("asset text\n");

    const assetResponse = await request(app)
      .post("/api/assets")
      .send({
        projectPath: projectDir,
        filename: "My Sketch.png",
        mimeType: "image/png",
        dataBase64: Buffer.from("png bytes").toString("base64"),
      });

    expect(assetResponse.status).toBe(201);
    expect(assetResponse.body).toMatchObject({
      markdownPath: "./.roughdraft-assets/My-Sketch.png",
      mimeType: "image/png",
    });
    expect(assetResponse.body.previewUrl).toContain("/api/files?");
    expect(
      fs.readFileSync(
        path.join(projectDir, ".roughdraft-assets", "My-Sketch.png"),
        "utf-8",
      ),
    ).toBe("png bytes");
  });

  it("advertises remote-document support in the status capabilities", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    const response = await request(app).get("/api/status");
    expect(response.status).toBe(200);
    expect(response.body.capabilities).toMatchObject({
      remoteDocuments: true,
    });
  });

  it("registers a remote document session and returns it on GET", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    const sessionId = "session-1";

    const register = await request(app).post("/api/remote-document").send({
      sessionId,
      originPath: "/work/draft.md",
      content: "# hello\n",
    });

    expect(register.status).toBe(201);
    expect(register.body).toMatchObject({
      id: sessionId,
      version: expect.any(String),
      viewerUrl: expect.stringContaining(`/?session=${sessionId}`),
    });

    const fetchResponse = await request(app).get(
      `/api/remote-document/${sessionId}`,
    );
    expect(fetchResponse.status).toBe(200);
    expect(fetchResponse.body).toMatchObject({
      id: sessionId,
      originPath: "/work/draft.md",
      content: "# hello\n",
      version: register.body.version,
    });
  });

  it("rejects remote-document register without required fields", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    const response = await request(app)
      .post("/api/remote-document")
      .send({ sessionId: "x" });
    expect(response.status).toBe(400);
  });

  it("rejects a remote-document register with a duplicate session id", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    await request(app).post("/api/remote-document").send({
      sessionId: "dup",
      originPath: "/a.md",
      content: "a",
    });

    const second = await request(app).post("/api/remote-document").send({
      sessionId: "dup",
      originPath: "/b.md",
      content: "b",
    });
    expect(second.status).toBe(409);
  });

  it("returns 404 for unknown remote document sessions", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    const get = await request(app).get("/api/remote-document/missing");
    expect(get.status).toBe(404);

    const put = await request(app)
      .put("/api/remote-document/missing")
      .send({ content: "x" });
    expect(put.status).toBe(404);
  });

  it("requires a bearer token on remote-document JSON routes when a token is configured", async () => {
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
      remoteDocumentToken: "secret-token",
    });

    const noToken = await request(app).post("/api/remote-document").send({
      sessionId: "auth-1",
      originPath: "/work/a.md",
      content: "x",
    });
    expect(noToken.status).toBe(401);

    const wrongToken = await request(app)
      .post("/api/remote-document")
      .set("Authorization", "Bearer wrong-token")
      .send({
        sessionId: "auth-1",
        originPath: "/work/a.md",
        content: "x",
      });
    expect(wrongToken.status).toBe(401);

    const queryToken = await request(app)
      .post("/api/remote-document")
      .query({ token: "secret-token" })
      .send({
        sessionId: "auth-1",
        originPath: "/work/a.md",
        content: "x",
      });
    expect(queryToken.status).toBe(401);

    const ok = await request(app)
      .post("/api/remote-document")
      .set("Authorization", "Bearer secret-token")
      .send({
        sessionId: "auth-1",
        originPath: "/work/a.md",
        content: "x",
      });
    expect(ok.status).toBe(201);

    const getWithQueryToken = await request(app)
      .get("/api/remote-document/auth-1")
      .query({ token: "secret-token" });
    expect(getWithQueryToken.status).toBe(401);

    const getWithHeader = await request(app)
      .get("/api/remote-document/auth-1")
      .set("Authorization", "Bearer secret-token");
    expect(getWithHeader.status).toBe(200);

    const putWithQueryToken = await request(app)
      .put("/api/remote-document/auth-1")
      .query({ token: "secret-token" })
      .send({ content: "mutated" });
    expect(putWithQueryToken.status).toBe(401);

    const unchanged = await request(app)
      .get("/api/remote-document/auth-1")
      .set("Authorization", "Bearer secret-token");
    expect(unchanged.body.content).toBe("x");
  });

  it("accepts ?token= query for the SSE endpoint when a token is configured", async () => {
    const { app } = createApp({
      homeDir,
      staticDirPath: projectDir,
      remoteDocumentToken: "secret-token",
    });

    await request(app)
      .post("/api/remote-document")
      .set("Authorization", "Bearer secret-token")
      .send({ sessionId: "sse-auth", originPath: "/a.md", content: "x" });

    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;

      const noToken = await fetch(
        `http://127.0.0.1:${port}/api/remote-document/sse-auth/events?role=viewer`,
      );
      expect(noToken.status).toBe(401);

      const queryToken = await fetch(
        `http://127.0.0.1:${port}/api/remote-document/sse-auth/events?role=viewer&token=secret-token`,
      );
      expect(queryToken.status).toBe(200);
      await queryToken.body?.cancel();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("advertises whether a remote-document token is required in /api/status", async () => {
    const noTokenApp = createApp({ homeDir, staticDirPath: projectDir });
    const noTokenStatus = await request(noTokenApp.app).get("/api/status");
    expect(noTokenStatus.body.capabilities.remoteDocumentTokenRequired).toBe(
      false,
    );

    const tokenApp = createApp({
      homeDir,
      staticDirPath: projectDir,
      remoteDocumentToken: "secret-token",
    });
    const tokenStatus = await request(tokenApp.app).get("/api/status");
    expect(tokenStatus.body.capabilities.remoteDocumentTokenRequired).toBe(
      true,
    );
  });

  it("returns 503 and keeps both content and version back when PUT lands with no active CLI session listener", async () => {
    // The browser's save is meaningless if no CLI is connected to receive it
    // and write to disk. Surfacing 503 (instead of silently 200-ing) prevents
    // the browser from believing a save succeeded that never reached disk.
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    const register = await request(app).post("/api/remote-document").send({
      sessionId: "s2",
      originPath: "/draft.md",
      content: "v1",
    });

    const update = await request(app).put("/api/remote-document/s2").send({
      content: "v2",
    });

    expect(update.status).toBe(503);
    // An undelivered save must not move the version: the browser retries with
    // the same expectedVersion, and a moved version would turn the delivery
    // failure into a phantom 409.
    expect(update.body.version).toBe(register.body.version);

    // The undelivered bytes must not be retained either. Echoing them back on
    // the bootstrap GET makes the browser's localStorage draft — the only
    // durable copy of that unsent work — look like it already reached the
    // destination, and the restore policy then discards it.
    const fetched = await request(app).get("/api/remote-document/s2");
    expect(fetched.body.content).toBe("v1");
    expect(fetched.body.version).toBe(register.body.version);
  });

  it("accepts a retry with the original expectedVersion once a CLI attaches", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    const register = await request(app).post("/api/remote-document").send({
      sessionId: "s4",
      originPath: "/a.md",
      content: "v1",
    });

    const undelivered = await request(app).put("/api/remote-document/s4").send({
      content: "v2",
      expectedVersion: register.body.version,
    });
    expect(undelivered.status).toBe(503);

    await withListeningApp(app, async ({ openStream }) => {
      const cli = await openStream("/api/remote-document/s4/events?role=cli");
      await cli.waitFor("event: connected");

      const retry = await request(app).put("/api/remote-document/s4").send({
        content: "v2",
        expectedVersion: register.body.version,
      });

      expect(retry.status).toBe(200);
      expect(retry.body.version).not.toBe(register.body.version);
      expect(await cli.waitFor("event: save")).toContain('"content":"v2"');
    });
  });

  it("returns 409 with current state when expectedVersion is stale", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    const register = await request(app).post("/api/remote-document").send({
      sessionId: "s3",
      originPath: "/a.md",
      content: "v1",
    });

    await withListeningApp(app, async ({ openStream }) => {
      const cli = await openStream("/api/remote-document/s3/events?role=cli");
      await cli.waitFor("event: connected");

      // A delivered save moves the version, so the next PUT carrying the
      // registration version really is stale.
      const delivered = await request(app).put("/api/remote-document/s3").send({
        content: "v2",
        expectedVersion: register.body.version,
      });
      expect(delivered.status).toBe(200);

      const conflict = await request(app).put("/api/remote-document/s3").send({
        content: "v-bad",
        expectedVersion: register.body.version,
      });

      expect(conflict.status).toBe(409);
      expect(conflict.body.current).toMatchObject({
        id: "s3",
        content: "v2",
      });
    });
  });

  it("attaches streams without role=cli as viewers, leaving the CLI in place", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    await request(app).post("/api/remote-document").send({
      sessionId: "s5",
      originPath: "/a.md",
      content: "v1",
    });

    await withListeningApp(app, async ({ openStream }) => {
      const cli = await openStream("/api/remote-document/s5/events?role=cli");
      await cli.waitFor("event: connected");

      // Only the literal role=cli is privileged; anything else is a viewer, so
      // a mistyped or absent role cannot displace the CLI that owns the disk.
      for (const query of ["", "?role=bogus"]) {
        const stream = await openStream(
          `/api/remote-document/s5/events${query}`,
        );
        expect(await stream.waitFor("event: connected")).toContain(
          '"role":"viewer"',
        );
      }

      const update = await request(app).put("/api/remote-document/s5").send({
        content: "v2",
      });

      expect(update.status).toBe(200);
      expect(await cli.waitFor("event: save")).toContain('"content":"v2"');
    });
  });

  it("returns 404 when opening SSE for an unknown session", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    const response = await request(app).get("/api/remote-document/nope/events");
    expect(response.status).toBe(404);
  });

  it("delivers a save event over SSE when the session content is updated", async () => {
    const { app } = createApp({ homeDir, staticDirPath: projectDir });
    const sessionId = "sse-delivers";

    const register = await request(app).post("/api/remote-document").send({
      sessionId,
      originPath: "/draft.md",
      content: "before",
    });
    expect(register.status).toBe(201);

    await withListeningApp(app, async ({ openStream }) => {
      const cli = await openStream(
        `/api/remote-document/${sessionId}/events?role=cli`,
      );
      await cli.waitFor("event: connected");

      const update = await request(app)
        .put(`/api/remote-document/${sessionId}`)
        .send({ content: "after" });
      expect(update.status).toBe(200);

      expect(await cli.waitFor("event: save")).toContain('"content":"after"');
    });
  });
});

describe("sweepRemoteSessions", () => {
  function fakeViewer(): Response & { ended: boolean } {
    const viewer = { ended: false, end: () => (viewer.ended = true) };
    return viewer as unknown as Response & { ended: boolean };
  }

  function session(overrides: Partial<RemoteSession> = {}): RemoteSession {
    return {
      id: "s1",
      originPath: "/draft.md",
      content: "body",
      version: "v1",
      saveClient: null,
      viewers: new Set(),
      disconnectedAt: null,
      ...overrides,
    };
  }

  it("ends the viewer streams of a session it drops", () => {
    // A viewer left attached to a forgotten session keeps receiving keepalives
    // forever: its EventSource never errors, so the browser's re-open loop
    // never runs and the tab goes stale without ever saying so.
    const viewer = fakeViewer();
    const sessions = new Map([
      ["s1", session({ disconnectedAt: 1_000, viewers: new Set([viewer]) })],
    ]);

    sweepRemoteSessions(sessions, 1_000 + REMOTE_SESSION_TTL_MS + 1);

    expect(sessions.has("s1")).toBe(false);
    expect(viewer.ended).toBe(true);
  });

  it("leaves a session still inside its grace period alone", () => {
    const viewer = fakeViewer();
    const sessions = new Map([
      ["s1", session({ disconnectedAt: 1_000, viewers: new Set([viewer]) })],
    ]);

    sweepRemoteSessions(sessions, 1_000 + REMOTE_SESSION_TTL_MS);

    expect(sessions.has("s1")).toBe(true);
    expect(viewer.ended).toBe(false);
  });

  it("leaves a connected session alone however old it is", () => {
    const viewer = fakeViewer();
    const sessions = new Map([
      ["s1", session({ disconnectedAt: null, viewers: new Set([viewer]) })],
    ]);

    sweepRemoteSessions(sessions, Number.MAX_SAFE_INTEGER);

    expect(sessions.has("s1")).toBe(true);
    expect(viewer.ended).toBe(false);
  });
});
