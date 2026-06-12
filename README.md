# Software Analysis MCP

Software Analysis MCP 是一个面向 AI 编程工具的软件分析基础设施项目。项目计划通过本地采集的网站/API 流量、浏览器轨迹和日志证据，构建可追溯的 API、流程、业务实体与状态模型，并通过 MCP、CLI 和结构化产物提供分析结果。

## 项目状态

项目目前处于**阶段 1：工程基础**。当前已具备 monorepo、核心领域模型、本地工作区、SQLite 初始 migration、Blob Store、默认脱敏/审计服务、最小 Pipeline Runner、CLI 纵切片和 Python worker hello 协议。

当前仓库可以用于：

- 阅读项目范围、架构方向和安全原则。
- 查阅已接受的架构决策记录（ADR）。
- 初始化本地分析工作区并读取项目状态。
- 运行阶段 1 的 TypeScript 与 Python 测试。

当前仓库还不能用于：

- 启动 `software-analysis-mcp` MCP 服务。
- 采集或导入 HTTP/HTTPS 流量、浏览器轨迹或日志。
- 执行分析管线或生成 OpenAPI、Markdown、Postman、SDK 上下文等产物。
- 完整证明权限控制或 raw evidence 授权读取流程已经实现并经过验证。

上述能力属于后续工作包。当前文档描述的是已冻结的设计约束，不代表对应实现已经存在。

## 已冻结的工程基线

| 类别 | 决策 |
| --- | --- |
| Node.js | 24 LTS，`engines.node` 使用 `>=24` |
| Node.js 包管理器 | pnpm 11 |
| Python | `>=3.11` |
| Python 包管理器 | uv |
| npm 命名空间 | `@software-analysis/*` |
| CLI 可执行文件 | `software-analysis` |
| MCP 可执行文件 | `software-analysis-mcp` |
| TypeScript 构建 | tsup |
| TypeScript 测试 | Vitest |
| SQLite 驱动 | better-sqlite3 |
| 查询层 | Kysely |
| 数据库迁移 | 自研事务化 migrations |
| Schema 校验 | Zod |
| CLI 框架 | Commander.js |
| 代码检查与格式化 | ESLint、Prettier |
| 许可证 | Apache-2.0 |

完整冻结项见[工程决策](docs/development/engineering-decisions.md)。

## 架构与安全默认值

- **Local-first**：项目状态和原始证据默认保存在用户选择的本地项目工作区，不要求云服务。
- **Evidence-first**：分析遵循 `Evidence -> Facts -> Findings -> Artifacts`，高层结论必须可追溯到证据引用。
- **默认脱敏**：MCP、AI、常规查询和导出默认只能获得脱敏视图；原始敏感数据访问必须显式授权并写入审计记录。
- **最小网络暴露**：未来的本地服务默认只绑定回环地址，不默认监听公网接口。
- **确定性优先**：LLM 只能作为可选增强阶段，不能修改原始证据，也不能成为基础管线的必需依赖。
- **主状态归 TypeScript**：Python worker 通过版本化协议接收任务并返回结构化结果，不直接拥有项目主状态。

首版 PII 脱敏只承诺检测已支持的候选类别，至少包括电子邮箱、电话号码、常见身份证件号码模式和银行卡号模式，并允许配置规则。启发式检测可能误报或漏报，不承诺识别任意 PII；验收以文档列明的 fixture 与 leakage tests 为准。

这些安全默认值是后续实现必须满足的验收约束。目前尚无可运行实现，因此不能把它们视为已经生效的安全控制。

## 文档

- [文档索引](docs/README.md)
- [总项目计划](docs/software-analysis-mcp-platform-plan.md)
- [冻结的工程决策](docs/development/engineering-decisions.md)
- [开发环境](docs/development/setup.md)
- [本地工作区格式](docs/development/workspace-format.md)
- [安全默认值](docs/development/security-defaults.md)
- [架构决策记录](docs/adr/README.md)

## 当前快速验证

```bash
npx pnpm@11.5.2 install
npx pnpm@11.5.2 lint
npx pnpm@11.5.2 typecheck
npx pnpm@11.5.2 test
npx pnpm@11.5.2 build
uv run --project workers/python pytest
```

当前 CLI 纵切片可以初始化本地工作区并读取状态：

```bash
npx pnpm@11.5.2 build
node packages/cli/dist/index.js init ./demo-analysis --json
node packages/cli/dist/index.js project status --project ./demo-analysis --json
node packages/cli/dist/index.js doctor --json
```

## 版本契约

首个格式和协议版本固定为：

```text
project_schema_version = 1
evidence_schema_version = 1
artifact_schema_version = 1
worker_protocol_version = 1
```

这些版本独立于 npm/Python 包的语义化版本。任何不向后兼容的格式或协议变更都必须提升对应版本，并提供迁移或明确的兼容性处理。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。
