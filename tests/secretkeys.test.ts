import { describe, it, expect, vi } from "vitest";
import { createAsyncStorage } from "../libs/asyncStorage";
import { createSyncStorage } from "../libs/syncStorage";
import { MD5 } from "../libs/utils/encoding";
import {
  generateSecretKey,
  generateSecretKeys,
  pickActiveKey,
  pickLegacyKey,
} from "../libs/utils/secrets";
import {
  createMockEngine,
  mockEncrypt,
  mockDecrypt,
  unwrapMetadata,
} from "./mock-engine";

/**
 * secretKeys 密钥组功能测试（对应 spec.md「密钥组类型契约」「密钥选择规则」「值序列化与加密」新增 Scenario）
 */

describe("utils — generateSecretKey / generateSecretKeys", () => {
  it("默认生成 32 字节密钥（返回长度为 64 的 hex 字符串）", () => {
    const k = generateSecretKey();
    expect(k).toHaveLength(64);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it("自定义字节数：16 字节 → 32 字符 hex", () => {
    const k = generateSecretKey({ bytes: 16 });
    expect(k).toHaveLength(32);
    expect(k).toMatch(/^[0-9a-f]{32}$/);
  });

  it("批量生成：长度等于 count 且元素互不相同", () => {
    const keys = generateSecretKeys(3);
    expect(keys).toHaveLength(3);
    const unique = new Set(keys);
    expect(unique.size).toBe(3);
  });

  it("随机性：多次调用返回不同值", () => {
    const a = generateSecretKey();
    const b = generateSecretKey();
    expect(a).not.toBe(b);
  });
});

describe("utils — pickActiveKey / pickLegacyKey", () => {
  it("单活跃密钥被选中", () => {
    const picked = pickActiveKey([{ key: "k1" }], 1000);
    expect(picked?.key).toBe("k1");
  });

  it("多活跃取 since 最新", () => {
    const picked = pickActiveKey(
      [
        { key: "k1", since: 500 },
        { key: "k2", since: 800 },
      ],
      1000
    );
    expect(picked?.key).toBe("k2");
  });

  it("多活跃 since 均缺失时取数组最后一项", () => {
    const picked = pickActiveKey([{ key: "k1" }, { key: "k2" }], 1000);
    expect(picked?.key).toBe("k2");
  });

  it("legacy 项不参与活跃选择", () => {
    const picked = pickActiveKey(
      [
        { key: "old", legacy: true },
        { key: "new", since: Date.now() },
      ],
      Date.now() + 1000
    );
    expect(picked?.key).toBe("new");
  });

  it("全部过期 → 返回 null", () => {
    const picked = pickActiveKey([{ key: "k1", expiresAt: 100 }], 200);
    expect(picked).toBeNull();
  });

  it("since 在未来 → 视为未生效，返回 null", () => {
    const picked = pickActiveKey([{ key: "k1", since: 1000 }], 500);
    expect(picked).toBeNull();
  });

  it("secretKeys 空/未配置 → 返回 null", () => {
    expect(pickActiveKey([], 1000)).toBeNull();
    expect(pickActiveKey(undefined, 1000)).toBeNull();
  });

  it("单条 legacy 被 pickLegacyKey 选中", () => {
    const picked = pickLegacyKey([{ key: "old", legacy: true }]);
    expect(picked?.key).toBe("old");
  });

  it("多条 legacy 取 since 最新（缺 since 时取最后一项）", () => {
    const picked = pickLegacyKey([
      { key: "old1", legacy: true, since: 500 },
      { key: "old2", legacy: true, since: 800 },
    ]);
    expect(picked?.key).toBe("old2");
  });

  it("无 legacy 项 → 返回 null", () => {
    expect(pickLegacyKey([{ key: "k1" }])).toBeNull();
    expect(pickLegacyKey([])).toBeNull();
    expect(pickLegacyKey(undefined)).toBeNull();
  });
});

describe("storage-core — secretKeys 写入带 metadata 头（async）", () => {
  it("engine 收到形如 [<hash8>:]<cipher> 的字符串，hash 前缀 = HashFn(key).slice(0,8)", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKeys: [{ key: "k1" }],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS.set("a", "hello");
    const stored = engine.getStore().get("a");
    const parsed = unwrapMetadata(stored);
    expect(parsed).not.toBeNull();
    expect(parsed!.hashPrefix).toBe(MD5("k1").slice(0, 8));
    expect(parsed!.cipher).toBe(mockEncrypt(JSON.stringify("hello"), "k1"));
  });

  it("legacy 项不参与写入（写入用非 legacy 活跃 key）", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKeys: [
          { key: "old", legacy: true },
          { key: "new", since: Date.now() - 1000 },
        ],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS.set("a", "hello");
    const parsed = unwrapMetadata(engine.getStore().get("a"));
    expect(parsed!.hashPrefix).toBe(MD5("new").slice(0, 8));
    expect(parsed!.cipher).toContain("enc[new]:");
  });
});

describe("storage-core — secretKeys 读取按 metadata 头定位密钥（async）", () => {
  it("get 按头 hash 定位到非 legacy 密钥并解密", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKeys: [
          { key: "k1" },
          { key: "k2" },
        ],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS.set("a", "hello");
    await expect(LS.get("a")).resolves.toBe("hello");
  });
});

