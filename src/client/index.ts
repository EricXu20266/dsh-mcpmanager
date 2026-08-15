/**
 * dsh-mcpmanager client: sidebar entry + MCP server config panel.
 * Lists/creates/edits/deletes mcp-client instances in the profile patch.
 */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Translate } from './locales-types.ts'
import { zh, en } from './locales.ts'
import type { McpServerEntry } from './market-data.ts'

export const name = 'dsh-mcpmanager'
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/* ── inline styles (consistent with dsh-discovery / taishen-style panel) ── */

/* 卡片操作按钮（小） */
const btnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '4px 12px', boxSizing: 'border-box',
  background: 'var(--dsw-alias-button-elevated-fill, #2a2a4a)', border: '1px solid var(--dsw-alias-border-l2, #3a3a5a)',
  borderRadius: 8, color: 'var(--dsw-alias-label-primary, #e0e0f0)', font: '500 12px system-ui',
  cursor: 'pointer', transition: 'background-color .15s ease, color .15s ease',
}
const primaryBtn: React.CSSProperties = {
  ...btnStyle, background: '#4176e6', borderColor: '#4176e6', color: '#fff',
}
const dangerBtn: React.CSSProperties = { ...btnStyle, color: '#ff7b72', borderColor: '#6e2f33' }
/* 侧边栏入口按钮（对齐 dsh-discovery） */
const sidebarBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  width: '100%', height: 38, padding: '8px 16px', boxSizing: 'border-box',
  background: 'transparent', border: 'none', borderRadius: 12,
  color: 'var(--dsw-alias-label-primary, #c6c8d4)', font: '500 14px system-ui',
  lineHeight: '22px', cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
  transition: 'background-color .15s ease, color .15s ease, transform .15s ease',
}
const btnHoverStyle: React.CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06))',
  color: 'var(--dsw-alias-label-primary, #e0e0f0)',
}
const railStyle: React.CSSProperties = {
  ...sidebarBtnStyle, justifyContent: 'center', width: 36, height: 36, padding: 0, borderRadius: 8,
  color: 'var(--dsw-alias-label-secondary, #9aa0b4)',
}
/* 面板骨架（对齐 dsh-discovery：mask + 居中大横版） */
const maskStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,8,16,.6)', zIndex: 1000 }
const panelStyle: React.CSSProperties = {
  position: 'absolute', inset: '28px 32px', maxWidth: 1180, margin: '0 auto',
  background: 'var(--dsw-alias-bg-layer-1, #14141f)',
  border: '1px solid var(--dsw-alias-border-l2, #2e2e4a)', borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
}
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
  color: 'var(--dsw-alias-label-primary, #e0e0f0)', font: '600 15px system-ui', flexShrink: 0,
}
const closeStyle: React.CSSProperties = {
  marginLeft: 'auto', background: 'var(--dsw-alias-button-elevated-fill, #2a2a4a)',
  color: 'var(--dsw-alias-label-primary, #e0e0f0)', border: '1px solid var(--dsw-alias-border-l2, #3a3a5a)',
  borderRadius: 6, padding: '4px 12px', cursor: 'pointer', font: '12px system-ui',
}
/* 列表卡片 */
const itemStyle: React.CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-1, #1a1a2b)',
  border: '1px solid var(--dsw-alias-border-l2, #2e2e4a)', borderRadius: 12, padding: '14px 16px', marginBottom: 10,
}
const emptyStyle: React.CSSProperties = { textAlign: 'center', color: 'var(--dsw-alias-label-secondary, #9aa0b4)', fontSize: 13, padding: 48 }
const formStyle: React.CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-1, #1a1a2b)',
  border: '1px solid var(--dsw-alias-border-l2, #2e2e4a)', borderRadius: 12, padding: 14, marginBottom: 12,
}
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--dsw-alias-label-secondary, #9aa0b4)', margin: '8px 0 3px' }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, #3a3a5a)', borderRadius: 7,
  padding: '6px 9px', fontSize: 12, background: 'var(--dsw-alias-bg-layer-2, #1c1c2e)', color: 'var(--dsw-alias-label-primary, #e0e0f0)',
}
const metaStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--dsw-alias-label-secondary, #7c7c9c)', marginTop: 6,
}

