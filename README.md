# dsh-mcpmanager

DSH MCP 管理器（DSH MCP manager）——查看、新增、编辑、启用/禁用 profile 中的 MCP server 配置；重启生效交由 host agent（LLM）处理。

## 功能

- **配置列表**：解析 profile 的 `cordis.patch.yml`（`@deepseek-ai/dsh-mcp-client` 实例），显示 serverName / transport / command / env / 启用状态
- **新增/编辑**：表单化配置（id / serverName / transport（stdio、streamable-http）/ command / args / env / cwd）
- **启用/禁用**：cordis patch `disabled: true` 原生机制——禁用保留配置、host 不加载，可随时再启用
- **内置 Node 运行（打包版稳定性）**：保存时若 command 是 `npx`，自动扫描 npm `_npx` 缓存解析为「当前 Node + 包入口 js」直调——跳过系统 PATH 依赖（打包版 host 用捆绑 Node 运行，系统可能没有 npx）
- **删除**：确认后移除实例
- **LLM 处理重启**：配置修改需重启 DHS 生效，一键生成 prompt 交 DHS 评估并执行重启
- **i18n**：zh / en 双语

## 安装

```sh
# 从 GitHub 安装（首次需要允许构建，dsh 会给出提示，把包 key 加入 profile 的 pnpm-workspace.yaml allowBuilds）
dsh plugin add github:EricXu20266/dsh-mcpmanager

# 或从 npm 安装（预构建产物，无需授权）
dsh plugin add dsh-mcpmanager
```

## 使用

安装后重启 dsh 会话，侧边栏出现「MCP 管理」入口。新增的 MCP server 修改配置后需重启 host 生效。

## 开发

```sh
pnpm install
pnpm build          # tsc 编译 host 侧 → lib/
pnpm bundle:client  # tsdown 打包 client 侧 → client/client.js
```

## 许可

MIT
