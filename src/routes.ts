/**
 * dsh-mcpmanager host routes:
 *  - GET  /dsh-mcpmanager/list   — MCP server configs parsed from profile cordis.patch.yml
 *  - POST /dsh-mcpmanager/upsert — add or update one mcp-client instance (npx → bundled node auto-resolve)
 *  - POST /dsh-mcpmanager/delete — remove one mcp-client instance by id
 *  - POST /dsh-mcpmanager/toggle — enable/disable an instance (cordis patch `disabled: true` row)
 *
 * 写操作采用「文本级保形」：按顶层 YAML 条目块增删改，保留注释、!!js 表达式
 * 及其它所有非 MCP 条目（id 定向覆写、inject、isolate 等）——不做整文件重 dump，
 * 避免 js-yaml 丢注释 / 拒绝 !!js / 清空用户 patch。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
// js-yaml 5.x 运行时 API（类型声明缺失）：defineScalarTag 自定义 tag + Schema 构造
import * as yamlRuntime from 'js-yaml'
const { defineScalarTag, Schema, CORE_SCHEMA } = yamlRuntime as unknown as {
  defineScalarTag: (name: string, opts: { resolve: (v: string) => string; identify: () => boolean }) => unknown
  Schema: new (tags: unknown[]) => { tags: unknown[] }
  CORE_SCHEMA: { tags: unknown[] }
}
import { sendJson, sameOrigin } from './http.ts'

export interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

export interface McpManagerHost {
  webServer: WebServerService
  effect(callback: () => () => void, label: string): void
}

const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'

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

/** Profile patch path: $DSH_HOME/profiles/web/cordis.patch.yml (or ~/.dsh). */
function resolvePatchPath(): string {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'profiles', 'web', 'cordis.patch.yml')
}

function readPatchText(): string {
  const path = resolvePatchPath()
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** 按顶层 `- ` 条目分割 YAML 文本（保留条目内空行），保形基础。 */
function splitTopEntries(text: string): string[] {
  const lines = text.split('\n')
  const entries: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (/^-\s+/.test(line) && current.length > 0 && current[current.length - 1].trim() !== '') {
      entries.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) entries.push(current.join('\n'))
  return entries
}

/* ── !!js 表达式兼容 ──────────────────────────────────────────────────────
 * cordis patch 允许 `!!js <expr>`（Schemastery 动态求值，如 env 里注入
 * process.env 的 API key）。裸 js-yaml 遇到未知 tag 抛 "unknown tag"，
 * 会让整个 MCP 管理页 500（且 GUI 打不开无法自救）。这里注册解析 Type：
 * 遇到 !!js 标签保留表达式原始文本（不执行、不崩溃），GUI 以静态字符串
 * 展示/编辑；如需执行语义请直接手改 cordis.patch.yml。 */

function jsExpressionType(tag: string): unknown {
  // 遇到 !!js 标签保留表达式原文（不执行、不崩溃）；identify 恒 false 避免 dump 侧误用
  return defineScalarTag(tag, { resolve: (v) => v, identify: () => false })
}

const patchSchema = new Schema([
  ...CORE_SCHEMA.tags,
  jsExpressionType('tag:yaml.org,2002:js'),
  jsExpressionType('tag:yaml.org,2002:js/function'),
  jsExpressionType('tag:yaml.org,2002:js/regexp'),
  jsExpressionType('tag:yaml.org,2002:js/undefined'),
])

/** 解析 patch 文本：容忍 !!js 标签（保留原始文本），其余与默认 schema 一致。 */
function parsePatchYaml(text: string): unknown {
  return yamlLoad(text, { schema: patchSchema as never })
}

/** 只读解析：从原始文本提取 MCP client 实例与 disabled id（不重写文件）。 */
function parseEntries(text: string): { rows: Array<{ id: string; config?: Record<string, unknown> }>; disabled: Set<string> } {
  const rows: Array<{ id: string; config?: Record<string, unknown> }> = []
  const disabled = new Set<string>()
  for (const entry of splitTopEntries(text)) {
    if (/^\s*-\s+insert:/.test(entry)) {
      const parsed = parsePatchYaml(entry) as unknown
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const insert = (item as { insert?: unknown }).insert
          if (Array.isArray(insert)) {
            for (const row of insert as Array<{ id?: string; name?: string; config?: Record<string, unknown> }>) {
              if (row.id !== undefined && row.name === MCP_CLIENT) {
                rows.push({ id: row.id, config: row.config })
              }
            }
          }
        }
      }
    } else if (/disabled:\s*true/.test(entry)) {
      const m = /^\s*-\s+id:\s*['"]?([^'"]+)/.exec(entry)
      if (m !== null) disabled.add(m[1].trim())
    }
  }
  return { rows, disabled }
}

