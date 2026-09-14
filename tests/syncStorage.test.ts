import { describe, it, expect, vi } from "vitest";
import { createSyncStorage } from "../libs/syncStorage";
import { ErrorMessage } from "../libs/types";
import { MD5 } from "../libs/utils/encoding";
import { createMockEngine, mockEncrypt, mockDecrypt } from "./mock-engine";

/** 等一 tick 让 debounce(wait:0) 触发订阅回调 */
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe("createSyncStorage — 基本读写", () => {
  it("set 后 get 返回写入值", () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ counter: number }>({ counter: 0 }, [
      engine,
    ]);
    LS.set("counter", 1);
    expect(LS.get("counter")).toBe(1);
  });

  it("engine 无数据时 get 回退到 initialData", () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ counter: number }>({ counter: 42 }, [
      engine,
    ]);
    expect(LS.get("counter")).toBe(42);
  });
});

describe("createSyncStorage — 键哈希", () => {
  it("enableHashKey=true 时 engine 收到的 key 是 MD5(key)", () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ counter: number }>(
      { counter: 0 },
      [engine],
      { enableHashKey: true }
    );
    LS.set("counter", 7);
    const storedKey = engine.getStore().keys().next().value;
    expect(storedKey).toBe(MD5("counter"));
    expect(storedKey).not.toBe("counter");
  });
});

describe("createSyncStorage — 加密/序列化", () => {
  it("secretKey + EncryptFn/DecryptFn：engine 存的是密文，get 返回原值", () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ a: string }>(
      { a: "x" },
      [engine],
      {
        secretKey: "123456",
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    LS.set("a", "hello");
    const storedValue = engine.getStore().get("a");
    expect(storedValue).toBe(`enc[123456]:${JSON.stringify("hello")}`);
    expect(LS.get("a")).toBe("hello");
  });
});

describe("createSyncStorage — 增量合并", () => {
  it("increments 含 key 时 set 合并旧值（对象型 key）", () => {
    const engine = createMockEngine(false);
    // point 字段用可选属性类型，因为 increments 的 set 实际接收部分对象
    // （源码 set<K>(key, value: T[K]) 类型上要求完整对象，但 increments 靠 spread 合并）
    const LS = createSyncStorage<{ point: { x?: number; y?: number } }>(
      { point: { x: 1, y: 2 } },
      [engine],
      { increments: ["point"] }
    );
    LS.set("point", { x: 9 });
    expect(LS.get("point")).toEqual({ x: 9, y: 2 });
    LS.set("point", { y: 5 });
    expect(LS.get("point")).toEqual({ x: 9, y: 5 });
  });
});

describe("createSyncStorage — 订阅与防抖", () => {
  it("subscribe 时 fn 立即执行一次（初始化）", () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ counter: number }>({ counter: 0 }, [
      engine,
    ]);
    const fn = vi.fn();
    LS.subscribe(fn, ["counter"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("多次 set 防抖合并只通知一次", async () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ counter: number }>({ counter: 0 }, [
      engine,
    ]);
    const fn = vi.fn();
    LS.subscribe(fn, ["counter"]);
    fn.mockClear();
    LS.set("counter", 1);
    LS.set("counter", 2);
    await wait();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("subscribe(fn, []) 只执行一次初始化，不返回 unsubscribe（Q7）", async () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ counter: number }>({ counter: 0 }, [
      engine,
    ]);
    const fn = vi.fn();
    const unsub = LS.subscribe(fn, []);
    expect(unsub).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    LS.set("counter", 1);
    await wait();
    expect(fn).toHaveBeenCalledTimes(1); // set 不再触发
  });
});

describe("createSyncStorage — 无 engine 错误处理（quirky）", () => {
  it("set 无 engine 返回 Error 实例（Q4）", () => {
    const LS = createSyncStorage<{ counter: number }>({ counter: 0 }, [
      null,
    ]);
    const result = LS.set("counter", 1);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(ErrorMessage.NOT_ENGINE);
  });

  it("get 无 engine 返回 Error 实例（Q5，非 Promise / 非 throw）", () => {
    const LS = createSyncStorage<{ counter: number }>({ counter: 0 }, [
      null,
    ]);
    // 源码用 `as any` 把 Error 强转成 T[K]，测试侧用 as unknown as Error 还原
    const result = LS.get("counter") as unknown as Error;
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe(ErrorMessage.NOT_ENGINE);
  });

  it("remove 无 engine 返回 Error 实例", () => {
    const LS = createSyncStorage<{ counter: number }>({ counter: 0 }, [
      null,
    ]);
    const result = LS.remove("counter");
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(ErrorMessage.NOT_ENGINE);
  });
});
