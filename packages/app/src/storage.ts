export interface Page {
  id: string;
  title: string;
  content: string;
  version?: string;
}

export interface MarkdownFileChangeEvent {
  path: string;
  exists: boolean;
  version: string | null;
}

export class MarkdownFileConflictError extends Error {
  current: Page;

  constructor(current: Page) {
    super("Markdown file changed on disk");
    this.name = "MarkdownFileConflictError";
    this.current = current;
  }
}

/**
 * How the open document relates to what the destination holds. Lives here
 * rather than in `App` so `DocumentWorkspace` can name it without importing
 * back up into its own parent.
 *
 * Every state but `"clean"` pauses autosave, warns before unload and blocks
 * the review handoff, so adding one is a decision about all three.
 */
export type DocumentDiskChangeState =
  | "clean"
  | "changed"
  | "conflict"
  | "paused"
  | "draft-restore";

export interface StoredAsset {
  markdownPath: string;
  previewUrl: string;
  mimeType: string;
}

export interface CompleteReviewResult {
  delivered: boolean;
}

export interface CompleteReviewOptions {
  overallComment?: string;
}

export interface ReviewWatchStatus {
  watching: boolean;
  watcherCount: number;
}

export interface BackendInfo {
  kind: "local-files" | "local-storage" | "remote";
  label: string;
  detail: string;
  projectPath?: string;
  sessionId?: string;
  originPath?: string;
}

export interface StorageBackend {
  info: BackendInfo;
  canManageProjects: boolean;
  getMarkdownFile(relativePath: string): Promise<Page>;
  saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page | undefined>;
  watchMarkdownFile?(
    relativePath: string,
    onChange: (event: MarkdownFileChangeEvent) => void,
  ): () => void;
  completeReview?(
    relativePath: string,
    options?: CompleteReviewOptions,
  ): Promise<CompleteReviewResult>;
  getReviewWatchStatus?(relativePath: string): Promise<ReviewWatchStatus>;
  saveAsset(file: File): Promise<StoredAsset>;
  resolveFileUrl(path: string): string | null;
  openProject(path: string): Promise<void>;
}
