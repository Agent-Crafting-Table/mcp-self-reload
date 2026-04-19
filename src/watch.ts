/**
 * mcp-self-reload — zero-downtime code rolls for bun MCP plugins
 *
 * Usage:
 *   import { watchSelf } from './watch.ts'
 *   watchSelf()  // call once near the end of your server setup
 *
 * When the current file changes on disk (e.g. after a deploy syncs new code),
 * this spawns a replacement bun process that inherits stdin/stdout, then exits.
 * The MCP pipe to Claude Code stays live throughout — no gap, no supervisor needed.
 */

import { statSync } from 'fs'
import { spawn } from 'child_process'

export interface WatchOptions {
  /**
   * How often to check for file changes, in ms. Default: 30_000 (30s).
   * Multiple instances stagger naturally due to different start times.
   */
  intervalMs?: number

  /**
   * How long to wait (ms) after spawning the replacement before exiting,
   * giving it time to initialize and start reading stdin. Default: 500.
   */
  handoffDelayMs?: number

  /**
   * Optional predicate — if provided, self-reload is deferred while this
   * returns true. Use to hold off when the current process is mid-task.
   *
   * @example
   *   watchSelf({ isBusy: () => currentlyHandlingRequest })
   */
  isBusy?: () => boolean
}

/**
 * Start watching the calling module's source file for changes.
 * When a change is detected and the process is idle, spawns a replacement
 * bun process with inherited stdio (so the MCP pipe stays live), then exits.
 */
export function watchSelf(opts: WatchOptions = {}): void {
  const {
    intervalMs = 30_000,
    handoffDelayMs = 500,
    isBusy,
  } = opts

  const sourcePath = getCallerPath()
  if (!sourcePath) {
    process.stderr.write('[mcp-self-reload] could not determine source path — watch disabled\n')
    return
  }

  let knownMtime = 0
  try { knownMtime = statSync(sourcePath).mtimeMs } catch {}

  const timer = setInterval(() => {
    let currentMtime = 0
    try { currentMtime = statSync(sourcePath).mtimeMs } catch { return }
    if (currentMtime === knownMtime) return

    if (isBusy?.()) {
      // Defer — will re-check on next tick
      return
    }

    process.stderr.write(
      `[mcp-self-reload] ${sourcePath} changed (${knownMtime} → ${currentMtime}); spawning replacement...\n`
    )

    const replacement = spawn(process.execPath, [sourcePath], {
      stdio: 'inherit',
      env: { ...process.env, MCP_SELF_RELOAD: '1' },
      detached: false,
    })

    replacement.unref()

    replacement.on('error', (err: Error) => {
      process.stderr.write(`[mcp-self-reload] spawn failed: ${err.message} — exiting with code 1 (supervisor will restart)\n`)
      clearInterval(timer)
      process.exit(1)
    })

    setTimeout(() => {
      process.stderr.write(`[mcp-self-reload] handing off to pid ${replacement.pid}\n`)
      clearInterval(timer)
      process.exit(0)
    }, handoffDelayMs)
  }, intervalMs).unref()
}

/**
 * True if this process was spawned by watchSelf as a replacement.
 * Useful for skipping re-registration of side effects on reload.
 */
export const isReload = process.env.MCP_SELF_RELOAD === '1'

// ── Internal helpers ─────────────────────────────────────────────────────────

function getCallerPath(): string | undefined {
  // Bun sets import.meta.path on each module. The caller of watchSelf()
  // is the MCP server's main file — walk the stack to find it.
  // Simpler: just use the entry point (process.argv[1]).
  try {
    const arg = process.argv[1]
    if (arg) {
      statSync(arg) // verify it exists
      return arg
    }
  } catch {}
  return undefined
}
