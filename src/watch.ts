/**
 * mcp-self-reload — zero-downtime code rolls for bun MCP plugins
 *
 * Usage: call watchSelf() near the end of your server setup.
 *
 * When the entry file changes on disk (e.g. after a deploy syncs new code),
 * this calls process.exit(0). The outer restart loop in package.json's start
 * script immediately relaunches bun with the new code, keeping the MCP
 * pipe to Claude Code alive throughout.
 *
 * Required package.json start script:
 *   "start": "bun install --no-summary && while true; do bun server.ts; sleep 0.5; done"
 */

import { statSync } from 'fs'

export interface WatchOptions {
  /** How often to check for file changes, ms. Default: 30_000 */
  intervalMs?: number
  /**
   * Defer reload while this returns true (e.g. mid-request).
   * Will re-check on next tick.
   */
  isBusy?: () => boolean
}

/**
 * Start watching the entry file for changes. When a change is detected and
 * the process is idle, exits so the outer restart loop reloads with new code.
 */
export function watchSelf(opts: WatchOptions = {}): void {
  const { intervalMs = 30_000, isBusy } = opts

  const sourcePath = process.argv[1]
  if (!sourcePath) {
    process.stderr.write('[mcp-self-reload] could not determine source path — watch disabled\n')
    return
  }

  let knownMtime = 0
  try { knownMtime = statSync(sourcePath).mtimeMs } catch {}

  setInterval(() => {
    let currentMtime = 0
    try { currentMtime = statSync(sourcePath).mtimeMs } catch { return }
    if (currentMtime === knownMtime) return
    if (isBusy?.()) return  // defer — will re-check next tick

    process.stderr.write(
      `[mcp-self-reload] ${sourcePath} changed — exiting for restart loop\n`
    )
    process.exit(0)
  }, intervalMs).unref()
}

/** True if this process was restarted by the outer loop (not the first boot). */
export const isReload = process.env.MCP_SELF_RELOAD === '1'
