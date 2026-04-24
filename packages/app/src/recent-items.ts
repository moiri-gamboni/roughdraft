export interface RecentItem {
  kind: "file" | "folder";
  path: string;
  openedAt: string;
}

const RECENT_ITEMS_KEY = "roughdraft:recent-items";
const MAX_RECENT_ITEMS_PER_KIND = 8;

function normalizePath(path: string): string {
  return path.trim().replace(/[\\/]+$/, "");
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function getContainingFolder(path: string): string | null {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath || !isMarkdownPath(normalizedPath)) {
    return null;
  }

  const lastSeparatorIndex = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );

  if (lastSeparatorIndex < 0) return null;
  if (lastSeparatorIndex === 0) return normalizedPath[0] === "\\" ? "\\" : "/";
  return normalizedPath.slice(0, lastSeparatorIndex);
}

function parseRecentItems(raw: string | null): RecentItem[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as RecentItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentItem =>
        !!item &&
        (item.kind === "file" || item.kind === "folder") &&
        typeof item.path === "string" &&
        typeof item.openedAt === "string",
    );
  } catch {
    return [];
  }
}

function writeRecentItems(items: RecentItem[]): void {
  localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(items));
}

function upsertRecentItem(
  items: RecentItem[],
  nextItem: RecentItem,
): RecentItem[] {
  const filtered = items.filter(
    (item) => !(item.kind === nextItem.kind && item.path === nextItem.path),
  );
  const nextItems = [nextItem, ...filtered];

  const files = nextItems
    .filter((item) => item.kind === "file")
    .slice(0, MAX_RECENT_ITEMS_PER_KIND);
  const folders = nextItems
    .filter((item) => item.kind === "folder")
    .slice(0, MAX_RECENT_ITEMS_PER_KIND);

  return [...files, ...folders].sort((left, right) =>
    right.openedAt.localeCompare(left.openedAt),
  );
}

export function readRecentItems(): RecentItem[] {
  return parseRecentItems(localStorage.getItem(RECENT_ITEMS_KEY));
}

export function listRecentItems(kind: RecentItem["kind"]): RecentItem[] {
  return readRecentItems()
    .filter((item) => item.kind === kind)
    .sort((left, right) => right.openedAt.localeCompare(left.openedAt));
}

export function recordRecentOpen(path: string): void {
  const trimmedPath = path.trim();
  if (!trimmedPath) return;

  let nextItems = readRecentItems();
  const openedAt = new Date().toISOString();

  if (isMarkdownPath(trimmedPath)) {
    nextItems = upsertRecentItem(nextItems, {
      kind: "file",
      path: trimmedPath,
      openedAt,
    });

    const folderPath = getContainingFolder(trimmedPath);
    if (folderPath) {
      nextItems = upsertRecentItem(nextItems, {
        kind: "folder",
        path: folderPath,
        openedAt,
      });
    }
  } else {
    nextItems = upsertRecentItem(nextItems, {
      kind: "folder",
      path: normalizePath(trimmedPath) || trimmedPath,
      openedAt,
    });
  }

  writeRecentItems(nextItems);
}
