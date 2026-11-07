# NeoMacros 编辑器

[NeoMacros](https://github.com/tuanzisama/NeoMacros) mod 的 Web 面板：**按键 / 事件 / 服务** 三类宏的管理与 Monaco 脚本编辑器。

纯静态 SPA、零后端，所有状态来自游戏内 mod 的本地 HTTP 服务（NM1 每请求签名，Ed25519 首选 / ECDSA P-256 回退）。

[English](README.md) | 简体中文

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm stub       # 可选：无游戏环境开发用桩服务（127.0.0.1:9454，真实 NM1 验签；GET /dev/pair-token 签发配对 token）
pnpm build      # 类型检查 + 产物构建
```

## 对接真实 mod

1. 游戏内 `/neomacros editor` 启动服务（未运行自动拉起）并发出深链；
2. 点击聊天栏深链打开面板（`?host=…&view=editor&pair=<token>`）→ 自动连接并配对上线；
3. 手动连接则填服务地址 + token（token 必填，180s 单次，签发新 token 即作废上一个）；
4. 配对为同步单次请求（无长轮询、无 approve），成功即得 `clientId`；私钥存于浏览器 IndexedDB（`extractable=false`），重启免配对；
5. 设备管理：`/neomacros editor devices [revoke <id>]`；被吊销设备的下次请求 401 `unknown device`，面板自动清凭据引导重配对。

## 功能

- **连接与配对**：meta 版本协商、深链引导（query 传参、读后即清、自动配对）、同步配对（token 必填，algo 上送小写 `ed25519`/`ecdsa-p256`）、401 自愈（按服务端 message 分支：unknown device 清凭据重配 / 时钟偏差提示校时）
- **宏管理**：三分类列表、搜索过滤、行内启停（自启意图）、服务启动/停止、重载、删除确认、新建向导
- **编辑器**：Monaco 多标签、`neomacros.d.ts` 全量补全（全局 `neo` + `@neomacros/*` 导入）、Ctrl+S 保存即热重载、`LocatedError` 行列标红、If-Match 乐观并发（409 冲突对比/覆盖/取回）、磁盘外部修改提示
- **日志台**：环形日志回放 + SSE 增量（未接线时 2s 轮询兜底）、级别过滤/搜索/暂停
- **设置**：主题（深色/浅色/跟随系统，内联启蒙无闪烁）、连接管理、本机/服务端设备、编辑器偏好（字号/缩进/换行/minimap/checkJs/自动保存）

## 结构

```
src/api/        NM1 签名、客户端（401 自愈钩子）、端点、IndexedDB 凭据、SSE
src/stores/     connection / macros / editor / logs / workspace / settings
src/monaco/     worker 装配、明暗主题、模型缓存、neomacros.d.ts + 补充声明
src/components/ shell / connect / explorer / editor / logs / settings / ui
dev-stub/       开发桩（仅开发用，可删；不进构建）
docs/           mod-auth-contract.md 鉴权对接契约
```

`neomacros.d.ts` 复制自 mod 仓库 `docs/vitepress/public/`，mod 侧 API 更新后直接替换此文件即可；
`neomacros-supplement.d.ts` 为其引用未声明类型（Callable/Consumer/…/EntitySnapshot）的补充环境声明。

## 契约

鉴权对接契约：`docs/mod-auth-contract.md`（唯一依据）+ `api-docs.json`（端点契约）；两者冲突时以前者为准。
