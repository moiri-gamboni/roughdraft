import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "./components/ui/button";
import type { UpdateStatus } from "./update-status";

interface UpdateNoticeProps {
  updateStatus: UpdateStatus;
}

export function UpdateNotice({ updateStatus }: UpdateNoticeProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  const handleUpdate = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(updateStatus.updateCommand);
      setCopied(true);
    } catch {
      window.open(
        `https://www.npmjs.com/package/${encodeURIComponent(updateStatus.packageName)}`,
        "_blank",
        "noopener,noreferrer",
      );
    }
  }, [updateStatus.packageName, updateStatus.updateCommand]);

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/95 p-4 text-slate-900 shadow-[0_14px_34px_rgba(120,53,15,0.12)] backdrop-blur">
      <div className="text-[0.68rem] font-semibold tracking-[0.18em] text-amber-700 uppercase">
        Update available
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">
        You&apos;re on {updateStatus.currentVersion}. The latest version is{" "}
        {updateStatus.latestVersion}.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800"
          onClick={() => void handleUpdate()}
          title={`Copy ${updateStatus.updateCommand}`}
        >
          {copied ? "Copied" : "Update"}
        </Button>
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          {copied ? (
            "Copied the npm command"
          ) : (
            <>
              Copies the npm command
              <ArrowUpRight className="size-3" />
            </>
          )}
        </span>
      </div>
    </div>
  );
}
