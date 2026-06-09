# ADR 0002：采用 TypeScript 主干与 Python worker

## 状态

已接受，2026-06-09。

## 背景

平台需要同时覆盖 MCP、CLI、领域模型、存储编排、产物生成，以及 mitmproxy、日志解析和统计分析。TypeScript 更适合 MCP 与应用接口生态，Python 更适合 mitmproxy 及后续安全和数据分析工具生态。单一语言会迫使其中一部分能力承担不必要的桥接成本。

## 决策

- TypeScript 是平台主干和项目主状态的唯一所有者。
- TypeScript 负责领域模型、应用服务、MCP/CLI、存储接口、管线编排、运行时 Schema 和产物生成。
- Python worker 负责 mitmproxy 原生接入、特定解析与统计任务，以及未来 Python 工具生态集成。
- TypeScript 与 Python 通过版本化、结构化的 stdio 消息协议通信。
- Python worker 不直接迁移或拥有项目主数据库；需要持久化的结果由 TypeScript 校验后写入。
- worker 必须可替换、可超时、可重启，失败不能破坏已提交的项目状态。

最低运行时冻结为 Node.js 24 LTS（`>=24`）和 Python `>=3.11`；包管理分别使用 pnpm 11 与 uv。

## 影响

正面影响：

- MCP、CLI 与核心领域共享同一套 TypeScript 类型和校验边界。
- 可以直接使用 mitmproxy 等成熟 Python 生态，而无需重写底层工具。
- worker 故障与项目主状态隔离，便于测试和诊断。

代价：

- 仓库需要维护两套语言工具链和跨语言协议 fixture。
- 进程生命周期、错误传递和版本兼容需要专门设计。
- 数据模型不能只依赖语言内类型，必须在边界执行运行时校验。

## 替代方案

- **纯 TypeScript**：工程统一，但 mitmproxy 与部分分析生态接入成本更高。
- **纯 Python**：采集生态便利，但 MCP、Node 工具链与未来 Web 集成需要更多桥接。
- **共享数据库作为进程协议**：实现表面简单，但会造成所有权不清、迁移耦合和并发写入风险。

## 后续工作

- 定义 `worker_protocol_version = 1` 的消息封装、错误模型和能力协商。
- 建立跨语言协议 fixture 与兼容性测试。
- 为 worker 启动、超时、取消和异常退出建立明确行为。
