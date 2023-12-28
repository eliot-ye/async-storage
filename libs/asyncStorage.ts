import { AESDecrypt, AESEncrypt, MD5 } from "../utils/encoding";

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
  HashFn?: (message: string) => string;
  increments?: (keyof T)[];
}

export function createAsyncStorage<T extends JSONConstraint>(
  initialData: T,
  engines: (StorageEngine | (() => StorageEngine) | null)[],
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
    EncryptFn = AESEncrypt,
    DecryptFn = AESDecrypt,
    HashFn = MD5,
    increments = [],
  } = option;

  function getHashKey(key: Key) {
    const _key = key as string;
    if (secretKey) {
      return HashFn(_key);
    }
    return _key;
  }

  return {
    async ready() {
      if (ready) {
        return;
      }
      return new Promise<void>((resolve) => {
        readyCallbacks.push(resolve);
      });
    },
    async set<K extends Key>(key: K, value: T[K]) {
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
      return _engine?.setItem(getHashKey(key), valueStr);
    },
    async get<K extends Key>(key: K): Promise<T[K]> {
      let str = await _engine?.getItem(getHashKey(key));
      if (str === null || str === undefined) {
        return initialData[key];
      }
      if (secretKey) {
        str = DecryptFn(str, secretKey);
      }
      try {
        return JSON.parse(str);
      } catch (error) {
        console.error(key, error);
      }
      return str as any;
    },
    remove(key: Key) {
      return _engine?.removeItem(getHashKey(key));
    },
  };
}
