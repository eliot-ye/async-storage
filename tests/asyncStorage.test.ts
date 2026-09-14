import { describe, it, expect, vi } from "vitest";
import { createAsyncStorage } from "../libs/asyncStorage";
import { ErrorMessage } from "../libs/types";
import { MD5 } from "../libs/utils/encoding";
import { createMockEngine, mockEncrypt, mockDecrypt } from "./mock-engine";

/** 等一 tick 让 debounce(wait:0) 触发订阅回调 */
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe("createAsyncStorage — 基本读写", () => {
  it("set 后 get 返回写入值", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [engine]
    );
    await LS.set("counter", 1);
    await expect(LS.get("counter")).resolves.toBe(1);
  });

  it("engine 无数据时 get 回退到 initialData", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 42 },
      [engine]
    );
    await expect(LS.get("counter")).resolves.toBe(42);
  });
});

describe("createAsyncStorage — 键哈希", () => {
  it("enableHashKey=true 时 engine 收到的 key 是 MD5(key)", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [engine],
      { enableHashKey: true }
    );
    await LS.set("counter", 7);
    const storedKey = engine.getStore().keys().next().value;
    expect(storedKey).toBe(MD5("counter"));
    expect(storedKey).not.toBe("counter");
  });

  it("enableHashKey=false（默认）时 engine 收到原始 key", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [engine]
    );
    await LS.set("counter", 7);
    expect(engine.getStore().has("counter")).toBe(true);
  });
});

describe("createAsyncStorage — 加密/序列化", () => {
  it("secretKey + EncryptFn/DecryptFn：engine 存的是密文，get 返回原值", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKey: "123456",
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS.set("a", "hello");
    const storedValue = engine.getStore().get("a");
    // engine 实际存储的是加密后的字符串
    expect(storedValue).toBe(`enc[123456]:${JSON.stringify("hello")}`);
    expect(typeof storedValue).toBe("string");
    // get 返回解密后的原值
    await expect(LS.get("a")).resolves.toBe("hello");
  });

  it("supportObject=false 时 engine 收到 JSON 字符串（即使 supportObject 默认 true 的 mock 里也走 JSON 路径）", async () => {
    const engine = createMockEngine(true, { supportObject: false });
    const LS = createAsyncStorage<{ obj: { a: number } }, true>(
      { obj: { a: 1 } },
      [engine]
    );
    await LS.set("obj", { a: 9 });
    const storedValue = engine.getStore().get("obj");
    expect(typeof storedValue).toBe("string");
    expect(JSON.parse(storedValue)).toEqual({ a: 9 });
  });
});

describe("createAsyncStorage — 增量合并", () => {
  it("increments 含 key 时 set 合并旧值（对象型 key）", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ point: { x?: number; y?: number } }, true>(
      { point: { x: 1, y: 2 } },
      [engine],
      { increments: ["point"] }
    );
    // 首次 set：旧值为 initialData 的 {x:1,y:2}，与新值 {x:9} 合并为 {x:9,y:2}
    await LS.set("point", { x: 9 });
    await expect(LS.get("point")).resolves.toEqual({ x: 9, y: 2 });
    // 第二次 set：旧值 {x:9,y:2} 与新值 {y:5} 合并为 {x:9,y:5}
    await LS.set("point", { y: 5 });
    await expect(LS.get("point")).resolves.toEqual({ x: 9, y: 5 });
  });
});

