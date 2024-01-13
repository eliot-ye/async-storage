import { CusLog } from "../utils/tools";
import type { StorageEngine } from "../asyncStorage";

export enum ErrorMessage {
  NOT_READY = "IndexedDB is not ready, please handle in the onReady event",
}

export function EIndexedDB(name = "asyncStorage", version = 1) {
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

  const storageEngine: StorageEngine = {
    // TODO: 目前测试在保存数组数据时会报错
    // supportObject: true,
    onReady() {
      return new Promise((resolve) => {
        if (idbDatabase) {
          resolve();
        } else {
          readyCallbacks.push(resolve);
        }
      });
    },
    getItem(key) {
      return new Promise((resolve, reject) => {
        if (!idbDatabase) {
          return reject(new Error(ErrorMessage.NOT_READY));
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
          return reject(new Error(ErrorMessage.NOT_READY));
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
          return reject(new Error(ErrorMessage.NOT_READY));
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
