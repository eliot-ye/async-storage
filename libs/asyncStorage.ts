import { MD5 } from "./utils/encoding";
import { debounce, getOnlyStr } from "./utils/tools";

type SubscribeFn = () => void;

export interface StorageEngine<IsAsync extends boolean = true> {
  /** 配置是否支持对象存储，如果为 true 则 setItem 的 value 值可能是 JSON，否则为字符串存储 */
  supportObject?: boolean;
  setItem: (
    key: string,
    value: any
  ) => IsAsync extends true ? Promise<void> : void;
  getItem: (
    key: string
  ) => IsAsync extends true
    ? Promise<any | null | undefined>
    : any | null | undefined;
  removeItem: (key: string) => IsAsync extends true ? Promise<void> : void;
  onReady?: () => Promise<void>;
}

interface Option<T> {
  secretKey?: string;
  EncryptFn?: (message: string, key: string) => string;
  DecryptFn?: (message: string, key: string) => string;
  /** 是否开启 key 加密，如果开启，所有 key 都会使用MD5值 */
  enableHashKey?: boolean;
  HashFn?: (message: string) => string;
  increments?: (keyof T)[];
}

export enum ErrorMessage {
  NOT_ENGINE = "No storage engine",
}

export function createAsyncStorage<T extends JSONConstraint>(
  initialData: T,
  engines: (StorageEngine<boolean> | (() => StorageEngine<boolean> | null) | null)[],
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
    EncryptFn,
    DecryptFn,
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

  const subscribeMap: {
    [id: string]: { fn: SubscribeFn; keys?: Key[] } | undefined;
  } = {};
  const subscribeIds: string[] = [];
  let effectKeys: Key[] = [];
  const effectHandler = debounce(
    () => {
      subscribeIds.forEach((_id) => {
        const subscribe = subscribeMap[_id];
        let hasSubscribe = false;
        if (subscribe?.keys) {
          for (const _key of effectKeys) {
            if (subscribe.keys.includes(_key)) {
              hasSubscribe = true;
            }
          }
        } else {
          hasSubscribe = true;
        }
        if (subscribe && hasSubscribe) {
          try {
            subscribe.fn();
          } catch (error) {
            console.error(`subscribe (id: ${_id}) error:`, error);
          }
        }
      });
      effectKeys = [];
    },
    { wait: 0 }
  );

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

      if (_engine.supportObject && !secretKey) {
        await _engine.setItem(getHashKey(key), _value);
      } else {
        let valueStr = JSON.stringify(_value);
        if (secretKey && EncryptFn) {
          valueStr = EncryptFn(valueStr, secretKey);
        }
        await _engine.setItem(getHashKey(key), valueStr);
      }

      effectKeys.push(key);
      effectHandler();
    },
    async get<K extends Key>(key: K): Promise<T[K]> {
      if (!_engine) {
        return Promise.reject(new Error(ErrorMessage.NOT_ENGINE));
      }
      const _value = await _engine.getItem(getHashKey(key));
      if (_value === null || _value === undefined) {
        return initialData[key];
      }
      if (typeof _value === "string") {
        if (secretKey && DecryptFn) {
          try {
            return JSON.parse(DecryptFn(_value, secretKey));
          } catch (error) {
            console.error(key, error);
          }
        }
      }
      try {
        return JSON.parse(_value);
      } catch (error) {
        console.warn(key, error);
      }
      return _value;
    },
    remove(key: Key) {
      if (!_engine) {
        return Promise.reject(new Error(ErrorMessage.NOT_ENGINE));
      }
      return _engine.removeItem(getHashKey(key));
    },

    /**
     * @param fn - 订阅函数
     * - 初始化时会执行一次
     * - 使用 `set` 时，内部在更新数据后才触发订阅函数，此时 `get` 会获取最新的数据。
     * - 短时间内多次使用 `set` 时，会触发防抖处理，订阅函数只执行一次。
     * @param keys - 订阅属性
     * - 只有订阅的属性发生了更改才触发执行订阅函数。如果不传入该参数，则所有属性更改都会执行。
     * - 如果传入空数组，则订阅函数只执行一次，并且不会返回 `unsubscribe`
     * @returns function `unsubscribe`
     */
    subscribe<K extends Key>(fn: SubscribeFn, keys?: K[]) {
      try {
        fn();
      } catch (error) {
        console.error(`subscribe error:`, error);
      }

      if (keys?.length === 0) {
        return;
      }
      const id = getOnlyStr(subscribeIds);
      subscribeIds.push(id);
      subscribeMap[id] = {
        fn,
        keys,
      };

      return () => {
        subscribeMap[id] = undefined;
        subscribeIds.splice(subscribeIds.indexOf(id), 1);
      };
    },
  };
}

