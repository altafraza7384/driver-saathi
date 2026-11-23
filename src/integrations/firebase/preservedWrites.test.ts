/**
 * Unit tests for the preserved-writes ledger (PR #30 round 2, round 3).
 *
 * The ledger is the durable record that makes a whole-cache clear safe
 * across logins: it remembers which identities had unsynced writes
 * preserved at logout, in its own IndexedDB database mirrored to
 * localStorage (NOT Firestore's IndexedDB store — the clear wipes
 * that, so a ledger kept there would destroy itself).
 */
import { describe, it, expect } from "vitest";
import {
  createPreservedWritesLedger,
  type PreservedWritesLedger,
  type PreservedWritesStorage,
} from "./preservedWrites";

/** In-memory stand-in for a store, shared across "reloads". */
function memoryStorage(initial?: string | null): {
  storage: PreservedWritesStorage;
  get raw(): string | null;
  set raw(v: string | null);
} {
  let value: string | null = initial ?? null;
  return {
    storage: {
      read: async () => value,
      write: async (v: string) => {
        value = v;
      },
      remove: async () => {
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

/**
 * Write-only failure (round 3): READ returns null but WRITE throws
 * (localStorage quota/error). The finding this models: the old ledger
 * swallowed the failed record, so a later clean logout cleared the
 * cache and destroyed the pending write.
 */
function failingStorage(): PreservedWritesStorage {
  return {
    read: async () => null,
    write: async () => {
      throw new Error("QuotaExceededError: setItem failed");
    },
    remove: async () => {
      throw new Error("denied");
    },
  };
}

describe("preserved-writes ledger", () => {
  it("starts empty: nothing unresolved", async () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    expect(await ledger.hasUnresolved()).toBe(false);
    expect(await ledger.list()).toEqual([]);
  });

  it("record + resolve round-trips, and resolve only drops its own uid", async () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    expect(await ledger.record("user-A")).toBe(true);
    expect(await ledger.record("user-B")).toBe(true);
    expect(await ledger.list()).toEqual(["user-A", "user-B"]);
    expect(await ledger.hasUnresolved()).toBe(true);
    expect(await ledger.hasUnresolved("user-A")).toBe(true); // B still open
    await ledger.resolve("user-A");
    expect(await ledger.list()).toEqual(["user-B"]);
    expect(await ledger.hasUnresolved("user-B")).toBe(false);
    expect(await ledger.hasUnresolved()).toBe(true);
    await ledger.resolve("user-B");
    expect(await ledger.hasUnresolved()).toBe(false);
    expect(await ledger.list()).toEqual([]);
  });

  it("record is idempotent", async () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    await ledger.record("user-A");
    await ledger.record("user-A");
    expect(await ledger.list()).toEqual(["user-A"]);
  });

  it("survives a fresh ledger instance over the same store (reload)", async () => {
    const backing = memoryStorage();
    const first = createPreservedWritesLedger(backing.storage);
    await first.record("user-A");
    // A new client after a reload reads the same durable store.
    const second = createPreservedWritesLedger(backing.storage);
    expect(await second.list()).toEqual(["user-A"]);
    expect(await second.hasUnresolved()).toBe(true);
  });

  it("fail-closed: corrupt stored JSON never reports clean", async () => {
    const backing = memoryStorage("not-json{{{");
    const ledger = createPreservedWritesLedger(backing.storage);
    expect(await ledger.hasUnresolved()).toBe(true);
    expect(await ledger.list()).toEqual([]);
    // record() must NOT overwrite corrupt data and drop unknown entries.
    expect(await ledger.record("user-B")).toBe(false);
    expect(backing.raw).toBe("not-json{{{");
    expect(await ledger.hasUnresolved()).toBe(true);
  });

  it("fail-closed: unreadable storage never reports clean", async () => {
    const throwing: PreservedWritesStorage = {
      read: async () => {
        throw new Error("denied");
      },
      write: async () => {
        throw new Error("denied");
      },
      remove: async () => {
        throw new Error("denied");
      },
    };
    const ledger = createPreservedWritesLedger(throwing);
    expect(await ledger.hasUnresolved()).toBe(true);
    // Neither record nor resolve may throw; record reports the failure.
    expect(await ledger.record("user-A")).toBe(false);
    await ledger.resolve("user-A");
    expect(await ledger.hasUnresolved()).toBe(true);
  });
});

describe("preserved-writes ledger — failed record is not a safety proof (round 3)", () => {
  it("a write-only failure in one store still records durably in the other", async () => {
    // The mirror (localStorage role) refuses writes; the primary
    // (IndexedDB role) works. The record itself — not a flag, not a
    // memory marker — lands durably in the surviving store.
    const { storage: primary } = memoryStorage();
    const ledger = createPreservedWritesLedger(primary, failingStorage());
    expect(await ledger.record("user-A")).toBe(true);
    expect(await ledger.hasUnresolved()).toBe(true);
    expect(await ledger.list()).toEqual(["user-A"]);
  });

  it("a write-only failure in the primary still records durably in the mirror", async () => {
    const { storage: mirror } = memoryStorage();
    const ledger = createPreservedWritesLedger(failingStorage(), mirror);
    expect(await ledger.record("user-A")).toBe(true);
    expect(await ledger.hasUnresolved()).toBe(true);
    expect(await ledger.list()).toEqual(["user-A"]);
  });

  it("a failed record survives a fresh ledger instance over the same stores (reload)", async () => {
    const failing = failingStorage();
    const mirrorBacking = memoryStorage();
    // The primary store refuses the write at record time; the record
    // itself lands durably in the mirror. A reload creates a fresh
    // ledger instance over the SAME stores — it must still see it.
    const first = createPreservedWritesLedger(failing, mirrorBacking.storage);
    expect(await first.record("user-A")).toBe(true);
    const second = createPreservedWritesLedger(
      failing,
      mirrorBacking.storage,
    );
    expect(await second.list()).toEqual(["user-A"]);
    expect(await second.hasUnresolved()).toBe(true);
  });

  it("a failed record is visible: record() returns false when it lands nowhere", async () => {
    // Both stores down at once: the failure is REPORTED (false),
    // never swallowed. The residual limit is documented on the
    // module: with no durable trace, a fresh client after a reload
    // cannot know about this record — no memory flag or third-store
    // marker is used as a substitute proof.
    const ledger = createPreservedWritesLedger(
      failingStorage(),
      failingStorage(),
    );
    expect(await ledger.record("user-A")).toBe(false);
  });

  it("the owner returning clean resolves a mirror-recorded entry (no stuck state)", async () => {
    const { storage: mirror } = memoryStorage();
    const ledger = createPreservedWritesLedger(failingStorage(), mirror);
    await ledger.record("user-A");
    expect(await ledger.hasUnresolved()).toBe(true);
    // A returns, syncs, and logs out clean: resolve drops the entry
    // from the mirror, so a later clear is allowed again.
    await ledger.resolve("user-A");
    expect(await ledger.hasUnresolved()).toBe(false);
    expect(await ledger.list()).toEqual([]);
  });
});