describe("storage-core — 时间轮换（async）", () => {
  it("新实例（配置了 k2 since:T 且 now>T）新写入用 k2；老 k1 密文仍可读出", async () => {
    const engine = createMockEngine(true);

    // 阶段 1：初始只用 k1，写入数据
    const LS1 = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKeys: [{ key: "k1" }],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS1.set("a", "hello");
    const rawOld = engine.getStore().get("a");
    const parsedOld = unwrapMetadata(rawOld)!;
    expect(parsedOld.hashPrefix).toBe(MD5("k1").slice(0, 8));

    // 阶段 2：k1 过期 + k2 生效（当前时间已过后）
    const past = Date.now() - 10_000;
    const LS2 = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
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
    await expect(LS2.get("a")).resolves.toBe("hello");

    // 新写入使用 k2
    await LS2.set("a", "world");
    const rawNew = engine.getStore().get("a");
    const parsedNew = unwrapMetadata(rawNew)!;
    expect(parsedNew.hashPrefix).toBe(MD5("k2").slice(0, 8));
    expect(parsedNew.cipher).toContain("enc[k2]:");
  });
});

describe("storage-core — legacy 项支持旧密文无 secretKey 可读回（async）", () => {
  it("配置 legacy 项后，无头的老密文可用 legacy key 解密", async () => {
    const engine = createMockEngine(true);
    // 直接通过 engine 存一个 mockEncrypt 写入的"无 metadata 头"老密文
    engine.setItem("a", mockEncrypt(JSON.stringify("old-value"), "oldKey"));

    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKeys: [
          { key: "oldKey", legacy: true },
          { key: "newKey", since: Date.now() },
        ],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await expect(LS.get("a")).resolves.toBe("old-value");
  });

  it("新写入覆盖后升级为带 metadata 头格式", async () => {
    const engine = createMockEngine(true);
    engine.setItem("a", mockEncrypt(JSON.stringify("old"), "oldKey"));

    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKeys: [
          { key: "oldKey", legacy: true },
          { key: "newKey", since: Date.now() },
        ],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS.set("a", "new");
    const stored = engine.getStore().get("a");
    const parsed = unwrapMetadata(stored);
    expect(parsed).not.toBeNull();
    expect(parsed!.hashPrefix).toBe(MD5("newKey").slice(0, 8));
    await expect(LS.get("a")).resolves.toBe("new");
  });

  it("完成迁移后删除 legacy 项：legacy fallback 不再触发，仅 metadata 头路径生效", async () => {
    const engine = createMockEngine(true);
    // 用一个带 metadata 头的密文（模拟迁移完成后的状态）
    engine.setItem("a", `[${MD5("onlyKey").slice(0, 8)}]:${mockEncrypt(JSON.stringify("v"), "onlyKey")}`);

    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKeys: [{ key: "onlyKey" }],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await expect(LS.get("a")).resolves.toBe("v");
  });
});

describe("storage-core — 密钥已下线无法解密时回退（async）", () => {
  it("metadata 头 hash 无匹配、无 legacy、无 secretKey → 回退 JSON.parse，失败则 console.warn 并返回原始字符串", async () => {
    const engine = createMockEngine(true);
    const bad = `[ffffffff]:${mockEncrypt(JSON.stringify("x"), "unknown")}`;
    engine.setItem("a", bad);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKeys: [{ key: "onlyKey" }],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    const result = await LS.get("a");
    // 无法解析 → 返回原始字符串
    expect(result).toBe(bad);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("storage-core — legacy secretKey 单密钥路径 100% 保留（async + sync）", () => {
  it("async：仅配 secretKey（无 secretKeys），set/get 走原路径（无 metadata 头）", async () => {
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
    expect(engine.getStore().get("a")).toBe(
      `enc[123456]:${JSON.stringify("hello")}`
    );
    await expect(LS.get("a")).resolves.toBe("hello");
  });

  it("sync：仅配 secretKey（无 secretKeys），set/get 走原路径", () => {
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
    expect(engine.getStore().get("a")).toBe(
      `enc[123456]:${JSON.stringify("hello")}`
    );
    expect(LS.get("a")).toBe("hello");
  });

  it("async：secretKeys + secretKey 同时配置时，新写入走 secretKeys（优先级）", async () => {
    const engine = createMockEngine(true);
    const LS = createAsyncStorage<{ a: string }, true>(
      { a: "x" },
      [engine],
      {
        secretKey: "legacyKey",
        secretKeys: [{ key: "newKey", since: Date.now() - 1000 }],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    await LS.set("a", "hello");
    const parsed = unwrapMetadata(engine.getStore().get("a"));
    expect(parsed!.hashPrefix).toBe(MD5("newKey").slice(0, 8));
  });
});

describe("storage-core — sync 版本 metadata 头读写对称（sync）", () => {
  it("set 写入带 metadata 头；get 按头定位密钥；legacy fallback 生效", () => {
    const engine = createMockEngine(false);
    const LS = createSyncStorage<{ a: string }>(
      { a: "x" },
      [engine],
      {
        secretKeys: [{ key: "k1" }],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    LS.set("a", "hello");
    const parsed = unwrapMetadata(engine.getStore().get("a"));
    expect(parsed!.hashPrefix).toBe(MD5("k1").slice(0, 8));
    expect(LS.get("a")).toBe("hello");
  });

  it("legacy 项解密无头老密文（sync）", () => {
    const engine = createMockEngine(false);
    engine.setItem("a", mockEncrypt(JSON.stringify("old"), "oldKey"));
    const LS = createSyncStorage<{ a: string }>(
      { a: "x" },
      [engine],
      {
        secretKeys: [{ key: "oldKey", legacy: true }],
        EncryptFn: mockEncrypt,
        DecryptFn: mockDecrypt,
      }
    );
    expect(LS.get("a")).toBe("old");
  });
});
