import { CusLog } from "../../utils/tools";
import type { StorageEngine } from "../asyncStorage";

export function ELocalStorage(name = "default"): StorageEngine | null {
  let ready = false;
  try {
    const testString = "test";
    localStorage.setItem(testString, testString);
    const test = localStorage.getItem(testString);
    if (test === testString) {
      ready = true;
    }
  } catch (error) {
    CusLog.error("LSE_localStorage", "unready", error);
  }

  if (!ready) {
    return null;
  }

  return {
    async getItem(key: string) {
      return localStorage.getItem(`${name}_${key}`);
    },
    async setItem(key: string, value: string) {
      return localStorage.setItem(`${name}_${key}`, value);
    },
    async removeItem(key: string) {
      return localStorage.removeItem(`${name}_${key}`);
    },
  };
}
