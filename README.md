# mcp-self-reload

Zero-downtime code rolls for bun-based MCP plugins.

> Part of [The Agent Crafting Table](https://github.com/Agent-Crafting-Table) — standalone Claude Code agent components.

## The Problem

When Claude Code starts an MCP plugin (`bun server.ts`), it owns the process. If the plugin exits to reload new code, Claude Code's MCP supervisor is supposed to restart it — but the supervisor is unreliable. It can take minutes to restart, or silently fail, leaving the plugin dead with no Discord messages getting through.

## How This Solves It

Instead of exiting and hoping the supervisor restarts, `mcp-self-reload` spawns the replacement bun process with inherited stdin/stdout **before** exiting. The MCP pipe to Claude Code stays live throughout the handoff — Claude Code never sees a disconnect.

```
File changes on disk
        ↓
watchSelf() detects new mtime
        ↓
spawn: bun server.ts (inherits same stdin/stdout)  ← new process, same pipe
        ↓
wait 500ms for replacement to start
        ↓
exit(0)  ← old process gone, new process handling requests
```

## Usage

```typescript
import { watchSelf, isReload } from 'mcp-self-reload/src/watch.ts'

// ... set up your MCP server ...

// At the end of setup, start watching
watchSelf({
  intervalMs: 30_000,     // check every 30s (default)
  handoffDelayMs: 500,    // wait 500ms after spawn before exiting (default)
  isBusy: () => false,    // optional: defer if mid-task
})
```

The `isBusy` option is key for plugins that shouldn't interrupt in-flight work:

```typescript
let handling = false
server.tool('reply', '...', { text: z.string() }, async ({ text }) => {
  handling = true
  try {
    // ... do work ...
  } finally {
    handling = false
  }
})

watchSelf({ isBusy: () => handling })
```

## isReload flag

```typescript
import { isReload } from 'mcp-self-reload/src/watch.ts'

if (isReload) {
  // This process was spawned by a self-handoff, not Claude Code directly
  // Useful for skipping startup announcements, re-pairing flows, etc.
}
```

## Deploy workflow

Pair this with a file-sync script. Example:

```bash
# 1. Edit your server.ts
# 2. Sync to Claude Code's plugin directory
cp server.ts ~/.claude/plugins/cache/my-plugin/0.0.1/server.ts
# 3. watchSelf() detects the mtime change within 30s and self-reloads
```

For multi-session fleets, use [fleet-discord](https://github.com/Agent-Crafting-Table/fleet-discord)'s `fleet-sync-plugin.sh` to sync across all session plugin dirs simultaneously.

## Why not `bun --hot`?

`bun --hot` does hot module replacement in-process but requires special structuring for cleanup (`import.meta.hot.dispose`). For MCP servers, the stdio transport setup needs to stay intact through reloads, which makes hot reloading fragile. The self-handoff approach is simpler: spawn a clean replacement, pass the pipe, exit.