describe("createAsyncStorage — 订阅与防抖", () => {
  it("subscribe 时 fn 立即执行一次（初始化）", () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [engine]
    );
    const fn = vi.fn();
    LS.subscribe(fn, ["counter"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("多次 set 防抖合并只通知一次", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [engine]
    );
    const fn = vi.fn();
    LS.subscribe(fn, ["counter"]);
    fn.mockClear();
    await LS.set("counter", 1);
    await LS.set("counter", 2);
    await wait();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("subscribe(fn, []) 只执行一次初始化，不返回 unsubscribe（Q7）", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [engine]
    );
    const fn = vi.fn();
    const unsub = LS.subscribe(fn, []);
    expect(unsub).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    await LS.set("counter", 1);
    await wait();
    expect(fn).toHaveBeenCalledTimes(1); // set 不再触发
  });

  // 并发 set 各自 key 都被通知（对应 spec 新 Scenario）
  it("并发 set 不同 key 各自订阅都被通知（防抖窗口清空不影响匹配）", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: number; b: number }, true>(
      { a: 0, b: 0 },
      [engine]
    );
    const fnA = vi.fn();
    const fnB = vi.fn();
    LS.subscribe(fnA, ["a"]);
    LS.subscribe(fnB, ["b"]);
    fnA.mockClear();
    fnB.mockClear();
    // 同一微任务批次内并发 set——两个 await setItem 都进入 promise 队列
    await Promise.all([LS.set("a", 1), LS.set("b", 2)]);
    await wait();
    // 各自 key 都被通知——订阅匹配不丢失
    expect(fnA).toHaveBeenCalled();
    expect(fnB).toHaveBeenCalled();
  });

  // 连续快速 set 同一 key 不丢通知（对应既有 Scenario "多次 set 合并" 的断言补强）
  it("连续快速 set 同一 key 防抖合并后订阅仍被调用", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [engine]
    );
    const fn = vi.fn();
    LS.subscribe(fn, ["counter"]);
    fn.mockClear();
    LS.set("counter", 1);
    LS.set("counter", 2);
    await wait();
    // 合并后只通知一次，但订阅函数确被调用
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // 跨防抖批次 set 匹配独立（对应 spec 新 Scenario）
  it("跨防抖批次 set：上一批 effectKeys 清空不影响后续 set 匹配", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: number; b: number }, true>(
      { a: 0, b: 0 },
      [engine]
    );
    const fnA = vi.fn();
    const fnB = vi.fn();
    LS.subscribe(fnA, ["a"]);
    LS.subscribe(fnB, ["b"]);
    fnA.mockClear();
    fnB.mockClear();
    // 第一批：set("a", ...) 后等 timer 触发，effectKeys 被清空
    await LS.set("a", 1);
    await wait();
    expect(fnA).toHaveBeenCalled();
    expect(fnB).not.toHaveBeenCalled();
    fnA.mockClear();
    fnB.mockClear();
    // 第二批：effectKeys 已清空，set("b", ...) 的 key 匹配不受上一批影响
    await LS.set("b", 2);
    await wait();
    expect(fnB).toHaveBeenCalled();
  });
});

describe("createAsyncStorage — 无 engine 错误处理（quirky）", () => {
  it("set 无 engine 返回 Error 实例（Q1，非 throw / 非 reject）", async () => {
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [null]
    );
    const result = await LS.set("counter", 1);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(ErrorMessage.NOT_ENGINE);
  });

  it("get 无 engine Promise.reject（Q2）", async () => {
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [null]
    );
    await expect(LS.get("counter")).rejects.toThrow(ErrorMessage.NOT_ENGINE);
  });

  it("remove 无 engine Promise.reject（Q3）", async () => {
    const LS = createAsyncStorage<{ counter: number }, true>(
      { counter: 0 },
      [null]
    );
    await expect(LS.remove("counter")).rejects.toThrow(ErrorMessage.NOT_ENGINE);
  });
});

describe("createAsyncStorage — 解密失败回退（quirky）", () => {
  it("DecryptFn 失败后回退 JSON.parse(密文)，失败后 console.warn 并返回原始密文（Q6）", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKey: "123456",
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    // 直接通过 engine 存一个不匹配 mockDecrypt 前缀的"坏密文"
    engine.setItem("a", "not-a-valid-cipher");

    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await LS.get("a");
    expect(result).toBe("not-a-valid-cipher");
    // DecryptFn 抛错 → console.error
    expect(errorSpy).toHaveBeenCalled();
    // JSON.parse(密文) 失败 → console.warn
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
