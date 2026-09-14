import { describe, it, expect, beforeEach } from "vitest";
import { createAsyncStorage } from "../libs/asyncStorage";
import { createSyncStorage } from "../libs/syncStorage";
import { ELocalStorage } from "../libs/engine/localStorage";
import { mockEncrypt, mockDecrypt } from "./mock-engine";

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
