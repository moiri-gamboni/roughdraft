import {
  MarkdownFileConflictError,
  type BackendInfo,
  type DirectoryListing,
  type FileSystemListing,
  type MarkdownFileChangeEvent,
  type Page,
  type ProjectTreeListing,
  type StorageBackend,
  type StoredAsset,
} from "./storage";

export class ApiBackend implements StorageBackend {
  info: BackendInfo;
  canManageProjects = true;

  constructor(info: BackendInfo) {
    this.info = info;
  }

  private updateProjectInfo(projectPath?: string): void {
    this.info = {
      ...this.info,
      detail: projectPath || "Project folder on disk",
      projectPath,
    };
  }

  private buildUrl(route: string, params?: Record<string, string>): string {
    const url = new URL(route, window.location.origin);
    const projectPath = this.info.projectPath?.trim();

    if (projectPath) {
      url.searchParams.set("projectPath", projectPath);
    }

    Object.entries(params ?? {}).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return `${url.pathname}${url.search}`;
  }

  async listPages(): Promise<Page[]> {
    const res = await fetch(this.buildUrl("/api/pages"));
    if (!res.ok) throw new Error(`Failed to list pages: ${res.status}`);
    return res.json();
  }

  async getPage(id: string): Promise<Page> {
    const res = await fetch(
      this.buildUrl(`/api/pages/${encodeURIComponent(id)}`),
    );
    if (!res.ok) throw new Error(`Failed to get page ${id}: ${res.status}`);
    return res.json();
  }

  async getMarkdownFile(relativePath: string): Promise<Page> {
    const res = await fetch(
      this.buildUrl("/api/markdown-file", {
        path: relativePath,
      }),
    );
    if (!res.ok) {
      throw new Error(
        `Failed to get markdown file ${relativePath}: ${res.status}`,
      );
    }
    return res.json();
  }

  async savePage(id: string, content: string): Promise<void> {
    const res = await fetch(
      this.buildUrl(`/api/pages/${encodeURIComponent(id)}`),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, projectPath: this.info.projectPath }),
      },
    );
    if (!res.ok) throw new Error(`Failed to save page ${id}: ${res.status}`);
  }

  async saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page> {
    const res = await fetch(
      this.buildUrl("/api/markdown-file", { path: relativePath }),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          expectedVersion,
          projectPath: this.info.projectPath,
        }),
      },
    );
    if (res.status === 409) {
      const payload = (await res.json()) as { current?: Page };
      if (payload.current) {
        throw new MarkdownFileConflictError(payload.current);
      }
    }
    if (!res.ok) {
      throw new Error(
        `Failed to save markdown file ${relativePath}: ${res.status}`,
      );
    }
    return res.json();
  }

  watchMarkdownFile(
    relativePath: string,
    onChange: (event: MarkdownFileChangeEvent) => void,
  ): () => void {
    const source = new EventSource(
      this.buildUrl("/api/markdown-file/events", { path: relativePath }),
    );

    source.addEventListener("change", (event) => {
      try {
        onChange(JSON.parse((event as MessageEvent<string>).data));
      } catch (error) {
        console.error("Failed to read markdown file change event:", error);
      }
    });

    source.onerror = (error) => {
      console.error("Markdown file event stream failed:", error);
    };

    return () => {
      source.close();
    };
  }

  async createPage(title?: string, content?: string): Promise<Page> {
    const res = await fetch(this.buildUrl("/api/pages"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content,
        projectPath: this.info.projectPath,
      }),
    });
    if (!res.ok) throw new Error(`Failed to create page: ${res.status}`);
    return res.json();
  }

  async deletePage(id: string): Promise<void> {
    const res = await fetch(
      this.buildUrl(`/api/pages/${encodeURIComponent(id)}`),
      {
        method: "DELETE",
      },
    );
    if (!res.ok) throw new Error(`Failed to delete page ${id}: ${res.status}`);
  }

  async saveAsset(file: File): Promise<StoredAsset> {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index];
      if (byte === undefined) continue;
      binary += String.fromCharCode(byte);
    }

    const res = await fetch(this.buildUrl("/api/assets"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64: btoa(binary),
        projectPath: this.info.projectPath,
      }),
    });

    if (!res.ok) throw new Error(`Failed to save asset: ${res.status}`);
    return res.json();
  }

  resolveFileUrl(path: string): string | null {
    const normalized = path.replace(/^\.?\//, "");
    return this.buildUrl("/api/files", { path: normalized });
  }

  async listDirectories(path?: string): Promise<DirectoryListing> {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await fetch(`/api/directories${query}`);
    if (!res.ok) throw new Error(`Failed to list directories: ${res.status}`);
    return res.json();
  }

  async listFileSystem(path?: string): Promise<FileSystemListing> {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await fetch(`/api/fs/list${query}`);
    if (!res.ok) throw new Error(`Failed to list file system: ${res.status}`);
    return res.json();
  }

  async listProjectTree(): Promise<ProjectTreeListing> {
    const res = await fetch(this.buildUrl("/api/file-tree"));
    if (!res.ok) throw new Error(`Failed to list project tree: ${res.status}`);
    return res.json();
  }

  async openProject(path: string): Promise<void> {
    this.updateProjectInfo(path);
  }

  async createProject(path: string): Promise<void> {
    const res = await fetch("/api/project/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
    const payload = (await res.json()) as { projectDir?: string };
    this.updateProjectInfo(payload.projectDir);
  }
}
