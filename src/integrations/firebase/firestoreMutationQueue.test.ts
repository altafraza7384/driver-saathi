/**
 * Unit tests for the Firestore SDK mutation-queue inspector (round 6).
 *
 * The inspector is the answer to the all-three-stores case the ledger
 * alone cannot close: when every ledger store fails at record time and
 * then heals, the ledger reads live-and-empty while user A's pending
 * writes are still sitting in Firestore's own IndexedDB store. The
 * ledger has no trace of them — but the SDK's own mutation queue does.
 * This module reads that queue READ-ONLY (the SDK's `mutations` object
 * store in its `firestore/[DEFAULT]/<projectId>/main` database) and
 * reports whether ANY identity has unacknowledged mutation batches.
 * A batch record is a batch regardless of its payload, so pending
 * DELETEs are covered too — the case a cache sweep is blind to.
 *
 * The fake below models the SDK database as the installed SDK
 * (firebase 13.0.0 / @firebase/firestore 4.18.0) actually lays it out,
 * verified against node_modules: database
 * `firestore/<persistenceKey>/<projectId>/main`, object stores
 * `mutationQueues` (keyPath `userId`) and `mutations` (keyPath
 * `batchId`, autoIncrement, index `userMutationsIndex` on
 * [userId, batchId]), and mutation-queue rows shaped
 * { userId, lastAcknowledgedBatchId, lastStreamToken }.
 */
import { describe, it, expect } from "vitest";
import {
  createFirestoreMutationQueueInspector,
  firestoreSdkDbName,
  type MutationQueueInspector,
} from "./firestoreMutationQueue";

const PROJECT_ID = "driver-saathi-app";
const SDK_DB_NAME = "firestore/[DEFAULT]/driver-saathi-app/main";

type SdkStoreData = {
  records: Map<string | number, Record<string, unknown>>;
  indexes: Set<string>;
};

type SdkDbData = {
  stores: Map<string, SdkStoreData>;
};

/**
 * Minimal fake IDBFactory modelling the SDK's database. Only what the
 * inspector uses: databases(), open() (no version — never an upgrade),
 * objectStoreNames, transaction("mutations", "readonly"),
 * store.index("userMutationsIndex") and store.getAll(). Reads are
 * asynchronous (setTimeout 0), like real IndexedDB.
 */
class FakeSdkFactory {
  private databasesMap = new Map<string, SdkDbData>();
  /** When false, databases() is absent (older browsers). */
  withDatabases = true;
  /** When true, open() rejects (DB locked / unavailable). */
  openFails = false;

  /** Create the SDK database with the real store/index layout. */
  ensureSdkDb(name: string = SDK_DB_NAME): SdkDbData {
    let data = this.databasesMap.get(name);
    if (!data) {
      data = {
        stores: new Map([
          [
            "mutationQueues",
            { records: new Map(), indexes: new Set() },
          ],
          [
            "mutations",
            {
              records: new Map(),
              indexes: new Set(["userMutationsIndex"]),
            },
          ],
        ]),
      };
      this.databasesMap.set(name, data);
    }
    return data;
  }

  /** Create a database WITHOUT the SDK stores (schema mismatch). */
  ensureBareDb(name: string): SdkDbData {
    let data = this.databasesMap.get(name);
    if (!data) {
      data = { stores: new Map() };
      this.databasesMap.set(name, data);
    }
    return data;
  }

  /** Add one unacknowledged mutation batch for uid (any payload). */
  addBatch(
    uid: string,
    batchId: number,
    payload: Record<string, unknown> = { type: "set" },
    name: string = SDK_DB_NAME,
  ) {
    const db = this.ensureSdkDb(name);
    const mutations = db.stores.get("mutations");
    if (!mutations) throw new Error("mutations store missing");
    mutations.records.set(batchId, {
      userId: uid,
      batchId,
      mutations: [payload],
    });
    db.stores.get("mutationQueues")?.records.set(uid, {
      userId: uid,
      lastAcknowledgedBatchId: batchId - 1,
      lastStreamToken: "",
    });
  }

  /** Acknowledge (remove) one batch, as the SDK does after a sync. */
  removeBatch(batchId: number, name: string = SDK_DB_NAME) {
    this.databasesMap.get(name)?.stores.get("mutations")?.records.delete(batchId);
  }

  databases(): Promise<{ name: string; version: number }[]> {
    if (!this.withDatabases) {
      throw new Error("databases() is not a function");
    }
    return Promise.resolve(
      [...this.databasesMap.keys()].map((name) => ({ name, version: 18 })),
    );
  }

