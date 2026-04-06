# Roadmap: vault-mind

**Created:** 2026-04-07
**Milestone:** v1.0 -- Knowledge OS MVP

## Phase Overview

| Phase | Name | Goal | Requirements | Depends |
|-------|------|------|-------------|---------|
| 1 | Scaffold + Migrate | Monorepo 结构 + 现有代码迁入 | -- | -- |
| 2 | MCP Server + Adapters | TS MCP server + adapter 接口 + filesystem adapter | MCP-01~06, ADAPT-01~02 | Phase 1 |
| 3 | Compiler Auto-Orchestration | compile.py 管线 + 增量编译 + 矛盾检测 | COMP-01~08 | Phase 1 |
| 4 | Unified Query | 多 adapter 融合查询 + compile triggers | QUERY-01~04, TRIG-01~04, ADAPT-03~05 | Phase 2, 3 |
| 5 | Agent Scheduler | 自治状态机 + evaluate 决策 + 白天/夜间模式 | AGENT-01~06 | Phase 3, 4 |
| 6 | Distribution + Skills | setup.sh + skills 迁入 + vault-health + vault-reconcile | DIST-01~04, SKILL-01~03 | Phase 2, 3 |

## Phase Details

### Phase 1: Scaffold + Migrate

**Goal:** Monorepo 结构建好，现有代码搬进来，CI 跑通。

**Success criteria:**
- [ ] Monorepo 目录结构 (mcp-server/, compiler/, agent/, adapters/, skills/, hooks/)
- [ ] connector.js 迁入 mcp-server/src/ (暂保持 JS, Phase 2 重写 TS)
- [ ] kb_meta.py 迁入 compiler/
- [ ] 8 skills + 4 hooks 迁入
- [ ] package.json + pyproject.toml + tsconfig.json
- [ ] CI: build + typecheck + ruff lint
- [ ] git commit: initial scaffold

**Worker assignment:** Codex (苦力活, Claude review)

### Phase 2: MCP Server + Adapters

**Goal:** connector.js 重写为 TypeScript MCP server, adapter 接口定义, filesystem adapter 实现。

**Success criteria:**
- [ ] mcp-server/src/index.ts -- stdio entry point
- [ ] vault.* methods 全部迁入 (17 methods)
- [ ] compile.* methods stub (status, run, diff, abort)
- [ ] query.* methods stub (unified, search, explain)
- [ ] agent.* methods stub (status, trigger, schedule, history)
- [ ] VaultMindAdapter interface (search, read, write, graph, events, init, dispose)
- [ ] adapter-filesystem 实现 (ripgrep search, fs read/write)
- [ ] adapter-obsidian 迁入 (WS proxy, 现有逻辑)
- [ ] Bearer token auth
- [ ] 现有 198 adversarial tests 迁入并通过
- [ ] vault-mind.yaml 配置加载

**Worker assignment:** Codex (实现) + Claude (接口设计 review)

### Phase 3: Compiler Auto-Orchestration

**Goal:** kb_meta.py 基础上构建 compile.py, 实现 raw -> concept 全自动管线。

**Success criteria:**
- [ ] compile.py 编排: diff -> chunk -> extract -> merge -> write -> index -> report
- [ ] Chunking: 按 heading/paragraph 切分, configurable size
- [ ] LLM extraction: concepts[], relationships[], claims[] JSON output
- [ ] Model tier 可配 (haiku/sonnet/opus via compile-config.yaml)
- [ ] Merge: 新 concept vs 现有 concept (合并/更新/标注矛盾)
- [ ] 矛盾检测: Claim 比对, severity 分级, wiki/_contradictions.md
- [ ] 覆盖度: per-concept source count, low/medium/high tags
- [ ] 编译报告: sources/concepts/contradictions/broken links
- [ ] kb_meta.py update-hash + update-index + check-links 自动调用
- [ ] E2E test: ingest 3 sources -> compile -> verify concepts + contradictions

