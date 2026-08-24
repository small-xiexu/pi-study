# pi-study

本仓库用于系统学习、实验和记录 Pi Coding Agent，同时把已经验证的项目资源封装为本地 Package `pi-study-workbench`。

## 学习入口

以下课程入口只存在于完整源码仓库；npm 制品不包含 `docs/`、`labs/` 或学习计划。

| 需要做什么 | 入口 | 职责 |
|---|---|---|
| 继续上次学习 | [唯一进度台账](docs/plans/pi-complete-learning-plan.md#当前断点) | 读取当前断点、验收状态和唯一下一步 |
| 复习稳定知识 | [学习资料索引](docs/learning/README.md) | 按主题查阅场景、流程、规则、版本和证据边界 |
| 进入受控实验 | [实验入口](docs/learning/README.md#实验入口) | 找到实验说明、入口文件和最大证明范围 |

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
