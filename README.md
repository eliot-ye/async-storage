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
    // 加密密钥，有值则会加密存储
    secretKey: "secret",
    EncryptFn: AESEncrypt,
    DecryptFn: AESDecrypt,

    // 所有 key 使用MD5值
    enableHashKey: true,
  }
);
```

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
