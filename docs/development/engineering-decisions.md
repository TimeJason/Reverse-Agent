# 冻结的工程决策

## 文档状态

- 状态：已接受
- 生效阶段：阶段 1，工作包 1
- 最后更新：2026-06-09

本文是基础工程决策的集中索引。后续工作包必须遵守这些冻结项；如需修改，必须新增或替代 ADR，并同步更新本文和相关文档。

## 运行时与包管理

| 项目 | 冻结值 | 后续配置要求 |
| --- | --- | --- |
| Node.js | 24 LTS | `package.json` 中设置 `"engines": { "node": ">=24" }` |
| pnpm | 11 | 使用 pnpm 11.x；根配置创建时应通过 `packageManager` 固定具体版本 |
| Python | `>=3.11` | Python 项目元数据声明 `requires-python = ">=3.11"` |
| Python 包管理器 | uv | 使用 uv 管理环境、依赖和锁文件，不以 pip/Poetry 作为仓库标准流程 |

Node.js 与 Python 的最低版本是兼容性下限。CI 后续至少覆盖最低支持版本；升级最低版本属于显式兼容性变更。

## 名称与发布边界

| 项目 | 冻结值 |
| --- | --- |
| npm 包命名空间 | `@software-analysis/*` |
| CLI 可执行文件 | `software-analysis` |
| MCP 可执行文件 | `software-analysis-mcp` |

所有第一方 npm 包必须位于 `@software-analysis/*`。可执行文件名属于用户接口，变更时必须按破坏性变更处理。本文不冻结具体包清单，包创建属于后续工作包。

## TypeScript 工具链

| 领域 | 冻结选择 |
| --- | --- |
| 构建器 | tsup |
| 测试 | Vitest |
| SQLite 驱动 | better-sqlite3 |
| 查询层 | Kysely |
| 数据库迁移 | 自研事务化 migrations |
| 运行时 Schema | Zod |
| CLI 框架 | Commander.js |
| 静态检查 | ESLint |
| 格式化 | Prettier |

约束：

- Kysely 是查询与类型化 SQL 层，不负责迁移生命周期。
- migrations 由项目自研的顺序迁移器执行；每个迁移必须在 SQLite 事务中原子提交，并记录已应用版本。
- Zod 负责外部输入、配置、持久化边界和协议消息的运行时校验。
- ESLint 与 Prettier 职责分离：ESLint 检查代码质量，Prettier 负责格式。
- 本工作包只冻结选择，不创建依赖清单、包目录或根构建配置。

## 架构边界

### 语言职责

- TypeScript 是平台主干，拥有领域模型、项目状态、应用编排、存储接口、MCP/CLI 接口和产物生成。
- Python worker 承担 mitmproxy 原生集成、解析、统计分析及未来 Python 工具生态接入。
- Python worker 不直接拥有或迁移项目主数据库；它通过版本化协议接收任务并返回结构化结果。

### 管线与依赖方向

标准管线固定为：

```text
Evidence -> Facts -> Findings -> Artifacts
```

- Provider 只能产生或导入 Evidence。
- Facts 必须由 Evidence 派生，并保留证据引用。
- Findings 必须由 Facts 和 Evidence 支撑，并包含置信度与证据引用。
- Exporter 只能消费结构化 Facts/Findings，不得重新解析 raw evidence。
- LLM 只能作为可选 enrich 阶段，不能修改 raw evidence，也不能让确定性分析依赖模型供应商。
- MCP、CLI 和未来 Web/API 接口必须通过应用服务访问领域与存储，不得直接访问 SQLite。

### 本地存储

- SQLite 是项目元数据、索引、Facts、Findings、产物元数据和审计日志的事务性主存储。
- 文件系统保存大型或原始 evidence body、导入文件和导出产物；SQLite 只保存引用、哈希、类型、大小和脱敏状态等元数据。
- better-sqlite3 提供 SQLite 连接，Kysely 提供查询层，自研事务化 migrations 管理 schema 演进。
- DuckDB 可在后续作为可选的分析加速层，但不是阶段 1 的主状态存储，也不进入本工作包的冻结依赖。

## 安全默认值

- 原始证据默认留在本地项目工作区。
- MCP、AI、常规查询、日志和导出默认使用脱敏视图。
- 默认脱敏至少覆盖凭据、会话标识、Cookie、令牌、密码、密钥和可识别个人信息。
- 对 raw evidence 或未脱敏值的访问必须显式请求、由策略允许，并写入审计日志。
- 日志、错误消息和审计元数据本身不得泄漏 raw secret。
- 未来本地 HTTP 服务默认只绑定回环地址。
- 未实现的控制不得在文档或发布说明中宣称已经生效。

## 格式与协议版本

初始版本固定为：

| 版本字段 | 初始值 | 适用范围 |
| --- | ---: | --- |
| `project_schema_version` | 1 | 项目清单、工作区布局及项目级持久化契约 |
| `evidence_schema_version` | 1 | 标准化 evidence 与 evidence 引用 |
| `artifact_schema_version` | 1 | 结构化导出产物及其元数据 |
| `worker_protocol_version` | 1 | TypeScript 主干与 Python worker 的消息协议 |

版本规则：

- 四个版本是正整数，彼此独立演进，不与软件包版本绑定。
- 向后兼容的字段增加可以保持当前版本，但读取端必须容忍未知字段。
- 删除字段、改变含义、改变必填性或改变消息语义属于破坏性变更，必须提升对应版本。
- `project_schema_version` 的升级必须提供事务化 migration；迁移失败必须回滚，不能留下半迁移状态。
- Evidence、Artifact 或 worker 协议遇到不支持的更高版本时必须明确拒绝，不能静默降级或猜测解析。
- 软件包和发布版本采用语义化版本；在 `0.x` 阶段公开接口仍可快速演进，但不能绕过上述数据与协议版本规则。

## 许可证

项目许可证固定为 Apache-2.0。许可证正文见仓库根目录的 [LICENSE](../../LICENSE)。

## 关联 ADR

- [ADR 0001：采用 Local-first 架构](../adr/0001-local-first.md)
- [ADR 0002：采用 TypeScript 主干与 Python worker](../adr/0002-typescript-core-python-worker.md)
- [ADR 0003：采用 Evidence-first 管线与单向依赖](../adr/0003-evidence-first-pipeline.md)
- [ADR 0004：默认脱敏](../adr/0004-redaction-by-default.md)
- [ADR 0005：采用 SQLite 与文件系统作为本地主存储](../adr/0005-local-storage.md)
- [ADR 0006：格式、协议与发布版本策略](../adr/0006-versioning-strategy.md)
