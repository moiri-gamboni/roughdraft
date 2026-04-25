export interface Page {
  id: string;
  title: string;
  content: string; // markdown string
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

export interface StoredAsset {
  markdownPath: string;
  previewUrl: string;
  mimeType: string;
}

export interface BackendInfo {
  kind: "local-files" | "local-storage";
  label: string;
  detail: string;
  projectPath?: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryListing {
  path: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
}

export interface FileSystemEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

export interface FileSystemListing {
  path: string;
  displayPath: string;
  parentPath: string | null;
  directories: FileSystemEntry[];
  files: FileSystemEntry[];
}

export interface ProjectTreeListing {
  paths: string[];
}

export interface StorageBackend {
  info: BackendInfo;
  canManageProjects: boolean;
  listPages(): Promise<Page[]>;
  getPage(id: string): Promise<Page>;
  getMarkdownFile(relativePath: string): Promise<Page>;
  savePage(id: string, content: string): Promise<void>;
  saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page | undefined>;
  watchMarkdownFile?(
    relativePath: string,
    onChange: (event: MarkdownFileChangeEvent) => void,
  ): () => void;
  createPage(title?: string, content?: string): Promise<Page>;
  deletePage(id: string): Promise<void>;
  saveAsset(file: File): Promise<StoredAsset>;
  resolveFileUrl(path: string): string | null;
  listDirectories(path?: string): Promise<DirectoryListing>;
  listFileSystem(path?: string): Promise<FileSystemListing>;
  listProjectTree(): Promise<ProjectTreeListing>;
  openProject(path: string): Promise<void>;
  createProject(path: string): Promise<void>;
}
