import type { NodeViewRendererProps } from "@tiptap/core";
import { DOMSerializer, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";

/**
 * Fenced `mermaid` code blocks render as diagrams. The fence text stays the
 * node's editable content, so saving never sees the diagram: the node view
 * only adds a rendered picture beside the source and hides the source while
 * nothing needs it.
 */

const sourceVisibleClass = "mermaid-block-source-visible";

function isMermaidBlock(node: ProseMirrorNode) {
  return node.type.name === "codeBlock" && node.attrs.language === "mermaid";
}

type MermaidTheme = "dark" | "default";

function currentTheme(): MermaidTheme {
  return document.documentElement.classList.contains("dark")
    ? "dark"
    : "default";
}

// Point comments and suggested paragraphs sit on an invisible word joiner,
// which mermaid would read as part of a node name.
const wordJoiner = "\u2060";

/**
 * The text to draw: the source as it would read with its pending suggestions
 * accepted, since deleted text stays in the document until then.
 */
export function diagramSource(node: ProseMirrorNode) {
  let source = "";
  node.forEach((child) => {
    const removed = child.marks.some(
      (mark) =>
        mark.type.name === "criticChange" &&
        (mark.attrs.kind === "deletion" ||
          mark.attrs.kind === "substitution-old"),
    );
    if (!removed) source += child.text ?? "";
  });
  return source.replaceAll(wordJoiner, "");
}

let mermaidLoader: Promise<typeof import("mermaid").default> | null = null;
let renderCount = 0;
// mermaid.initialize sets global config that render reads after awaiting, so
// interleaved renders could draw with each other's theme: run one at a time.
let renderQueue: Promise<unknown> = Promise.resolve();
// Keyed by theme and source. The editor recreates node views while it mounts,
// so without this each diagram would render several times on open.
const renders = new Map<string, Promise<string>>();

// Loaded on first use: mermaid is several times the size of the rest of the
// app, and most documents have no diagram.
function loadMermaid() {
  mermaidLoader ??= import("mermaid").then(
    (module) => module.default,
    (error) => {
      mermaidLoader = null;
      throw error;
    },
  );
  return mermaidLoader;
}

function renderSvg(source: string, theme: MermaidTheme) {
  const render = renderQueue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // Otherwise a parse error leaves mermaid's own error graphic on <body>.
      suppressErrorRendering: true,
      theme,
    });
    renderCount += 1;
    const { svg } = await mermaid.render(
      `mermaid-diagram-${renderCount}`,
      source,
    );
    return svg;
  });
  renderQueue = render.catch(() => undefined);
  return render;
}

function renderMermaid(source: string, theme: MermaidTheme) {
  const key = `${theme}\n${source}`;
  let render = renders.get(key);
  if (!render) {
    if (renders.size >= 50) renders.clear();
    render = renderSvg(source, theme);
    renders.set(key, render);
    // A failure may be a chunk that failed to load, so it is not kept.
    render.catch(() => renders.delete(key));
  }
  return render;
}

// Diagrams follow the app's colour scheme, which main.tsx switches live.
const liveRenders = new Set<() => void>();
let themeObserver: MutationObserver | null = null;
let observedTheme: MermaidTheme | null = null;

