# ADR 0006：格式、协议与发布版本独立演进

## 状态

已接受，2026-06-09。

## 背景

项目包含软件包发布版本、项目工作区格式、Evidence、Artifact 和跨语言 worker 协议。它们的兼容性变化速度不同。如果只使用一个软件版本号，读取端无法判断数据是否可迁移、协议是否可通信，也无法安全拒绝未知格式。

## 决策

初始格式和协议版本固定为：

```text
project_schema_version = 1
evidence_schema_version = 1
artifact_schema_version = 1
worker_protocol_version = 1
```

版本策略：

- 四个版本均为独立演进的正整数，不使用 SemVer 字符串。
- 软件包和项目发布采用语义化版本。
- 仅新增 optional 字段可以保持当前格式版本；读取端必须忽略未知字段。
- 新增 required 字段、删除字段、改变字段含义、改变协议语义，以及既有字段从 required 改为 optional 或从 optional 改为 required，均属于破坏性变更，必须提升对应整数版本。required/optional 任一方向的变化都可能使新写入端与旧读取端不兼容。
- `project_schema_version` 继续覆盖整体项目格式，包括项目清单、SQLite schema、文件引用和工作区布局。
- 纯 SQLite 项目格式 migration 必须在 SQLite 事务中原子执行，失败时完整回滚数据库变更。
- 涉及文件系统或工作区布局的跨介质 migration 必须执行可恢复的阶段协议：预检、写入临时路径或备份、提交数据库变更、文件原子重命名。
- migration journal 必须在各阶段前后持久记录阶段和恢复信息；启动或重试时依据 journal 与数据库提交状态执行恢复、重试或补偿。跨介质 migration 不承诺由单一 SQLite 事务完整回滚，也不得把半迁移状态视为成功。
- 对不支持的更高 Evidence、Artifact 或 worker 协议版本必须明确报错，不能静默猜测或降级。
- worker 建立通信时必须交换或校验协议版本；不兼容时不得执行任务。
- npm 包统一使用 `@software-analysis/*`，CLI 为 `software-analysis`，MCP 可执行文件为 `software-analysis-mcp`。这些公开名称的变更按破坏性发布处理。
- `0.x` 发布允许公开 API 快速演进，但不免除数据迁移、协议拒绝和变更记录要求。

## 影响

正面影响：

- 数据兼容性不再依赖对软件包版本的猜测。
- 项目迁移、跨语言通信和产物消费可以分别判断支持范围。
- 破坏性变化有明确触发条件和失败行为。

代价：

- 发布流程需要同步维护多个版本字段和兼容性 fixture。
- 向后兼容读取、纯 SQLite 回滚和跨介质恢复会增加测试矩阵。
- 开发者必须区分“软件发布版本”和“数据/协议版本”。

## 替代方案

- **所有对象共用项目 SemVer**：简单，但无法表达各格式独立兼容性。
- **每次发布都提升所有 Schema**：易于追踪，但制造无意义迁移并扩大兼容矩阵。
- **无显式版本、按字段探测**：短期灵活，长期会导致歧义解析和不可预测降级。

## 后续工作

- 为四类版本建立 fixture 和兼容性测试。
- 为纯 SQLite migration 建立原子回滚测试，为跨介质 migration 建立各阶段中断、恢复、重试和补偿测试。
- 在项目打开、Evidence 读取、Artifact 导入和 worker 握手处执行版本检查。
- 发布说明必须列出 migration、破坏性变更和支持的格式/协议版本。
