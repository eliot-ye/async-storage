import type { StorageEngine } from "../libs/types";

/** 内存 Map 实现的 StorageEngine，用于注入 storage-core 做单元测试 */
export interface MockEngineOptions {
  /** 是否支持对象直存，默认 false（匹配真实 engine 的默认行为——ELocalStorage/ECookie/EIndexedDB 均未设置 supportObject: true，都走 JSON.stringify 路径） */
  supportObject?: boolean;
}

/** 测试侧访问器：检视 mock engine 内部实际存储的键值 */
export interface MockEngineExtras {
  getStore: () => Map<string, any>;
  keys: () => string[];
}

/**
 * 创建内存 MockEngine。
 * @param isAsync - true 返回 StorageEngine<true>（Promise 版），false 返回 StorageEngine<false>（同步版）
 */
export function createMockEngine<A extends boolean>(
  isAsync: A,
  opts: MockEngineOptions = {}
): StorageEngine<A> & MockEngineExtras {
  const store = new Map<string, any>();
  const supportObject = opts.supportObject ?? false;
  const extras: MockEngineExtras = {
    getStore: () => store,
    keys: () => Array.from(store.keys()),
  };

  if (isAsync) {
    const engine: StorageEngine<true> & MockEngineExtras = {
      supportObject,
      onReady: () => Promise.resolve(),
      setItem: (key, value) => {
        store.set(key, value);
        return Promise.resolve();
      },
      getItem: (key) => {
        return Promise.resolve(store.has(key) ? store.get(key) : null);
      },
      removeItem: (key) => {
        store.delete(key);
        return Promise.resolve();
      },
      ...extras,
    };
    return engine as StorageEngine<A> & MockEngineExtras;
  }

  const engine: StorageEngine<false> & MockEngineExtras = {
    supportObject,
    setItem: (key, value) => {
      store.set(key, value);
    },
    getItem: (key) => {
      return store.has(key) ? store.get(key) : null;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    ...extras,
  };
  return engine as StorageEngine<A> & MockEngineExtras;
}

/** 测试用 EncryptFn：把明文包成 `enc[key]:<明文>` 形态 */
export function mockEncrypt(message: string, key: string): string {
  return `enc[${key}]:${message}`;
}

/** 测试用 DecryptFn：剥掉 `enc[key]:` 前缀；前缀不匹配时抛错（用于验证解密失败回退路径） */
export function mockDecrypt(message: string, key: string): string {
  const prefix = `enc[${key}]:`;
  if (!message.startsWith(prefix)) {
    throw new Error(`mockDecrypt: bad prefix for key ${key}`);
  }
  return message.slice(prefix.length);
}

/**
 * 构建带 metadata 头的密文（对应 v1.6.0 新格式 `[<hash8>:]<cipher>`）。
 *
 * @param hash8 - 8 字符 hash 前缀（通常来自 `HashFn(secret).slice(0, 8)`）
 * @param innerCipher - 内层密文（可以是 mockEncrypt 的返回值）
 */
export function wrapMetadata(
  hash8: string,
  innerCipher: string
): string {
  return `[${hash8}]:${innerCipher}`;
}

/**
 * 解析带 metadata 头的密文；格式不匹配时返回 null。
 * 与 `libs/utils/secrets.ts` 的 `splitMetadataHeader` 语义等价，测试侧独立一份避免"用被测代码测被测代码"。
 */
export function unwrapMetadata(
  raw: string
): { hashPrefix: string; cipher: string } | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("[") || !raw.includes("]:")) return null;
  const sep = raw.indexOf("]:");
  const hashPrefix = raw.slice(1, sep);
  if (hashPrefix.length === 0) return null;
  return { hashPrefix, cipher: raw.slice(sep + 2) };
}

