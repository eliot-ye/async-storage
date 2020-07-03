import { engine, initOption } from "../types"

export const INDEX_DB = "indexDB";

export function indexDBEngine(opt: initOption): engine {

  const storeName = opt.storeName || "keyvalue"
  let support = window.indexedDB && typeof indexedDB.open === "function";
  let db: IDBDatabase;
  const request = window.indexedDB.open(opt.name);

  let readyList: (() => void)[] = [];

  request.onerror = function () {
    support = false;
  }
  request.onupgradeneeded = function () {
    db = request.result
    db.createObjectStore(storeName)
    console.log("onupgradeneeded")
  }
  request.onsuccess = function () {
    db = request.result
    if (readyList.length) { readyList.map(readyFunc => readyFunc()); readyList = [] }
    console.log("onsuccess")
  }

  let indexDBEngine: engine = {
    support,

    setItem(key, value, secretPassphrase) {
      if (value === undefined) {
        return Promise.reject("value is undefined");
      }
      return new Promise((resolve, reject) => {
        function handle() {
          const request = db.transaction([storeName], 'readwrite').objectStore(storeName).put(value, key)
          request.onsuccess = function () {
            resolve()
          }
          request.onerror = function () {
            reject(request.error)
          }
        }
        db ? handle() : readyList.push(handle);
      })
    },

    getItem(key, secretPassphrase) {
      return new Promise((resolve, reject) => {
        function handle() {
          const request = db.transaction([storeName]).objectStore(storeName).get(key);
          request.onsuccess = function () {
            resolve(request.result)
          }
          request.onerror = function () {
            reject(request.error)
          }
        }
        db ? handle() : readyList.push(handle);
      })
    },

    length() {
      return new Promise((resolve, reject) => {
        function handle() {
          const request = db.transaction([storeName]).objectStore(storeName).getAllKeys()
          request.onsuccess = function () {
            resolve(request.result.length)
          }
          request.onerror = function () {
            reject(request.error)
          }
        }
        db ? handle() : readyList.push(handle);
      })
    },
    keys() {
      return new Promise((resolve, reject) => {
        function handle() {
          const request = db.transaction([storeName]).objectStore(storeName).getAllKeys()
          request.onsuccess = function () {
            resolve(request.result.map(item => item.toString()))
          }
          request.onerror = function () {
            reject(request.error)
          }
        }
        db ? handle() : readyList.push(handle);
      })
    },

    removeItem(key) {
      return new Promise((resolve, reject) => {
        function handle() {
          const request = db.transaction([storeName], 'readwrite').objectStore(storeName).delete(key)
          request.onsuccess = function () {
            resolve()
          }
          request.onerror = function () {
            reject(request.error)
          }
        }
        db ? handle() : readyList.push(handle);
      })
    },
    clean() {
      return new Promise((resolve, reject) => {
        function handle() {
          const request = db.transaction([storeName], 'readwrite').objectStore(storeName).clear()
          request.onsuccess = function () {
            resolve()
          }
          request.onerror = function () {
            reject(request.error)
          }
        }
        db ? handle() : readyList.push(handle);
      })
    },

  }

  return indexDBEngine

}