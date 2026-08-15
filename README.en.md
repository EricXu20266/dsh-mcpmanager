# dsh-mcpmanager

> 🌐 **English | [中文](README.md)**

DSH MCP Manager — a graphical tool for viewing and managing DHS MCP server configuration: list, form-based CRUD, enable/disable, and LLM verification. Persistence is fully aligned with DHS's native mechanism (`cordis.patch.yml`), and changes take effect via **hot reload** — no restart needed.

## How DHS manages MCP (background)

DHS has **no standalone MCP store — one server = one `@deepseek-ai/dsh-mcp-client` plugin instance**, persisted in the profile's patch layer:

```
~/.dsh/profiles/web/cordis.patch.yml
```

```yaml
# stdio transport (spawns a subprocess)
- insert:
    - id: mcp-github
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: github
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-github']
        env: { GITHUB_TOKEN: ... }

# streamable-http transport (remote service)
- insert:
    - id: mcp-web
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: web
        transport: streamable-http
        url: https://example.com/mcp
        headers: { Authorization: ... }
```

### Key mechanics

- **Tool naming**: after connection, every tool registers as `mcp__<serverName>__<rawName>` (same convention as Claude Code/Codex). The name is a pure function of serverName + rawName, so connection order does not matter.
- **Load chain**: host starts → parses profile config → each mcp-client instance connects to its server → `listTools()` discovers tools → tools are injected into `ctx.tools` → the model calls them like any other tool.
- **Hot reload (HMR)**: editing a config entry triggers disconnect + reconnect **without restarting the process** — new sessions immediately see `mcp__<serverName>__*` tools.
- **Reconnect with backoff**: automatic exponential backoff (from 500ms, capped at 30s, max 10 attempts); on recovery the tool set is replaced (no duplicates, no leaks); tools are unloaded and reconnection stops when the limit is exceeded.
- **`!!js` expressions**: cordis patches allow `!!js <expr>` dynamic evaluation (e.g. injecting API keys from environment variables), executed by Schemastery.

## What this plugin does: graphical management

DHS natively only offers "hand-write YAML + restart to apply" for MCP, which is hard to operate visually. This plugin provides an "MCP Manager" panel in the sidebar:

- **Config list**: parses `cordis.patch.yml` mcp-client instances, showing serverName / transport / command / url / enabled state (env values are masked — only keys shown)
- **Form-based CRUD**: add/edit via a visual form (id / serverName / transport dropdown (stdio, streamable-http) / command / args / env / url / headers / cwd)
- **Enable/disable**: uses the native cordis patch `disabled: true` mechanism — disable keeps the config but the host stops loading it; re-enable anytime
- **Save = hot reload**: changes apply immediately without restart — "Let the LLM verify the connection" guides DHS to confirm `mcp__*` tools appear in a new session
- **`!!js` compatibility**: the parser tolerates `!!js` expressions (preserved as-is, never executed or crashed on); the GUI shows them as static strings; for execution semantics edit the patch file directly
- **Built-in Node runtime (packaged-build stability)**: when saving, if the command is `npx`, it automatically scans the npm `_npx` cache and resolves to "current Node + package entry js" direct invocation — skipping system PATH dependency (packaged hosts run on bundled Node, and npx may not exist on the system)
- **i18n**: zh / en bilingual

## Install

```sh
# From GitHub (first install requires allowing the build; dsh will prompt you to add the package key to the profile's pnpm-workspace.yaml allowBuilds)
dsh plugin add github:EricXu20266/dsh-mcpmanager

# Or from npm (prebuilt artifacts, no build authorization needed)
dsh plugin add dsh-mcpmanager
```

## Usage

After installing, restart the dsh session and the "MCP Manager" entry appears in the sidebar. Add/edit/delete servers and save — hot reload takes effect immediately, no host restart needed.

## Development

```sh
pnpm install
pnpm build          # tsc compiles host side → lib/
pnpm bundle:client  # tsdown bundles client side → client/client.js
```

> During development, if the profile references this repo via a `file:` dependency, you must manually sync build artifacts into the profile's node_modules after changes (pnpm `file:` deps are copied once and don't watch source changes), then restart the host.

## License

MIT
