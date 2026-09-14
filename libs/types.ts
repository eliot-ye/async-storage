export type JSONConstraint = Record<string, any>;

export type SubscribeFn = () => void;

export interface StorageEngine<IsAsync extends boolean> {
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
  onReady?: IsAsync extends true ? () => Promise<void> : undefined | null;
}

export interface SecretKeyEntry {
  /** 密钥原文，消费者持有 */
  key: string;
  /** 生效时间（Unix 毫秒时间戳），默认视为一直有效 */
  since?: number;
  /** 失效时间（Unix 毫秒时间戳），到期后不再用于新写入；到期前的密文仍可解 */
  expiresAt?: number;
  /** 标记为旧 secretKey 的迁移期密钥；读取无 metadata 头的老密文时按此项解密 */
  legacy?: true;
}

export interface Option<T> {
  /** @deprecated 使用 `secretKeys`；本版本仍支持，作为一次性迁入的便利入口。下一个 major 版本将移除。 */
  secretKey?: string;
  /** 密钥组：支持多密钥 + 时间窗口 + 迁移期 legacy 标记 */
  secretKeys?: SecretKeyEntry[];
  EncryptFn?: (message: string, key: string) => string;
  DecryptFn?: (message: string, key: string) => string;
  /** 是否开启 key 加密，如果开启，所有 key 都会使用MD5值 */
  enableHashKey?: boolean;
  HashFn?: (message: string) => string;
  increments?: (keyof T)[];
}

export enum ErrorMessage {
  NOT_ENGINE = "No storage engine",
  MISSING_ENCRYPT_FN =
    "secretKey is provided but EncryptFn/DecryptFn is missing; refusing to store plaintext under a secret-key path",
}
