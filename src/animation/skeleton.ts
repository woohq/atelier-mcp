/**
 * Server-side bone hierarchy. Pure TS, no Three.js dependency.
 * Tracks skeletons and their bone trees by ID.
 */

export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  length: number;
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface Skeleton {
  id: string;
  name: string;
  bones: Map<string, Bone>;
  rootBoneId: string | null;
}

export class SkeletonRegistry {
  private skeletons = new Map<string, Skeleton>();
  private nextId = 1;

  private generateId(prefix = "skel"): string {
    return `${prefix}_${this.nextId++}`;
  }

  create(params: { id?: string; name: string }): Skeleton {
    const id = params.id ?? this.generateId();
    if (this.skeletons.has(id)) {
      throw new Error(`Skeleton with id "${id}" already exists`);
    }
    const skeleton: Skeleton = {
      id,
      name: params.name,
      bones: new Map(),
      rootBoneId: null,
    };
    this.skeletons.set(id, skeleton);
    return skeleton;
  }

  get(id: string): Skeleton | undefined {
    return this.skeletons.get(id);
  }

  addBone(skeletonId: string, bone: Omit<Bone, "id"> & { id?: string }): Bone {
    const skeleton = this.skeletons.get(skeletonId);
    if (!skeleton) {
      throw new Error(`Skeleton "${skeletonId}" not found`);
    }

    const boneId = bone.id ?? this.generateId("bone");
    if (skeleton.bones.has(boneId)) {
      throw new Error(`Bone with id "${boneId}" already exists in skeleton "${skeletonId}"`);
    }

    // Validate parent exists if specified
    if (bone.parentId !== null && !skeleton.bones.has(bone.parentId)) {
      throw new Error(`Parent bone "${bone.parentId}" not found in skeleton "${skeletonId}"`);
    }

    const newBone: Bone = {
      id: boneId,
      name: bone.name,
      parentId: bone.parentId,
      length: bone.length,
      position: [...bone.position],
      rotation: [...bone.rotation],
    };

    skeleton.bones.set(boneId, newBone);

    // First bone with no parent becomes root
    if (newBone.parentId === null && skeleton.rootBoneId === null) {
      skeleton.rootBoneId = boneId;
    }

    return newBone;
  }

  list(): Skeleton[] {
    return [...this.skeletons.values()];
  }

  clear(): void {
    this.skeletons.clear();
    this.nextId = 1;
  }
}
