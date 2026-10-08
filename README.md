# async-storage

### 介绍

一个异步 API 的本地存储库

### 安装

```
npm i gpl-async-storage
```

## 使用

```js
import {
  createAsyncStorage,
  EIndexedDB,
  ELocalStorage,
  ECookie,
} from "gpl-async-storage";

const LS = createAsyncStorage(
  {
    counter: 0,
  },
  // 存储引擎会按照顺序依次尝试，直到找到一个可用存储引擎
  // 这里使用了三个存储引擎，优先级依次为：IndexedDB > localStorage > cookie
  [EIndexedDB(), ELocalStorage(), ECookie()]
);

async function getCounter() {
  // 如果存储引擎为异步，则有可能需要等待存储引擎的初始化完成
  await LS.onReady();

  // 获取数据
  const value1 = await LS.get("counter"); // 0
  return value1;
}

async function setCounter() {
  // 如果存储引擎为异步，则有可能需要等待存储引擎的初始化完成
  await LS.onReady();

  // 设置数据
  await LS.set("counter", 2);

  // 获取数据
  const value2 = await LS.get("counter"); // 2
}

async function setCounter() {
  // 如果存储引擎为异步，则有可能需要等待存储引擎的初始化完成
  await LS.onReady();

  // 删除数据
  await LS.remove("counter");
}

LS.onReady().then(()=>{
  // 订阅 counter 数据变更
  LS.subscribe(async () => {
    const counter = await LS.get("counter");
    console.log("subscribe counter:", counter);
  }, ["counter"]);
});
```

### 加密

***注意：从 v1.3.0 开始，不再内置加密模块，需要自行引入***

#### 单密钥（@deprecated，仅兼容旧代码）

```js
import { createAsyncStorage, EIndexedDB } from "gpl-async-storage";
import { AES, enc } from "crypto-js";

function AESEncrypt(message: string, key: string) {
  return AES.encrypt(message, key).toString();
}
function AESDecrypt(message: string, key: string) {
  return AES.decrypt(message, key).toString(enc.Utf8);
}

const LS = createAsyncStorage(
  {
    counter: 0,
  },
  [EIndexedDB()],
  {
    // @deprecated 使用 secretKeys；本版本仍支持
    secretKey: "secret",
    EncryptFn: AESEncrypt,
    DecryptFn: AESDecrypt,

    // 所有 key 使用 MD5 值
    enableHashKey: true,
  }
);
```

> **v2.0.0 起加密契约强化**：`secretKey` 或 `secretKeys` 存在时，`EncryptFn` 与 `DecryptFn` **必须同时提供**，否则工厂函数在初始化阶段立即抛出 `Error(ErrorMessage.MISSING_ENCRYPT_FN)`——避免"配了密钥但没提供加密函数"时**静默以明文落库**。

#### 密钥组（推荐，支持轮换 + 迁移）

v2.0.0 起新增 `secretKeys` 字段：支持多密钥 + 时间窗口（`since` / `expiresAt`）+ 迁移期 `legacy` 标记。写入的密文会带 `[<hash8>:]<cipher>` metadata 头，让"哪把钥匙解的"内嵌在密文里，跨实例、跨页面、跨重启一致。

```js
import {
  createAsyncStorage,
  EIndexedDB,
  generateSecretKey,
  generateSecretKeys,
} from "gpl-async-storage";
import { AES, enc } from "crypto-js";

function AESEncrypt(message: string, key: string) {
  return AES.encrypt(message, key).toString();
}
function AESDecrypt(message: string, key: string) {
  return AES.decrypt(message, key).toString(enc.Utf8);
}

// 首次初始化：生成一把 32 字节（256 bit）随机密钥
const currentKey = generateSecretKey();

const LS = createAsyncStorage(
  {
    counter: 0,
  },
  [EIndexedDB()],
  {
    secretKeys: [{ key: currentKey }],
    EncryptFn: AESEncrypt,
    DecryptFn: AESDecrypt,
    enableHashKey: true,
  }
);
```

**轮换新密钥**（引入 `since`，实例重启后新 `set` 走新密钥；老密文仍可读）：

```js
const rotatedKey = generateSecretKey();
const LS = createAsyncStorage(
  initialData,
  engines,
  {
    secretKeys: [
      { key: currentKey, expiresAt: Date.now() }, // 老 key 停止写入
      { key: rotatedKey, since: Date.now() },       // 新 key 接管
    ],
    EncryptFn: AESEncrypt,
    DecryptFn: AESDecrypt,
  }
);
```

