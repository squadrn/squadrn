import { assertEquals, assertRejects } from "@std/assert";
import { SqliteStorage } from "./sqlite.ts";

function createStorage(): SqliteStorage {
  return new SqliteStorage(":memory:");
}

// --- get / set / delete ---

Deno.test("set and get a value", async () => {
  const db = createStorage();
  try {
    await db.set("agents:a1", { name: "Scout" });
    const val = await db.get<{ name: string }>("agents:a1");
    assertEquals(val?.name, "Scout");
  } finally {
    db.close();
  }
});

Deno.test("get returns null for missing key", async () => {
  const db = createStorage();
  try {
    const val = await db.get("nope");
    assertEquals(val, null);
  } finally {
    db.close();
  }
});

Deno.test("set overwrites existing key", async () => {
  const db = createStorage();
  try {
    await db.set("k", { v: 1 });
    await db.set("k", { v: 2 });
    const val = await db.get<{ v: number }>("k");
    assertEquals(val?.v, 2);
  } finally {
    db.close();
  }
});

Deno.test("delete removes a key and returns true", async () => {
  const db = createStorage();
  try {
    await db.set("k", "val");
    const deleted = await db.delete("k");
    assertEquals(deleted, true);
    assertEquals(await db.get("k"), null);
  } finally {
    db.close();
  }
});

Deno.test("delete returns false for missing key", async () => {
  const db = createStorage();
  try {
    const deleted = await db.delete("nope");
    assertEquals(deleted, false);
  } finally {
    db.close();
  }
});

// --- query ---

Deno.test("query returns items by collection", async () => {
  const db = createStorage();
  try {
    await db.set("agents:a1", { name: "A" });
    await db.set("agents:a2", { name: "B" });
    await db.set("tasks:t1", { title: "T" });
    const agents = await db.query<{ name: string }>("agents", {});
    assertEquals(agents.length, 2);
  } finally {
    db.close();
  }
});

Deno.test("query with limit", async () => {
  const db = createStorage();
  try {
    await db.set("x:1", { v: 1 });
    await db.set("x:2", { v: 2 });
    await db.set("x:3", { v: 3 });
    const results = await db.query<{ v: number }>("x", { limit: 2 });
    assertEquals(results.length, 2);
  } finally {
    db.close();
  }
});

Deno.test("query with where filter on JSON field", async () => {
  const db = createStorage();
  try {
    await db.set("agents:a1", { name: "Scout", role: "lead" });
    await db.set("agents:a2", { name: "Loki", role: "writer" });
    const results = await db.query<{ name: string }>("agents", {
      where: { role: "lead" },
    });
    assertEquals(results.length, 1);
    assertEquals(results[0]?.name, "Scout");
  } finally {
    db.close();
  }
});

// --- transaction ---

Deno.test("transaction commits on success", async () => {
  const db = createStorage();
  try {
    await db.transaction(async (tx) => {
      await tx.set("t:1", "a");
      await tx.set("t:2", "b");
    });
    assertEquals(await db.get("t:1"), "a");
    assertEquals(await db.get("t:2"), "b");
  } finally {
    db.close();
  }
});

Deno.test("transaction rolls back on error", async () => {
  const db = createStorage();
  try {
    await db.set("t:1", "before");
    await assertRejects(async () => {
      await db.transaction(async (tx) => {
        await tx.set("t:1", "during");
        throw new Error("boom");
      });
    });
    assertEquals(await db.get("t:1"), "before");
  } finally {
    db.close();
  }
});

// --- entity tables exist ---

Deno.test("entity tables are created by migration", () => {
  const db = createStorage();
  try {
    const tables = db.queryRaw<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);
    for (const expected of ["agents", "tasks", "sessions", "activities", "notifications", "kv"]) {
      assertEquals(names.includes(expected), true, `missing table: ${expected}`);
    }
  } finally {
    db.close();
  }
});

Deno.test("exec and queryRaw work on entity tables", () => {
  const db = createStorage();
  try {
    db.exec(
      "INSERT INTO agents (id, workspace_id, name, role, llm, soul_file) VALUES (?, ?, ?, ?, ?, ?)",
      "a1",
      "ws1",
      "Scout",
      "Lead",
      "claude",
      "/soul.md",
    );
    const rows = db.queryRaw<{ id: string; name: string }>(
      "SELECT id, name FROM agents WHERE id = ?",
      "a1",
    );
    assertEquals(rows.length, 1);
    assertEquals(rows[0]?.name, "Scout");
  } finally {
    db.close();
  }
});
