import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureSnapshot,
  listSnapshots,
  readSnapshot,
  type SnapshotSummary,
} from "./checkpoint-store";
import { callTool } from "./mcp";

describe("mcp", () => {
  let tempDir: string;
  let stateFile: string;
  let projectDir: string;
  let documentPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-mcp-"));
    projectDir = path.join(tempDir, "project");
    stateFile = path.join(tempDir, "state", "server.json");
    documentPath = path.join(projectDir, "draft.md");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(documentPath, "# Draft\n");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ url: "http://localhost:7373", port: 7373 }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("omits timeoutSeconds from review watch calls unless the tool caller provides one", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ events: [], timedOut: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await callTool(
      "roughdraft_watch_review_events",
      { documentPath, projectPath: projectDir },
      { ROUGHDRAFT_STATE_FILE: stateFile },
      fetchImpl,
    );
    await callTool(
      "roughdraft_watch_review_events",
      { documentPath, projectPath: projectDir, timeoutSeconds: 5 },
      { ROUGHDRAFT_STATE_FILE: stateFile },
      fetchImpl,
    );

    expect(requestBodies[0]).toMatchObject({
      projectPath: projectDir,
      path: "draft.md",
      batchWindowSeconds: 0.25,
      fromNow: true,
    });
    expect(requestBodies[0]).not.toHaveProperty("timeoutSeconds");
    expect(requestBodies[1]).toMatchObject({
      timeoutSeconds: 5,
    });
  });

  it("returns overall comments from review watch events unchanged", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          events: [
            {
              documentPath,
              type: "review.completed",
              overallComment: "Please prioritize the CLI contract.",
            },
          ],
          timedOut: false,
          nextSequence: 2,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

    const result = await callTool(
      "roughdraft_watch_review_events",
      { documentPath, projectPath: projectDir },
      { ROUGHDRAFT_STATE_FILE: stateFile },
      fetchImpl,
    );

    expect(result).toMatchObject({
      events: [
        {
          overallComment: "Please prioritize the CLI contract.",
        },
      ],
    });
  });

  it("does not write a reply when the message contains a CriticMarkup close delimiter", async () => {
    const original =
      '# Draft\n\n{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';
    fs.writeFileSync(documentPath, original);

    await expect(
      callTool(
        "roughdraft_reply_to_comment",
        {
          documentPath,
          parentId: "c1",
          message: "This closes early <<} and breaks parsing.",
        },
        { ROUGHDRAFT_STATE_FILE: stateFile },
      ),
    ).rejects.toThrow(/CriticMarkup close delimiter/);

    expect(fs.readFileSync(documentPath, "utf8")).toBe(original);
  });

  /** The snapshots of the test document, newest first. */
  function snapshots(): SnapshotSummary[] {
    const listing = listSnapshots(documentPath);
    if (listing.status !== "ok") {
      throw new Error(`Expected a readable history, got ${listing.status}`);
    }
    return listing.snapshots;
  }

  it("keeps the replies it writes in the document history", async () => {
    const original =
      '# Draft\n\n{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';
    fs.writeFileSync(documentPath, original);

    await callTool(
      "roughdraft_reply_to_comment",
      { documentPath, parentId: "c1", message: "Source added." },
      { ROUGHDRAFT_STATE_FILE: stateFile },
    );

    const written = fs.readFileSync(documentPath, "utf8");
    expect(written).toContain("Source added.");
    expect(readSnapshot(documentPath, snapshots()[0].id)).toBe(written);
  });

  it("refuses to treat a snapshot as a document", async () => {
    // An agent handed a snapshot path would otherwise reply into it and start
    // a history of the history, which the HTTP routes refuse.
    const original =
      '# Draft\n\n{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';
    fs.writeFileSync(documentPath, original);
    await callTool(
      "roughdraft_reply_to_comment",
      { documentPath, parentId: "c1", message: "Source added." },
      { ROUGHDRAFT_STATE_FILE: stateFile },
    );
    const snapshotId = snapshots()[0].id;
    const snapshotPath = path.join(
      projectDir,
      ".roughdraft-history",
      "v1",
      "draft",
      `${snapshotId}.md`,
    );

    await expect(
      callTool(
        "roughdraft_get_review_index",
        { documentPath: snapshotPath },
        { ROUGHDRAFT_STATE_FILE: stateFile },
      ),
    ).rejects.toThrow(/history/i);

    expect(fs.existsSync(snapshotPath)).toBe(true);
  });

  it("treats the bytes it read as accounted for, not as someone else's", async () => {
    // A tool derives its write from the read immediately above it, so it
    // incorporates those bytes rather than destroying them and owes no
    // `replaced` capture. The newest snapshot here is deliberately older than
    // the disk — the state a coalesced autosave leaves behind — because that is
    // the only arrangement in which the decision is observable: with a matching
    // snapshot the content dedup would drop the capture anyway.
    const original =
      '# Draft\n\n{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';
    fs.writeFileSync(documentPath, original);
    captureSnapshot(documentPath, "# An older state\n", "save");

    await callTool(
      "roughdraft_reply_to_comment",
      { documentPath, parentId: "c1", message: "Source added." },
      { ROUGHDRAFT_STATE_FILE: stateFile },
    );

    expect(
      snapshots().filter((snapshot) => snapshot.trigger === "replaced"),
    ).toHaveLength(0);
  });

  it("keeps the resolutions it writes in the document history", async () => {
    const original =
      '# Draft\n\n{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';
    fs.writeFileSync(documentPath, original);

    await callTool(
      "roughdraft_mark_resolved",
      { documentPath, targetId: "c1", summary: "Cited." },
      { ROUGHDRAFT_STATE_FILE: stateFile },
    );

    const written = fs.readFileSync(documentPath, "utf8");
    expect(written).not.toBe(original);
    expect(readSnapshot(documentPath, snapshots()[0].id)).toBe(written);
  });
});
