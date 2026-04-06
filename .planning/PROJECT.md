# vault-mind

## What This Is

Knowledge OS for AI agents. 四层架构 (MCP + Unified Memory + Knowledge Compiler + Autonomous Agent) 让任何 AI agent (Claude Code / Codex / Gemini / OpenClaw) 通过标准 MCP 接口操作、编译、查询知识库。从 obsidian-vault-bridge 进化而来，核心差异是自动编译管线和可插拔 adapter 体系。面向 power user 和 AI agent 开发者。

## Core Value

**知识不编译就是垃圾。** vault-mind 把 raw markdown notes 自动编译成结构化知识图谱 (concepts, relationships, contradictions)，任何 agent 可查询。

## Requirements

### Validated

- [x] **VAULT-01**: MCP connector 支持 stdio transport (connector.js, 已验证)
- [x] **VAULT-02**: Filesystem fallback 当 Obsidian 未运行 (已验证)
- [x] **VAULT-03**: kb_meta.py 零依赖 CLI (init/diff/hash/index/links/vitality, 已验证)
- [x] **VAULT-04**: vault CRUD + search + graph MCP methods (21 methods, 58 E2E tests)
- [x] **VAULT-05**: Bearer token auth (timing-safe, 已验证)
- [x] **VAULT-06**: 8 vault skills (save/world/challenge/emerge/connect/graduate/ingest/bridge)
- [x] **VAULT-07**: 4 cron hooks (morning/nightly/weekly/bg-agent)

### Active

- [ ] **MCP-01**: MCP server TypeScript 重写 (从 connector.js)
- [ ] **MCP-02**: compile.* namespace (status, run, diff, abort)
- [ ] **MCP-03**: query.* namespace (unified, search, explain)
- [ ] **MCP-04**: agent.* namespace (status, trigger, schedule, history)
- [ ] **ADAPT-01**: Adapter 接口定义 (VaultMindAdapter interface)
- [ ] **ADAPT-02**: adapter-filesystem (默认, 零依赖)
- [ ] **ADAPT-03**: adapter-obsidian (WS proxy, 可选)
- [ ] **ADAPT-04**: adapter-memu (PG/pgvector, 可选)
- [ ] **ADAPT-05**: adapter-gitnexus (MCP 转发, 可选)
- [ ] **COMP-01**: compile.py 自动编排 (diff -> chunk -> extract -> merge -> write -> index)
- [ ] **COMP-02**: 增量编译 (只处理 dirty 文件)
- [ ] **COMP-03**: 矛盾检测 (claims 比对, severity 分级)
- [ ] **COMP-04**: 覆盖度追踪 (per-concept source count)
- [ ] **QUERY-01**: Unified query 融合排序 (多 adapter 并行搜索)
- [ ] **QUERY-02**: 查询结果标注来源 (vault/memU/gitnexus)
- [ ] **AGENT-01**: Agent scheduler 状态机 (idle -> evaluate -> action -> report)
- [ ] **AGENT-02**: Evaluate 决策逻辑 (dirty -> compile, stale -> emerge, etc.)
- [ ] **AGENT-03**: 白天响应式 + 夜间主动式
- [ ] **DIST-01**: setup.sh 一键安装 (检测环境, 交互式配置)
- [ ] **DIST-02**: vault-mind.yaml 配置文件
- [ ] **SKILL-01**: Skills 迁入 + 适配 unified query
- [ ] **SKILL-02**: vault-health 新 skill (8 类审计)
- [ ] **SKILL-03**: vault-reconcile 新 skill (矛盾调和)

### Out of Scope

- **内置 dreamtime** -- dreamtime 是独立系统，通过标准 MCP 方法调用 vault-mind，不在此 repo
- **Web UI / Dashboard** -- vault-mind 是 headless MCP server，UI 是消费者的事
- **多用户协作** -- 面向个人 power user，不搞 RBAC/权限
- **付费功能** -- 全部开源 GPL-3.0
- **adapter-dreamtime 在此 repo** -- 由 dreamtime 项目维护

## Context

**前身**: obsidian-vault-bridge (D:/projects/obsidian-vault-bridge/)
- Obsidian WS 插件 (21 methods, 198 adversarial tests)
- MCP connector (connector.js, stdio + WS proxy + FS fallback)
- KB engine (kb_meta.py, 7 commands)
- 8 vault skills + 4 cron hooks
- CI: GitHub Actions 4 jobs

**竞品参考**: eugeniughelbur/obsidian-second-brain (19 skill files, 纯 Claude Code, 无编译/无 MCP/无 adapter)

**Repo**: 2233admin/obsidian-llm-wiki
**Spec**: docs/2026-04-07-vault-mind-design.md

## Constraints

- **Tech (MCP server)**: TypeScript + Node.js, @modelcontextprotocol/sdk
- **Tech (compiler)**: Python 3.11+, 零重依赖原则 (kb_meta.py 保持零依赖)
- **Tech (agent)**: Python, 和 compiler 同包
- **Tech (skills)**: 纯 markdown, 平台无关
- **Runtime**: MCP stdio transport, 任何 MCP client 可用
- **Compatibility**: 不破坏现有 obsidian-vault-bridge 功能
- **LLM cost**: compile extraction 可配 model tier (haiku/sonnet/opus)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 新 repo 而非重构 obsidian-vault-bridge | 范围已超出 "Obsidian bridge", vault-mind 是 Knowledge OS | -- Pending |
| adapter 体系而非硬编码集成 | 用户多样性: 有的没 memU, 有的没 Obsidian, 全部可选 | -- Pending |
| 不内置 dreamtime | vault-mind 是 MCP server, 不为特定消费者写专用代码 | ✓ Good |
| Python compiler + TS MCP server | MCP 生态标准是 TS, LLM SDK 生态 Python 更好 | -- Pending |
| filesystem adapter 为默认 | 最小安装 = vault-mind + markdown 文件夹, 零外部依赖 | -- Pending |

---
*Last updated: 2026-04-07 after initial design spec*
