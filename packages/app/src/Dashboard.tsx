/**
 * The page at `/`: what this Roughdraft server has been asked to open, what an
 * agent is currently blocked on, and what was reviewed recently.
 *
 * `data` is the seam the tests render through; production passes nothing and
 * the page polls for itself.
 */

import {
  Clock,
  Copy,
  FileText,
  RefreshCcw,
  ServerOff,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { buildLocationForPath, getPathLeaf } from "./app-navigation";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  type DashboardReview,
  type DashboardReviewSummary,
  type DashboardRow,
  normalizeAbsolutePath,
} from "./dashboard-data";
import { copyTextToClipboard } from "./lib/clipboard";
import { formatRelativeAge } from "./lib/relative-time";
import { cn } from "./lib/utils";
import { type DashboardData, useDashboardData } from "./useDashboardData";

const COPY_FEEDBACK_MS = 2000;

interface DashboardProps {
  loadError: string | null;
  requestedPath: string | null;
  /** Test seam: the polling hook runs only when this is absent. */
  data?: DashboardData;
}

export function Dashboard({ loadError, requestedPath, data }: DashboardProps) {
  if (data) {
    return (
      <DashboardView
        loadError={loadError}
        requestedPath={requestedPath}
        data={data}
      />
    );
  }
  return (
    <PollingDashboard loadError={loadError} requestedPath={requestedPath} />
  );
}

function PollingDashboard({
  loadError,
  requestedPath,
}: Omit<DashboardProps, "data">) {
  const data = useDashboardData();
  return (
    <DashboardView
      loadError={loadError}
      requestedPath={requestedPath}
      data={data}
    />
  );
}

function DashboardView({
  loadError,
  requestedPath,
  data,
}: Omit<DashboardProps, "data"> & { data: DashboardData }) {
  const { status, payload, rows, nowMs, updatedAtMs } = data;
  const isEmpty =
    status === "ok" &&
    rows !== null &&
    rows.waiting.length === 0 &&
    rows.documents.length === 0;

  return (
    <div
      data-testid="dashboard"
      className="min-h-screen bg-[#FCFCFC] text-stone-900 dark:bg-background dark:text-slate-100"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-8">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-stone-200 pb-3 dark:border-slate-800">
          <h1 className="text-sm font-semibold tracking-[0.01em] text-stone-700 dark:text-slate-200">
            {payload
              ? `Roughdraft · port ${payload.server.port} · running since ${formatStartedAt(payload.server.startedAt, nowMs)}`
              : "Roughdraft"}
          </h1>
          {updatedAtMs !== null && (
            <span className="text-[0.7rem] text-stone-400 dark:text-slate-500">
              {`updated ${formatClock(updatedAtMs)}`}
            </span>
          )}
        </header>

        {loadError && (
          <Notice
            testId="dashboard-load-error"
            tone="warning"
            icon={<TriangleAlert className="size-3.5" />}
          >
            <p>{loadError}</p>
            {requestedPath && (
              <p className="mt-0.5 font-mono text-[0.7rem] break-all text-amber-800 dark:text-amber-300">
                {requestedPath}
              </p>
            )}
          </Notice>
        )}

        {status === "unsupported" && (
          <Notice
            testId="dashboard-unsupported"
            tone="warning"
            icon={<ServerOff className="size-3.5" />}
          >
            <p>
              This server is running an older build. Run{" "}
              <code className="font-mono">roughdraft stop</code>, then open a
              document again.
            </p>
          </Notice>
        )}

        {status === "unreachable" && (
          <Notice
            testId="dashboard-unreachable"
            tone="muted"
            icon={<ServerOff className="size-3.5" />}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>Couldn't reach the Roughdraft server.</p>
              <Button
                data-testid="dashboard-unreachable-retry"
                variant="outline"
                size="sm"
                onClick={data.retry}
              >
                <RefreshCcw className="size-3.5" />
                Retry
              </Button>
            </div>
          </Notice>
        )}

        {status === "stale" && (
          <Notice
            testId="dashboard-stale-notice"
            tone="muted"
            icon={<Clock className="size-3.5" />}
          >
            <p>
              Showing the last update. The server did not answer the latest
              poll.
            </p>
          </Notice>
        )}

        {status === "loading" && (
          <p className="text-xs text-stone-400 dark:text-slate-500">Loading…</p>
        )}

        {rows && rows.waiting.length > 0 && (
          <Section
            testId="dashboard-section-waiting"
            title="Waiting for your review"
          >
            {rows.waiting.map((row) => (
              <Row
                key={row.absolutePath}
                row={row}
                nowMs={nowMs}
                onDiscardDraft={data.discardDraft}
              />
            ))}
          </Section>
        )}

        {rows && rows.documents.length > 0 && (
          <Section testId="dashboard-section-documents" title="Documents">
            {rows.documents.map((row) => (
              <Row
                key={row.absolutePath}
                row={row}
                nowMs={nowMs}
                onDiscardDraft={data.discardDraft}
              />
            ))}
          </Section>
        )}

        {rows && rows.reviews.length > 0 && (
          <Section testId="dashboard-section-reviews" title="Recent reviews">
            {rows.reviews.map((review) => (
              <ReviewItem key={review.sequence} review={review} nowMs={nowMs} />
            ))}
          </Section>
        )}

        {isEmpty && payload && (
          <div
            data-testid="dashboard-empty"
            className="rounded-md border border-stone-200 bg-white px-4 py-4 text-xs leading-6 text-stone-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
          >
            <p>
              {`This server has not been asked to open a document since it started ${formatRelativeAge(payload.server.startedAt, nowMs)}.`}
            </p>
            <p className="text-stone-500 dark:text-slate-400">
              Ask an agent to open one, or run{" "}
              <code className="font-mono text-stone-700 dark:text-slate-200">
                {"roughdraft open <file.md>"}
              </code>{" "}
              in a terminal.
            </p>
          </div>
        )}

        <OpenByPathField />
      </div>
    </div>
  );
}

