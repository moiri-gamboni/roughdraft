import { describe, expect, it } from "vitest";
import { type CriticComment, createCriticComment } from "./critic-markup";
import {
  buildCommentThreadRailItems,
  type CommentGroupAnchor,
  resolveAnchoredRailLayouts,
} from "./document-comments";

/**
 * Property fuzz for the rail's pure layout/threading functions. Cheap enough
 * to run thousands of cases in-suite. Deterministic (mulberry32 per case).
 */

const CASE_COUNT = Number(process.env.FUZZ_CASES ?? 2000);

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("resolveAnchoredRailLayouts", () => {
  it(`never overlaps cards and pins the active anchor (${CASE_COUNT} cases)`, () => {
    const GAP = 16;
    const failures: string[] = [];

    for (let caseIndex = 0; caseIndex < CASE_COUNT; caseIndex++) {
      const random = mulberry32(caseIndex);
      const itemCount = 1 + Math.floor(random() * 12);
      let anchorTop = random() * 40;
      const items = Array.from({ length: itemCount }, (_, index) => {
        anchorTop += random() * 300;
        return {
          key: `k${index}`,
          anchorTop,
          anchorBottom: anchorTop + 10 + random() * 80,
        };
      });
      const heights: Record<string, number> = {};
      for (const item of items) {
        // Leave some unmeasured so the default-height path is exercised.
        if (random() < 0.8) heights[item.key] = 20 + random() * 400;
      }
      const activeKey =
        random() < 0.7
          ? (items[Math.floor(random() * itemCount)]?.key ?? null)
          : null;

      const layouts = resolveAnchoredRailLayouts(
        items,
        heights,
        activeKey,
        GAP,
      );
      const fail = (problem: string) =>
        failures.push(
          `case ${caseIndex} active=${activeKey} ${problem} layouts=${JSON.stringify(layouts.map((l) => [l.key, l.railTop, l.railBottom]))}`,
        );

      if (layouts.length !== items.length) {
        fail(`expected ${items.length} layouts, got ${layouts.length}`);
        continue;
      }
      for (let index = 0; index < layouts.length; index++) {
        const layout = layouts[index]!;
        const height = heights[layout.key] ?? 120;
        if (Math.abs(layout.railBottom - layout.railTop - height) > 1e-6) {
          fail(
            `card ${layout.key} height ${layout.railBottom - layout.railTop} != ${height}`,
          );
        }
        if (index > 0) {
          const previous = layouts[index - 1]!;
          if (layout.railTop < previous.railBottom + GAP - 1e-6) {
            fail(`card ${layout.key} overlaps ${previous.key}`);
          }
        }
      }
      const active = activeKey
        ? layouts.find((layout) => layout.key === activeKey)
        : null;
      if (active && Math.abs(active.railTop - active.anchorTop) > 1e-6) {
        fail(
          `active card not at its anchor (${active.railTop} vs ${active.anchorTop})`,
        );
      }
    }

    expect(failures.slice(0, 8), `${failures.length} failing cases`).toEqual(
      [],
    );
  });
});

describe("buildCommentThreadRailItems", () => {
  it(`emits unique keys for random overlapping anchor groups (${CASE_COUNT} cases)`, () => {
    const failures: string[] = [];

    for (let caseIndex = 0; caseIndex < CASE_COUNT; caseIndex++) {
      const random = mulberry32(caseIndex);
      const comments = new Map<string, CriticComment>();
      const commentCount = 1 + Math.floor(random() * 6);
      const ids: string[] = [];
      for (let index = 0; index < commentCount; index++) {
        const parent =
          ids.length > 0 && random() < 0.4
            ? ids[Math.floor(random() * ids.length)]
            : null;
        const comment = createCriticComment(
          { content: "n", parentCommentId: parent },
          { existingComments: comments.values() },
        );
        comments.set(comment.id, comment);
        ids.push(comment.id);
      }

      // Random groups over random id subsets, mimicking split/overlapping
      // anchors; some reference ids that no longer exist.
      const groupCount = 1 + Math.floor(random() * 4);
      let top = 0;
      const groups: CommentGroupAnchor[] = Array.from(
        { length: groupCount },
        (_, index) => {
          const subset = [
            ...new Set(
              Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
                random() < 0.15
                  ? `missing${index}`
                  : (ids[Math.floor(random() * ids.length)] ?? "missing"),
              ),
            ),
          ];
          top += random() * 200;
          return {
            key: subset.slice().sort().join("::"),
            commentIds: subset,
            anchorTop: top,
            anchorBottom: top + 20,
          };
        },
      );

      const items = buildCommentThreadRailItems(groups, comments);
      const keys = items.map((item) => item.key);
      if (new Set(keys).size !== keys.length) {
        failures.push(
          `case ${caseIndex} duplicate keys ${JSON.stringify(keys)} groups=${JSON.stringify(groups.map((g) => g.commentIds))}`,
        );
      }
      for (let index = 1; index < items.length; index++) {
        if (items[index]!.anchorTop < items[index - 1]!.anchorTop) {
          failures.push(`case ${caseIndex} items not sorted by anchorTop`);
          break;
        }
      }
    }

    expect(failures.slice(0, 8), `${failures.length} failing cases`).toEqual(
      [],
    );
  });
});
