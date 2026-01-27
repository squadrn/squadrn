import type { EventEmitter, EventHandler, EventName } from "@squadrn/types";

export class EventBus implements EventEmitter {
  #handlers = new Map<EventName, Set<EventHandler>>();

  on(event: EventName, handler: EventHandler): void {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, new Set());
    }
    this.#handlers.get(event)!.add(handler);
  }

  off(event: EventName, handler: EventHandler): void {
    this.#handlers.get(event)?.delete(handler);
  }

  async emit(event: EventName, payload?: unknown): Promise<void> {
    const handlers = this.#handlers.get(event);
    if (!handlers) return;

    const results = [...handlers].map(async (handler) => {
      try {
        await handler(payload);
      } catch (err) {
        console.error(`[EventBus] Handler error for "${event}":`, err);
      }
    });

    await Promise.all(results);
  }
}
