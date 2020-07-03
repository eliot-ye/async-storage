const LOCAL_STORAGE = "localStorage";
function localStorageEngine(opt) {
    const keyPrefix = opt.name + "/";
    let support = true;
    try {
        localStorage.setItem(LOCAL_STORAGE, LOCAL_STORAGE);
        localStorage.removeItem(LOCAL_STORAGE);
    }
    catch (error) {
        support = false;
    }
    const localStorageEngine = {
        support,
        async setItem(key, value, secretPassphrase) {
            if (value === undefined) {
                return Promise.reject("value is undefined");
            }
            localStorage.setItem(keyPrefix + key, JSON.stringify(value));
        },
        async getItem(key, secretPassphrase) {
            const valueStr = localStorage.getItem(keyPrefix + key);
            return valueStr ? JSON.parse(valueStr) : valueStr;
        },
        async keys() {
            let keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.indexOf(keyPrefix) === 0) {
                    keys.push(key.replace(keyPrefix, ""));
                }
            }
            return keys;
        },
        async length() {
            const keys = await localStorageEngine.keys();
            return keys.length;
        },
        async removeItem(key) {
            localStorage.removeItem(keyPrefix + key);
        },
        async clean() {
            const keys = await localStorageEngine.keys();
            keys.map(key => localStorageEngine.removeItem(key));
        },
    };
    return localStorageEngine;
}

const INDEX_DB = "indexDB";
function indexDBEngine(opt) {
    const storeName = opt.storeName || "keyvalue";
    let support = window.indexedDB && typeof indexedDB.open === "function";
    let db;
    const request = window.indexedDB.open(opt.name);
    let readyList = [];
    request.onerror = function () {
        support = false;
    };
    request.onupgradeneeded = function () {
        db = request.result;
        db.createObjectStore(storeName);
        console.log("onupgradeneeded");
    };
    request.onsuccess = function () {
        db = request.result;
        if (readyList.length) {
            readyList.map(readyFunc => readyFunc());
            readyList = [];
        }
        console.log("onsuccess");
    };
    let indexDBEngine = {
        support,
        setItem(key, value, secretPassphrase) {
            if (value === undefined) {
                return Promise.reject("value is undefined");
            }
            return new Promise((resolve, reject) => {
                function handle() {
                    const request = db.transaction([storeName], 'readwrite').objectStore(storeName).put(value, key);
                    request.onsuccess = function () {
                        resolve();
                    };
                    request.onerror = function () {
                        reject(request.error);
                    };
                }
                db ? handle() : readyList.push(handle);
            });
        },
        getItem(key, secretPassphrase) {
            return new Promise((resolve, reject) => {
                function handle() {
                    const request = db.transaction([storeName]).objectStore(storeName).get(key);
                    request.onsuccess = function () {
                        resolve(request.result);
                    };
                    request.onerror = function () {
                        reject(request.error);
                    };
                }
                db ? handle() : readyList.push(handle);
            });
        },
        length() {
            return new Promise((resolve, reject) => {
                function handle() {
                    const request = db.transaction([storeName]).objectStore(storeName).getAllKeys();
                    request.onsuccess = function () {
                        resolve(request.result.length);
                    };
                    request.onerror = function () {
                        reject(request.error);
                    };
                }
                db ? handle() : readyList.push(handle);
            });
        },
        keys() {
            return new Promise((resolve, reject) => {
                function handle() {
                    const request = db.transaction([storeName]).objectStore(storeName).getAllKeys();
                    request.onsuccess = function () {
                        resolve(request.result.map(item => item.toString()));
                    };
                    request.onerror = function () {
                        reject(request.error);
                    };
                }
                db ? handle() : readyList.push(handle);
            });
        },
        removeItem(key) {
            return new Promise((resolve, reject) => {
                function handle() {
                    const request = db.transaction([storeName], 'readwrite').objectStore(storeName).delete(key);
                    request.onsuccess = function () {
                        resolve();
                    };
                    request.onerror = function () {
                        reject(request.error);
                    };
                }
                db ? handle() : readyList.push(handle);
            });
        },
        clean() {
            return new Promise((resolve, reject) => {
                function handle() {
                    const request = db.transaction([storeName], 'readwrite').objectStore(storeName).clear();
                    request.onsuccess = function () {
                        resolve();
                    };
                    request.onerror = function () {
                        reject(request.error);
                    };
                }
                db ? handle() : readyList.push(handle);
            });
        },
    };
    return indexDBEngine;
}

const engineList = {
    [LOCAL_STORAGE]: localStorageEngine,
    [INDEX_DB]: indexDBEngine
};
const engineNameList = [INDEX_DB, LOCAL_STORAGE];
function defineEngine(engineName, engine) {
    engineList[engineName] = engine;
}
function createLocalDB(createOpt) {
    const _engineNameList = createOpt.engineNameList || engineNameList;
    let engineObj = engineList[_engineNameList[0]]({ name: createOpt.name, storeName: createOpt.storeName });
    if (!engineObj.support) {
        for (let i = 1; i < _engineNameList.length; i++) {
            engineObj = engineList[_engineNameList[i]]({ name: createOpt.name, storeName: createOpt.storeName });
            if (engineObj.support)
                break;
        }
    }
    const publicEngine = {
        setItem: engineObj.setItem,
        getItem: engineObj.getItem,
        length: engineObj.length,
        keys: engineObj.keys,
        removeItem: engineObj.removeItem,
        clean: engineObj.clean
    };
    return publicEngine;
}

export { createLocalDB, defineEngine };
