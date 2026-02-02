import type {
  AgentId,
  Message,
  Session,
  SessionId,
  StorageAdapter,
} from "@squadrn/types";
import { createSessionId } from "@squadrn/types";
import type { EventBus } from "./event_bus.ts";
import * as path from "jsr:@std/path";

function expandHome(p: string): string {
  return p.startsWith("~")
    ? p.replace(/^~/, Deno.env.get("HOME") ?? "")
    : p;
}

function sessionsDir(): string {
  return expandHome("~/.squadrn/sessions");
}

function sessionFilePath(sessionId: SessionId): string {
  return path.join(sessionsDir(), `${sessionId}.jsonl`);
}

interface SessionFilter {
  agentId?: AgentId;
  status?: Session["status"];
}

export class SessionManager {
  #storage: StorageAdapter;
  #events: EventBus;

  constructor(storage: StorageAdapter, events: EventBus) {
    this.#storage = storage;
    this.#events = events;
  }

  async createSession(agentId: AgentId): Promise<Session> {
    const id = createSessionId();
    const now = new Date();

    const history = await this.#loadHistoryFromDisk(id);

    const session: Session = {
      id,
      agentId,
      workspaceId: "" as Session["workspaceId"],
      status: "idle",
      context: {
        conversationHistory: history,
        workingMemory: {},
      },
      createdAt: now,
      lastActiveAt: now,
    };

    await this.#persist(session);
    await this.#events.emit("session:created", { sessionId: id, agentId });
    return session;
  }

  async getSession(sessionId: SessionId): Promise<Session | null> {
    return await this.#storage.get<Session>(`sessions:${sessionId}`);
  }

  async getActiveSessionForAgent(agentId: AgentId): Promise<Session | null> {
    const sessions = await this.#storage.query<Session>("sessions", {
      where: { agentId },
    });
    return sessions.find((s) => s.status !== "idle") ?? null;
  }

  async updateSession(
    sessionId: SessionId,
    updates: Partial<Pick<Session, "status" | "context">>,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    const updated: Session = {
      ...session,
      ...updates,
      lastActiveAt: new Date(),
    };
    await this.#persist(updated);
    await this.#events.emit("session:updated", { sessionId });
  }

  async endSession(sessionId: SessionId): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    const ended: Session = { ...session, status: "idle", lastActiveAt: new Date() };
    await this.#persist(ended);
    await this.#events.emit("session:ended", { sessionId, agentId: session.agentId });
  }

  async listSessions(filter?: SessionFilter): Promise<Session[]> {
    const where: Record<string, unknown> = {};
    if (filter?.agentId) where.agentId = filter.agentId;
    if (filter?.status) where.status = filter.status;
    return await this.#storage.query<Session>("sessions", { where });
  }

  // ── Context helpers ──────────────────────────────────────────────────

  async addMessage(sessionId: SessionId, message: Message): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    session.context.conversationHistory.push(message);
    session.lastActiveAt = new Date();
    await this.#persist(session);
    await this.#appendToDisk(sessionId, message);
  }

  async getHistory(sessionId: SessionId, limit?: number): Promise<Message[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    const history = session.context.conversationHistory;
    return limit ? history.slice(-limit) : history;
  }

  async setWorkingMemory(
    sessionId: SessionId,
    key: string,
    value: unknown,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);

    session.context.workingMemory[key] = value;
    session.lastActiveAt = new Date();
    await this.#persist(session);
  }

  async getWorkingMemory(
    sessionId: SessionId,
    key: string,
  ): Promise<unknown | undefined> {
    const session = await this.getSession(sessionId);
    if (!session) return undefined;
    return session.context.workingMemory[key];
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  async cleanupOldSessions(maxAgeMs: number): Promise<number> {
    const all = await this.listSessions();
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const session of all) {
      const lastActive = session.lastActiveAt instanceof Date
        ? session.lastActiveAt.getTime()
        : new Date(session.lastActiveAt as unknown as string).getTime();

      if (lastActive < cutoff && session.status === "idle") {
        await this.#storage.delete(`sessions:${session.id}`);
        removed++;
      }
    }
    return removed;
  }

  // ── Private ──────────────────────────────────────────────────────────

  async #persist(session: Session): Promise<void> {
    await this.#storage.set(`sessions:${session.id}`, session);
  }

  async #loadHistoryFromDisk(sessionId: SessionId): Promise<Message[]> {
    const filePath = sessionFilePath(sessionId);
    try {
      const text = await Deno.readTextFile(filePath);
      return text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Message);
    } catch {
      return [];
    }
  }

  async #appendToDisk(sessionId: SessionId, message: Message): Promise<void> {
    const dir = sessionsDir();
    await Deno.mkdir(dir, { recursive: true });
    const filePath = sessionFilePath(sessionId);
    const line = JSON.stringify(message) + "\n";
    await Deno.writeTextFile(filePath, line, { append: true });
  }
}

export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session not found: ${sessionId}`);
  }
}
