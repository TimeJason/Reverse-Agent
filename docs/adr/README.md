# 架构决策记录

ADR 记录已经接受的长期工程决策。ADR 一旦接受便不直接改写其历史结论；后续如需改变方向，应新增 ADR 说明替代关系，并同步更新[冻结的工程决策](../development/engineering-decisions.md)。

| ADR | 状态 | 决策 |
| --- | --- | --- |
| [0001](0001-local-first.md) | 已接受 | 采用 Local-first 架构 |
| [0002](0002-typescript-core-python-worker.md) | 已接受 | 采用 TypeScript 主干与 Python worker |
| [0003](0003-evidence-first-pipeline.md) | 已接受 | 采用 Evidence-first 管线与单向依赖 |
| [0004](0004-redaction-by-default.md) | 已接受 | 默认脱敏 |
| [0005](0005-local-storage.md) | 已接受 | 采用 SQLite 与文件系统作为本地主存储 |
| [0006](0006-versioning-strategy.md) | 已接受 | 格式、协议与发布版本独立演进 |