export function createSyncStorage<T extends JSONConstraint>(
  initialData: T,
  engines: (
    | StorageEngine<false>
    | (() => StorageEngine<false> | null)
    | null
  )[],
  option: Option<T> = {}
) {
  type Key = keyof T;

  const _engines = engines.filter((e) => e !== null);
  const _engine =
    typeof _engines[0] === "function" ? _engines[0]() : _engines[0];

  const {
    secretKey,
    enableHashKey,
    EncryptFn,
    DecryptFn,
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

  const subscribeMap: {
    [id: string]: { fn: SubscribeFn; keys?: Key[] } | undefined;
  } = {};
  const subscribeIds: string[] = [];
  let effectKeys: Key[] = [];
  const effectHandler = debounce(
    () => {
      subscribeIds.forEach((_id) => {
        const subscribe = subscribeMap[_id];
        let hasSubscribe = false;
        if (subscribe?.keys) {
          for (const _key of effectKeys) {
            if (subscribe.keys.includes(_key)) {
              hasSubscribe = true;
            }
          }
        } else {
          hasSubscribe = true;
        }
        if (subscribe && hasSubscribe) {
          try {
            subscribe.fn();
          } catch (error) {
            console.error(`subscribe (id: ${_id}) error:`, error);
          }
        }
      });
      effectKeys = [];
    },
    { wait: 0 }
  );

  return {
    set<K extends Key>(key: K, value: T[K]) {
      if (!_engine) {
        return new Error(ErrorMessage.NOT_ENGINE);
      }
      let _value = value;
      if (increments.includes(key)) {
        _value = {
          ...this.get(key),
          ...value,
        };
      }

      if (_engine.supportObject && !secretKey) {
        _engine.setItem(getHashKey(key), _value);
      } else {
        let valueStr = JSON.stringify(_value);
        if (secretKey && EncryptFn) {
          valueStr = EncryptFn(valueStr, secretKey);
        }
        _engine.setItem(getHashKey(key), valueStr);
      }

      effectKeys.push(key);
      effectHandler();
    },
    get<K extends Key>(key: K): T[K] {
      if (!_engine) {
        return new Error(ErrorMessage.NOT_ENGINE) as any;
      }
      const _value = _engine.getItem(getHashKey(key));
      if (_value === null || _value === undefined) {
        return initialData[key];
      }
      if (typeof _value === "string") {
        if (secretKey && DecryptFn) {
          try {
            return JSON.parse(DecryptFn(_value, secretKey));
          } catch (error) {
            console.error(key, error);
          }
        }
      }
      try {
        return JSON.parse(_value);
      } catch (error) {
        console.warn(key, error);
      }
      return _value;
    },
    remove(key: Key) {
      if (!_engine) {
        return new Error(ErrorMessage.NOT_ENGINE);
      }
      return _engine.removeItem(getHashKey(key));
    },

    /**
     * @param fn - 订阅函数
     * - 初始化时会执行一次
     * - 使用 `set` 时，内部在更新数据后才触发订阅函数，此时 `get` 会获取最新的数据。
     * - 短时间内多次使用 `set` 时，会触发防抖处理，订阅函数只执行一次。
     * @param keys - 订阅属性
     * - 只有订阅的属性发生了更改才触发执行订阅函数。如果不传入该参数，则所有属性更改都会执行。
     * - 如果传入空数组，则订阅函数只执行一次，并且不会返回 `unsubscribe`
     * @returns function `unsubscribe`
     */
    subscribe<K extends Key>(fn: SubscribeFn, keys?: K[]) {
      try {
        fn();
      } catch (error) {
        console.error(`subscribe error:`, error);
      }

      if (keys?.length === 0) {
        return;
      }
      const id = getOnlyStr(subscribeIds);
      subscribeIds.push(id);
      subscribeMap[id] = {
        fn,
        keys,
      };

      return () => {
        subscribeMap[id] = undefined;
        subscribeIds.splice(subscribeIds.indexOf(id), 1);
      };
    },
  };
}
