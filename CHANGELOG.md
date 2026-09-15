# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-09-14

### Breaking Changes

- `createSyncStorage.get()` 在无 engine 时改为 **抛出** `Error(ErrorMessage.NOT_ENGINE)`——与异步版本 `get()` 的 `Promise.reject` 语义对称。下游需 `try/catch` 捕获。
  - 影响面：仅同步版本 `get`；`createSyncStorage.set()` / `remove()` 仍返回 Error 实例（保持对称的不对称，破坏面最小）。
  - 类型声明 `get<K>(key: K): T[K]` **未变**（不再需要 `as any`）。
- 加密契约强化：`secretKey` 或 `secretKeys` 存在时，`EncryptFn` 与 `DecryptFn` **必须同时提供**，否则工厂函数在初始化阶段立即 throw `Error(ErrorMessage.MISSING_ENCRYPT_FN)`——避免"配了密钥但没提供加密函数"时静默明文落库。
- `Option.HashFn` 语义扩展：除键哈希外，同时用于计算 secret 的 metadata hash 前缀（写入 `[<hash8>:]<cipher>` 密文头）。自定义 `HashFn` 必须保证非可逆，否则 secret 会泄露到密文头。

### Added

- `Option.secretKeys?: SecretKeyEntry[]` 密钥组配置，支持多密钥 + 时间窗口（`since` / `expiresAt`）+ 迁移期 `legacy: true` 标记；写入的密文带 `[<hash8>:]<cipher>` metadata 头，跨实例、跨页面、跨重启一致。
- `generateSecretKey()` / `generateSecretKeys(count, opts)` 工具函数（基于 `crypto.getRandomValues`，库不偷偷在初始化时生成）。
- 新增 GitHub Actions CI 冒烟 workflow（push / PR 触发 `npm ci → build → test → pack --dry-run`）。

### Changed

- `Option.secretKey` 标记 `@deprecated`——本版本仍完整支持，下个 major 移除。
- `README.md` 加密章节重写：新增密钥组用法、legacy 迁移指南、HashFn 非可逆警告、React Native polyfill 提示。

### Documentation

- 新增 `CHANGELOG.md`（本文件）。
- `README.md` 补充 publish 流程说明（说明发布从 `dist/` 目录执行）。
