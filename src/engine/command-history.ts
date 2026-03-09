/**
 * Command history for undo/redo support.
 * Records tool invocations and their inverse operations.
 */

import { logger } from "../util/logger.js";

export interface CommandRecord {
  toolName: string;
  args: Record<string, unknown>;
  /** Data needed to reverse this command */
  undoData: Record<string, unknown>;
  timestamp: number;
}

export class CommandHistory {
  private undoStack: CommandRecord[] = [];
  private redoStack: CommandRecord[] = [];
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  push(record: CommandRecord): void {
    this.undoStack.push(record);
    // Clear redo stack on new action (standard undo/redo behavior)
    this.redoStack.length = 0;

    // Trim if over max
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
  }

  popUndo(): CommandRecord | undefined {
    const record = this.undoStack.pop();
    if (record) {
      this.redoStack.push(record);
    }
    return record;
  }

  popRedo(): CommandRecord | undefined {
    const record = this.redoStack.pop();
    if (record) {
      this.undoStack.push(record);
    }
    return record;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    logger.debug("Command history cleared");
  }
}
