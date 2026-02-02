import { Database } from "@db/sqlite";
import type { QueryFilter, StorageAdapter, Transaction } from "./adapter.ts";
import { StorageError } from "../errors.ts";

const MIGRATIONS: string[] = [
  // v1: key-value store + entity tables
  `
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    collection TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_kv_collection ON kv(collection);

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline',
    llm TEXT NOT NULL,
    channels TEXT NOT NULL DEFAULT '[]',
    heartbeat_cron TEXT NOT NULL DEFAULT '*/15 * * * *',
    soul_file TEXT NOT NULL,
    current_task_id TEXT,
    current_session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'inbox',
    priority TEXT NOT NULL DEFAULT 'medium',
    assignee_ids TEXT NOT NULL DEFAULT '[]',
    creator_id TEXT,
    parent_task_id TEXT,
    depends_on TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    due_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    context TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_activities_workspace ON activities(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_activities_target ON activities(target_type, target_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    delivered INTEGER NOT NULL DEFAULT 0,
    delivered_at TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);

  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );

  INSERT OR IGNORE INTO schema_version (version) VALUES (1);
  `,
];

export class SqliteStorage implements StorageAdapter {
  #db: Database;

  constructor(path: string) {
    const resolved = path === ":memory:"
      ? ":memory:"
      : path.replace(/^~/, Deno.env.get("HOME") ?? "");
    this.#db = new Database(resolved);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#migrate();
  }

  #migrate(): void {
    // Get current version
    let currentVersion = 0;
    try {
      const row = this.#db
        .prepare("SELECT MAX(version) as v FROM schema_version")
        .get() as { v: number } | undefined;
      if (row) currentVersion = row.v;
    } catch {
      // Table doesn't exist yet, version is 0
    }

    for (let i = currentVersion; i < MIGRATIONS.length; i++) {
      const migration = MIGRATIONS[i]!;
      this.#db.exec(migration);
    }
  }

  get<T>(key: string): Promise<T | null> {
    const row = this.#db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    if (!row) return Promise.resolve(null);
    return Promise.resolve(JSON.parse(row.value) as T);
  }

  set<T>(key: string, value: T): Promise<void> {
    const collection = key.split(":")[0] ?? null;
    this.#db.prepare(
      `INSERT INTO kv (key, value, collection, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, JSON.stringify(value), collection);
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    const changes = this.#db.prepare("DELETE FROM kv WHERE key = ?").run(key);
    return Promise.resolve(changes > 0);
  }

  query<T>(collection: string, filter: QueryFilter): Promise<T[]> {
    let sql = "SELECT value FROM kv WHERE collection = ?";
    const params: unknown[] = [collection];

    if (filter.where) {
      // Filter on JSON fields within the value column
      for (const [field, val] of Object.entries(filter.where)) {
        sql += ` AND json_extract(value, '$.${field}') = ?`;
        params.push(val);
      }
    }

    if (filter.orderBy) {
      sql += ` ORDER BY ${filter.orderBy === "key" ? "key" : "updated_at"}`;
    }
    if (filter.limit) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }
    if (filter.offset) {
      sql += " OFFSET ?";
      params.push(filter.offset);
    }

    const rows = this.#db.prepare(sql).all(
      ...params as (string | number | null | bigint | boolean | Uint8Array)[],
    ) as { value: string }[];
    return Promise.resolve(rows.map((r) => JSON.parse(r.value) as T));
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    this.#db.exec("BEGIN");
    try {
      const result = await fn({
        get: (key) => this.get(key),
        set: (key, value) => this.set(key, value),
        delete: (key) => this.delete(key),
      });
      this.#db.exec("COMMIT");
      return result;
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw new StorageError(
        "STORAGE_TRANSACTION_FAILED",
        `Transaction failed: ${(err as Error).message}`,
        { cause: err as Error },
      );
    }
  }

  /** Execute raw SQL — useful for entity table operations */
  exec(sql: string, ...params: unknown[]): void {
    this.#db.prepare(sql).run(
      ...params as (string | number | null | bigint | boolean | Uint8Array)[],
    );
  }

  /** Query raw SQL rows */
  queryRaw<T>(sql: string, ...params: unknown[]): T[] {
    return this.#db.prepare(sql).all(
      ...params as (string | number | null | bigint | boolean | Uint8Array)[],
    ) as T[];
  }

  close(): void {
    this.#db.close();
  }
}
