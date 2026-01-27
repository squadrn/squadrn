export type EventName =
  // Lifecycle
  | "gateway:started"
  | "gateway:stopping"
  | "plugin:loaded"
  | "plugin:error"
  | "agent:started"
  | "agent:stopped"
  | "agent:error"
  // Messages
  | "message:received"
  | "message:send"
  | "message:delivered"
  // Tasks
  | "task:created"
  | "task:assigned"
  | "task:updated"
  | "task:completed"
  // Agent
  | "agent:heartbeat"
  | "agent:thinking"
  | "agent:response";

export type EventHandler = (payload: unknown) => void | Promise<void>;

export interface EventEmitter {
  on(event: EventName, handler: EventHandler): void;
  off(event: EventName, handler: EventHandler): void;
  emit(event: EventName, payload?: unknown): Promise<void>;
}
