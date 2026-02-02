import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Scheduler, parseCron, nextCronDate, CronParseError, JobNotFoundError } from "./scheduler.ts";
import type { ScheduledJob } from "./scheduler.ts";
import { EventBus } from "./event_bus.ts";
import type { StorageAdapter, QueryFilter, Transaction } from "@squadrn/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorage(): StorageAdapter {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (store.get(key) as T) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return store.delete(key);
    },
    async query<T>(collection: string, _filter: QueryFilter): Promise<T[]> {
      const results: T[] = [];
      for (const [k, v] of store) {
        if (k.startsWith(`${collection}:`)) results.push(v as T);
      }
      return results;
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      const tx: Transaction = {
        get: async <U>(key: string) => (store.get(key) as U) ?? null,
        set: async <U>(key: string, value: U) => { store.set(key, value); },
        delete: async (key: string) => store.delete(key),
      };
      return fn(tx);
    },
    close() {},
  };
}

function makeJob(overrides?: Partial<ScheduledJob>): ScheduledJob {
  return {
    id: "job-1",
    name: "Test heartbeat",
    cron: "*/15 * * * *",
    agentId: "agent-1",
    action: "heartbeat",
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cron parsing
// ---------------------------------------------------------------------------

Deno.test("parseCron - parses every-15-minutes expression", () => {
  const fields = parseCron("*/15 * * * *");
  assertEquals(fields.minutes, [0, 15, 30, 45]);
  assertEquals(fields.hours.length, 24);
  assertEquals(fields.daysOfMonth.length, 31);
  assertEquals(fields.months.length, 12);
  assertEquals(fields.daysOfWeek.length, 7);
});

Deno.test("parseCron - parses specific values", () => {
  const fields = parseCron("5 3 1 6 0");
  assertEquals(fields.minutes, [5]);
  assertEquals(fields.hours, [3]);
  assertEquals(fields.daysOfMonth, [1]);
  assertEquals(fields.months, [6]);
  assertEquals(fields.daysOfWeek, [0]);
});

Deno.test("parseCron - parses ranges", () => {
  const fields = parseCron("1-5 * * * *");
  assertEquals(fields.minutes, [1, 2, 3, 4, 5]);
});

Deno.test("parseCron - parses comma-separated values", () => {
  const fields = parseCron("0,30 * * * *");
  assertEquals(fields.minutes, [0, 30]);
});

Deno.test("parseCron - throws on invalid expression", () => {
  assertThrows(() => parseCron("bad"), CronParseError);
  assertThrows(() => parseCron("* *"), CronParseError);
});

Deno.test("nextCronDate - returns future date for every-15-min", () => {
  const after = new Date("2025-06-01T10:00:00Z");
  const next = nextCronDate("*/15 * * * *", after);
  assertEquals(next.getMinutes() % 15, 0);
  assertEquals(next.getTime() > after.getTime(), true);
});

Deno.test("nextCronDate - specific time", () => {
  const after = new Date("2025-06-01T00:00:00Z");
  const next = nextCronDate("30 12 * * *", after);
  assertEquals(next.getHours(), 12);
  assertEquals(next.getMinutes(), 30);
});

// ---------------------------------------------------------------------------
// Scheduler - job management
// ---------------------------------------------------------------------------

Deno.test("Scheduler - addJob and listJobs", async () => {
  const scheduler = new Scheduler(makeStorage(), new EventBus());
  const job = makeJob();
  await scheduler.addJob(job);

  const jobs = scheduler.listJobs();
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0]!.id, "job-1");
  assertEquals(typeof jobs[0]!.nextRun, "string");
});

Deno.test("Scheduler - removeJob", async () => {
  const scheduler = new Scheduler(makeStorage(), new EventBus());
  await scheduler.addJob(makeJob());
  await scheduler.removeJob("job-1");
  assertEquals(scheduler.listJobs().length, 0);
});

Deno.test("Scheduler - getJob returns undefined for missing", async () => {
  const scheduler = new Scheduler(makeStorage(), new EventBus());
  assertEquals(scheduler.getJob("nope"), undefined);
});

Deno.test("Scheduler - enableJob / disableJob", async () => {
  const scheduler = new Scheduler(makeStorage(), new EventBus());
  await scheduler.addJob(makeJob({ enabled: false }));
  assertEquals(scheduler.getJob("job-1")!.enabled, false);

  await scheduler.enableJob("job-1");
  assertEquals(scheduler.getJob("job-1")!.enabled, true);
  assertEquals(typeof scheduler.getJob("job-1")!.nextRun, "string");

  await scheduler.disableJob("job-1");
  assertEquals(scheduler.getJob("job-1")!.enabled, false);
  assertEquals(scheduler.getJob("job-1")!.nextRun, undefined);
});

Deno.test("Scheduler - enableJob throws for missing job", async () => {
  const scheduler = new Scheduler(makeStorage(), new EventBus());
  try {
    await scheduler.enableJob("nope");
    throw new Error("should have thrown");
  } catch (err) {
    assertEquals(err instanceof JobNotFoundError, true);
  }
});

// ---------------------------------------------------------------------------
// Scheduler - lifecycle
// ---------------------------------------------------------------------------

Deno.test("Scheduler - start restores persisted jobs", async () => {
  const storage = makeStorage();
  const events = new EventBus();

  // Pre-persist a job
  await storage.set("scheduled_jobs:job-1", makeJob());

  const scheduler = new Scheduler(storage, events);
  await scheduler.start();

  assertEquals(scheduler.listJobs().length, 1);
  assertEquals(scheduler.isRunning, true);

  scheduler.stop();
  assertEquals(scheduler.isRunning, false);
});

Deno.test("Scheduler - fires job and emits event", async () => {
  const storage = makeStorage();
  const events = new EventBus();
  const received: unknown[] = [];

  events.on("agent:heartbeat", (payload: unknown) => {
    received.push(payload);
  });

  const scheduler = new Scheduler(storage, events);
  await scheduler.start();

  // Add a job with nextRun set to now so the setTimeout delay is ~0
  const job = makeJob({ cron: "* * * * *" });
  job.nextRun = new Date().toISOString();
  await scheduler.addJob(job);

  // Wait briefly for the setTimeout(0) to fire
  await new Promise((resolve) => setTimeout(resolve, 50));

  scheduler.stop();

  assertEquals(received.length >= 1, true);
  const payload = received[0] as Record<string, unknown>;
  assertEquals(payload.jobId, "job-1");
  assertEquals(payload.agentId, "agent-1");
  assertEquals(payload.action, "heartbeat");
});

Deno.test("Scheduler - stop prevents further firing", async () => {
  const storage = makeStorage();
  const events = new EventBus();
  const received: unknown[] = [];

  events.on("agent:heartbeat", (payload: unknown) => {
    received.push(payload);
  });

  const scheduler = new Scheduler(storage, events);
  await scheduler.start();

  const job = makeJob({ cron: "* * * * *" });
  job.nextRun = new Date().toISOString();
  await scheduler.addJob(job);

  scheduler.stop();

  await new Promise((resolve) => setTimeout(resolve, 50));
  // May have fired once before stop, but shouldn't keep firing
  const count = received.length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assertEquals(received.length, count);
});
