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

export function createAsyncStorage<T extends JSONConstraint, B extends boolean>(
  initialData: T,
  engines: (StorageEngine<B> | (() => StorageEngine<B> | null) | null)[],
  option: Option<T> = {}
) {
  type Key = keyof T;

  // 加密契约校验（v1.6.0 起强制）：配了密钥就必须同时提供 EncryptFn/DecryptFn，
  // 否则立即拒绝创建实例——避免"配了 secretKey 但没提供加密函数"时静默明文落库。
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
    secretKeys,
    enableHashKey,
    EncryptFn,
    DecryptFn,
    HashFn = MD5,
    increments = [],
  } = option;

  // 实例化时锁定当前活跃密钥（同实例生命周期内 set 用同一密钥，密文格式稳定）
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

  /**
   * 尝试用给定 key 解密 raw 字符串并 JSON.parse；成功返回解析值，失败返回 null。
   * DecryptFn 抛错时 console.error（沿用现有回退行为）。
   */
  function tryDecrypt(
    raw: string,
    key: string
  ): T[Key] | null {
    try {
      return JSON.parse(DecryptFn!(raw, key));
    } catch (error) {
      console.error(key, error);
      return null;
    }
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
        return new Error(ErrorMessage.NOT_ENGINE);
      }
      let _value = value;
      if (increments.includes(key)) {
        _value = {
          ...(await this.get(key)),
          ...value,
        };
      }

      if (_engine.supportObject && !secretKey && !activeKeyEntry) {
        // 无加密配置 → 对象直存
        await _engine.setItem(getHashKey(key), _value);
      } else if (activeKeyEntry && EncryptFn) {
        // 有活跃密钥组 → 带 metadata 头写入
        const cipher = EncryptFn(JSON.stringify(_value), activeKeyEntry.key);
        const hashPrefix = hashSecret(activeKeyEntry.key, HashFn);
        await _engine.setItem(
          getHashKey(key),
          `[${hashPrefix}]:${cipher}`
        );
      } else {
        // legacy 单密钥路径（secretKey 存在但无活跃 secretKeys，或无 secretKey 但 supportObject=false）
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
      if (typeof _value !== "string") {
        // supportObject 直存路径
        return _value;
      }

      // 新格式 metadata 头：尝试按 hash 前缀定位非 legacy 密钥
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

      // legacy 迁移期：用 legacy 项解密（老 secretKey 路径写入的无 metadata 头密文）
      if (secretKeys && DecryptFn) {
        const legacyEntry = pickLegacyKey(secretKeys);
        if (legacyEntry) {
          const decoded = tryDecrypt(_value, legacyEntry.key);
          if (decoded !== null) return decoded;
        }
      }

      // secretKey 兜底（@deprecated 路径）
      if (secretKey && DecryptFn) {
        const decoded = tryDecrypt(_value, secretKey);
        if (decoded !== null) return decoded;
      }

      // 最终回退：JSON.parse（沿用现有 quirky 行为）
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
