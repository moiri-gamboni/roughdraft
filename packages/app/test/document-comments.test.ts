import { describe, expect, it } from "vitest";
import {
  getCommentAnchorMeasurements,
  groupCommentAnchorMeasurements,
  resolveCommentRailLayouts,
} from "../src/document-comments";

describe("document comment layout helpers", () => {
  it("maps DOM anchor boxes to positions relative to the editor", () => {
    const measurements = getCommentAnchorMeasurements(
      [
        {
          dataset: {
            commentIds: JSON.stringify(["cmt-1"]),
          },
          getBoundingClientRect: () => ({
            top: 180,
            bottom: 212,
          }),
        },
      ],
      120,
    );

    expect(measurements).toEqual([
      {
        commentIds: ["cmt-1"],
        anchorTop: 60,
        anchorBottom: 92,
      },
    ]);
  });

  it("groups multiple DOM spans that belong to the same anchored comments", () => {
    const grouped = groupCommentAnchorMeasurements([
      {
        commentIds: ["cmt-2", "cmt-3"],
        anchorTop: 40,
        anchorBottom: 54,
      },
      {
        commentIds: ["cmt-3", "cmt-2"],
        anchorTop: 58,
        anchorBottom: 74,
      },
      {
        commentIds: ["cmt-4"],
        anchorTop: 140,
        anchorBottom: 156,
      },
    ]);

    expect(grouped).toEqual([
      {
        key: "cmt-2::cmt-3",
        commentIds: ["cmt-2", "cmt-3"],
        anchorTop: 40,
        anchorBottom: 74,
      },
      {
        key: "cmt-4",
        commentIds: ["cmt-4"],
        anchorTop: 140,
        anchorBottom: 156,
      },
    ]);
  });

  it("pushes overlapping cards down the rail while keeping later gaps intact", () => {
    const layouts = resolveCommentRailLayouts(
      [
        {
          key: "cmt-5",
          commentIds: ["cmt-5"],
          anchorTop: 20,
          anchorBottom: 34,
        },
        {
          key: "cmt-6",
          commentIds: ["cmt-6"],
          anchorTop: 48,
          anchorBottom: 62,
        },
        {
          key: "cmt-7",
          commentIds: ["cmt-7"],
          anchorTop: 220,
          anchorBottom: 236,
        },
      ],
      {
        "cmt-5": 100,
        "cmt-6": 90,
        "cmt-7": 80,
      },
      16,
    );

    expect(
      layouts.map(({ key, railTop, railBottom }) => ({
        key,
        railTop,
        railBottom,
      })),
    ).toEqual([
      {
        key: "cmt-5",
        railTop: 20,
        railBottom: 120,
      },
      {
        key: "cmt-6",
        railTop: 136,
        railBottom: 226,
      },
      {
        key: "cmt-7",
        railTop: 242,
        railBottom: 322,
      },
    ]);
  });
});
