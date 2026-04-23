import { Mark, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentRef: {
      setCommentRef: (attributes: { commentIds: string[] }) => ReturnType;
      removeCommentId: (commentId: string) => ReturnType;
      unsetCommentRef: () => ReturnType;
    };
  }
}

const CommentRef = Mark.create({
  name: "commentRef",
  priority: 1100,
  inclusive: false,
  spanning: true,

  addAttributes() {
    return {
      commentIds: {
        default: [],
        parseHTML: (element) => {
          const ids = element.getAttribute("data-comment-ids");

          if (!ids) return [];

          try {
            return JSON.parse(ids);
          } catch {
            return [];
          }
        },
        renderHTML: (attributes) =>
          attributes.commentIds?.length
            ? { "data-comment-ids": JSON.stringify(attributes.commentIds) }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-ids]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "comment-anchor",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCommentRef:
        (attributes) =>
        ({ commands }) =>
          commands.setMark(this.name, attributes),
      removeCommentId:
        (commentId) =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks.commentRef;

          if (!markType) return false;

          let found = false;

          state.doc.descendants((node, pos) => {
            if (!node.isText) return;

            const mark = node.marks.find(
              (candidate) =>
                candidate.type === markType &&
                Array.isArray(candidate.attrs.commentIds) &&
                candidate.attrs.commentIds.includes(commentId),
            );

            if (!mark) return;

            found = true;

            const from = pos;
            const to = pos + node.nodeSize;
            const nextIds = (mark.attrs.commentIds as string[]).filter(
              (id) => id !== commentId,
            );

            tr.removeMark(from, to, markType);

            if (nextIds.length > 0) {
              tr.addMark(from, to, markType.create({ commentIds: nextIds }));
            }
          });

          if (found && dispatch) {
            dispatch(tr);
          }

          return found;
        },
      unsetCommentRef:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

const MarkdownLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dataMarkdownSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown-src"),
        renderHTML: (attributes) =>
          attributes.dataMarkdownSrc
            ? { "data-markdown-src": attributes.dataMarkdownSrc }
            : {},
      },
    };
  },
});

const MarkdownImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dataMarkdownSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown-src"),
        renderHTML: (attributes) =>
          attributes.dataMarkdownSrc
            ? { "data-markdown-src": attributes.dataMarkdownSrc }
            : {},
      },
    };
  },
});

export function createEditorExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
      link: false,
    }),
    Placeholder.configure({
      placeholder,
    }),
    MarkdownLink.configure({
      autolink: true,
      openOnClick: false,
      linkOnPaste: true,
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    CommentRef,
    MarkdownImage.configure({
      allowBase64: true,
      inline: false,
    }),
  ];
}
