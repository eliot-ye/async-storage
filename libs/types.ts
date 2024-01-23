export type JSONConstraint = Record<string, any>;

export type SubscribeFn = () => void;

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

export interface Option<T> {
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
