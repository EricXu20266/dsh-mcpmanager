/** Data model for the MCP manager browser. */

export interface McpServerEntry {
  id: string
  serverName: string
  transport: string
  command?: string
  args?: string[]
  envKeys?: string[]
  url?: string
  headers?: Record<string, string>
  cwd?: string
  enabled: boolean
}
