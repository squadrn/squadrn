import type { EventEmitter, EventHandler, EventName } from "@squadrn/types";

export type ErrorHandler = (event: EventName, error: unknown) => void;

export class EventBus implements EventEmitter {
  #handlers = new Map<EventName, Set<EventHandler>>();
  #onError: ErrorHandler = (event, err) =>
    console.error(`[EventBus] Handler error for "${event}":`, err);

  /** Replace the default error handler (useful for logging integration). */
  set onError(handler: ErrorHandler) {
    this.#onError = handler;
  }

  on(event: EventName, handler: EventHandler): void {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, new Set());
    }
    this.#handlers.get(event)!.add(handler);
  }

  off(event: EventName, handler: EventHandler): void {
    this.#handlers.get(event)?.delete(handler);
  }

  /** Returns the number of handlers registered for an event. */
  listenerCount(event: EventName): number {
    return this.#handlers.get(event)?.size ?? 0;
  }

  async emit(event: EventName, payload?: unknown): Promise<void> {
    const handlers = this.#handlers.get(event);
    if (!handlers) return;

    await Promise.all(
      [...handlers].map(async (handler) => {
        try {
          await handler(payload);
        } catch (err) {
          this.#onError(event, err);
        }
      }),
    );
  }
}
