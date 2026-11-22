/**
 * Durable ledger of identities whose unsynced writes were preserved at
 * logout (PR #30 round 2).
 *
 * THE HOLE IT CLOSES: waitForPendingWrites only sees the ACTIVE
 * identity's queue, so it can never prove a WHOLE-cache clear safe.
 * Round 1 fixed the departing user (check before the identity change),
 * but the older retained-identity case still failed: user A logs out
 * with an offline write pending and the cache is preserved; user B
 * then logs in and out with a clean queue, and the whole-cache clear
 * destroyed A's still-pending write. An active-user clean check is
 * NOT a whole-cache safety proof.
 *
 * The ledger records, at logout time, every identity whose pending
 * writes forced the cache to be kept. A later logout — by ANY identity
 * — must not clear the cache while any ledger entry is unresolved.
 * An entry is resolved only when that identity is active again and
 * its own pending-writes check proves its queue clean (at its next
 * logout through this flow). Until then the cache is kept, however
 * many other users log in and out.
 *
 * STORAGE: localStorage, NOT IndexedDB — clearIndexedDbPersistence
 * wipes Firestore's IndexedDB store, so a ledger kept there would be
 * destroyed by exactly the clear it is supposed to gate. localStorage
 * survives the clear, the page reload, and a fresh client instance.
 * It holds ONLY user ids (no document data, no write contents).
 *
 * FAIL-CLOSED: if the stored value is corrupt or the storage cannot
 * be read, hasUnresolved() returns true (preserve) rather than
 * assuming the cache is safe to clear. A corrupt entry can leave the
 * cache kept until the owning identity returns and logs out clean;
 * that stuck-safe state is preferable to destroying unsynced data.
 *
 * PROVEN SCOPE (honest limit): the ledger only knows about identities
 * whose logout went through this flow. A session that ends WITHOUT
 * this logout path (e.g. a token revoked while offline) leaves no
 * record, so a later clear cannot be proven safe for that identity's
 * writes. The privacy draft states this limit; do not claim more.
 */

/** localStorage key. Value: JSON array of user ids. */
export const PRESERVED_WRITES_STORAGE_KEY =
  "driver-saathi:preserved-pending-writes";

/** Minimal storage surface, so tests can substitute a fake store. */
export type PreservedWritesStorage = {
  read(): string | null;
  write(value: string): void;
  remove(): void;
};

export type PreservedWritesLedger = {
  /** Record that uid's unsynced writes were preserved at logout. */
  record(uid: string): void;
  /** Drop uid's entry — its queue has since been proven clean. */
  resolve(uid: string): void;
  /**
   * True when any recorded identity OTHER than exceptUid still has
   * unconfirmed pending writes — or when the ledger cannot be read
   * (fail closed: never clear on doubt). False only when every
   * recorded entry is resolved (or there are none) AND the ledger
   * was readable.
   */
  hasUnresolved(exceptUid?: string | null): boolean;
  /** Recorded uids (empty when unreadable — never throws). */
  list(): string[];
};

function localStorageStore(): PreservedWritesStorage {
  return {
    read() {
      return localStorage.getItem(PRESERVED_WRITES_STORAGE_KEY);
    },
    write(value: string) {
      localStorage.setItem(PRESERVED_WRITES_STORAGE_KEY, value);
    },
    remove() {
      localStorage.removeItem(PRESERVED_WRITES_STORAGE_KEY);
    },
  };
}

function parseUids(raw: string | null): string[] | null {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const uids = parsed.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    // A well-formed value round-trips exactly; anything else is corrupt.
    if (uids.length !== parsed.length) return null;
    return uids;
  } catch {
    return null;
  }
}

export function createPreservedWritesLedger(
  storage: PreservedWritesStorage = localStorageStore(),
): PreservedWritesLedger {
  const readUids = (): string[] | null => {
    try {
      return parseUids(storage.read());
    } catch (e) {
      console.warn("Preserved-writes ledger unreadable; preserving cache", e);
      return null;
    }
  };

  const writeUids = (uids: string[]): boolean => {
    try {
      if (uids.length === 0) storage.remove();
      else storage.write(JSON.stringify(uids));
      return true;
    } catch (e) {
      console.warn("Preserved-writes ledger write failed", e);
      return false;
    }
  };

  return {
    record(uid: string) {
      const uids = readUids();
      // Unreadable ledger: do NOT overwrite it (that could drop other
      // identities' entries). The current logout already preserves the
      // cache, and hasUnresolved stays fail-closed until the owner
      // returns. Best effort only.
      if (uids === null) return;
      if (!uids.includes(uid)) writeUids([...uids, uid]);
    },
    resolve(uid: string) {
      const uids = readUids();
      if (uids === null) return;
      if (uids.includes(uid)) {
        writeUids(uids.filter((u) => u !== uid));
      }
    },
    hasUnresolved(exceptUid?: string | null) {
      const uids = readUids();
      // null = unreadable/corrupt: fail closed, never clear on doubt.
      if (uids === null) return true;
      return uids.some((u) => u !== exceptUid);
    },
    list() {
      return readUids() ?? [];
    },
  };
}

/** Shared production ledger (localStorage-backed). */
export const preservedWritesLedger: PreservedWritesLedger =
  createPreservedWritesLedger();