function Section({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="flex flex-col gap-1.5">
      <h2 className="text-[0.62rem] font-medium tracking-[0.06em] text-stone-400 uppercase dark:text-slate-500">
        {title}
      </h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Notice({
  testId,
  tone,
  icon,
  children,
}: {
  testId: string;
  tone: "warning" | "muted";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5",
        tone === "warning"
          ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          : "border-stone-200 bg-white text-stone-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Row({
  row,
  nowMs,
  onDiscardDraft,
}: {
  row: DashboardRow;
  nowMs: number;
  onDiscardDraft: (key: string) => void;
}) {
  const draft = row.draft;
  const counts = row.document ? formatCounts(row.document.summary) : null;
  const draftLabel = draftBadgeLabel(row);

  return (
    <article
      data-testid="dashboard-row"
      data-document-path={row.absolutePath}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900",
        // The blocked agent is what this page exists to surface.
        row.awaiting && "border-amber-300 dark:border-amber-700",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <FileText className="size-3.5 shrink-0 text-stone-400 dark:text-slate-500" />
        <a
          data-testid="dashboard-row-open"
          href={row.href}
          className="text-sm font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-700 dark:text-slate-100 dark:decoration-slate-600 dark:hover:decoration-slate-200"
        >
          {row.fileName}
        </a>
        <span className="min-w-0 truncate text-[0.7rem] text-stone-400 dark:text-slate-500">
          {row.directory}
        </span>
        {row.awaiting && (
          <Badge data-testid="dashboard-waiting-badge">agent waiting</Badge>
        )}
        {draftLabel && (
          <Badge data-testid="dashboard-draft-badge" variant="warning">
            {draftLabel}
          </Badge>
        )}
        {row.missing && (
          <Badge data-testid="dashboard-missing-badge" variant="muted">
            file missing on disk
          </Badge>
        )}
        {counts && <Badge variant="muted">{counts}</Badge>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.7rem] text-stone-500 dark:text-slate-400">
          {formatRowFacts(row, nowMs)}
        </p>
        <div className="flex items-center gap-1">
          <CopyPathButton absolutePath={row.absolutePath} />
          {draft && (
            <Button
              data-testid="dashboard-row-discard-draft"
              variant="ghost"
              size="xs"
              onClick={() => {
                if (
                  window.confirm(
                    `Discard this browser's unsaved draft of ${row.fileName}?`,
                  )
                ) {
                  onDiscardDraft(draft.key);
                }
              }}
            >
              <Trash2 className="size-2.5" />
              Discard draft
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function CopyPathButton({ absolutePath }: { absolutePath: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <Button
      data-testid="dashboard-row-copy-path"
      variant="ghost"
      size="xs"
      onClick={async () => {
        try {
          await copyTextToClipboard(absolutePath);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
    >
      <Copy className="size-2.5" />
      {state === "idle" && "Copy path"}
      {state === "copied" && "Copied"}
      {state === "failed" && "Couldn't copy"}
    </Button>
  );
}

function ReviewItem({
  review,
  nowMs,
}: {
  review: DashboardReview;
  nowMs: number;
}) {
  const counts = formatCounts(review.summary);

  return (
    <div
      data-testid="dashboard-review-item"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-stone-200 bg-white px-3 py-2 text-[0.7rem] text-stone-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
    >
      <span>{formatRelativeAge(review.createdAt, nowMs)}</span>
      <a
        href={buildLocationForPath(review.absolutePath)}
        className="text-xs font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-700 dark:text-slate-100 dark:decoration-slate-600 dark:hover:decoration-slate-200"
      >
        {getPathLeaf(review.absolutePath) ?? review.absolutePath}
      </a>
      {counts && <Badge variant="muted">{counts}</Badge>}
      {review.hasOverallComment && (
        <Badge variant="muted">overall comment</Badge>
      )}
      {!review.deliveredToWaiter && (
        <span className="text-amber-700 dark:text-amber-300">
          no agent was waiting when this was sent
        </span>
      )}
    </div>
  );
}

function OpenByPathField() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-1.5 border-t border-stone-200 pt-4 dark:border-slate-800"
      onSubmit={(event) => {
        event.preventDefault();
        const path = normalizeAbsolutePath(value);
        if (!path.startsWith("/")) {
          setError("Enter an absolute path, starting with /.");
          return;
        }
        if (!path.endsWith(".md")) {
          setError("Roughdraft opens one .md file at a time.");
          return;
        }
        setError(null);
        window.location.assign(buildLocationForPath(path));
      }}
    >
      <label
        htmlFor="dashboard-open-path"
        className="text-[0.62rem] font-medium tracking-[0.06em] text-stone-400 uppercase dark:text-slate-500"
      >
        Open a document by path
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="dashboard-open-path"
          data-testid="dashboard-open-path-input"
          value={value}
          placeholder="/absolute/path/to/file.md"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          data-testid="dashboard-open-path-submit"
          type="submit"
          size="sm"
        >
          Open
        </Button>
      </div>
      {error && (
        <p
          data-testid="dashboard-open-path-error"
          className="text-[0.7rem] text-destructive"
        >
          {error}
        </p>
      )}
    </form>
  );
}

function draftBadgeLabel(row: DashboardRow): string | null {
  if (!row.draft) return null;
  if (!row.document) return "draft only";
  return row.draft.disposition === "unsaved" ? "unsaved draft" : null;
}

function formatCounts(summary: DashboardReviewSummary | null): string | null {
  if (!summary) return null;
  const parts = [
    plural(summary.comments, "comment"),
    plural(summary.suggestions, "suggestion"),
    summary.unresolved > 0 ? `${summary.unresolved} unresolved` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function plural(count: number, noun: string): string | null {
  if (count <= 0) return null;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatRowFacts(row: DashboardRow, nowMs: number): string {
  const facts: string[] = [];
  const document = row.document;

  if (document?.modifiedAt) {
    facts.push(`modified ${formatRelativeAge(document.modifiedAt, nowMs)}`);
  }
  if (document?.lastOpenedAt) {
    facts.push(`opened ${formatRelativeAge(document.lastOpenedAt, nowMs)}`);
  }
  if (document?.lastReviewedAt) {
    facts.push(`reviewed ${formatRelativeAge(document.lastReviewedAt, nowMs)}`);
  }
  if (row.draft) {
    facts.push(
      `draft saved ${formatRelativeAge(row.draft.updatedAt, nowMs)}`,
    );
  }

  return facts.join(" · ");
}

/** Relative while the server started today; a full date-time once it did not. */
function formatStartedAt(iso: string, nowMs: number): string {
  const started = new Date(iso);
  if (started.toDateString() === new Date(nowMs).toDateString()) {
    return formatRelativeAge(iso, nowMs);
  }
  return started.toLocaleString();
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
