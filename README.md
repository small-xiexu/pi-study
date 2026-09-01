# pi-study

本仓库用于系统学习、实验和记录 Pi Coding Agent，同时把已经验证的项目资源封装为本地 Package `pi-study-workbench`。

## 学习入口

以下课程入口只存在于完整源码仓库；npm 制品不包含 `docs/`、`labs/` 或学习计划。

| 需要做什么 | 入口 | 职责 |
|---|---|---|
| 继续上次学习 | [唯一进度台账](docs/plans/pi-complete-learning-plan.md#当前断点) | 读取当前断点、验收状态和唯一下一步 |
| 复习稳定知识 | [学习资料索引](docs/learning/README.md) | 按主题查阅场景、流程、规则、版本和证据边界 |
| 进入受控实验 | [实验入口](docs/learning/README.md#实验入口) | 找到实验说明、入口文件和最大证明范围 |
| 运行毕业项目 | [8.8 运行手册](labs/8.8-capstone/README.md) | 从默认离线门禁进入双工作面、手工清单和最终 Git 门禁 |

## 毕业综合项目

毕业项目在同一仓库保留两个工作面：7.7 SDK 任务台是带严格 `read` 和精确 fixture Path Gate 的默认安全入口；根 `pi-study-workbench` Package 是拥有完整定制能力的显式 opt-in 入口，不是沙箱。版本、安装、手工验收和证据边界以[总运行手册](labs/8.8-capstone/README.md)为准，源码讲解与受控排查报告见[阶段 8 稳定文档](docs/learning/09-source-and-capstone.md)。

依赖就绪后，默认执行无 Provider 总门禁：

```bash
node labs/8.8-capstone/run-capstone-check.mjs
```

`npm run capstone:check` 是同一入口的根脚本别名。该门禁不安装依赖、不读取 Provider 凭据、不调用真实 Model，也不替代手工验收、Git 冻结或授权提交。

## 本地 Package

`pi-study-workbench` is the local Pi Package produced by this learning repository. The repository root is the Package root, so project discovery and Package loading use the same resource files instead of copied sources.

### Resources

| Type | Resource |
|---|---|
| Extension | `pi-study-guard` |
| Skill | `java-readonly-analysis` |
| Prompt Template | `java-review` |
| Theme | `pi-study-lab` |

The explicit `pi` Manifest in `package.json` controls resource discovery. The npm `files` allowlist controls the tarball and excludes project Settings, tests, test-only fixtures, learning labs, plans, caches, sessions, credentials, and `node_modules`.

### Verification

Run the controlled source/tarball equivalence lab from the root of a full source checkout:

```bash
node labs/6.3-local-package/scripts/run-package-artifact-lab.mjs
```

The `labs/` directory is intentionally excluded from the published tarball, so this command is available only in the full learning repository, not inside an installed or unpacked Package artifact. The lab runs offline with isolated Pi and npm configuration, performs pack and publish dry-runs, inspects a temporary tarball, and compares resource discovery from the source root and unpacked root. It does not publish, install a third-party Package, call a Model, or retain the temporary tarball.

## License

This learning Package is `UNLICENSED`. No permission for public reuse or redistribution is granted unless a separate license is added explicitly.
