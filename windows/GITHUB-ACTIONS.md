# 在 GitHub 网页构建 Windows 版

## 首次配置

1. 登录 GitHub，打开 https://github.com/Stonewuu/ai-fusion-video ，点击右上角 **Fork → Create fork**，将仓库复制到自己的账号。
2. 解压 `FusionVideo-GitHub-Actions-Setup.zip`。包内顶层包含 `.github/` 和 `windows/` 两个目录；不要把 ZIP 文件本身上传到仓库。
3. 打开自己的 Fork，选择 **Code → Add file → Upload files**。将解压后的 `.github` 和 `windows` 两个目录一起拖入上传区，保留目录结构，然后 **Commit changes** 到默认分支（通常是 `main`）。
4. 检查仓库中已存在 `.github/workflows/windows-build.yml` 与 `windows/bundle.ps1`。工作流必须在默认分支，网页才会显示手动运行按钮。
5. 点击 **Actions**；如果 Fork 显示启用工作流的提示，先启用。选择左侧 **Build Windows → Run workflow**。
6. 保持默认分支。首次可以不勾选 `Also publish...`，然后点击绿色 **Run workflow**。
7. 等待所有构建步骤成功，打开本次运行页面，向下找到 **Artifacts → FusionVideo-Windows-x64** 并下载。
8. 解压下载的 Artifact，取出其中的 `FusionVideo-Windows-x64-版本号.zip`，再次解压到 `C:\FusionVideo` 或 `D:\Apps\FusionVideo`，双击 `Start.cmd`。

Artifact 是 GitHub 提供的外层下载包，里面包含应用 ZIP、SHA256SUMS.txt、build-manifest.json 和 smoke.json。完整安装路径须为英文 ASCII 且不含空格。

## 同时发布到 Releases

在 **Run workflow** 时勾选 `Also publish the Windows ZIP to this repository's Releases`。

构建、打包、启动检查全部通过后，工作流会向自己的 Fork 发布一个带唯一 `windows-v...` 标签的 Release，附件包含 Windows ZIP、校验文件和构建信息。使用内置 `GITHUB_TOKEN`；无需配置个人访问令牌、Docker Hub 账号或模型 API Key。`contents: write` 仅授予发布任务，构建任务使用读取权限。

该 Release 不替换上游发布，也不设为仓库默认 latest。原仓库 Docker 工作流使用的版本标签规则与本工作流生成的 Windows 标签分开。

## 后续构建新版

在自己的 Fork 首页点击 **Sync fork → Update branch**，合入上游代码，再执行 **Actions → Build Windows → Run workflow**。保留新增的 `windows/` 目录和 Windows 工作流；若 GitHub 报合并冲突，需要先处理冲突。

下载新版成品后可解压到新的英文目录。若已有项目数据，先停止旧程序，再保留并迁移原 `data/` 和 `config/`；迁移前保留完整旧目录备份。

本配置实现云端构建和成品发布。当前 `Update.cmd` 仍从 Stonewuu 上游正式 Release 下载源码并在本机编译；它尚未改为从个人 Fork 下载云端成品。云端成品自动更新需要独立的更新源配置与资产校验协议，不在此配置中冒充已实现。

## 构建执行内容

- `windows-2022` 托管 Windows 环境。
- 执行更新与回滚事务测试。
- 下载工具链，校验 `windows/toolchain.json` 中的 SHA-256。
- 调用 `windows/bundle.ps1` 编译后端、前端并集成本机运行环境。
- 打包时拒绝包含数据库、密码配置、日志、备份或构建机目录链接的目录。
- 生成 ZIP 和校验值，并执行 ZIP 完整性检查。
- 首次启动服务，检查初始化页面及后端状态，然后正常停止。
- 上传 Artifact；勾选发布时再创建 Release。

## 常见入口问题

| 现象 | 检查 |
| --- | --- |
| 没有 Build Windows | 检查工作流是否放在 `.github/workflows/windows-build.yml`，是否误多套了一层解压目录 |
| 没有 Run workflow | 工作流须提交到默认分支，并具有 `workflow_dispatch`；还需对仓库有写权限 |
| 构建失败 | 打开红色步骤查看日志；失败时不会执行发布任务 |
| Release 发布返回 403 | 检查仓库或组织的 Actions 令牌权限限制；本工作流的发布任务已声明 `contents: write` |
| Artifact 下载后看到另一个 ZIP | 先解开 Artifact 外层包，再解开应用 ZIP |

## 验证范围

本地检查记录另附于交付文件。工作流配置的静态检查与本机脚本验证不等于 GitHub 云端运行成功；首次提交后，以自己的 Actions 实际运行结果为准。

官方参考：

- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
- https://docs.github.com/en/actions/tutorials/store-and-share-data
- https://docs.github.com/en/actions/tutorials/authenticate-with-github_token
