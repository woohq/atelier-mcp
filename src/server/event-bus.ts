import type { EventMap, EventName } from "../types/events.js";
import { logger } from "../util/logger.js";

type Listener<K extends EventName> = (payload: EventMap[K]) => void | Promise<void>;

const DEFAULT_MAX_LISTENERS = 25;

export class EventBus {
  private listeners = new Map<EventName, Set<Listener<EventName>>>();
  private maxListeners: number;

  constructor(maxListeners = DEFAULT_MAX_LISTENERS) {
    this.maxListeners = maxListeners;
  }

  on<K extends EventName>(event: K, listener: Listener<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(listener as Listener<EventName>);

    if (set.size > this.maxListeners) {
      logger.warn("EventBus: possible listener leak detected", {
        event,
        count: set.size,
        maxListeners: this.maxListeners,
      });
    }

    return () => {
      this.listeners.get(event)?.delete(listener as Listener<EventName>);
    };
  }

  async emit<K extends EventName>(event: K, payload: EventMap[K]): Promise<Error[]> {
    const listeners = this.listeners.get(event);
    if (!listeners) return [];

    const errors: Error[] = [];

    for (const listener of listeners) {
      try {
        await (listener as Listener<K>)(payload);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
        logger.error("Event listener error", {
          event,
          error: error.message,
        });
      }
    }

    return errors;
  }

  async emitStrict<K extends EventName>(event: K, payload: EventMap[K]): Promise<void> {
    const errors = await this.emit(event, payload);
    if (errors.length === 1) {
      throw errors[0];
    } else if (errors.length > 1) {
      throw new AggregateError(errors, `${errors.length} listener(s) failed for event "${event}"`);
    }
  }

  removeAllListeners(event?: EventName): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
