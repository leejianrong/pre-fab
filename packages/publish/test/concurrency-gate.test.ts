import { describe, expect, it } from "vitest";
import { createConcurrencyGate } from "../src/concurrency-gate.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createConcurrencyGate (KAN-1153)", () => {
  it("never runs more than the cap concurrently, and every queued call eventually resolves", async () => {
    const limit = 3;
    const gate = createConcurrencyGate({ limit });
    const taskCount = 12;
    let concurrent = 0;
    let maxConcurrent = 0;
    const gates = Array.from({ length: taskCount }, () => deferred<void>());

    const runs = gates.map((g, i) =>
      gate.run(async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await g.promise;
        concurrent -= 1;
        return i;
      }),
    );

    // Let every task that's going to start, start.
    await new Promise((r) => setTimeout(r, 20));
    expect(concurrent).toBe(limit);
    expect(gate.active).toBe(limit);
    expect(gate.pending).toBe(taskCount - limit);

    // Release them all; the queue should drain to zero without ever
    // exceeding the cap at any point along the way.
    for (const g of gates) g.resolve();
    const results = await Promise.all(runs);

    expect(results).toEqual(Array.from({ length: taskCount }, (_, i) => i));
    expect(maxConcurrent).toBeLessThanOrEqual(limit);
    expect(gate.active).toBe(0);
    expect(gate.pending).toBe(0);
  });

  it("admits queued callers FIFO as slots free up", async () => {
    const gate = createConcurrencyGate({ limit: 1 });
    const order: number[] = [];
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];

    const runs = gates.map((g, i) =>
      gate.run(async () => {
        order.push(i);
        await g.promise;
      }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([0]); // only the first admitted so far, cap is 1

    gates[0]!.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([0, 1]);

    gates[1]!.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([0, 1, 2]);

    gates[2]!.resolve();
    await Promise.all(runs);
  });

  it("a rejection from one task frees its slot and does not wedge tasks queued behind it", async () => {
    const gate = createConcurrencyGate({ limit: 1 });

    const failing = gate.run(async () => {
      throw new Error("boom");
    });
    const succeeding = gate.run(async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    await expect(succeeding).resolves.toBe("ok");
    expect(gate.active).toBe(0);
    expect(gate.pending).toBe(0);
  });

  it("clamps a non-positive or fractional limit to a sane minimum of 1", async () => {
    const gate = createConcurrencyGate({ limit: 0 });
    const order: number[] = [];
    const g1 = deferred<void>();

    const run1 = gate.run(async () => {
      order.push(1);
      await g1.promise;
    });
    const run2 = gate.run(async () => {
      order.push(2);
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1]); // run2 must still be queued, not run alongside run1

    g1.resolve();
    await Promise.all([run1, run2]);
    expect(order).toEqual([1, 2]);
  });
});
