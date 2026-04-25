import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index";

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
      port: 4312,
      serverRoot,
      stateless: true,
      capabilities: {
        projectPathRequired: true,
        fileSystemBrowsing: true,
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
});
