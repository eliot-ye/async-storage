import { engine, initOption } from "../types"

export const LOCAL_STORAGE = "localStorage";

export function localStorageEngine(opt: initOption): engine {
  const keyPrefix = opt.name + "/";

  let support = true;
  try {
    localStorage.setItem(LOCAL_STORAGE, LOCAL_STORAGE);
    localStorage.removeItem(LOCAL_STORAGE);
  } catch (error) {
    support = false
  }

  const localStorageEngine: engine = {
    support,

    async setItem(key, value) {
      if (value === undefined) {
        return Promise.reject("value is undefined");
      }
      localStorage.setItem(keyPrefix + key, JSON.stringify(value))
    },

    async getItem(key) {
      const valueStr = localStorage.getItem(keyPrefix + key)
      return valueStr && JSON.parse(valueStr);
    },

    async keys() {
      let keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.indexOf(keyPrefix) === 0) {
          keys.push(key.replace(keyPrefix, ""))
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
    async clear() {
      const keys = await localStorageEngine.keys()
      keys.map(key => localStorageEngine.removeItem(key));
    },

  }

  return localStorageEngine
}



