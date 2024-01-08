import { CusLog } from "../../utils/tools";
import type { StorageEngine } from "../asyncStorage";

export function ELocalStorage(name = "LS") {
  let ready = false;
  try {
    const testString = "test";
    localStorage.setItem(testString, testString);
    const test = localStorage.getItem(testString);
    if (test === testString) {
      ready = true;
    }
  } catch (error) {
    CusLog.error("ELocalStorage", "unready", error);
  }

  if (!ready) {
    return null;
  }

  const storageEngine: StorageEngine<false> = {
    supportObject: false,
    async getItem(key) {
      return localStorage.getItem(`${name}_${key}`);
    },
    async setItem(key, value) {
      return localStorage.setItem(`${name}_${key}`, value);
    },
    async removeItem(key) {
      return localStorage.removeItem(`${name}_${key}`);
    },
  };

  return storageEngine;
}