interface DiscoveryClientContext {
  workspaces: { list: { getSnapshot(): { items: Array<{ workspaceId: string; sessionIds: string[] }>; recentWorkspaceId?: string } }; startSession(): void; connectWorkspace(id: string): Promise<string> }
  sessions: { list: { getSnapshot(): { current?: string } }; open(id: string): void; scope(id: string): unknown }
  locale: { register(ns: string, dict: unknown): void; bind(ns: string): Translate }
  slots: { inject(name: string, fn: () => unknown): void; register(spec: unknown, render: (owner: { wide: boolean }) => ReactNode): unknown }
}

async function openSessionAndSend(ctx: DiscoveryClientContext, text: string): Promise<boolean> {
  const ws = ctx.workspaces.list.getSnapshot()
  const current = ctx.sessions.list.getSnapshot().current
  const currentWsId = current === undefined
    ? undefined
    : ws.items.find((item) => item.sessionIds.includes(current))?.workspaceId
  const target = currentWsId ?? ws.recentWorkspaceId
  if (target === undefined) {
    ctx.workspaces.startSession()
    return false
  }
  const sessionId = await ctx.workspaces.connectWorkspace(target)
  ctx.sessions.open(sessionId)
  const scoped = ctx.sessions.scope(sessionId)
  if (scoped === undefined) return false
  const conversation = scoped.get('conversation') as { send(text: string): Promise<void> }
  await conversation.send(text)
  return true
}

function buildRestartPrompt(): string {
  return [
    '已修改 MCP server 配置，需要重启 DHS host 才能生效。',
    '请评估是否可以安全重启（保存当前会话状态后执行），并告知用户重启结果。',
  ].join('\n')
}