  open(name: string) {
    const req: Record<string, unknown> = {
      result: undefined,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    };
    setTimeout(() => {
      if (this.openFails) {
        req.error = new Error("IndexedDB open failed");
        (req.onerror as ((ev: Event) => void) | null)?.(new Event("error"));
        return;
      }
      // Opening a missing database creates an empty one (version 1),
      // as real IndexedDB does — with no object stores in it.
      const data = this.databasesMap.get(name) ?? { stores: new Map() };
      if (!this.databasesMap.has(name)) this.databasesMap.set(name, data);
      const db = this.makeDb(data);
      req.result = db;
      (req.onsuccess as ((ev: Event) => void) | null)?.(new Event("success"));
    }, 0);
    return req as unknown as IDBOpenDBRequest;
  }

  private makeDb(data: SdkDbData) {
    const db: Record<string, unknown> = {
      objectStoreNames: {
        contains: (storeName: string) => data.stores.has(storeName),
      },
      close: () => {},
      transaction: (storeNames: string | string[], _mode?: IDBTransactionMode) => {
        const tx: Record<string, unknown> = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null,
          objectStore: (storeName: string) => {
            const storeData = data.stores.get(storeName);
            if (!storeData) throw new Error(`NotFoundError: ${storeName}`);
            return {
              indexNames: {
                contains: (indexName: string) =>
                  storeData.indexes.has(indexName),
              },
              index: (indexName: string) => {
                if (!storeData.indexes.has(indexName)) {
                  throw new Error(`NotFoundError: index ${indexName}`);
                }
                return {};
              },
              getAll: () => {
                const getReq: Record<string, unknown> = {
                  result: undefined,
                  error: null,
                  onsuccess: null,
                  onerror: null,
                };
                setTimeout(() => {
                  getReq.result = [...storeData.records.values()];
                  (getReq.onsuccess as ((ev: Event) => void) | null)?.(
                    new Event("success"),
                  );
                  setTimeout(() => {
                    (tx.oncomplete as ((ev: Event) => void) | null)?.(
                      new Event("complete"),
                    );
                  }, 0);
                }, 0);
                return getReq;
              },
            };
          },
        };
        return tx;
      },
    };
    return db as unknown as IDBDatabase;
  }
}

function inspectorFor(
  factory: FakeSdkFactory,
  overrides: { projectId?: string; timeoutMs?: number } = {},
): MutationQueueInspector {
  return createFirestoreMutationQueueInspector({
    projectId: overrides.projectId ?? PROJECT_ID,
    factory: factory as unknown as IDBFactory,
    timeoutMs: overrides.timeoutMs ?? 1000,
  });
}

describe("firestoreSdkDbName", () => {
  it("names the default database the SDK actually opens", () => {
    expect(firestoreSdkDbName("driver-saathi-app")).toBe(
      "firestore/[DEFAULT]/driver-saathi-app/main",
    );
  });

  it("suffixes a non-default database id onto the project id", () => {
    expect(firestoreSdkDbName("driver-saathi-app", "[DEFAULT]", "mydb")).toBe(
      "firestore/[DEFAULT]/driver-saathi-app.mydb/main",
    );
  });

  it("honours a custom persistence key", () => {
    expect(firestoreSdkDbName("driver-saathi-app", "custom-key")).toBe(
      "firestore/custom-key/driver-saathi-app/main",
    );
  });
});

