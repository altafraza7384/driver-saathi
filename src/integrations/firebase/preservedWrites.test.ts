/**
 * Unit tests for the preserved-writes ledger (PR #30 round 2).
 *
 * The ledger is the durable record that makes a whole-cache clear safe
 * across logins: it remembers which identities had unsynced writes
 * preserved at logout, in localStorage (NOT IndexedDB — the clear
 * wipes IndexedDB, so a ledger kept there would destroy itself).
 */
import { describe, it, expect } from "vitest";
import {
  createPreservedWritesLedger,
  type PreservedWritesStorage,
} from "./preservedWrites";

/** In-memory stand-in for localStorage, shared across "reloads". */
function memoryStorage(initial?: string | null): {
  storage: PreservedWritesStorage;
  get raw(): string | null;
  set raw(v: string | null);
} {
  let value: string | null = initial ?? null;
  return {
    storage: {
      read: () => value,
      write: (v: string) => {
        value = v;
      },
      remove: () => {
        value = null;
      },
    },
    get raw() {
      return value;
    },
    set raw(v: string | null) {
      value = v;
    },
  };
}

describe("preserved-writes ledger", () => {
  it("starts empty: nothing unresolved", () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    expect(ledger.hasUnresolved()).toBe(false);
    expect(ledger.list()).toEqual([]);
  });

  it("record + resolve round-trips, and resolve only drops its own uid", () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    ledger.record("user-A");
    ledger.record("user-B");
    expect(ledger.list()).toEqual(["user-A", "user-B"]);
    expect(ledger.hasUnresolved()).toBe(true);
    expect(ledger.hasUnresolved("user-A")).toBe(true); // B still open
    ledger.resolve("user-A");
    expect(ledger.list()).toEqual(["user-B"]);
    expect(ledger.hasUnresolved("user-B")).toBe(false);
    expect(ledger.hasUnresolved()).toBe(true);
    ledger.resolve("user-B");
    expect(ledger.hasUnresolved()).toBe(false);
    expect(ledger.list()).toEqual([]);
  });

  it("record is idempotent", () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    ledger.record("user-A");
    ledger.record("user-A");
    expect(ledger.list()).toEqual(["user-A"]);
  });

  it("survives a fresh ledger instance over the same store (reload)", () => {
    const backing = memoryStorage();
    const first = createPreservedWritesLedger(backing.storage);
    first.record("user-A");
    // A new client after a reload reads the same durable store.
    const second = createPreservedWritesLedger(backing.storage);
    expect(second.list()).toEqual(["user-A"]);
    expect(second.hasUnresolved()).toBe(true);
  });

  it("fail-closed: corrupt stored JSON never reports clean", () => {
    const backing = memoryStorage("not-json{{{");
    const ledger = createPreservedWritesLedger(backing.storage);
    expect(ledger.hasUnresolved()).toBe(true);
    expect(ledger.list()).toEqual([]);
    // record() must NOT overwrite corrupt data and drop unknown entries.
    ledger.record("user-B");
    expect(backing.raw).toBe("not-json{{{");
    expect(ledger.hasUnresolved()).toBe(true);
  });

  it("fail-closed: unreadable storage never reports clean", () => {
    const throwing: PreservedWritesStorage = {
      read: () => {
        throw new Error("denied");
      },
      write: () => {
        throw new Error("denied");
      },
      remove: () => {
        throw new Error("denied");
      },
    };
    const ledger = createPreservedWritesLedger(throwing);
    expect(ledger.hasUnresolved()).toBe(true);
    // Neither record nor resolve may throw.
    expect(() => ledger.record("user-A")).not.toThrow();
    expect(() => ledger.resolve("user-A")).not.toThrow();
    expect(ledger.hasUnresolved()).toBe(true);
  });
});
