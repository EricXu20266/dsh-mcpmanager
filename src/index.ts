/**
 * dsh-mcpmanager host entry: mounts MCP configuration routes that read/write
 * the profile's cordis.patch.yml (mcp-client plugin instances). Configuration
 * changes require a host restart — delegated to the host agent via prompts.
 */
import type { Context } from '@deepseek-ai/cordis'
import { mountMcpManagerRoutes, type McpManagerHost } from './routes.ts'

export const name = 'dsh-mcpmanager'

/** Minimal host-plane systemPrompt service face (avoids a hard dep on @deepseek-ai/dsh-system-prompt). */
interface SystemPromptFace {
  section(section: { name: string; order: number; text: string }): () => void
}

export function apply(ctx: Context): void {
  ctx.inject(['webServer', 'loader'], (hostCtx: Context) => {
    const host = hostCtx as unknown as McpManagerHost
    host.effect(() => mountMcpManagerRoutes(host), 'dsh-mcpmanager: http routes')
  })
  ctx.inject(['systemPrompt'], (sysCtx: Context) => (sysCtx as unknown as { systemPrompt: SystemPromptFace }).systemPrompt.section({
    name: 'plugin:dsh-mcpmanager',
    order: 900,
    text: 'Installed plugin: dsh-mcpmanager (sidebar MCP 管理 panel). Lists and edits MCP server instances in the profile cordis.patch.yml; edits hot-reload via HMR.',
  }))
}