describe("createFirestoreMutationQueueInspector", () => {
  it("is clean when the SDK database does not exist in this profile", async () => {
    // No persistent Firestore database at all: no stored mutation
    // queue can exist, so there is nothing pending to protect.
    const factory = new FakeSdkFactory();
    const inspector = inspectorFor(factory);
    expect(await inspector.checkPendingMutations()).toEqual({
      status: "clean",
    });
  });

  it("is clean when the SDK database exists but the mutations store is empty", async () => {
    const factory = new FakeSdkFactory();
    factory.ensureSdkDb();
    const inspector = inspectorFor(factory);
    expect(await inspector.checkPendingMutations()).toEqual({
      status: "clean",
    });
  });

  it("is pending with the owning uid when one batch is unacknowledged", async () => {
    const factory = new FakeSdkFactory();
    factory.addBatch("user-A", 1);
    const inspector = inspectorFor(factory);
    expect(await inspector.checkPendingMutations()).toEqual({
      status: "pending",
      userIds: ["user-A"],
    });
  });

  it("lists every identity with a pending batch, deduplicated", async () => {
    const factory = new FakeSdkFactory();
    factory.addBatch("user-A", 1);
    factory.addBatch("user-A", 2);
    factory.addBatch("user-B", 3);
    const inspector = inspectorFor(factory);
    expect(await inspector.checkPendingMutations()).toEqual({
      status: "pending",
      userIds: ["user-A", "user-B"],
    });
  });

  it("sees a pending DELETE batch — the case a cache sweep is blind to", async () => {
    // A delete tombstones its document, so no getDocsFromCache sweep
    // can enumerate it — but the batch itself is still a row in the
    // SDK's mutations store, and the inspector reads rows, not docs.
    const factory = new FakeSdkFactory();
    factory.addBatch("user-A", 1, { type: "delete", path: "users/user-A/notes/n1" });
    const inspector = inspectorFor(factory);
    expect(await inspector.checkPendingMutations()).toEqual({
      status: "pending",
      userIds: ["user-A"],
    });
  });

  it("goes clean again once the batch is acknowledged (synced)", async () => {
    const factory = new FakeSdkFactory();
    factory.addBatch("user-A", 1);
    const inspector = inspectorFor(factory);
    expect(await inspector.checkPendingMutations()).toEqual({
      status: "pending",
      userIds: ["user-A"],
    });
    factory.removeBatch(1);
    expect(await inspector.checkPendingMutations()).toEqual({
      status: "clean",
    });
  });

  it("is unknown (fail closed) when the database lacks the SDK stores — schema mismatch", async () => {
    // The database exists but is not the SDK schema (e.g. a future
    // SDK renamed the stores): an empty read would be a lie, so the
    // inspector refuses to call it clean.
    const factory = new FakeSdkFactory();
    factory.ensureBareDb(SDK_DB_NAME);
    const inspector = inspectorFor(factory);
    const result = await inspector.checkPendingMutations();
    expect(result.status).toBe("unknown");
  });

  it("is unknown when a batch record is malformed", async () => {
    const factory = new FakeSdkFactory();
    const db = factory.ensureSdkDb();
    db.stores.get("mutations")?.records.set(1, {
      batchId: 1,
      // No userId: this row cannot be attributed, so it cannot be
      // proven clean — never treat a row we cannot read as absent.
    });
    const inspector = inspectorFor(factory);
    expect((await inspector.checkPendingMutations()).status).toBe("unknown");
  });

  it("is unknown when the database cannot be opened", async () => {
    const factory = new FakeSdkFactory();
    factory.ensureSdkDb();
    factory.openFails = true;
    const inspector = inspectorFor(factory);
    expect((await inspector.checkPendingMutations()).status).toBe("unknown");
  });

  it("is unknown when no project id is configured", async () => {
    const factory = new FakeSdkFactory();
    factory.ensureSdkDb();
    const inspector = inspectorFor(factory, { projectId: "" });
    const result = await inspector.checkPendingMutations();
    expect(result.status).toBe("unknown");
    expect(result).toMatchObject({ status: "unknown" });
  });

  it("is unknown when IndexedDB is not available at all", async () => {
    // No factory injected and no global indexedDB (jsdom): the queue
    // cannot be inspected, so the clear cannot be proven safe.
    const inspector = createFirestoreMutationQueueInspector({
      projectId: PROJECT_ID,
      factory: undefined,
      timeoutMs: 1000,
    });
    expect(typeof indexedDB).toBe("undefined");
    expect((await inspector.checkPendingMutations()).status).toBe("unknown");
  });

  it("still detects pending batches when databases() is unavailable (open fallback)", async () => {
    // Older browsers have no indexedDB.databases(): the inspector
    // falls back to opening the database, and must still see the row.
    const factory = new FakeSdkFactory();
    factory.withDatabases = false;
    factory.addBatch("user-A", 1);
    const inspector = inspectorFor(factory);
    expect(await inspector.checkPendingMutations()).toEqual({
      status: "pending",
      userIds: ["user-A"],
    });
  });

  it("never writes: the check leaves the SDK database untouched", async () => {
    const factory = new FakeSdkFactory();
    factory.addBatch("user-A", 1);
    const inspector = inspectorFor(factory);
    await inspector.checkPendingMutations();
    const db = factory.ensureSdkDb();
    expect(db.stores.get("mutations")?.records.size).toBe(1);
    expect(
      db.stores.get("mutations")?.records.get(1),
    ).toEqual({
      userId: "user-A",
      batchId: 1,
      mutations: [{ type: "set" }],
    });
  });
});
