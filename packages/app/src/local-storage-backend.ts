import type {
  BackendInfo,
  DirectoryListing,
  FileSystemListing,
  Page,
  ProjectLayout,
  ProjectTreeListing,
  StorageBackend,
  StoredAsset,
} from "./storage";

const PAGES_KEY = "roughdraft:pages";
const PROJECT_KEY = "roughdraft:project";
const ASSETS_KEY = "roughdraft:assets";

interface LocalAssetRecord {
  path: string;
  dataUrl: string;
  mimeType: string;
}

function readPages(): Record<string, Page> {
  try {
    const raw = localStorage.getItem(PAGES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function writePages(pages: Record<string, Page>): void {
  localStorage.setItem(PAGES_KEY, JSON.stringify(pages));
}

function readProject(): ProjectLayout {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { pages: {} };
}

function writeProject(project: ProjectLayout): void {
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
}

function readAssets(): Record<string, LocalAssetRecord> {
  try {
    const raw = localStorage.getItem(ASSETS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function writeAssets(assets: Record<string, LocalAssetRecord>): void {
  localStorage.setItem(ASSETS_KEY, JSON.stringify(assets));
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function nextAssetPath(
  assets: Record<string, LocalAssetRecord>,
  filename: string,
): string {
  const safeName = sanitizeFilename(filename);
  const dotIndex = safeName.lastIndexOf(".");
  const basename = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : "";
  let counter = 0;

  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const path = `./.roughdraft-assets/${basename}${suffix}${extension}`;
    if (!assets[path]) return path;
    counter += 1;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function normalizeAssetPath(input: string): string {
  if (input.startsWith("./")) return input;
  return `./${input.replace(/^\/+/, "")}`;
}

function nextId(pages: Record<string, Page>): string {
  let i = 1;
  while (pages[`untitled-${i}`]) i++;
  return `untitled-${i}`;
}

export class LocalStorageBackend implements StorageBackend {
  info: BackendInfo = {
    kind: "local-storage",
    label: "Browser storage",
    detail: "Saved in this browser only",
  };
  canManageProjects = false;

  async listPages(): Promise<Page[]> {
    return Object.values(readPages());
  }

  async getPage(id: string): Promise<Page> {
    const pages = readPages();
    const page = pages[id];
    if (!page) throw new Error(`Page not found: ${id}`);
    return page;
  }

  async getMarkdownFile(relativePath: string): Promise<Page> {
    const id = relativePath.replace(/\.md$/i, "");
    return this.getPage(id);
  }

  async savePage(id: string, content: string): Promise<void> {
    const pages = readPages();
    if (!pages[id]) throw new Error(`Page not found: ${id}`);
    pages[id].content = content;
    // Derive title from first line of content
    const firstLine = content.split("\n")[0] || "";
    pages[id].title = firstLine.replace(/^#*\s*/, "") || id;
    writePages(pages);
  }

  async saveMarkdownFile(relativePath: string, content: string): Promise<void> {
    const id = relativePath.replace(/\.md$/i, "");
    return this.savePage(id, content);
  }

  async createPage(title?: string, content?: string): Promise<Page> {
    const pages = readPages();
    const id = nextId(pages);
    const page: Page = {
      id,
      title: title || id,
      content: content || `# ${title || "Untitled"}\n`,
    };
    pages[id] = page;
    writePages(pages);

    // Also add to project layout
    const project = readProject();
    const existing = Object.values(project.pages);
    const maxX =
      existing.length > 0 ? Math.max(...existing.map((p) => p.x + p.width)) : 0;
    project.pages[id] = { x: maxX + 20, y: 0, width: 400, height: 500 };
    writeProject(project);

    return page;
  }

  async deletePage(id: string): Promise<void> {
    const pages = readPages();
    delete pages[id];
    writePages(pages);

    const project = readProject();
    delete project.pages[id];
    writeProject(project);
  }

  async getProject(): Promise<ProjectLayout> {
    return readProject();
  }

  async saveProject(project: ProjectLayout): Promise<void> {
    writeProject(project);
  }

  async saveAsset(file: File): Promise<StoredAsset> {
    const assets = readAssets();
    const markdownPath = nextAssetPath(assets, file.name);
    const dataUrl = await fileToDataUrl(file);

    assets[markdownPath] = {
      path: markdownPath,
      dataUrl,
      mimeType: file.type || "application/octet-stream",
    };
    writeAssets(assets);

    return {
      markdownPath,
      previewUrl: dataUrl,
      mimeType: file.type || "application/octet-stream",
    };
  }

  resolveFileUrl(path: string): string | null {
    const assets = readAssets();
    const normalized = normalizeAssetPath(path);
    return assets[normalized]?.dataUrl ?? null;
  }

  async listDirectories(_path?: string): Promise<DirectoryListing> {
    throw new Error("Project folders are unavailable in browser storage mode.");
  }

  async listFileSystem(_path?: string): Promise<FileSystemListing> {
    throw new Error("Project folders are unavailable in browser storage mode.");
  }

  async listProjectTree(): Promise<ProjectTreeListing> {
    throw new Error("Project folders are unavailable in browser storage mode.");
  }

  async openProject(_path: string): Promise<void> {
    throw new Error("Project folders are unavailable in browser storage mode.");
  }

  async createProject(_path: string): Promise<void> {
    throw new Error("Project folders are unavailable in browser storage mode.");
  }
}
