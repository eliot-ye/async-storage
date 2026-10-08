import { describe, it, expect, beforeEach } from "vitest";
import { createAsyncStorage } from "../libs/asyncStorage";
import { createSyncStorage } from "../libs/syncStorage";
import { ELocalStorage } from "../libs/engine/localStorage";
import { MD5 } from "../libs/utils/encoding";
import { mockEncrypt, mockDecrypt, unwrapMetadata } from "./mock-engine";

/**
 * 系统级验证（td-apply 步骤 6.2，tier-small 冒烟级）
 *
 * 目的：验证 storage-core 与真实 engine（ELocalStorage）的契约边界一致——
 * 即 mock engine（tests/mock-engine.ts）实现的行为与真实 engine 在
 * StorageEngine<false> 契约层面等价。若 mock 与真实 engine 契约漂移，
 * storage-core 的 characterization test 锁定的是"mock 行为"而非"系统行为"。
 *
 * ELocalStorage 依赖全局 localStorage；在 Node 环境下用 Map-backed stub 提供。
 */
function makeLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => void store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("storage-core × ELocalStorage 集成冒烟", () => {
  beforeEach(() => {
    // ELocalStorage 构造时读 window.localStorage（见 libs/engine/localStorage.ts）
    (globalThis as any).window = { localStorage: makeLocalStorageStub() };
    globalThis.localStorage = (globalThis as any).window.localStorage;
  });

  it("同步：createSyncStorage + ELocalStorage 基本读写", () => {
    const engine = ELocalStorage("integSync");
    expect(engine).not.toBeNull();
    const LS = createSyncStorage<{ counter: number }>({ counter: 0 }, [
      engine!,
    ]);
    LS.set("counter", 5);
    expect(LS.get("counter")).toBe(5);
  });

  it("同步：无 secretKey 时 ELocalStorage 收到 JSON 字符串（非对象）", () => {
    const engine = ELocalStorage("integJson");
    const LS = createSyncStorage<{ obj: { a: number } }>(
      { obj: { a: 1 } },
      [engine!]
    );
    LS.set("obj", { a: 9 });
    // ELocalStorage 的 getItem 返回 localStorage 原值
    const raw = engine!.getItem("obj");
    expect(typeof raw).toBe("string");
    expect(JSON.parse(raw)).toEqual({ a: 9 });
  });

  it("异步：createAsyncStorage + ELocalStorage（onReady 立即可用）", async () => {
    const engine = ELocalStorage("integAsync");
    expect(engine).not.toBeNull();
    const LS = createAsyncStorage<{ counter: number }, false>(
      { counter: 0 },
      [engine!]
    );
    await LS.set("counter", 7);
    await expect(LS.get("counter")).resolves.toBe(7);
  });

  it("加密路径：secretKey + EncryptFn/DecryptFn 与真实 engine 配合工作", async () => {
    const engine = ELocalStorage("integEncrypt");
    const LS = createAsyncStorage<{ a: string }, false>(
      { a: "x" },
      [engine!],
      {
        secretKey: "123456",
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS.set("a", "hello");
    // 真实 engine 的 getItem 拿到的是密文字符串
    const raw = engine!.getItem("a");
    expect(raw).toBe(`enc[123456]:${JSON.stringify("hello")}`);
    await expect(LS.get("a")).resolves.toBe("hello");
  });
});

describe("storage-core × ELocalStorage 集成 — secretKeys 密钥组", () => {
  beforeEach(() => {
    (globalThis as any).window = { localStorage: makeLocalStorageStub() };
    globalThis.localStorage = (globalThis as any).window.localStorage;
  });

  it("secretKeys + 真实 engine：新写入带 metadata 头，get 按头定位密钥解回", async () => {
    const engine = ELocalStorage("integSecretKeys");
    const LS = createAsyncStorage<{ a: string }, false>(
      { a: "x" },
      [engine!],
      {
        secretKeys: [{ key: "integK1" }],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS.set("a", "hello");
    const raw = engine!.getItem("a") as string;
    const parsed = unwrapMetadata(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.hashPrefix).toBe(MD5("integK1").slice(0, 8));
    await expect(LS.get("a")).resolves.toBe("hello");
  });

  it("legacy 迁移链路：无头老密文 → legacy 项解密 → 新写入升级为新格式", async () => {
    const engine = ELocalStorage("integMigration");
    // 模拟真实 engine 里已经存在一条老 secretKey 路径写入的无头密文
    engine!.setItem(
      "a",
      mockEncrypt(JSON.stringify("legacy-value"), "oldKey")
    );

    const LS = createAsyncStorage<{ a: string }, false>(
      { a: "x" },
      [engine!],
      {
        secretKeys: [
          { key: "oldKey", legacy: true },
          { key: "newKey", since: Date.now() },
        ],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    // 老密文通过 legacy 项可读回
    await expect(LS.get("a")).resolves.toBe("legacy-value");

    // 新写入升级为新格式
    await LS.set("a", "new-value");
    const rawNew = engine!.getItem("a") as string;
    const parsedNew = unwrapMetadata(rawNew);
    expect(parsedNew!.hashPrefix).toBe(MD5("newKey").slice(0, 8));
    await expect(LS.get("a")).resolves.toBe("new-value");
  });

  it("时间轮换：老 key 过期后新实例用新 key 写入，老密文仍可读", async () => {
    const engine = ELocalStorage("integRotate");

    // 阶段 1：只用 k1 写入
    const LS1 = createAsyncStorage<{ a: string }, false>(
      { a: "x" },
      [engine!],
      {
        secretKeys: [{ key: "k1" }],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS1.set("a", "old");
    await expect(LS1.get("a")).resolves.toBe("old");

    // 阶段 2：k1 过期、k2 生效（模拟时钟推进）
    const past = Date.now() - 10_000;
    const LS2 = createAsyncStorage<{ a: string }, false>(
      { a: "x" },
      [engine!],
      {
        secretKeys: [
          { key: "k1", expiresAt: past },
          { key: "k2", since: past },
        ],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    // 老 k1 密文仍可读出
    await expect(LS2.get("a")).resolves.toBe("old");
    // 新写入用 k2
    await LS2.set("a", "new");
    const rawNew = engine!.getItem("a") as string;
    expect(unwrapMetadata(rawNew)!.hashPrefix).toBe(MD5("k2").slice(0, 8));
    await expect(LS2.get("a")).resolves.toBe("new");
  });
});