function watchTheme(render: () => void) {
  liveRenders.add(render);
  if (themeObserver) return;
  observedTheme = currentTheme();
  themeObserver = new MutationObserver(() => {
    const theme = currentTheme();
    if (theme === observedTheme) return;
    observedTheme = theme;
    for (const rerender of liveRenders) rerender();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

function createMermaidNodeView({
  node,
  view,
  getPos,
}: NodeViewRendererProps): NodeView {
  const dom = document.createElement("div");
  dom.className = "mermaid-block";
  dom.dataset.testid = "mermaid-block";

  const diagram = document.createElement("div");
  diagram.className = "mermaid-diagram";
  diagram.contentEditable = "false";
  diagram.dataset.testid = "mermaid-diagram";
  diagram.title = "Click to edit the diagram source";

  const pre = document.createElement("pre");
  pre.dataset.testid = "mermaid-source";
  const code = document.createElement("code");
  code.className = "language-mermaid";
  pre.append(code);
  dom.append(diagram, pre);

  // Clicking the picture puts the caret in the source, which reveals it.
  diagram.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const pos = getPos();
    if (pos === undefined) return;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)),
    );
    view.focus();
  });

  let source = diagramSource(node);
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  // Renders are async; only the latest one may write to the DOM.
  let latestRender = 0;

  const render = async () => {
    const renderId = ++latestRender;
    const theme = currentTheme();
    try {
      const svg = await renderMermaid(source, theme);
      if (renderId !== latestRender) return;
      diagram.innerHTML = svg;
      diagram.dataset.theme = theme;
      diagram.firstElementChild?.setAttribute("data-testid", "mermaid-svg");
      dom.classList.remove("mermaid-block-error");
    } catch (error) {
      if (renderId !== latestRender) return;
      const message = document.createElement("p");
      message.className = "mermaid-error";
      message.dataset.testid = "mermaid-error";
      message.textContent = `Diagram error: ${
        error instanceof Error ? error.message : String(error)
      }`;
      diagram.replaceChildren(message);
      dom.classList.add("mermaid-block-error");
    }
  };
  void render();
  watchTheme(render);

  return {
    dom,
    contentDOM: code,
    update(next) {
      if (!isMermaidBlock(next)) return false;
      const nextSource = diagramSource(next);
      if (nextSource !== source) {
        source = nextSource;
        clearTimeout(renderTimer);
        renderTimer = setTimeout(render, 250);
      }
      return true;
    },
    stopEvent: (event) => diagram.contains(event.target as Node),
    // Only the source is document content; the picture and the classes set
    // on the wrapper are not, and reading them back as edits would recreate
    // this view in a loop.
    ignoreMutation: (mutation) =>
      mutation.type !== "selection" && !code.contains(mutation.target),
    destroy() {
      liveRenders.delete(render);
      clearTimeout(renderTimer);
      latestRender += 1;
    },
  };
}

/** Code blocks keep their schema rendering; only mermaid fences differ. */
export function createCodeBlockNodeView(props: NodeViewRendererProps) {
  const { node } = props;
  if (isMermaidBlock(node)) return createMermaidNodeView(props);

  const toDOM = node.type.spec.toDOM;
  if (!toDOM) throw new Error("codeBlock has no toDOM");
  const { dom, contentDOM } = DOMSerializer.renderSpec(document, toDOM(node));
  return {
    dom: dom as HTMLElement,
    contentDOM,
    update: (next: ProseMirrorNode) =>
      next.type === node.type && next.attrs.language === node.attrs.language,
  } satisfies NodeView;
}

const arrowDirections = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
} as const;

/**
 * The source of a mermaid block shows while the selection is inside it, and
 * always when it carries review marks: a comment or suggestion anchored in
 * hidden text would have nowhere to point.
 */
export const mermaidSourceVisibility = new Plugin({
  key: new PluginKey("mermaidSourceVisibility"),
  props: {
    // The browser's own caret motion skips the hidden source, so arrowing
    // off the end of a block into a diagram steps into its source instead.
    handleKeyDown(view, event) {
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return false;
      }
      const direction =
        arrowDirections[event.key as keyof typeof arrowDirections];
      const { selection } = view.state;
      if (!direction || !selection.empty || !view.endOfTextblock(direction)) {
        return false;
      }

      const forward = direction === "down" || direction === "right";
      const { $head } = selection;
      if (!$head.parent.isTextblock) return false;
      const $edge = view.state.doc.resolve(
        forward ? $head.after() : $head.before(),
      );
      const neighbour = forward ? $edge.nodeAfter : $edge.nodeBefore;
      if (!neighbour || !isMermaidBlock(neighbour)) return false;

      view.dispatch(
        view.state.tr
          .setSelection(
            TextSelection.create(
              view.state.doc,
              forward ? $edge.pos + 1 : $edge.pos - 1,
            ),
          )
          .scrollIntoView(),
      );
      return true;
    },
    decorations(state) {
      const { from, to } = state.selection;
      const decorations: Decoration[] = [];

      state.doc.descendants((node, pos) => {
        if (node.isTextblock && !isMermaidBlock(node)) return false;
        if (!isMermaidBlock(node)) return true;

        const end = pos + node.nodeSize;
        let reviewed = false;
        node.forEach((child) => {
          if (child.marks.length > 0) reviewed = true;
        });

        if (reviewed || (from < end && to > pos)) {
          decorations.push(
            Decoration.node(pos, end, { class: sourceVisibleClass }),
          );
        }
        return false;
      });

      return DecorationSet.create(state.doc, decorations);
    },
  },
});