function MCPIcon(): ReactNode {
  return h('span', { style: { width: 16, height: 16, borderRadius: 4, background: '#10b981', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', flexShrink: 0 } }, 'M')
}

interface FormState {
  id: string
  serverName: string
  transport: string
  command: string
  args: string
  env: string
  url: string
  headers: string
  cwd: string
}

const emptyForm: FormState = { id: '', serverName: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '', cwd: '' }

function McpPanel({ t, ctx, onClose }: { t: Translate; ctx: DiscoveryClientContext; onClose: () => void }) {
  const [servers, setServers] = useState<McpServerEntry[] | null>(null)
  const [patchPath, setPatchPath] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<FormState | null>(null)

  const load = (): void => {
    setError('')
    fetch('/dsh-mcpmanager/list', { cache: 'no-store' })
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + String(res.status)); return res.json() })
      .then((body: { servers: McpServerEntry[]; patchPath: string }) => {
        setServers(body.servers ?? [])
        setPatchPath(body.patchPath ?? '')
      })
      .catch(() => setError(t('loadFail')))
  }
  useEffect(load, [])

  const startAdd = (): void => setEditing({ ...emptyForm })
  const startEdit = (s: McpServerEntry): void => setEditing({
    id: s.id,
    serverName: s.serverName,
    transport: s.transport,
    command: s.command ?? '',
    args: (s.args ?? []).join(', '),
    // env 值已脱敏（只回键名），编辑时保留已配置键提示，重新填写会整体覆盖
    env: (s.envKeys ?? []).join(', '),
    url: s.url ?? '',
    headers: Object.entries(s.headers ?? {}).map(([k, v]) => `${k}=${v}`).join(', '),
    cwd: s.cwd ?? '',
  })

  const save = (): void => {
    if (editing === null) return
    const config: Record<string, unknown> = {
      serverName: editing.serverName.trim() || editing.id.trim(),
      transport: editing.transport,
    }
    if (editing.command.trim() !== '') config.command = editing.command.trim()
    if (editing.args.trim() !== '') config.args = editing.args.split(',').map((s) => s.trim()).filter((s) => s !== '')
    if (editing.env.trim() !== '') {
      const env: Record<string, string> = {}
      for (const pair of editing.env.split(',')) {
        const idx = pair.indexOf('=')
        if (idx > 0) env[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
      }
      config.env = env
    }
    if (editing.transport === 'streamable-http' && editing.url.trim() !== '') config.url = editing.url.trim()
    if (editing.headers.trim() !== '') {
      const headers: Record<string, string> = {}
      for (const pair of editing.headers.split(',')) {
        const idx = pair.indexOf('=')
        if (idx > 0) headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
      }
      config.headers = headers
    }
    if (editing.cwd.trim() !== '') config.cwd = editing.cwd.trim()
    fetch('/dsh-mcpmanager/upsert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: editing.id.trim(), config }),
    })
      .then((res) => res.json())
      .then((body: { ok?: boolean; error?: string; resolvedNpx?: boolean }) => {
        if (body.ok) {
          setNotice(body.resolvedNpx === true ? t('npxResolved') : t('saved'))
          setEditing(null)
          load()
        } else {
          setError(body.error ?? t('saveFail'))
        }
      })
      .catch(() => setError(t('saveFail')))
  }

  const remove = (s: McpServerEntry): void => {
    if (!window.confirm(t('deleteConfirm').replace('{id}', s.id))) return
    fetch('/dsh-mcpmanager/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: s.id }),
    })
      .then((res) => res.json())
      .then((body: { ok?: boolean; error?: string }) => {
        if (body.ok) {
          setNotice(t('saved'))
          load()
        } else {
          setError(body.error ?? t('saveFail'))
        }
      })
      .catch(() => setError(t('saveFail')))
  }

  const toggleEnabled = (s: McpServerEntry): void => {
    fetch('/dsh-mcpmanager/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: s.id, enabled: !s.enabled }),
    })
      .then((res) => res.json())
      .then((body: { ok?: boolean; error?: string }) => {
        if (body.ok) {
          setNotice(t('saved'))
          load()
        } else {
          setError(body.error ?? t('saveFail'))
        }
      })
      .catch(() => setError(t('saveFail')))
  }

  const askRestart = (): void => {
    onClose()
    void openSessionAndSend(ctx, buildRestartPrompt())
  }

  const field = (key: keyof FormState, label: string): ReactNode => h('div', null,
    h('label', { style: labelStyle }, label),
    h('input', {
      style: inputStyle,
      value: editing![key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing!, [key]: e.target.value }),
    }),
  )

  return h('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 } },
    h('div', { style: { padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-l2, #2e2e4a)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h('button', { type: 'button', style: primaryBtn, onClick: startAdd }, `+ ${t('add')}`),
      h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #7c7c9c)' } }, t('restartNote')),
      h('span', { style: { flex: 1 } }),
      h('button', { type: 'button', style: btnStyle, onClick: askRestart }, t('restartWithLLM')),
    ),
    notice !== '' && h('div', { style: { padding: '6px 16px', fontSize: 12, color: '#3fb96f', background: 'rgba(26,127,55,.15)' } }, notice),
    error !== '' && h('div', { style: emptyStyle }, error),
    servers === null && !error && h('div', { style: emptyStyle }, t('loading')),
    h('div', { style: { flex: 1, overflowY: 'auto', padding: '16px 20px 24px' } },
      servers !== null && patchPath !== '' && h('div', { style: metaStyle }, `📄 ${patchPath}`),
      servers !== null && servers.length === 0 && h('div', { style: emptyStyle }, t('empty')),
      editing !== null && h('div', { style: formStyle },
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' } },
          field('id', t('fieldId')),
          field('serverName', t('fieldServer')),
        ),
        h('label', { style: labelStyle }, t('fieldTransport')),
        h('select', {
          style: inputStyle,
          value: editing.transport,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setEditing({ ...editing, transport: e.target.value }),
        },
          h('option', { value: 'stdio' }, t('transportStdio')),
          h('option', { value: 'streamable-http' }, t('transportHttp')),
        ),
        field('command', t('fieldCommand')),
        field('args', t('fieldArgs')),
        editing.transport === 'streamable-http' && field('url', t('fieldUrl')),
        editing.transport === 'streamable-http' && field('headers', t('fieldHeaders')),
        field('env', t('fieldEnv')),
        field('cwd', t('fieldCwd')),
        h('div', { style: { marginTop: 12, display: 'flex', gap: 8 } },
          h('button', { type: 'button', style: primaryBtn, onClick: save }, t('save')),
          h('button', { type: 'button', style: btnStyle, onClick: () => setEditing(null) }, t('cancel')),
        ),
      ),
      servers !== null && servers.map((s) => h('div', { key: s.id, style: itemStyle },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e0e0f0)', fontFamily: 'monospace', opacity: s.enabled ? 1 : 0.45 } }, s.serverName),
          h('span', { style: { fontSize: 10, padding: '1px 7px', borderRadius: 9, background: 'var(--dsw-alias-bg-layer-2, #2a2a4a)', color: s.transport === 'stdio' ? '#7aa2ff' : '#d8a75c', border: '1px solid var(--dsw-alias-border-l2, #3a3a5a)' } }, s.transport),
          h('span', { style: { fontSize: 10, padding: '1px 7px', borderRadius: 9, background: s.enabled ? 'rgba(26,127,55,.15)' : 'rgba(255,255,255,.04)', color: s.enabled ? '#3fb96f' : '#8b949e' } },
            s.enabled ? t('enabled') : t('disabled')),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: s.enabled ? btnStyle : { ...btnStyle, background: '#4176e6', borderColor: '#4176e6', color: '#fff' }, onClick: () => toggleEnabled(s) },
            s.enabled ? t('disableServer') : t('enableServer')),
          h('button', { type: 'button', style: btnStyle, onClick: () => startEdit(s) }, t('edit')),
          h('button', { type: 'button', style: dangerBtn, onClick: () => remove(s) }, t('delete')),
        ),
        h('div', { style: metaStyle }, `id: ${s.id}`),
        (s.command !== undefined || (s.args ?? []).length > 0) && h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #9aa0b4)', marginTop: 3, fontFamily: 'monospace', opacity: s.enabled ? 1 : 0.5 } },
          [s.command, ...(s.args ?? [])].filter(Boolean).join(' '),
        ),
        s.url !== undefined && h('div', { style: metaStyle }, `url: ${s.url}`),
        (s.envKeys ?? []).length > 0 && h('div', { style: metaStyle }, `env: ${s.envKeys!.join(', ')}`),
      )),
    ),
  )
}

