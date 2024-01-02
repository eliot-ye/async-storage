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

// 保存数据
LS.set("counter", 2);

// 获取数据
LS.get("counter").then((value) => {
  // value = 2
});
async function getCounter() {
  const value = await LS.get("counter");
  // value = 2
}

// 删除数据
LS.remove("key");

// 如果存储引擎为异步，则有可能需要等待存储引擎的初始化完成
LS.ready().then(async () => {
  // 存储引擎初始化已完成
  const value = await LS.get("counter");
  // value = 2
});
```

### 加密

```js
import { createAsyncStorage, EIndexedDB } from "gpl-async-storage";

const LS = createAsyncStorage(
  {
    counter: 0,
  },
  [EIndexedDB()],
  {
    // 加密密钥，有值则会加密存储
    secretKey: "secret",
  }
);
```

### 自定义存储引擎

自定义存储引擎需要实现 `StorageEngine` 接口

```ts
interface StorageEngine {
  setItem: (key: string, value: string) => Promise<void> | void;
  getItem: (
    key: string
  ) => Promise<string | null | undefined> | string | null | undefined;
  removeItem: (key: string) => Promise<void> | void;
  onReady?: () => Promise<void>;
}
```

例如：ELocalStorage 的实现如下

```ts
import type { StorageEngine } from "gpl-async-storage";

export function ELocalStorage(name = "LS"): StorageEngine | null {
  let ready = false;
  try {
    const testString = "test";
    localStorage.setItem(testString, testString);
    const test = localStorage.getItem(testString);
    if (test === testString) {
      ready = true;
    }
  } catch (error) {
    console.error("ELocalStorage", "unready", error);
  }

  if (!ready) {
    return null;
  }

  return {
    async getItem(key: string) {
      return localStorage.getItem(`${name}_${key}`);
    },
    async setItem(key: string, value: string) {
      return localStorage.setItem(`${name}_${key}`, value);
    },
    async removeItem(key: string) {
      return localStorage.removeItem(`${name}_${key}`);
    },
  };
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

在 react-native 中使用 async-storage，可直接使用 `@react-native-async-storage/async-storage` 库作为存储引擎。

```js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStorage } from "gpl-async-storage";

const LS = createAsyncStorage(
  {
    counter: 0,
  },
  [AsyncStorage]
);
```
