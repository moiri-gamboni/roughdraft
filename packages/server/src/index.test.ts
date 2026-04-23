import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index";

describe("createApp", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-server-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates a page and persists it in roughdraft.json", async () => {
    const { app } = createApp({
      projectDir,
      staticDirPath: projectDir,
    });

    const response = await request(app)
      .post("/api/pages")
      .send({ title: "Draft" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: "untitled-1",
      title: "Draft",
      content: "# Draft\n",
    });

    const filePath = path.join(projectDir, "untitled-1.md");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("# Draft\n");

    const project = JSON.parse(
      fs.readFileSync(path.join(projectDir, "roughdraft.json"), "utf-8"),
    ) as {
      pages: Record<
        string,
        { x: number; y: number; width: number; height: number }
      >;
    };

    expect(project.pages["untitled-1"]).toEqual({
      x: 20,
      y: 0,
      width: 400,
      height: 500,
    });
  });

  it("reads nested markdown files inside the project", async () => {
    const nestedDir = path.join(projectDir, "notes");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "roughdraft.json"),
      JSON.stringify({ pages: {} }),
    );
    fs.writeFileSync(path.join(nestedDir, "draft.md"), "# Nested draft\n");

    const { app } = createApp({
      projectDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).get("/api/markdown-file").query({
      path: "notes/draft.md",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "notes/draft",
      title: "Nested draft",
      content: "# Nested draft\n",
    });
  });

  it("rejects markdown-file reads outside the project directory", async () => {
    fs.writeFileSync(
      path.join(projectDir, "roughdraft.json"),
      JSON.stringify({ pages: {} }),
    );

    const { app } = createApp({
      projectDir,
      staticDirPath: projectDir,
    });

    const response = await request(app).get("/api/markdown-file").query({
      path: "../secrets.md",
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Markdown file not found" });
  });
});
