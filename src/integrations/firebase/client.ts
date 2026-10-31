import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, type Functions } from "firebase/functions";
import { Capacitor } from "@capacitor/core";

// Firebase WEB app config (Firebase console > Project settings > Your apps >
// Web app). These are public identifiers, not secrets. Values come from
// VITE_FIREBASE_* env vars — see firebase/.env.example.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const firebaseAuth: Auth = getAuth(firebaseApp);

/**
 * Firestore instance. On web, use the persistent (IndexedDB) local cache
 * with the multi-tab manager: repeat app opens render straight from the
 * local cache and sync in the background, instead of a cold network read
 * of every collection on every launch. Native (Capacitor) previously
 * kept the default in-memory instance, so the native app — the MAIN
 * distribution — re-read everything from the network on every launch
 * and showed loading/empty states offline (audit 2026-10-24). Native
 * now gets the persistent cache too, with the single-tab manager
 * (the multi-tab manager is a browser concept). Any failure (private
 * mode, missing IndexedDB, an already-initialized instance) falls back
 * to the default in-memory-cache instance.
 */
function createFirestore(app: FirebaseApp): Firestore {
  if (typeof indexedDB !== "undefined") {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: Capacitor.isNativePlatform()
            ? persistentSingleTabManager(undefined)
            : persistentMultipleTabManager(),
        }),
      });
    } catch (e) {
      console.warn("Firestore persistent cache unavailable; using default cache", e);
    }
  }
  return getFirestore(app);
}

export const firebaseDb: Firestore = createFirestore(firebaseApp);
export const firebaseStorage: FirebaseStorage = getStorage(firebaseApp);
// Staged Cloud Functions (firebase/functions) are deployed in asia-south1.
export const firebaseFunctions: Functions = getFunctions(firebaseApp, "asia-south1");
