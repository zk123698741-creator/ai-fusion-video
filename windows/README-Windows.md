# 融光 Windows 免安装版

适用 Windows 10/11 x64。解压到 `C:\FusionVideo` 或 `D:\Apps\FusionVideo` 等纯英文、无空格可写目录，双击 `Start.cmd`，启动成功后自动打开浏览器。完整目录路径均须使用 ASCII 字符且不含空格；启动器会在创建数据前检查。首次启动按页面提示创建管理员，再配置模型服务商和 API Key。日常运行无需 Docker、Java、Node.js、MySQL 或 Redis 的系统安装。

本包是“本机服务 + 浏览器界面”。应用、数据库、缓存均在本机运行，默认只监听 `127.0.0.1`。初始访问地址为 `http://127.0.0.1:18088`。

| 入口 | 操作 |
| --- | --- |
| `Start.cmd` | 启动并打开界面；首次启动初始化数据库 |
| `Stop.cmd` | 停止本包启动的服务，关闭浏览器后也可使用 |
| `Update.cmd` | 检查上游正式 Release，有新版时编译并切换 |
| `Rollback.cmd` | 恢复最近一次更新前的程序及数据快照 |

## 更新

双击 `Update.cmd`。更新需要联网访问 GitHub、npm 和 Maven 仓库，并预留编译和备份空间。JDK、Node 和 npm 已随包附带，应用更新无需另装编译环境。执行期间保留命令窗口。

1. 从上游 `releases/latest` 解析正式版本号，跳过相同或更低版本。
2. 下载对应 Tag 源码，记录 SHA-256，按该版本锁文件安装依赖并构建前后端。此时旧应用继续运行。
3. 构建成功后停止旧应用，冷备份 `data/` 和 `config/` 到 `backups/时间戳/`。
4. 切换 `current.txt`，启动新版本并检查后端初始化接口、前端页面和统一入口。
5. 启动或健康检查失败时，恢复旧程序指针、数据库、素材和配置，再启动旧版本。

手动回滚会将数据恢复到更新前的时间点；回滚前的现有数据也会另存一份备份。备份和旧版本不会自动删除。

应用启动时若提示更新中断，运行 `Rollback.cmd` 按更新日志恢复。若提示端口占用，确认其他实例已停止；需要改端口时先停止程序，再编辑 `config/windows.json` 中的端口。

未来上游若变更构建协议、数据库依赖或 Node/Java 要求，构建会显示具体错误，需更新 Windows 封装。`Update.cmd` 更新应用，不替换附带的 MySQL、Redis、Java、Node 和 FFmpeg 版本。Windows 封装脚本随本包及源码包提供。

## 数据与目录

| 路径 | 内容 |
| --- | --- |
| `releases/` | 不同版本的应用程序 |
| `current.txt` | 当前程序版本目录名 |
| `runtime/` | 内置 JDK、Node、MySQL、Redis、FFmpeg |
| `data/mysql/` | MySQL 数据库 |
| `data/redis/` | Redis 持久化数据 |
| `data/data/media/` | 默认本地素材 |
| `data/data/agent-workspace/` | 默认 Agent 工作区 |
| `config/` | 随机生成的本地服务密码、端口及启动配置 |
| `backups/` | 更新与回滚前的冷备份 |
| `logs/` | 启动与各服务日志 |
| `.runtime/` | 实例锁、更新工作区及中断恢复日志 |

迁移本机数据：运行 `Stop.cmd`，等待正常停止，再复制完整目录到新位置。Redis 配置和其他绝对路径会在下次启动时重新生成。

## 版本与来源

应用版本见 `current.txt` 指向的 `releases/版本目录/version.json`。通过 GitHub Actions 构建的包同时包含 `build-manifest.json`，记录实际源码提交及工具链。Windows 封装版本为 `windows.1`；`Update.cmd` 后续跟随版本号更高的上游正式 Release。网页构建步骤见源码中的 `windows/GITHUB-ACTIONS.md`。

内置 Temurin JDK 21.0.13+9、Node.js 24.18.0、MySQL Community 8.4.7、Redis Windows MSYS2 8.10.3、FFmpeg 9.0.2 essentials。原始许可证随各运行时目录保留。MySQL 使用的 Visual C++ 运行库取自本包的 Temurin JDK；对应许可位于 `runtime/java/legal/`。Redis 为社区 Windows 移植版。

- 应用源码与 MIT 许可：https://github.com/Stonewuu/ai-fusion-video
- Temurin 源码与发行版：https://github.com/adoptium/temurin21-binaries
- Node.js 源码：https://github.com/nodejs/node/tree/v24.18.0
- MySQL 源码与许可：https://dev.mysql.com/downloads/mysql/
- Redis Windows 构建脚本：https://github.com/redis-windows/redis-windows/tree/8.10.3
- Redis 源码与许可：https://github.com/redis/redis/tree/8.10.3
- FFmpeg 构建、源码与许可：https://www.gyan.dev/ffmpeg/builds/ ，https://ffmpeg.org/download.html

精确下载链接及校验值见 `windows/toolchain.json`。这些值为本次下载档案的固定指纹；JDK 指纹也与发行 API 返回值核对。

## 从源码重建

在 Windows 源码根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\bundle.ps1 -Destination D:\Builds\FusionVideo-Windows-x64
```

首次重建需要联网下载工具链。构建脚本保留前后端测试源码编译，但 Maven 打包使用 `-DskipTests`；本包验证范围见独立交付验证记录。更新事务测试：

```powershell
node --test windows/transaction.test.mjs
```

Windows 兼容处理：Redis 使用相对配置路径；JVM 显式指定本包套接字临时目录，避开 MSIX 启动器继承的 TEMP 重定向问题；Next.js 的 pnpm 运行时依赖物化并检查版本冲突，发行包无构建机目录链接。上游 MySQL 的 Windows 参数解析及 AgentScope 的嵌套 JAR URI 解析对非英文或空格路径存在限制，因此本封装在启动前检查并提示使用纯英文、无空格目录。任意中文、空格路径的完整支持属于后续兼容工作。

AI 对话、图像和视频生成需要自行配置可用的模型服务；本包未内置服务商账户或 API Key。
# EXE 安装包

`FusionVideo-Windows-x64-版本号-Setup.exe` 提供安装向导、开始菜单和桌面快捷方式。按当前用户安装，无需管理员权限。选择无空格的英文目录；默认目录不符合要求时，可改为有写入权限的 `D:\FusionVideo`。

安装包用于首次安装，拒绝覆盖已有程序或数据目录。已有版本使用 `Update.cmd` 更新，使用 `Rollback.cmd` 回滚。卸载前运行 `Stop.cmd`，卸载保留运行后生成的配置、数据库、媒体和备份。

