# Ezchm

Mac 上的 CHM 阅读器，专为阅读 SQL 存储过程和各类代码文档优化。

- 目录、索引、全文搜索、书签，自动记住每本书读到哪里
- 自动识别页面中的代码块并高亮，SQL 方言（SQL Server、Oracle、MySQL、PostgreSQL）自动识别，也可手动切换
- SQL 一键格式化，能正确缩进 BEGIN/END、IF/ELSE、WHILE、TRY/CATCH、PL/SQL 包和异常处理，随时切回原文
- 代码块可复制、显示行号、自动换行
- 统一的现代排版，浅色/深色主题，多套代码配色，字号可调；也可保留 CHM 原样式
- 可直接打开本地代码文件或文件夹阅读，自动识别 GBK 等编码
- 目录按路径自动整理成树；多标签页
- 智能代码折叠：BEGIN/END、IF、CASE、循环、括号、注释头、声明区，可一键全部折叠
- 高光：点击任意标识符，整页同名标识符一起高亮，区分读取与赋值，滚动条上标出位置，⌥↑/⌥↓ 跳转
- Agent：选中内容后浮出工具条（问 AI、解释、找问题、引用、复制），像 Notion 一样就地提问、就地看结果，键盘 ↑↓ ↵ 操作，可替换选中代码、重试、转到侧栏继续聊；回答默认简洁，可在设置里改为详细；后端是本机 Claude Code；内置解释、逐行注释、找问题、优化改写、涉及对象、流程梳理、测试数据、方言转换
- 代码可编辑：代码文件直接保存，CHM 里的代码块保存为本地编辑副本

## 安装

1. 到 [ezchm-releases](../../../ezchm-releases/releases/latest) 下载最新的 `ezchm_<版本>_aarch64.dmg`（仅支持 Apple 芯片）。
2. 打开 dmg，把 Ezchm 拖进「应用程序」。
3. 应用没有苹果签名，第一次打开会被系统拦下：
   - 先双击打开一次，看到提示后点「完成」；
   - 打开「系统设置 › 隐私与安全性」，在页面下方找到 Ezchm 的提示，点「仍要打开」，输入开机密码确认；
   - 之后就能正常打开了。
4. 可以在访达里对任意 `.chm` 文件右键「打开方式 › Ezchm」，勾选「始终以此方式打开」。

## 更新

Ezchm 启动后会自动检查新版本，弹窗里点「更新」即可，也可以在设置里手动检查。更新包带签名校验。

手动安装新版本时，把新 dmg 里的 Ezchm 拖进「应用程序」覆盖旧版即可。

## 数据

- 书架、阅读进度、书签、设置都保存在 `~/Library/Application Support/Ezchm/data.db`，与应用本体分开，更新或覆盖安装都不会影响。
- 数据库结构升级按版本号顺序执行，只增不删；升级前自动备份到同目录的 `backups/pre-migrate-*.db`，在事务里执行，失败自动回滚。
- 每天自动备份一份到 `backups/daily-*.db`，保留 14 份。

## Agent

Agent 调用本机已安装的 [Claude Code](https://docs.anthropic.com/claude-code)（`claude` 命令），使用它自己的登录状态，Ezchm 不保存任何密钥。找不到时可在「设置 › Agent」里填写 `claude` 的完整路径（终端里运行 `which claude` 查看）。

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 打开 CHM | ⌘O |
| 打开文件夹 | ⇧⌘O |
| 页内查找 | ⌘F |
| 全文搜索 | ⇧⌘F |
| 加书签 | ⌘D |
| 后退 / 前进 | ⌘[ / ⌘] |
| 正文字号 | ⌘= / ⌘- |
| 代码字号 | ⇧⌘= / ⇧⌘- |
| 显示/隐藏侧栏 | ⌘\ |
| 设置 | ⌘, |
| Agent 面板 | ⌘J |
| 引用选中内容到 Agent | ⌘L |
| 编辑 / 保存 | ⌘E / ⌘S |
| 新标签页 / 关闭标签页 | ⌘T / ⌘W |
| 切换标签页 | ⌃Tab / ⌘1…9 |
| 高光跳转 | ⌥↑ / ⌥↓，Esc 取消 |

## 构建与发布

所有编译都在 GitHub Actions 上完成，本地不需要任何开发工具。

- 推送到 `main` 后，`打包 macOS` 工作流在 `macos-latest` 上打出 Apple 芯片（aarch64）安装包，版本号为 `0.1.<运行序号>`，并发布到 `ezchm-releases`，同时生成 `latest.json` 供应用在线更新。
- 本仓库需要两个 secret：
  - `RELEASES_TOKEN`：能向 `ezchm-releases` 发布、并能写本仓库 secrets 的令牌；
  - `TAURI_SIGNING_PRIVATE_KEY`：更新签名私钥，由 `生成签名密钥` 工作流生成并直接写入，公钥会自动提交到 `src-tauri/tauri.conf.json`。
- 缺少任一 secret 时只打包不发布，dmg 可在工作流运行页的 Artifacts 里下载。

本地开发：

```bash
npm install
npm run tauri dev
```

## 许可

CHM 解析使用 [CHMLib](http://www.jedrea.com/chmlib/)（LGPL-2.1）。
