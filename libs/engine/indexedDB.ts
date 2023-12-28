import { CusLog } from "../../utils/tools";
import type { StorageEngine } from "../asyncStorage";

export function EIndexedDB(
  name = "asyncStorage",
  version = 1
): StorageEngine | null {
  const objectStoreName = "asyncStorage";

  const readyCallbacks: (() => void)[] = [];

  let hasIndexDB = false;

  let idbDatabase: null | IDBDatabase = null;

  if (window.indexedDB) {
    const idbOpenDBRequest = window.indexedDB.open(name, version);
    hasIndexDB = true;
    idbOpenDBRequest.onupgradeneeded = function () {
      if (!idbDatabase) {
        idbDatabase = idbOpenDBRequest.result;
      }
      if (!idbDatabase.objectStoreNames.contains(objectStoreName)) {
        idbDatabase.createObjectStore(objectStoreName, { keyPath: "key" });
      }
    };
    idbOpenDBRequest.onsuccess = function () {
      idbDatabase = idbOpenDBRequest.result;
      readyCallbacks.forEach((cb) => cb());
    };
    idbOpenDBRequest.onerror = function () {
      CusLog.error("IndexedDB", "error", idbOpenDBRequest.error);
    };
  }
  if (!hasIndexDB) {
    return null;
  }

  const NotReadyError = "IndexedDB is not ready";

  const storageEngine: StorageEngine = {
    onReady(callback) {
      readyCallbacks.push(callback);
    },
    getItem(key) {
      return new Promise((resolve, reject) => {
        if (!idbDatabase) {
          return reject(NotReadyError);
        }
        const transaction = idbDatabase.transaction(
          objectStoreName,
          "readonly"
        );
        const objectStore = transaction.objectStore(objectStoreName);
        const request = objectStore.get(key);
        request.onsuccess = function () {
          if (request.result) {
            resolve(request.result.value);
          } else {
            resolve(null);
          }
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    },
    setItem(key, value) {
      return new Promise((resolve, reject) => {
        if (!idbDatabase) {
          return reject(NotReadyError);
        }
        const transaction = idbDatabase.transaction(
          objectStoreName,
          "readwrite"
        );
        const objectStore = transaction.objectStore(objectStoreName);
        const request = objectStore.put({ key, value });
        request.onsuccess = function () {
          resolve();
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    },
    removeItem(key) {
      return new Promise((resolve, reject) => {
        if (!idbDatabase) {
          return reject(NotReadyError);
        }
        const transaction = idbDatabase.transaction(
          objectStoreName,
          "readwrite"
        );
        const objectStore = transaction.objectStore(objectStoreName);
        const request = objectStore.delete(key);
        request.onsuccess = function () {
          resolve();
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    },
  };

  return storageEngine;
}
