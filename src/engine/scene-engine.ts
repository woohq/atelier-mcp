/**
 * Server-side scene graph. Pure TS, no Three.js dependency.
 * Tracks objects by ID, hierarchy, and metadata.
 */

export interface SceneObject {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  metadata: Record<string, unknown>;
}

export class SceneEngine {
  private objects = new Map<string, SceneObject>();
  private nextId = 1;

  generateId(prefix = "obj"): string {
    return `${prefix}_${this.nextId++}`;
  }

  create(params: {
    id?: string;
    name: string;
    type: string;
    parentId?: string | null;
    metadata?: Record<string, unknown>;
  }): SceneObject {
    const id = params.id ?? this.generateId(params.type);
    if (this.objects.has(id)) {
      throw new Error(`Object with id "${id}" already exists`);
    }
    const obj: SceneObject = {
      id,
      name: params.name,
      type: params.type,
      parentId: params.parentId ?? null,
      metadata: params.metadata ?? {},
    };
    this.objects.set(id, obj);
    return obj;
  }

  get(id: string): SceneObject | undefined {
    return this.objects.get(id);
  }

  update(
    id: string,
    changes: Partial<Pick<SceneObject, "name" | "parentId" | "metadata">>,
  ): SceneObject {
    const obj = this.objects.get(id);
    if (!obj) {
      throw new Error(`Object with id "${id}" not found`);
    }
    if (changes.name !== undefined) obj.name = changes.name;
    if (changes.parentId !== undefined) obj.parentId = changes.parentId;
    if (changes.metadata !== undefined) {
      obj.metadata = { ...obj.metadata, ...changes.metadata };
    }
    return obj;
  }

  remove(id: string): boolean {
    // Also remove children
    const children = this.getChildren(id);
    for (const child of children) {
      this.objects.delete(child.id);
    }
    return this.objects.delete(id);
  }

  list(): SceneObject[] {
    return [...this.objects.values()];
  }

  getChildren(parentId: string): SceneObject[] {
    return [...this.objects.values()].filter((o) => o.parentId === parentId);
  }

  clear(): void {
    this.objects.clear();
    this.nextId = 1;
  }

  count(): number {
    return this.objects.size;
  }
}
