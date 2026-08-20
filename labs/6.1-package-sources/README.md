# 6.1 Package 来源实验

本实验卡覆盖 CLI `-e` 本地绝对路径的 A/B 行为。实验只使用课程自建、无依赖的 Pi Package、隔离的 `PI_CODING_AGENT_DIR` 和本机文件，不读取现有认证文件，不请求 Model，不访问外网，也不安装第三方 Package。

## 第一组：本地路径 A/B

### 实验卡

- 真实场景：通过 CLI `-e` 传入同一个本地 Package 绝对路径，把内容从 A 原地改成 B，判断新 Pi 进程是否继续读取旧内容。
- 待验证结论：这条 CLI `-e` 本地绝对路径链直接加载当前磁盘内容；新 Pi 进程不会继续使用旧 A。
- 固定条件：Pi `0.84.2`、同一绝对路径、同一隔离配置根、每次启动新 Pi 进程、无 Session、无 Model 请求、无外网。
- 唯一变量：`local-package/extensions/source-marker.js` 注册的脱敏标记由 A 改为 B。
- A 预期：帮助输出只包含 `PI_STUDY_PACKAGE_A`。
- B 预期：原地切换后，帮助输出只包含 `PI_STUDY_PACKAGE_B`。
- 通过标准：Source 路径不变，A/B 两次输出准确切换，且反向标记不存在。
- 能证明：通过 CLI `-e` 传入的同一本地绝对路径，在新 Pi 进程中加载当前文件内容，没有继续以旧 A 作为加载来源。
- 不能证明：用户 Settings 或项目 Settings 中的本地路径、CLI `-e` 相对路径、同进程热重载、npm/Git 更新、缓存删除、Package 权限隔离或正式分发可复现。

### 操作边界

`switch-local-marker.mjs` 只允许把本课程 fixture 切换为 A 或 B。实验结束后必须恢复 A，并用 Git 差异确认 fixture 没有残留变化。

自动测试会把 fixture 复制到系统临时目录，以同一绝对路径通过 CLI `-e` 分别启动新 Pi 进程执行 A/B，不修改仓库内基线。自动 Green 只证明实验实现和这条真实 Pi CLI 加载链可运行，不能替代学习者亲自观察两次输出。

## 未覆盖范围

本卡不覆盖用户或项目 Settings、本地相对路径、Git 分支/Tag/Commit、npm 精确版本或版本范围、同进程热重载和缓存清理；这些范围需要各自独立的合同与动态证据。
