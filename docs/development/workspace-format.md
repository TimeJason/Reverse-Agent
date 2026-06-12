# 本地工作区格式

阶段 1 创建的分析工作区采用 Local-first 布局：

```text
analysis-workspace/
  project.yaml
  .software-analysis/
    db/
    evidence/
      raw/
      normalized/
    blobs/
    artifacts/
    pipelines/
      runs/
    audit/
    cache/
```

## project.yaml

`project.yaml` 面向人类可读，当前版本字段固定为：

```yaml
project_schema_version: 1
evidence_schema_version: 1
artifact_schema_version: 1
worker_protocol_version: 1
```

它还包含项目 ID、workspace ID、项目名称和创建/更新时间。

## SQLite

SQLite 文件位于：

```text
.software-analysis/db/project.sqlite
```

阶段 1 初始 migration 创建：

- `workspaces`
- `projects`
- `capture_sessions`
- `evidence_sources`
- `evidence_index`
- `facts`
- `findings`
- `pipeline_runs`
- `artifacts`
- `redaction_policies`
- `audit_events`
- `schema_migrations`

纯 SQLite migration 使用事务回滚。未来涉及文件系统布局的跨介质 migration 必须使用 migration journal 和可恢复阶段协议。

## Blob

Blob 文件位于 `.software-analysis/blobs/`，当前按 SHA-256 哈希寻址：

```text
.software-analysis/blobs/<hash-prefix>/<hash>
```

SQLite 只保存引用、哈希、媒体类型、大小和脱敏状态等元数据。
