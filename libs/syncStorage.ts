import {
  type StorageEngine,
  type Option,
  type SubscribeFn,
  type JSONConstraint,
  ErrorMessage,
} from "./types";
import { MD5 } from "./utils/encoding";
import { debounce, getOnlyStr } from "./utils/tools";

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
