import { describe, expect, it } from "vitest";
import {
  createCriticComment,
  criticMarkdownToEditorState,
  criticMarkdownToRenderedHtml,
} from "./critic-markup";
import {
  buildCommentThreadRailItems,
  type CommentGroupAnchor,
  reconcileCommentsWithDoc,
} from "./document-comments";

const DOCUMENT_WITH_ENDMATTER_REPLY = `# Draft

{==anchored text==}{>>Original comment.<<}{#c1}

---
comments:
  c1:
    by: user
    at: "2026-04-28T12:00:00.000Z"
  c2:
    body: A reply that lives only in the endmatter.
    by: AI
    at: "2026-04-28T12:05:00.000Z"
    re: c1
`;

function anchorGroupFor(commentIds: string[]): CommentGroupAnchor {
  return {
    key: commentIds.join(","),
    commentIds,
    anchorTop: 0,
    anchorBottom: 20,
  };
}

describe("buildCommentThreadRailItems", () => {
  it("renders a reply that exists only in the YAML endmatter", () => {
    const { comments } = criticMarkdownToRenderedHtml(
      DOCUMENT_WITH_ENDMATTER_REPLY,
    );

    // The anchor only knows about the inline marker, which is exactly the
    // situation the app writes itself when replying through the rail.
    const items = buildCommentThreadRailItems(
      [anchorGroupFor(["c1"])],
      comments,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.rootCommentId).toBe("c1");
    expect(items[0]?.commentIds).toEqual(["c1", "c2"]);
  });

  it("does not duplicate a reply that is already anchored inline", () => {
    const { comments } = criticMarkdownToRenderedHtml(
      DOCUMENT_WITH_ENDMATTER_REPLY,
    );

    const items = buildCommentThreadRailItems(
      [anchorGroupFor(["c1", "c2"])],
      comments,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.commentIds).toEqual(["c1", "c2"]);
  });

  it("renders a thread once when its anchor is split across groups", () => {
    // Commenting on a range that partially overlaps an existing comment
    // leaves c1 anchored as `[c1]` on one side and `[c1, c2]` on the other.
    const { comments } = criticMarkdownToRenderedHtml(
      "{==a {==b==}{>>c2<<}{#c2} c==}{>>c1<<}{#c1}",
    );

    const items = buildCommentThreadRailItems(
      [
        { ...anchorGroupFor(["c1"]), anchorTop: 0, anchorBottom: 20 },
        { ...anchorGroupFor(["c1", "c2"]), anchorTop: 30, anchorBottom: 50 },
      ],
      comments,
    );

    expect(items.map((item) => item.key)).toEqual(["c1", "c2"]);
    expect(items[0]).toMatchObject({ anchorTop: 0, anchorBottom: 50 });
  });
});

describe("reconcileCommentsWithDoc", () => {
  const anchoredDoc = criticMarkdownToEditorState(
    'a {==x==}{>>n<<}{#c1} b\n\n---\ncomments:\n  c1:\n    by: u\n    at: "2026-01-01T00:00:00.000Z"\n',
  );
  const plainDoc = criticMarkdownToEditorState("a x b\n");
  const comment = anchoredDoc.comments.get("c1");
  if (!comment) throw new Error("fixture comment missing");

  it("restores a buried comment when its anchor reappears (undo)", () => {
    const result = reconcileCommentsWithDoc(
      anchoredDoc.doc,
      new Map(),
      new Map([["c1", comment]]),
      new Set(["c1"]),
    );

    expect(result.changed).toBe(true);
    expect([...result.live.keys()]).toEqual(["c1"]);
    expect(result.graveyard.size).toBe(0);
  });

  it("restores a buried reply along with its root", () => {
    const reply = createCriticComment(
      { content: "r", parentCommentId: "c1" },
      { existingComments: [comment] },
    );
    const result = reconcileCommentsWithDoc(
      anchoredDoc.doc,
      new Map(),
      new Map([
        ["c1", comment],
        [reply.id, reply],
      ]),
      new Set(["c1", reply.id]),
    );

    expect([...result.live.keys()].sort()).toEqual(["c1", reply.id].sort());
  });

  it("keeps a deleted reply buried while its root stays anchored", () => {
    // Deleting a reply removes only its own id from the shared anchor mark.
    // Restoration must key on the reply's own id: climbing to the
    // still-anchored root restored every deleted reply on the next update.
    const reply = createCriticComment(
      { content: "r", parentCommentId: "c1" },
      { existingComments: [comment] },
    );
    const result = reconcileCommentsWithDoc(
      anchoredDoc.doc,
      new Map([["c1", comment]]),
      new Map([[reply.id, reply]]),
      new Set(["c1", reply.id]),
    );

    expect(result.changed).toBe(false);
    expect([...result.graveyard.keys()]).toEqual([reply.id]);
  });

  it("keeps a deleted suggestion comment buried while its change stays", () => {
    // A comment attached to a suggestion has no anchor of its own; its
    // deletion changes nothing in the document, so nothing may restore it.
    const suggestionComment = createCriticComment(
      { content: "n", parentCommentId: "s1" },
      {},
    );
    const changeDoc = criticMarkdownToEditorState(
      'a {--x--}{#s1} b\n\n---\nsuggestions:\n  s1:\n    by: u\n    at: "2026-01-01T00:00:00.000Z"\n',
    );
    const result = reconcileCommentsWithDoc(
      changeDoc.doc,
      new Map(),
      new Map([[suggestionComment.id, suggestionComment]]),
      new Set(),
    );

    expect(result.changed).toBe(false);
    expect([...result.graveyard.keys()]).toEqual([suggestionComment.id]);
  });

  it("buries a live comment whose anchor disappeared (undo of creation)", () => {
    const result = reconcileCommentsWithDoc(
      plainDoc.doc,
      new Map([["c1", comment]]),
      new Map(),
      new Set(["c1"]),
    );

    expect(result.changed).toBe(true);
    expect(result.live.size).toBe(0);
    expect([...result.graveyard.keys()]).toEqual(["c1"]);
  });

  it("leaves an endmatter orphan that was never anchored alone", () => {
    const orphan = createCriticComment(
      { content: "orphan reply", parentCommentId: "gone" },
      {},
    );
    const result = reconcileCommentsWithDoc(
      plainDoc.doc,
      new Map([[orphan.id, orphan]]),
      new Map(),
      new Set(),
    );

    expect(result.changed).toBe(false);
    expect([...result.live.keys()]).toEqual([orphan.id]);
  });

  it("records anchored comments so a later burial is licensed", () => {
    const everAnchored = new Set<string>();
    reconcileCommentsWithDoc(
      anchoredDoc.doc,
      new Map([["c1", comment]]),
      new Map(),
      everAnchored,
    );

    expect(everAnchored.has("c1")).toBe(true);
  });
});