function toEntry(row: { id: string; config?: Record<string, unknown> }, disabled: Set<string>): McpServerEntry {
  const config = (row.config ?? {}) as Record<string, unknown>
  const env = typeof config.env === 'object' && config.env !== null ? config.env as Record<string, string> : undefined
  return {
    id: row.id,
    serverName: typeof config.serverName === 'string' ? config.serverName : row.id,
    transport: typeof config.transport === 'string' ? config.transport : 'stdio',
    command: typeof config.command === 'string' ? config.command : undefined,
    args: Array.isArray(config.args) ? config.args.map(String) : undefined,
    // 脱敏：只回传 env 键名，不泄露值（API key / token）
    envKeys: env !== undefined ? Object.keys(env) : undefined,
    url: typeof config.url === 'string' ? config.url : undefined,
    headers: typeof config.headers === 'object' && config.headers !== null ? config.headers as Record<string, string> : undefined,
    cwd: typeof config.cwd === 'string' ? config.cwd : undefined,
    enabled: !disabled.has(row.id),
  }
}

function readBody(request: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    request.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(c)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/** 渲染一个 mcp-client insert 条目块（文本级，缩进与 cordis patch 格式一致）。 */
function renderInsertBlock(id: string, config: Record<string, unknown>): string {
  const configText = yamlDump(config, { lineWidth: -1, indent: 2 })
    .split('\n')
    .map((line) => (line.trim() === '' ? line : `        ${line}`))
    .join('\n')
  return [
    '- insert:',
    `    - id: ${id}`,
    `      name: '${MCP_CLIENT}'`,
    '      config:',
    configText,
  ].join('\n')
}

/* ── npx → bundled node（保证打包版稳定性：host 用捆绑 node 运行，系统 PATH 无 npx）── */

function resolveBinEntry(pkgDir: string, pkg: string): string | null {
  const pkgJsonPath = join(pkgDir, 'node_modules', pkg, 'package.json')
  if (!existsSync(pkgJsonPath)) return null
  try {
    const doc = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { bin?: string | Record<string, string> }
    const bin = doc.bin
    let entry: string | undefined
    if (typeof bin === 'string') entry = bin
    else if (bin !== null && typeof bin === 'object') entry = Object.values(bin)[0]
    if (entry === undefined) return null
    return join(pkgDir, 'node_modules', pkg, entry)
  } catch {
    return null
  }
}

/**
 * 把 `npx [-y] [--package ...] <pkg> [args...]` 解析为「当前 node + 包入口 js」。
 * 扫描 npx 缓存（npm-cache/_npx），命中则直调入口，跳过系统 PATH 依赖（打包版无 npx）。
 * 解析失败返回 null，保留原 npx 命令。
 */
function resolveNpxToBundledNode(npxArgs: string[]): { command: string; args: string[] } | null {
  let pkgIdx = 0
  for (; pkgIdx < npxArgs.length; pkgIdx++) {
    const arg = npxArgs[pkgIdx]
    if (arg !== undefined && !arg.startsWith('-')) break
  }
  if (pkgIdx >= npxArgs.length) return null
  const pkg = npxArgs[pkgIdx]
  const cacheRoot = process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'npm-cache', '_npx')
    : join(homedir(), '.npm', '_npx')
  if (!existsSync(cacheRoot)) return null
  try {
    for (const dir of readdirSync(cacheRoot)) {
      const pkgJsonPath = join(cacheRoot, dir, 'package.json')
      if (!existsSync(pkgJsonPath)) continue
      const doc = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { dependencies?: Record<string, string> }
      if (doc.dependencies?.[pkg] !== undefined) {
        const entry = resolveBinEntry(join(cacheRoot, dir), pkg)
        if (entry !== null) {
          return { command: process.execPath, args: [entry, ...npxArgs.slice(pkgIdx + 1)] }
        }
      }
    }
  } catch {
    // 扫描失败 → fallback 原命令
  }
  return null
}

