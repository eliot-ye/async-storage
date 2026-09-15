import { describe, it, expect } from "vitest";
import { createAsyncStorage } from "../libs/asyncStorage";
import { createSyncStorage } from "../libs/syncStorage";
import { ErrorMessage } from "../libs/types";
import { createMockEngine, mockEncrypt, mockDecrypt } from "./mock-engine";

/**
 * 加密契约校验（v2.0.0 起强制）
 *
 * 场景覆盖（tasks.md 3.6）：
 * 1. secretKey 存在、缺 EncryptFn → throw MISSING_ENCRYPT_FN
 * 2. secretKey 存在、缺 DecryptFn → throw MISSING_ENCRYPT_FN
 * 3. secretKeys 非空、缺 EncryptFn → throw MISSING_ENCRYPT_FN
 * 4. 两者都未配置 → 工厂正常返回实例
 *
 * 每个场景各测异步 + 同步两个版本（共 8 个 it）。
 */

describe("createAsyncStorage — 加密契约校验", () => {
  it("secretKey 存在、缺 EncryptFn → 抛 MISSING_ENCRYPT_FN", () => {
    const engine = createMockEngine(true);
    expect(() =>
      createAsyncStorage<{ a: string }, true>(
        { a: "x" },
        [engine],
        { secretKey: "k", DecryptFn: mockDecrypt }
      )
    ).toThrow(ErrorMessage.MISSING_ENCRYPT_FN);
  });

  it("secretKey 存在、缺 DecryptFn → 抛 MISSING_ENCRYPT_FN", () => {
    const engine = createMockEngine(true);
    expect(() =>
      createAsyncStorage<{ a: string }, true>(
        { a: "x" },
        [engine],
        { secretKey: "k", EncryptFn: mockEncrypt }
      )
    ).toThrow(ErrorMessage.MISSING_ENCRYPT_FN);
  });

  it("secretKeys 非空、缺 EncryptFn → 抛 MISSING_ENCRYPT_FN", () => {
    const engine = createMockEngine(true);
    expect(() =>
      createAsyncStorage<{ a: string }, true>(
        { a: "x" },
        [engine],
        { secretKeys: [{ key: "k" }], DecryptFn: mockDecrypt }
      )
    ).toThrow(ErrorMessage.MISSING_ENCRYPT_FN);
  });

  it("secretKeys 非空、缺 DecryptFn → 抛 MISSING_ENCRYPT_FN", () => {
    const engine = createMockEngine(true);
    expect(() =>
      createAsyncStorage<{ a: string }, true>(
        { a: "x" },
        [engine],
        { secretKeys: [{ key: "k" }], EncryptFn: mockEncrypt }
      )
    ).toThrow(ErrorMessage.MISSING_ENCRYPT_FN);
  });

  it("两者都未配置 → 工厂正常返回实例（走明文路径）", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: string }, true>({ a: "x" }, [engine]);
    await LS.set("a", "hello");
    await expect(LS.get("a")).resolves.toBe("hello");
  });

  it("secretKeys 空数组 → 视为未配置，工厂正常返回实例", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      { secretKeys: [] }
    );
    await LS.set("a", "hello");
    await expect(LS.get("a")).resolves.toBe("hello");
  });
});

describe("createSyncStorage — 加密契约校验", () => {
  it("secretKey 存在、缺 EncryptFn → 抛 MISSING_ENCRYPT_FN", () => {
    const engine = createMockEngine(false);
    expect(() =>
      createSyncStorage<{ a: string }>({ a: "x" }, [engine], {
        secretKey: "k",
        DecryptFn: mockDecrypt,
      })
    ).toThrow(ErrorMessage.MISSING_ENCRYPT_FN);
  });

  it("secretKey 存在、缺 DecryptFn → 抛 MISSING_ENCRYPT_FN", () => {
    const engine = createMockEngine(false);
    expect(() =>
      createSyncStorage<{ a: string }>({ a: "x" }, [engine], {
        secretKey: "k",
        EncryptFn: mockEncrypt,
      })
    ).toThrow(ErrorMessage.MISSING_ENCRYPT_FN);
  });

  it("secretKeys 非空、缺 EncryptFn → 抛 MISSING_ENCRYPT_FN", () => {
    const engine = createMockEngine(false);
    expect(() =>
      createSyncStorage<{ a: string }>({ a: "x" }, [engine], {
        secretKeys: [{ key: "k" }],
        DecryptFn: mockDecrypt,
      })
    ).toThrow(ErrorMessage.MISSING_ENCRYPT_FN);
  });

  it("secretKeys 非空、缺 DecryptFn → 抛 MISSING_ENCRYPT_FN", () => {
    const engine = createMockEngine(false);
    expect(() =>
      createSyncStorage<{ a: string }>({ a: "x" }, [engine], {
        secretKeys: [{ key: "k" }],
        EncryptFn: mockEncrypt,
      })
    ).toThrow(ErrorMessage.MISSING_ENCRYPT_FN);
  });

  it("两者都未配置 → 工厂正常返回实例（走明文路径）", () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ a: string }>({ a: "x" }, [engine]);
    LS.set("a", "hello");
    expect(LS.get("a")).toBe("hello");
  });

  it("secretKeys 空数组 → 视为未配置，工厂正常返回实例", () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ a: string }>(
      { a: "x" },
      [engine],
      { secretKeys: [] }
    );
    LS.set("a", "hello");
    expect(LS.get("a")).toBe("hello");
  });
});
