import { Database } from "@db/sqlite";
import type { QueryFilter, StorageAdapter, Transaction } from "./adapter.ts";

export class SqliteStorage implements StorageAdapter {
  #db: Database;

  constructor(path: string) {
    const resolved = path.replace(/^~/, Deno.env.get("HOME") ?? "");
    this.#db = new Database(resolved);
    this.#init();
  }

  #init(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        collection TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  async get<T>(key: string): Promise<T | null> {
    const row = this.#db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.value) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const collection = key.split(":")[0] ?? null;
    this.#db.prepare(
      `INSERT INTO kv (key, value, collection, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, JSON.stringify(value), collection);
  }

  async delete(key: string): Promise<boolean> {
    const changes = this.#db.prepare("DELETE FROM kv WHERE key = ?").run(key);
    return changes > 0;
  }

  async query<T>(collection: string, filter: QueryFilter): Promise<T[]> {
    let sql = "SELECT value FROM kv WHERE collection = ?";
    const params: unknown[] = [collection];

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

    const rows = this.#db.prepare(sql).all(...params as (string | number | null | bigint | boolean | Uint8Array)[]) as { value: string }[];
    return rows.map((r) => JSON.parse(r.value) as T);
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
      throw err;
    }
  }

  close(): void {
    this.#db.close();
  }
}
