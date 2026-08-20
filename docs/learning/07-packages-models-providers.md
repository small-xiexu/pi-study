# Packages、Models 与 Providers

本文按 Pi `0.84.2` 记录已经核对的稳定知识、实验方法和证据边界。学习状态和验收结论只记录在 [完整学习计划](../plans/pi-complete-learning-plan.md) 中。

## Pi Package 解决什么问题

阶段 4 的 Prompt、Skill、Theme 和阶段 5 的 Extension 原本分散在项目目录中。Pi Package 的作用是把这些资源组织成一个可加载、可安装和可分发的来源，让个人调试、团队协作和正式交付可以使用同一套资源。

一个来源从声明到生效经历以下链路：

1. Settings、`pi install` 或临时 `-e` 提供 Source。
2. Pi 判断它是 npm、Git 还是本地路径，并计算 Package 身份。
3. npm 和 Git 来源解析到受 Pi 管理的安装目录；本地路径直接指向原文件或目录，不复制内容。
4. Pi 按 Package Manifest 或约定目录发现 Extension、Skill、Prompt 和 Theme。
5. 后续更新是否改变实际内容，取决于 Source 指向的是可移动目标还是固定快照。

Package 只是资源的组织和分发边界，不是权限沙箱。Package 中的 Extension 可以执行代码，Skill 也可以引导 Model 使用工具；安装第三方 Package 前仍需审查来源和内容。

## 三类来源

| 来源 | Package 身份 | 用户级解析位置 | 项目级解析位置 | 内容变化方式 |
|---|---|---|---|---|
| npm | 包名，不包含版本 | `~/.pi/agent/npm/` | `.pi/npm/` | 安装或更新到满足 Source 的版本 |
| Git | 规范化后的 `host/path`，不包含协议与 ref | `~/.pi/agent/git/<host>/<path>` | `.pi/git/<host>/<path>` | 获取并对齐配置的分支、Tag 或 Commit |
| 本地路径 | 解析后的绝对路径 | 原路径 | 原路径 | 直接读取原地文件变化，不复制、不下载 |

SSH、HTTPS 等不同写法经规范化后可能归为同一个 Git identity。同一个 Package 同时出现在用户和项目 Settings 时，项目条目通常优先；例外是项目条目设置 `autoload: false` 时，它作为用户条目的 delta 应用，两条记录都会保留，不是简单替换。

Settings 中的本地相对路径按 Settings 所在配置目录解析：用户级以 Pi agent 目录为基准，项目级以项目 `.pi/` 目录为基准。

### CLI `-e` 临时作用域

`-e` 把 Source 作为当前 Pi 运行的 temporary scope 输入，不写入用户或项目 Settings。CLI 会先把本地相对路径按启动 `cwd` 解析为绝对路径；本地 Source 随后直接读取该文件或目录。npm 与 Git Source 则安装或克隆到 Pi agent 目录下的 `tmp/extensions/` 管理目录。

temporary scope 描述配置与本次加载的作用域，不承诺进程退出后立即删除磁盘内容。Pi `0.84.2` 的 Git 实现会在刷新失败时保留已有 temporary checkout，因此“不写 Settings”不能推出“缓存必然删除”。临时加载也不是沙箱，来源中的 Extension 仍在 Pi 进程权限下运行。

## Git 分支与 Commit

Git 分支是指向某个 Commit 的可移动名称，Commit SHA 是一份固定历史快照。

假设 `main` 最初指向提交 A，Package 内容为 `PACKAGE_A`。开发者提交新内容后产生提交 B，`main` 随即前进到 B；提交 A 本身没有变化。

| 配置目标 | 远端新增 B 后 | 适用场景 |
|---|---|---|
| Git 分支 `main` | 更新并重新对齐该分支后可能从 A 变成 B | 跟随持续开发 |
| Git Commit A 的完整 SHA | 仓库出现 B 后仍保持 A | 团队复现、测试基线、正式交付 |

因此，“Source 字符串写了 `@main`”只固定了分支名称，没有固定分支背后的内容。分支可以前进、回退或被强制改写。只有 Commit SHA 直接标识不可变的 Git 对象。

Pi `0.84.2` 会把带 `@ref` 的 Git Source 视为已指定 ref，但这里的“已指定”不能等同于“内容不可变”：如果 ref 是分支或被重指向的 Tag，更新时重新解析该 ref 仍可能得到另一个 Commit。正式复现应记录完整 Commit SHA，并核对实际 checkout 的 `HEAD`。

完整 Commit SHA 固定的是 Git 对象身份。它不保证该对象永远能从远端取得，也不固定仓库外依赖、安装脚本结果、Node/npm/Pi 版本、操作系统或运行环境，因此是源码快照固定点，不等于完整供应链可复现。

## 证据类型与边界

- Pi `0.84.2` 随包 `docs/packages.md`、`dist/core/package-manager.js` 和 `dist/utils/git.js` 属于静态证据，可支持本版本的 Source 身份、解析目录和更新分支；它们不能证明某次运行已经经过这些分支。
- 课程自动测试把 fixture 复制到同一临时绝对路径，A/B 两次分别启动新 Pi 进程并通过 CLI `-e` 加载，覆盖 A-only -> B-only。这只证明该实验实现和这条 CLI `-e` 本地绝对路径链可运行。
- 上述自动证据不动态覆盖用户 Settings、项目 Settings、CLI `-e` 相对路径、同进程热重载、Git/npm A/B、缓存删除或学习者亲自操作，也不能外推到真实 Provider、生产环境、安全隔离或任意版本。
- 学习者实操、当前进度、验收结论和下一步只以完整学习计划为准。

第一组实验卡和课程 fixture 位于 [`labs/6.1-package-sources/`](../../labs/6.1-package-sources/README.md)。
