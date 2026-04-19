/**
 * Minimal example: an MCP server that self-reloads when its source changes.
 *
 * Run with: bun example-server.ts
 * Then edit this file — the server will reload without dropping the MCP connection.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { watchSelf, isReload } from './watch.ts'

if (isReload) {
  process.stderr.write('[example] reloaded from self-handoff\n')
}

const server = new McpServer({ name: 'example', version: '1.0.0' })

server.tool('ping', 'Returns pong', {}, async () => ({
  content: [{ type: 'text' as const, text: 'pong' }],
}))

await server.connect(new StdioServerTransport())

// Start watching — will self-handoff when this file changes on disk
watchSelf()

process.stderr.write('[example] ready\n')
