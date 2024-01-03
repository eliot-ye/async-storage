import { AESDecrypt, AESEncrypt, MD5 } from "../utils/encoding";

export enum ErrorMessage {
  NOT_ENGINE = "No storage engine",
}

export interface StorageEngine {
  setItem: (key: string, value: string) => Promise<void> | void;
  getItem: (
    key: string
  ) => Promise<string | null | undefined> | string | null | undefined;
  removeItem: (key: string) => Promise<void> | void;
  onReady?: () => Promise<void>;
}

interface Option<T> {
  secretKey?: string;
  EncryptFn?: (message: string, key: string) => string;
  DecryptFn?: (message: string, key: string) => string;
  enableHashKey?: boolean;
  HashFn?: (message: string) => string;
  increments?: (keyof T)[];
}

export function createAsyncStorage<T extends JSONConstraint>(
  initialData: T,
  engines: (StorageEngine | (() => StorageEngine | null) | null)[],
  option: Option<T> = {}
) {
  type Key = keyof T;

  const _engines = engines.filter((e) => e !== null);
  const _engine =
    typeof _engines[0] === "function" ? _engines[0]() : _engines[0];

  let ready = false;
  const readyCallbacks: (() => void)[] = [];
  if (_engine) {
    if (_engine.onReady) {
      _engine.onReady().then(() => {
        ready = true;
        readyCallbacks.forEach((cb) => cb());
      });
    } else {
      ready = true;
    }
  }

  const {
    secretKey,
    enableHashKey,
    EncryptFn = AESEncrypt,
    DecryptFn = AESDecrypt,
    HashFn = MD5,
    increments = [],
  } = option;

  function getHashKey(key: Key) {
    const _key = key as string;
    if (enableHashKey) {
      return HashFn(_key);
    }
    return _key;
  }

  return {
    async onReady() {
      if (ready) {
        return;
      }
      return new Promise<void>((resolve) => {
        readyCallbacks.push(resolve);
      });
    },
    async set<K extends Key>(key: K, value: T[K]) {
      if (!_engine) {
        return Promise.reject(new Error(ErrorMessage.NOT_ENGINE));
      }
      let _value = value;
      if (increments.includes(key)) {
        _value = {
          ...(await this.get(key)),
          ...value,
        };
      }
      let valueStr = JSON.stringify(_value);
      if (secretKey) {
        valueStr = EncryptFn(valueStr, secretKey);
      }
      return _engine.setItem(getHashKey(key), valueStr);
    },
    async get<K extends Key>(key: K): Promise<T[K]> {
      if (!_engine) {
        return Promise.reject(new Error(ErrorMessage.NOT_ENGINE));
      }
      const str = await _engine.getItem(getHashKey(key));
      if (str === null || str === undefined) {
        return initialData[key];
      }
      if (secretKey) {
        try {
          return JSON.parse(DecryptFn(str, secretKey));
        } catch (error) {
          console.error(key, error);
        }
      }
      try {
        return JSON.parse(str);
      } catch (error) {
        console.error(key, error);
      }
      return str as any;
    },
    remove(key: Key) {
      if (!_engine) {
        return Promise.reject(new Error(ErrorMessage.NOT_ENGINE));
      }
      return _engine.removeItem(getHashKey(key));
    },
  };
}
