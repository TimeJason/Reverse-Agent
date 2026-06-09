# 安全默认值

## Local-first

原始证据、SQLite 数据库、Blob 和导出产物默认保存在用户选择的本地工作区。当前阶段不上传数据，不启动远程服务。

## 默认脱敏

默认策略覆盖：

- `Authorization`
- `Cookie`
- `Set-Cookie`
- password/passwd 字段
- token 字段
- secret 字段
- API key 字段

PII 只按已支持的候选类别进行启发式检测。首版候选类别至少包括电子邮箱、电话号码、常见身份证件号码模式和银行卡号模式。该能力可能误报或漏报，不承诺识别任意 PII。

## 审计

审计事件通过 `AuditSink` 写入。当前 `AuditService` 会拒绝明显包含 raw secret 的 metadata，避免把敏感值复制到审计日志。

## LLM 边界

阶段 1 不调用 LLM。未来 LLM enrich 必须默认使用脱敏证据，并保留 `evidence_refs`、`confidence` 和 `pipeline_run_id`。

## 当前不支持

- 不支持在线 HTTPS 代理。
- 不支持证书安装。
- 不支持远程团队协作。
- 不支持 raw evidence 授权读取流程。
- 不支持生产级权限模型。