export function apply(ctx: DiscoveryClientContext): void {
  const NS = 'dsh-mcpmanager'
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mcpmanager: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: 'dsh-mcpmanager',
    order: 3,
    locale: NS,
  }, (owner: { wide: boolean }) => h(McpTrigger, { wide: owner.wide ?? false, t, ctx })))
}

function McpTrigger({ wide, t, ctx }: { wide: boolean; t: Translate; ctx: DiscoveryClientContext }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const close = (): void => setOpen(false)
  const closeButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])
  useEffect(() => { if (open) closeButton.current?.focus() }, [open])

  const style = wide ? { ...sidebarBtnStyle, ...(hovered ? btnHoverStyle : null) } : railStyle

  return h('div', { style: { display: 'contents' } },
    h('button', {
      type: 'button',
      style,
      title: t('nav'),
      'aria-label': t('nav'),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick: () => setOpen(true),
    },
      h(MCPIcon),
      wide && h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t('nav')),
    ),
    open && h('div', { style: maskStyle, onClick: close },
      h('div', { style: panelStyle, onClick: (e: React.MouseEvent) => e.stopPropagation() },
        h('div', { style: headerStyle },
          h(MCPIcon),
          h('span', null, t('nav')),
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #7c7c9c)', fontWeight: 400 } }, t('subtitle')),
          h('button', { ref: closeButton, style: closeStyle, onClick: close, 'aria-label': 'Close' }, '✕'),
        ),
        h('div', { style: { flex: 1, overflowY: 'hidden', padding: '0 4px' } }, h(McpPanel, { t, ctx, onClose: close })),
      ),
    ),
  )
}