#### 从 `secretKey` 迁移到 `secretKeys`

老代码如果用的是 `secretKey: "xxx"` 且 storage 里已经落了一批无 metadata 头的老密文，可以直接把老密钥标 `legacy: true` 加入 `secretKeys`——读取时自动走 legacy 项解密，写入时用非 legacy 项升级为新格式：

```js
// Step 1: 用 legacy 项兼容老数据
const LS = createAsyncStorage(
  initialData,
  engines,
  {
    secretKeys: [
      { key: "oldKeyFromSecretKey", legacy: true }, // 用于解密老数据
      { key: generateSecretKey(), since: Date.now() }, // 用于新写入
    ],
    EncryptFn: AESEncrypt,
    DecryptFn: AESDecrypt,
  }
);

// Step 2: 观察一段时间，确认老数据已被新 set 覆盖或不再访问
// Step 3: 从 secretKeys 中删除 legacy:true 的项 → 完成迁移
```

#### HashFn 非可逆警告

`HashFn` 默认 `MD5`，v2.0.0 起同时用于两处：

1. **键哈希**（`enableHashKey: true` 时对 key 变换）——现有语义，不变。
2. **secret 哈希**（写入 `[<hash8>:]<cipher>` metadata 头时，取 `HashFn(secret).slice(0, 8)`）——新语义。

若自定义 `HashFn`，**必须保证非可逆**（例如仍是 MD5 / SHA256 之类的单向哈希），否则 secret 会通过 metadata 头泄露。切勿用可逆函数（如 `toUpperCase` / 简单前缀拼接）作为 `HashFn`。

#### React Native 环境

`generateSecretKey` / `generateSecretKeys` 底层使用 `crypto.getRandomValues`（Web Crypto API）。若运行环境未提供（老 Node / React Native），请先安装 `react-native-get-random-values` 或类似 polyfill：

```bash
npm i react-native-get-random-values
```

```js
import "react-native-get-random-values";
import { generateSecretKey } from "gpl-async-storage";
```


### 发布流程

本库从 `dist/` 目录执行 npm publish（见 `.github/workflows/npm-publish-github-packages.yml` 的 `cd dist && npm publish`）。因此 `package.json` 的 `files` 字段（当前为 `["*"]`）对实际发布产物是空操作——`dist/` 内的所有文件都会被打进 npm 包。若需要收紧发布内容，请修改 `vite.config.ts` 的 `build.lib.entry` 与 `closeBundle` 复制步骤，而不是修改 `files` 字段。


### 自定义存储引擎

自定义存储引擎需要实现 `StorageEngine` 接口

```ts
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
```

例如：ELocalStorage 的实现如下

```ts
import type { StorageEngine } from "gpl-async-storage";

export function ELocalStorage(name = "LS") {
  let ready = false;
  try {
    const testString = "test";
    localStorage.setItem(testString, testString);
    const test = localStorage.getItem(testString);
    if (test === testString) {
      ready = true;
    }
  } catch (error) {
    CusLog.error("ELocalStorage", "unready", error);
  }

  if (!ready) {
    return null;
  }

  const storageEngine: StorageEngine<false> = {
    getItem(key) {
      return localStorage.getItem(`${name}_${key}`);
    },
    setItem(key, value) {
      return localStorage.setItem(`${name}_${key}`, value);
    },
    removeItem(key) {
      return localStorage.removeItem(`${name}_${key}`);
    },
  };

  return storageEngine;
}
```

由于浏览器的 `localStorage` (`Storage`) API 天然符合 `StorageEngine` 接口，所以在不考虑兼容性的情况下，可以直接使用 `localStorage` 作为存储引擎。如下：

```js
import { createAsyncStorage } from "gpl-async-storage";

const LS = createAsyncStorage(
  {
    counter: 0,
  },
  [localStorage]
);
```

### react-native

在 react-native 中可直接使用 `@react-native-async-storage/async-storage` 库作为存储引擎。

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStorage } from "gpl-async-storage";
import {useEffect, useState} from 'react';

const initialData = {
  counter: 0,
}

export const LS = createAsyncStorage(
  initialData,
  [AsyncStorage]
);

// 封装 react hooks 可实现使用 LS.set 更新数据时，hook 值实时更新
export function useAsyncStorage<K extends keyof typeof initialData>(key: K) {
  const [state, setState] = useState(initialData[key]);

  useEffect(() => {
    return LS.subscribe(async () => {
      await LS.onReady();
      const value = await LS.get(key);
      setState(value);
    }, [key]);
  }, [key]);

  return state;
}
```