**Worker assignment:** Claude (核心 IP) + Gemini (review)

### Phase 4: Unified Query + Compile Triggers

**Goal:** 多 adapter 并行搜索融合返回, 文件变更自动触发编译。

**Success criteria:**
- [ ] unifiedQuery() 并行调用所有 search-capable adapters
- [ ] 融合排序: source-weighted merge, 权重可配
- [ ] 结果标注来源 (adapter name + original path)
- [ ] adapter 失败不阻塞 (Promise.allSettled)
- [ ] adapter-memu 实现 (PG query, cosine similarity)
- [ ] adapter-gitnexus 实现 (MCP 转发)
- [ ] Compile trigger: vault.create/modify on raw/ -> dirty queue
- [ ] Trigger: dirty >= 3 -> batch compile
- [ ] Trigger: vault-ingest -> auto queue
- [ ] query.unified MCP method 接通 unifiedQuery()
- [ ] compile.run MCP method 接通 compile.py

**Worker assignment:** Codex (adapter 实现) + Claude (query 逻辑)

### Phase 5: Agent Scheduler

**Goal:** 自治 agent 根据 vault 状态决定行动, 白天响应 + 夜间主动。

**Success criteria:**
- [ ] scheduler.py 状态机 (IDLE -> EVALUATE -> ACTION -> REPORT -> IDLE)
- [ ] evaluate.py 决策逻辑 (优先级: dirty -> emerge -> reconcile -> prune -> challenge)
- [ ] 阈值可配 (vault-mind.yaml: days_since_emerge, orphan_threshold, etc.)
- [ ] 白天模式: file change -> 标记 dirty, 不主动编译
- [ ] 夜间模式: 全量 evaluate + 执行所有待办
- [ ] agent.status() MCP method: 返回 dirty_count, days_since_emerge, unresolved_contradictions, orphan_count
- [ ] agent.trigger() MCP method: 手动触发指定 action
- [ ] agent.history() MCP method: 返回最近 N 次 action log
- [ ] 日志写入 vault log.md

**Worker assignment:** Claude (状态机设计) + Codex (实现)

### Phase 6: Distribution + Skills

**Goal:** 一键安装, skills 迁入适配 unified query, 新增 vault-health + vault-reconcile。

**Success criteria:**
- [ ] setup.sh: 检测 Node.js/Python/Claude Code/OpenClaw
- [ ] setup.sh: npm install + pip install
- [ ] setup.sh: 交互式生成 vault-mind.yaml
- [ ] setup.sh: 注册 MCP server 到 Claude Code / OpenClaw
- [ ] setup.sh: 安装 skills
- [ ] setup.sh: 可选注册 cron hooks
- [ ] 8 现有 skills 适配 unified query (vault-challenge 引用 _contradictions.md, vault-world L1 拉 adapter 上下文, etc.)
- [ ] vault-health skill: 孤儿/死链/stale/矛盾/覆盖度/frontmatter/重复/风格 8 类审计
- [ ] vault-reconcile skill: 矛盾调和工作流
- [ ] README.md: 安装/使用/架构图/竞品对比
- [ ] GitHub release v1.0

**Worker assignment:** Codex (setup.sh + skill 迁入) + Claude (新 skills) + Gemini (README review)

## MVP Definition

**MVP = Phase 1-4 完成。** 此时 vault-mind 已经:
- 有 MCP server (任何 agent 可接入)
- 有 adapter 体系 (filesystem 默认, obsidian/memU/gitnexus 可选)
- 有自动编译管线 (raw -> concept graph)
- 有统一查询 (多源融合)

这就已经超越 obsidian-second-brain -- 他没有编译器, 没有 MCP, 没有统一查询。

Phase 5-6 是 "从能用到好用" 的完善。

---
*Roadmap created: 2026-04-07*
*Last updated: 2026-04-07 after design spec*
