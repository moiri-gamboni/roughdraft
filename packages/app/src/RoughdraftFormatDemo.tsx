import { ArrowRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "./components/ui/button";
import { MarkdownCodeEditor } from "./MarkdownCodeEditor";
import { PageCard } from "./PageCard";
import type { Page, StorageBackend } from "./storage";

interface FormatExample {
  id: string;
  label: string;
  markdown: string;
}

const FORMAT_EXAMPLES: FormatExample[] = [
  {
    id: "spec-review",
    label: "Review a spec",
    markdown:
      '# Checkout Spec Review\nGoal: reduce trial checkout abandonment by 8%. Scope: ship {==guest checkout for returning teams==}{>>PM: confirm whether this excludes SSO-only workspaces.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"} in the first beta.\n\nMetric: replace {~~activation~>first successful team purchase~~}{id="s1" by="user" at="2026-04-28T12:03:00.000Z"} before engineering sizing.\n',
  },
  {
    id: "plan-review",
    label: "Review a plan",
    markdown:
      '# Agent Plan Review\nPlan: scaffold the settings page, wire save/load through `settings.ts`, then {==run the full suite after styling==}{>>Can we add the failing state test before implementation so the agent has a guardrail?<<}{id="c1" by="user" at="2026-04-28T12:10:00.000Z"}.\n\nAdd {++a rollback note for the migration step++}{id="s1" by="user" at="2026-04-28T12:12:00.000Z"}{>>I want to keep this easy to undo if the vibe pass gets messy.<<}{id="c2" by="user" at="2026-04-28T12:13:00.000Z" re="s1"} before implementation starts.\n',
  },
  {
    id: "writing-edit",
    label: "Edit writing",
    markdown:
      '## Draft Intro\nRoughdraft lets me stay in flow while an agent marks up {==my argument==}{>>AI: this is the claim readers need to understand first.<<}{id="c1" by="AI" at="2026-04-28T12:20:00.000Z"}.\n\nIt turns feedback from {~~a confusing pile of notes~>specific comments and suggested edits inside the Markdown file~~}{id="s1" by="AI" at="2026-04-28T12:21:00.000Z"}{>>User: keep the plain-English phrasing, but avoid making it sound like a docs product.<<}{id="c2" by="user" at="2026-04-28T12:22:00.000Z" re="s1"}.\n',
  },
];

const demoBackend: StorageBackend = {
  info: {
    kind: "local-storage",
    label: "Homepage demo",
    detail: "In-memory Roughdraft format preview",
  },
  canManageProjects: false,
  async getMarkdownFile() {
    return {
      id: "homepage-format-preview",
      title: "homepage-format-preview.md",
      content: FORMAT_EXAMPLES[0].markdown,
    };
  },
  async saveMarkdownFile(_relativePath, content) {
    return {
      id: "homepage-format-preview",
      title: "homepage-format-preview.md",
      content,
    };
  },
  async saveAsset(file) {
    return {
      markdownPath: file.name,
      previewUrl: "",
      mimeType: file.type || "application/octet-stream",
    };
  },
  resolveFileUrl() {
    return null;
  },
  async openProject() {},
};

export function RoughdraftFormatDemo() {
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(
    FORMAT_EXAMPLES[0].id,
  );
  const [source, setSource] = useState(FORMAT_EXAMPLES[0].markdown);
  const page: Page = useMemo(
    () => ({
      id: "homepage-format-preview",
      title: "homepage-format-preview.md",
      content: source,
    }),
    [source],
  );

  const handleSelectExample = useCallback((example: FormatExample) => {
    setSelectedExampleId(example.id);
    setSource(example.markdown);
  }, []);

  const handleSourceChange = useCallback((nextSource: string) => {
    setSelectedExampleId(null);
    setSource(nextSource);
  }, []);

  const handleResultChange = useCallback((nextSource: string) => {
    setSelectedExampleId(null);
    setSource(nextSource);
  }, []);

  return (
    <section
      aria-labelledby="roughdraft-markdown-heading"
      className="rfm-format-demo mx-auto mt-20 w-full max-w-none border-t border-slate-200 pt-10 text-left dark:border-slate-700 sm:mt-24"
    >
      <div className="mx-auto w-full">
        <div className="max-w-3xl">
          <p className="text-xs font-medium tracking-[0.16em] text-stone-500 uppercase dark:text-stone-400">
            Roughdraft flavored Markdown
          </p>
          <h2
            className="mt-3 text-3xl leading-tight font-semibold text-balance text-slate-950 dark:text-slate-50 sm:text-4xl"
            id="roughdraft-markdown-heading"
          >
            It's just Markdown
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-400">
            We extended the markdown format, building on prior art like{" "}
            <a
              className="font-medium text-slate-950 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-950 dark:text-slate-50 dark:decoration-slate-600 dark:hover:decoration-slate-50"
              href="https://criticmarkup.com/"
              target="_blank"
              rel="noreferrer"
            >
              CriticMarkup
            </a>
            , to support full comment threads, and suggesting changes. Read the{" "}
            <a
              className="font-medium text-slate-950 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-950 dark:text-slate-50 dark:decoration-slate-600 dark:hover:decoration-slate-50"
              href="/roughdraft-flavored-markdown"
            >
              spec
            </a>
            . We are working with other major Markdown apps to rally support for
            this initiative.
          </p>
        </div>
      </div>

      <div
        className="mx-auto mt-5 flex w-full flex-wrap gap-2"
        role="group"
        aria-label="Format examples"
      >
        {FORMAT_EXAMPLES.map((example) => (
          <Button
            className="h-8 px-3 text-xs"
            key={example.id}
            type="button"
            variant={selectedExampleId === example.id ? "default" : "outline"}
            onClick={() => handleSelectExample(example)}
          >
            {example.label}
          </Button>
        ))}
      </div>

      <div className="mx-auto mt-5 grid w-full gap-3 lg:grid-cols-[minmax(20rem,0.72fr)_2.5rem_minmax(0,1.28fr)] lg:items-stretch">
        <div className="rfm-demo-pane">
          <div className="rfm-demo-pane-header">
            <span>Source</span>
          </div>
          <MarkdownCodeEditor
            className="rfm-source-editor"
            value={source}
            onChange={handleSourceChange}
          />
        </div>

        <div className="hidden items-start justify-center pt-3 text-slate-400 dark:text-slate-500 lg:flex">
          <ArrowRight className="size-5" aria-hidden="true" />
        </div>

        <div className="rfm-demo-pane">
          <div className="rfm-demo-pane-header">
            <span>Result</span>
          </div>
          <div className="rfm-result-editor">
            <PageCard
              page={page}
              selected
              backend={demoBackend}
              interactionMode="editing"
              onSave={async () => {}}
              onLocalContentChange={handleResultChange}
              saveBlocked
            />
          </div>
        </div>
      </div>
    </section>
  );
}
