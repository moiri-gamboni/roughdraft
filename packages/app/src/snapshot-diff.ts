import { diffLines } from "diff";

/**
 * How many lines of one uninterrupted run are worth showing. A restore-worthy
 * snapshot can differ from the open document by the whole file, and rendering
 * ten thousand lines answers "what changed?" no better than forty does.
 */
export const MAX_DIFF_RUN_LINES = 40;

export type DiffLineKind = "added" | "removed" | "context";

export type DiffLine =
  | { kind: DiffLineKind; text: string }
  | { kind: "elided"; count: number };

export interface SnapshotDiff {
  lines: DiffLine[];
  /** False when the two texts are identical, which is worth saying plainly. */
  changed: boolean;
}

/**
 * Split a diff chunk into lines without inventing one. `diffLines` keeps the
 * trailing newline on a chunk, so a plain split leaves an empty last element
 * that is punctuation rather than content.
 */
function toLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function kindOf(change: { added?: boolean; removed?: boolean }): DiffLineKind {
  if (change.added) return "added";
  if (change.removed) return "removed";
  return "context";
}

/**
 * A unified line diff of two revisions of one document.
 *
 * Deliberately a line diff rather than CriticMarkup: both sides *contain*
 * review markers, and wrapping real `{>>…<<}` in synthetic `{++…++}` is a
 * nesting the parser never promised to render. Lines cannot collide with
 * their own content, so a fenced code block full of markers passes through
 * untouched.
 */
export function diffSnapshot(before: string, after: string): SnapshotDiff {
  const lines: DiffLine[] = [];
  let changed = false;

  for (const change of diffLines(before, after)) {
    const kind = kindOf(change);
    if (kind !== "context") changed = true;

    const runLines = toLines(change.value);
    for (const text of runLines.slice(0, MAX_DIFF_RUN_LINES)) {
      lines.push({ kind, text });
    }

    const elided = runLines.length - MAX_DIFF_RUN_LINES;
    if (elided > 0) lines.push({ kind: "elided", count: elided });
  }

  return { lines, changed };
}
