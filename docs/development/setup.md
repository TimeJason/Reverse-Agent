# 开发环境

## 版本要求

- Node.js：24 LTS 或更高的 24+ 兼容版本。
- pnpm：11.5.2，仓库通过 `packageManager` 固定。
- Python：3.11 或更高。
- Python 包管理器：uv。

## 安装

```bash
npx pnpm@11.5.2 install
```

如果 pnpm 提示构建脚本审批，仓库已在 `pnpm-workspace.yaml` 中允许 `esbuild` 和 `better-sqlite3`。不要交互式批准未知依赖。

## 常用命令

```bash
npx pnpm@11.5.2 format:check
npx pnpm@11.5.2 lint
npx pnpm@11.5.2 typecheck
npx pnpm@11.5.2 test
npx pnpm@11.5.2 build
uv run --project workers/python pytest
```

阶段 1 预留了以下测试套件脚本，但当前只输出明确跳过信息：

```bash
npx pnpm@11.5.2 test:contract
npx pnpm@11.5.2 test:golden
npx pnpm@11.5.2 test:e2e
npx pnpm@11.5.2 test:security
npx pnpm@11.5.2 test:bench
```

## 当前可运行能力

```bash
npx pnpm@11.5.2 build
node packages/cli/dist/index.js init ./demo-analysis --json
node packages/cli/dist/index.js project status --project ./demo-analysis --json
node packages/cli/dist/index.js doctor --json
```

当前阶段尚不支持在线抓包、HAR 导入、正式 MCP Server、OpenAPI 导出或浏览器采集。
