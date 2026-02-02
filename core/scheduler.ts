import type { AgentId, StorageAdapter } from "@squadrn/types";
import type { EventBus } from "./event_bus.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  agentId: string;
  action: "heartbeat" | "task" | "custom";
  payload?: unknown;
  enabled: boolean;
  lastRun?: string; // ISO date
  nextRun?: string; // ISO date
}

// ---------------------------------------------------------------------------
// Cron parser (minimal, supports standard 5-field expressions)
// ---------------------------------------------------------------------------

interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2]!, 10) : 1;
    const range = stepMatch ? stepMatch[1]! : part;

    if (range === "*") {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (range.includes("-")) {
      const [startStr, endStr] = range.split("-");
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);
      for (let i = start; i <= end; i += step) values.add(i);
    } else {
      values.add(parseInt(range, 10));
    }
  }

  return [...values].sort((a, b) => a - b);
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronParseError(expr, "expected 5 fields (minute hour dom month dow)");
  }
  return {
    minutes: parseField(parts[0]!, 0, 59),
    hours: parseField(parts[1]!, 0, 23),
    daysOfMonth: parseField(parts[2]!, 1, 31),
    months: parseField(parts[3]!, 1, 12),
    daysOfWeek: parseField(parts[4]!, 0, 6),
  };
}

export function nextCronDate(expr: string, after: Date = new Date()): Date {
  const fields = parseCron(expr);
  const d = new Date(after.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // start from the next minute

  // Safety: give up after scanning ~2 years of minutes
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    if (
      fields.months.includes(d.getMonth() + 1) &&
      fields.daysOfMonth.includes(d.getDate()) &&
      fields.daysOfWeek.includes(d.getDay()) &&
      fields.hours.includes(d.getHours()) &&
      fields.minutes.includes(d.getMinutes())
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }

  throw new CronParseError(expr, "could not find next run within 1 year");
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

import { SchedulerError } from "./errors.ts";

export class CronParseError extends SchedulerError {
  readonly expression: string;

  constructor(expression: string, reason: string) {
    super("SCHEDULER_CRON_INVALID", `Invalid cron expression "${expression}": ${reason}`, {
      context: { expression },
    });
    this.expression = expression;
  }
}

export class JobNotFoundError extends SchedulerError {
  readonly jobId: string;

  constructor(jobId: string) {
    super("SCHEDULER_JOB_NOT_FOUND", `Scheduled job not found: ${jobId}`, {
      context: { jobId },
    });
    this.jobId = jobId;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const STORAGE_COLLECTION = "scheduled_jobs";

export class Scheduler {
  #storage: StorageAdapter;
  #events: EventBus;
  #jobs = new Map<string, ScheduledJob>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #running = false;

  constructor(storage: StorageAdapter, events: EventBus) {
    this.#storage = storage;
    this.#events = events;
  }

  get isRunning(): boolean {
    return this.#running;
  }

  // -- Job management -------------------------------------------------------

  async addJob(job: ScheduledJob): Promise<void> {
    if (job.enabled && !job.nextRun) {
      job.nextRun = nextCronDate(job.cron).toISOString();
    }
    this.#jobs.set(job.id, job);
    await this.#persist(job);

    if (this.#running && job.enabled) {
      this.#scheduleNext(job);
    }
  }

  async removeJob(jobId: string): Promise<void> {
    this.#clearTimer(jobId);
    this.#jobs.delete(jobId);
    await this.#storage.delete(`${STORAGE_COLLECTION}:${jobId}`);
  }

  listJobs(): ScheduledJob[] {
    return [...this.#jobs.values()];
  }

  getJob(jobId: string): ScheduledJob | undefined {
    return this.#jobs.get(jobId);
  }

  async enableJob(jobId: string): Promise<void> {
    const job = this.#jobs.get(jobId);
    if (!job) throw new JobNotFoundError(jobId);
    job.enabled = true;
    job.nextRun = nextCronDate(job.cron).toISOString();
    await this.#persist(job);
    if (this.#running) this.#scheduleNext(job);
  }

  async disableJob(jobId: string): Promise<void> {
    const job = this.#jobs.get(jobId);
    if (!job) throw new JobNotFoundError(jobId);
    job.enabled = false;
    job.nextRun = undefined;
    this.#clearTimer(jobId);
    await this.#persist(job);
  }

  // -- Lifecycle ------------------------------------------------------------

  async start(): Promise<void> {
    if (this.#running) return;

    // Restore persisted jobs
    const persisted = await this.#storage.query<ScheduledJob>(STORAGE_COLLECTION, {});
    for (const job of persisted) {
      this.#jobs.set(job.id, job);
    }

    this.#running = true;

    // Schedule enabled jobs
    for (const job of this.#jobs.values()) {
      if (job.enabled) {
        job.nextRun = nextCronDate(job.cron).toISOString();
        this.#scheduleNext(job);
      }
    }
  }

  stop(): void {
    this.#running = false;
    for (const id of this.#timers.keys()) {
      this.#clearTimer(id);
    }
  }

  // -- Internal -------------------------------------------------------------

  #scheduleNext(job: ScheduledJob): void {
    this.#clearTimer(job.id);
    if (!job.enabled || !this.#running) return;

    const next = job.nextRun ? new Date(job.nextRun) : nextCronDate(job.cron);
    const delay = Math.max(next.getTime() - Date.now(), 0);

    const timer = setTimeout(() => this.#fire(job), delay);
    this.#timers.set(job.id, timer);
  }

  async #fire(job: ScheduledJob): Promise<void> {
    if (!this.#running || !job.enabled) return;

    const now = new Date();
    job.lastRun = now.toISOString();
    job.nextRun = nextCronDate(job.cron, now).toISOString();
    await this.#persist(job);

    try {
      await this.#events.emit("agent:heartbeat", {
        jobId: job.id,
        agentId: job.agentId as AgentId,
        action: job.action,
        payload: job.payload,
        firedAt: now.toISOString(),
      });
    } catch {
      // Event handler errors are already caught by the EventBus, but guard anyway.
    }

    // Schedule the following execution
    if (this.#running && job.enabled) {
      this.#scheduleNext(job);
    }
  }

  #clearTimer(jobId: string): void {
    const t = this.#timers.get(jobId);
    if (t !== undefined) {
      clearTimeout(t);
      this.#timers.delete(jobId);
    }
  }

  async #persist(job: ScheduledJob): Promise<void> {
    await this.#storage.set(`${STORAGE_COLLECTION}:${job.id}`, job);
  }
}
