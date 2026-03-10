import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";

export interface Prefab {
  name: string;
  objects: Array<{
    id: string;
    name: string;
    type: string;
    parentId: string | null;
    metadata: Record<string, unknown>;
  }>;
  createdAt: string;
}

export class AssetLibrary {
  private assetsDir: string;

  constructor(assetsDir: string) {
    this.assetsDir = assetsDir;
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.assetsDir, { recursive: true });
  }

  async save(name: string, prefab: Prefab): Promise<string> {
    await this.ensureDir();
    const filePath = path.join(this.assetsDir, `${name}.json`);
    await writeFile(filePath, JSON.stringify(prefab, null, 2), "utf-8");
    return filePath;
  }

  async load(name: string): Promise<Prefab | null> {
    try {
      const filePath = path.join(this.assetsDir, `${name}.json`);
      const data = await readFile(filePath, "utf-8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async list(): Promise<string[]> {
    await this.ensureDir();
    const files = await readdir(this.assetsDir);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  }
}
