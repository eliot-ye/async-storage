import {
  type StorageEngine,
  type Option,
  type SubscribeFn,
  type JSONConstraint,
  type SecretKeyEntry,
  ErrorMessage,
} from "./types";
import { MD5 } from "./utils/encoding";
import { debounce, getOnlyStr } from "./utils/tools";
import { pickActiveKey, pickLegacyKey, hashSecret } from "./utils/secrets";

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

  // 加密契约校验（v1.6.0 起强制）：与 createAsyncStorage 对称。
  const hasSecretConfigured =
    option.secretKey != null ||
    (Array.isArray(option.secretKeys) && option.secretKeys.length > 0);
  if (
    hasSecretConfigured &&
    (!option.EncryptFn || !option.DecryptFn)
  ) {
    throw new Error(ErrorMessage.MISSING_ENCRYPT_FN);
  }

  const _engines = engines.filter((e) => e !== null);
  const _engine =
    typeof _engines[0] === "function" ? _engines[0]() : _engines[0];

  const {
    secretKey,
    secretKeys,
    enableHashKey,
    EncryptFn,
    DecryptFn,
    HashFn = MD5,
    increments = [],
  } = option;

  // 实例化时锁定当前活跃密钥
  const activeKeyEntry: SecretKeyEntry | null = pickActiveKey(
    secretKeys,
    Date.now()
  );

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

  function tryDecrypt(raw: string, key: string): T[Key] | null {
    try {
      return JSON.parse(DecryptFn!(raw, key));
    } catch (error) {
      console.error(key, error);
      return null;
    }
  }

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

      if (_engine.supportObject && !secretKey && !activeKeyEntry) {
        _engine.setItem(getHashKey(key), _value);
      } else if (activeKeyEntry && EncryptFn) {
        const cipher = EncryptFn(JSON.stringify(_value), activeKeyEntry.key);
        const hashPrefix = hashSecret(activeKeyEntry.key, HashFn);
        _engine.setItem(getHashKey(key), `[${hashPrefix}]:${cipher}`);
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
      if (typeof _value !== "string") {
        return _value;
      }

      if (_value.startsWith("[") && _value.includes("]:") && DecryptFn) {
        const sep = _value.indexOf("]:");
        const hashPrefix = _value.slice(1, sep);
        const cipher = _value.slice(sep + 2);
        const matched = secretKeys?.find(
          (e) =>
            !e.legacy && hashSecret(e.key, HashFn) === hashPrefix
        );
        if (matched) {
          const decoded = tryDecrypt(cipher, matched.key);
          if (decoded !== null) return decoded;
        }
      }

      if (secretKeys && DecryptFn) {
        const legacyEntry = pickLegacyKey(secretKeys);
        if (legacyEntry) {
          const decoded = tryDecrypt(_value, legacyEntry.key);
          if (decoded !== null) return decoded;
        }
      }

      if (secretKey && DecryptFn) {
        const decoded = tryDecrypt(_value, secretKey);
        if (decoded !== null) return decoded;
      }

      try {
        return JSON.parse(_value);
      } catch (error) {
        console.warn(key, error);
      }
      return _value as any;
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