export function mountMcpManagerRoutes(host: McpManagerHost): () => void {
  const disposers = [
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-mcpmanager/list',
      handler: async (_request, response) => {
        try {
          const text = readPatchText()
          const { rows, disabled } = parseEntries(text)
          const servers = rows.map((r) => toEntry(r, disabled))
          sendJson(response, 200, { servers, patchPath: resolvePatchPath() })
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-mcpmanager/upsert',
      handler: async (request, response) => {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin request rejected' })
          return
        }
        try {
          const body = JSON.parse(await readBody(request)) as { id?: string; config?: Record<string, unknown> }
          if (body.id === undefined || body.config === undefined) {
            sendJson(response, 400, { error: 'id and config are required' })
            return
          }
          const config = { ...body.config }
          let resolvedNpx = false
          if (typeof config.command === 'string' && config.command === 'npx' && Array.isArray(config.args)) {
            const resolved = resolveNpxToBundledNode(config.args.map(String))
            if (resolved !== null) {
              config.command = resolved.command
              config.args = resolved.args
              resolvedNpx = true
            }
          }
          // 文本级保形：替换已存在的 insert 块，否则追加
          const entries = splitTopEntries(readPatchText())
          const block = renderInsertBlock(body.id, config)
          const idx = entries.findIndex((e) => e.includes(`id: ${body.id}`) && e.includes(MCP_CLIENT))
          if (idx >= 0) entries[idx] = block
          else entries.push(block)
          mkdirSync(join(resolvePatchPath(), '..'), { recursive: true })
          writeFileSync(resolvePatchPath(), entries.join('\n'), 'utf8')
          sendJson(response, 200, { ok: true, id: body.id, restartRequired: true, resolvedNpx })
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-mcpmanager/delete',
      handler: async (request, response) => {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin request rejected' })
          return
        }
        try {
          const body = JSON.parse(await readBody(request)) as { id?: string }
          if (body.id === undefined) {
            sendJson(response, 400, { error: 'id is required' })
            return
          }
          const entries = splitTopEntries(readPatchText()).filter((e) =>
            !(e.includes(`id: ${body.id}`) && (e.includes(MCP_CLIENT) || e.includes('disabled: true'))))
          writeFileSync(resolvePatchPath(), entries.join('\n'), 'utf8')
          sendJson(response, 200, { ok: true, id: body.id, restartRequired: true })
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-mcpmanager/toggle',
      handler: async (request, response) => {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin request rejected' })
          return
        }
        try {
          const body = JSON.parse(await readBody(request)) as { id?: string; enabled?: boolean }
          if (body.id === undefined || typeof body.enabled !== 'boolean') {
            sendJson(response, 400, { error: 'id and enabled are required' })
            return
          }
          const entries = splitTopEntries(readPatchText())
          const mcpIdx = entries.findIndex((e) => e.includes(`id: ${body.id}`) && e.includes(MCP_CLIENT))
          if (mcpIdx === -1) {
            sendJson(response, 404, { error: `mcp server "${body.id}" not found` })
            return
          }
          const disabledIdx = entries.findIndex((e) => e.includes(`id: ${body.id}`) && e.includes('disabled: true'))
          if (body.enabled) {
            if (disabledIdx >= 0) entries.splice(disabledIdx, 1)
          } else if (disabledIdx === -1) {
            entries.push(`- id: ${body.id}\n  disabled: true`)
          }
          writeFileSync(resolvePatchPath(), entries.join('\n'), 'utf8')
          sendJson(response, 200, { ok: true, id: body.id, enabled: body.enabled, restartRequired: true })
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
