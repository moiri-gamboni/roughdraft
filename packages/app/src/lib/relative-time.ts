export function formatRelativeAge(
  at: string | number,
  nowMs: number,
): string {
  const elapsedMs = nowMs - new Date(at).getTime();
  if (!Number.isFinite(elapsedMs)) return "";

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
