# NeoMacros Editor

Web panel for the [NeoMacros](https://github.com/tuanzisama/NeoMacros) mod: manage **keybind / event / server** macros with a Monaco-based script editor.

Pure static SPA, zero backend — all state comes from the mod's local HTTP service in-game (NM1 per-request signatures, Ed25519 preferred / ECDSA P-256 fallback).

English | [简体中文](README.zh-CN.md)

## Quick Start

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm stub       # optional: stub service for dev without the game (127.0.0.1:9454, real NM1 verification; GET /dev/pair-token issues a pairing token)
pnpm build      # type check + production build
```

## Connecting to the Mod

1. Run `/neomacros editor` in-game (auto-starts the service) and click the deep link in chat;
2. The panel opens via `?host=…&view=editor&pair=<token>` and connects / pairs automatically;
3. Manual connection: enter the service address + token (token required, single-use for 180s; issuing a new one revokes the previous);
4. Pairing is a single synchronous request (no long-polling, no approve step); success yields a `clientId`. The private key lives in browser IndexedDB (`extractable=false`), so restarts skip re-pairing;
5. Device management: `/neomacros editor devices [revoke <id>]`. A revoked device gets `401 unknown device` on its next request; the panel clears credentials and guides re-pairing.

## Features

- **Connection & pairing**: meta version negotiation, deep-link bootstrap (query params, cleared after read, auto-pairing), synchronous pairing (token required, lowercase `ed25519` / `ecdsa-p256` reported), 401 self-healing (per server message: unknown device → clear credentials and re-pair; clock skew → time-sync hint)
- **Macro management**: three category lists, search & filter, inline enable/disable (autostart intent), service start/stop, reload, delete confirmation, creation wizard
- **Editor**: Monaco multi-tab, full completion from `neomacros.d.ts` (global `neo` + `@neomacros/*` imports), Ctrl+S saves and hot-reloads, `LocatedError` squiggles with line/column, If-Match optimistic concurrency (409 → compare / overwrite / revert), external disk-change notice
- **Logs**: ring-buffer replay + SSE increments (2s polling fallback), level filter / search / pause
- **Settings**: theme (dark / light / system, inline bootstrap without flash), connection management, local & server devices, editor preferences (font size / indent / wrap / minimap / checkJs / auto-save)

## Structure

```
src/api/        NM1 signing, client (401 self-heal hooks), endpoints, IndexedDB credentials, SSE
src/stores/     connection / macros / editor / logs / workspace / settings
src/monaco/     worker setup, light/dark themes, model cache, neomacros.d.ts + supplements
src/components/ shell / connect / explorer / editor / logs / settings / ui
dev-stub/       dev-only stub (safe to delete; excluded from build)
docs/           mod-auth-contract.md — auth integration contract
```

`neomacros.d.ts` is copied from the mod repo's `docs/vitepress/public/`; after a mod-side API update, just replace the file. `neomacros-supplement.d.ts` provides ambient declarations for types it references (Callable / Consumer / … / EntitySnapshot).

## Contract

Auth integration contract: `docs/mod-auth-contract.md` (single source of truth) + `api-docs.json` (endpoint contract); when they conflict, the former wins.
