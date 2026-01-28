import { assertEquals, assertGreater } from "jsr:@std/assert";
import type { EventName } from "@squadrn/types";
import { EventBus } from "./event_bus.ts";

Deno.test("emits event to a single subscriber", async () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  bus.on("task:created", (data) => {
    received.push(data);
  });
  await bus.emit("task:created", { id: "1" });

  assertEquals(received, [{ id: "1" }]);
});

Deno.test("emits to multiple subscribers of the same event", async () => {
  const bus = new EventBus();
  const a: string[] = [];
  const b: string[] = [];

  bus.on("gateway:started", () => {
    a.push("a");
  });
  bus.on("gateway:started", () => {
    b.push("b");
  });
  await bus.emit("gateway:started");

  assertEquals(a, ["a"]);
  assertEquals(b, ["b"]);
});

Deno.test("handlers for same event run in parallel", async () => {
  const bus = new EventBus();
  const order: number[] = [];

  bus.on("agent:heartbeat", async () => {
    await new Promise((r) => setTimeout(r, 50));
    order.push(1);
  });
  bus.on("agent:heartbeat", async () => {
    await new Promise((r) => setTimeout(r, 10));
    order.push(2);
  });

  const start = performance.now();
  await bus.emit("agent:heartbeat");
  const elapsed = performance.now() - start;

  // Handler 2 (10ms) finishes before handler 1 (50ms) → parallel execution
  assertEquals(order, [2, 1]);
  // Total time should be ~50ms (parallel), not ~60ms (sequential)
  assertGreater(70, elapsed);
});

Deno.test("error in one handler does not block others", async () => {
  const bus = new EventBus();
  const errors: unknown[] = [];
  bus.onError = (_event, err) => errors.push(err);

  const received: string[] = [];

  bus.on("message:received", () => {
    throw new Error("boom");
  });
  bus.on("message:received", () => {
    received.push("ok");
  });

  await bus.emit("message:received");

  assertEquals(received, ["ok"]);
  assertEquals(errors.length, 1);
  assertEquals((errors[0] as Error).message, "boom");
});

Deno.test("off() removes a handler", async () => {
  const bus = new EventBus();
  const received: unknown[] = [];

  const handler = (data: unknown) => {
    received.push(data);
  };

  bus.on("task:completed", handler);
  await bus.emit("task:completed", "first");
  bus.off("task:completed", handler);
  await bus.emit("task:completed", "second");

  assertEquals(received, ["first"]);
});

Deno.test("listenerCount returns correct count", () => {
  const bus = new EventBus();

  assertEquals(bus.listenerCount("plugin:loaded"), 0);

  const h1 = () => {};
  const h2 = () => {};
  bus.on("plugin:loaded", h1);
  bus.on("plugin:loaded", h2);
  assertEquals(bus.listenerCount("plugin:loaded"), 2);

  bus.off("plugin:loaded", h1);
  assertEquals(bus.listenerCount("plugin:loaded"), 1);
});

Deno.test("emit with no subscribers does not throw", async () => {
  const bus = new EventBus();
  await bus.emit("gateway:stopping", { reason: "test" });
});

Deno.test("emit passes undefined payload when none given", async () => {
  const bus = new EventBus();
  let captured: unknown = "sentinel";

  bus.on("agent:started", (data) => {
    captured = data;
  });
  await bus.emit("agent:started");

  assertEquals(captured, undefined);
});

Deno.test("different events are independent", async () => {
  const bus = new EventBus();
  const results: string[] = [];

  bus.on("task:created", () => { results.push("created"); });
  bus.on("task:completed", () => { results.push("completed"); });

  await bus.emit("task:created");

  assertEquals(results, ["created"]);
});

Deno.test("async handler errors are caught", async () => {
  const bus = new EventBus();
  const errors: unknown[] = [];
  bus.onError = (_event, err) => errors.push(err);

  bus.on("plugin:error", async () => {
    await Promise.reject(new Error("async boom"));
  });

  await bus.emit("plugin:error");

  assertEquals(errors.length, 1);
  assertEquals((errors[0] as Error).message, "async boom");
});
