import type { SecretKeyEntry } from "../types";

export interface GenerateSecretKeyOptions {
  /** 生成的密钥长度（字节），默认 32（256 bit，匹配 AES-256 密钥长度） */
  bytes?: number;
}

/**
 * 生成一个随机十六进制字符串密钥。
 * 底层使用 `crypto.getRandomValues`（Web Crypto API）生成随机字节。
 * 返回值长度为 `bytes * 2`（每字节两位小写十六进制）。
 *
 * 若运行环境未提供 `crypto.getRandomValues`（如老 Node / RN），消费者需自行 polyfill
 * （例如 `react-native-get-random-values`）。
 */
export function generateSecretKey(opts: GenerateSecretKeyOptions = {}): string {
  const bytes = opts.bytes ?? 32;
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error(
      "generateSecretKey requires crypto.getRandomValues; install a polyfill (e.g. react-native-get-random-values) if running on an older environment."
    );
  }
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * 批量生成 `count` 个独立随机密钥。
 */
export function generateSecretKeys(
  count: number,
  opts: GenerateSecretKeyOptions = {}
): string[] {
  return Array.from({ length: count }, () => generateSecretKey(opts));
}

/**
 * 从 `secretKeys` 中选出当前活跃密钥用于新写入。
 *
 * 规则（对应 spec.md「密钥选择规则」）：
 * 1. 空或未配置 → 返回 null（走 legacy 路径或对象直存路径）。
 * 2. 过滤出 `(!since || now >= since) && (!expiresAt || now < expiresAt) && !legacy` 的条目为活跃。
 * 3. 活跃条目为空 → 返回 null。
 * 4. 活跃条目 ≥ 2 → 取 `since` 最大者；`since` 均缺失时取数组中最后一项。
 */
export function pickActiveKey(
  secretKeys: SecretKeyEntry[] | undefined,
  now: number
): SecretKeyEntry | null {
  if (!secretKeys || secretKeys.length === 0) return null;

  const active = secretKeys.filter(
    (e) =>
      !e.legacy &&
      (!e.since || now >= e.since) &&
      (!e.expiresAt || now < e.expiresAt)
  );
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];

  // 多活跃：取 since 最大；since 均缺失时取最后一项
  let best = active[active.length - 1];
  for (const e of active) {
    if ((e.since ?? -Infinity) > (best.since ?? -Infinity)) {
      best = e;
    }
  }
  return best;
}

/**
 * 从 `secretKeys` 中选出 legacy 迁移期密钥。
 *
 * 规则：取 `legacy: true` 的项；多条时取 `since` 最大者，`since` 均缺失时取数组中最后一项
 * （与 pickActiveKey 的 tiebreaker 一致）。对应 spec.md 与 architecture-review 已知问题建议。
 */
export function pickLegacyKey(
  secretKeys: SecretKeyEntry[] | undefined
): SecretKeyEntry | null {
  if (!secretKeys || secretKeys.length === 0) return null;

  const legacy = secretKeys.filter((e) => e.legacy === true);
  if (legacy.length === 0) return null;
  if (legacy.length === 1) return legacy[0];

  let best = legacy[legacy.length - 1];
  for (const e of legacy) {
    if (e.since !== undefined) {
      if (e.since > (best.since ?? -Infinity)) {
        best = e;
      }
    }
  }
  return best;
}

/**
 * 计算 secret 的 metadata hash 前缀（`HashFn(secret).slice(0, 8)`）。
 */
export function hashSecret(secret: string, HashFn: (m: string) => string): string {
  return HashFn(secret).slice(0, 8);
}
