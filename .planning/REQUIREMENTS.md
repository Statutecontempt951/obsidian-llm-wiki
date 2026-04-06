# Requirements: vault-mind

**Defined:** 2026-04-07
**Core Value:** 知识不编译就是垃圾 -- 自动把 raw notes 编译成可查询的结构化知识图谱

## v1 Requirements

### MCP Interface (Layer 0)

- [ ] **MCP-01**: MCP server TypeScript 重写, stdio transport
- [ ] **MCP-02**: vault.* methods 迁入 (read/create/modify/append/delete/rename/search/searchByTag/searchByFrontmatter/graph/backlinks/batch/lint/list/stat/exists)
- [ ] **MCP-03**: compile.* methods (status, run, diff, abort)
- [ ] **MCP-04**: query.* methods (unified, search, explain)
- [ ] **MCP-05**: agent.* methods (status, trigger, schedule, history)
- [ ] **MCP-06**: Bearer token auth

### Adapter System (Layer 1)

- [ ] **ADAPT-01**: VaultMindAdapter interface 定义
- [ ] **ADAPT-02**: adapter-filesystem 默认实现 (ripgrep/glob search, read, write)
- [ ] **ADAPT-03**: adapter-obsidian (WS proxy, graph, events) -- 可选
- [ ] **ADAPT-04**: adapter-memu (PG search, embeddings) -- 可选
- [ ] **ADAPT-05**: adapter-gitnexus (MCP 转发) -- 可选
- [ ] **ADAPT-06**: adapter 注册 + 自动发现 (vault-mind.yaml)

### Unified Query (Layer 1)

- [ ] **QUERY-01**: 多 adapter 并行搜索 + 融合排序
- [ ] **QUERY-02**: 结果标注来源 (vault/memU/gitnexus)
- [ ] **QUERY-03**: adapter 搜索失败不阻塞其他 adapter
- [ ] **QUERY-04**: 权重可配 (vault=1.0, memU=0.8, gitnexus=0.6 默认)

### Knowledge Compiler (Layer 2)

- [ ] **COMP-01**: compile.py 编排管线 (diff -> chunk -> extract -> merge -> write -> index -> report)
- [ ] **COMP-02**: 增量编译 (kb_meta.py diff 只处理 new/changed)
- [ ] **COMP-03**: LLM extraction 输出 JSON (summary, concepts[], relationships[], claims[])
- [ ] **COMP-04**: model tier 可配 (haiku/sonnet/opus)
- [ ] **COMP-05**: 矛盾检测 (claims 比对, severity: direct/nuanced/temporal)
- [ ] **COMP-06**: 矛盾写入 wiki/_contradictions.md
- [ ] **COMP-07**: 覆盖度追踪 (per-concept source count, low/medium/high)
- [ ] **COMP-08**: 编译报告 (N sources, M concepts, K contradictions)

### Compile Triggers (Layer 2)

- [ ] **TRIG-01**: vault.create/modify 写入 raw/ -> 标记 dirty
- [ ] **TRIG-02**: dirty >= 3 -> 触发批量编译
- [ ] **TRIG-03**: compile.run -> 立即编译所有 dirty
- [ ] **TRIG-04**: vault-ingest 完成 -> 自动 queue 编译

### Agent Scheduler (Layer 3)

- [ ] **AGENT-01**: 状态机 (idle -> evaluate -> action -> report -> idle)
- [ ] **AGENT-02**: evaluate 决策逻辑 (dirty->compile, stale->emerge, contradictions->reconcile, orphans->prune)
- [ ] **AGENT-03**: 白天响应式 (标记 dirty, 不主动编译)
- [ ] **AGENT-04**: 夜间主动式 (全量 evaluate + 执行)
- [ ] **AGENT-05**: 阈值可配 (vault-mind.yaml)
- [ ] **AGENT-06**: agent.status() 返回 vault 状态 (dirty_count, days_since_emerge, etc.)

### Distribution

- [ ] **DIST-01**: setup.sh 一键安装 (检测 Node/Python/Claude Code/OpenClaw)
- [ ] **DIST-02**: vault-mind.yaml 配置文件 + example
- [ ] **DIST-03**: skills 迁入 ~/.claude/skills/vault-mind/ 或 OpenClaw skills/
- [ ] **DIST-04**: cron hooks 迁入 + 注册

### Skills

- [ ] **SKILL-01**: 8 现有 skills 迁入 + 适配 unified query
- [ ] **SKILL-02**: vault-health 新 skill (孤儿/死链/stale/矛盾/覆盖度/frontmatter/重复/风格)
- [ ] **SKILL-03**: vault-reconcile 新 skill (矛盾调和)

## v2 Requirements

### Advanced Adapters

- **ADAPT-V2-01**: adapter SDK (社区可写自己的 adapter)
- **ADAPT-V2-02**: adapter 热加载 (不重启 MCP server)

### Compiler Enhancements

- **COMP-V2-01**: 编译缓存 (相同 raw 不重新 extract)
- **COMP-V2-02**: 多语言 extraction (中英混合 raw -> 统一 concept)
- **COMP-V2-03**: PDF/audio transcript 直接 ingest

### Agent Enhancements

- **AGENT-V2-01**: 学习用户模式 (哪些时间段用户活跃, 调整调度)
- **AGENT-V2-02**: 编译质量反馈循环 (用户纠正 concept -> 调整 extraction prompt)

## Out of Scope

| Feature | Reason |
|---------|--------|
| 内置 dreamtime | 独立系统, 通过 MCP 调用 vault-mind |
| Web UI / Dashboard | headless MCP server, UI 是消费者的事 |
| 多用户 / RBAC | 面向个人 power user |
| adapter-dreamtime 在此 repo | 由 dreamtime 项目维护 |
| 移动端 | MCP server 运行在桌面/服务器 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MCP-01~06 | Phase 1-2 | Pending |
| ADAPT-01~06 | Phase 2 | Pending |
| QUERY-01~04 | Phase 3 | Pending |
| COMP-01~08 | Phase 3-4 | Pending |
| TRIG-01~04 | Phase 4 | Pending |
| AGENT-01~06 | Phase 5 | Pending |
| DIST-01~04 | Phase 6 | Pending |
| SKILL-01~03 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 after design spec*
