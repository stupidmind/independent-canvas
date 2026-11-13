# 独立画布

在一张画布上放聊天、资料和分支。把资料卡连到聊天卡，提问时模型就能参考它。

## 下载使用

从仓库的 **Releases** 下载 Mac 分享版。适用于 Apple 芯片 Mac 和 macOS 13 或更新版本。解压后把「独立画布.app」拖到「应用程序」并打开。分享版使用本地签名，尚未经过 Apple 公证。

- 画布支持分支、分组、叠卡、撤销和本地备份。
- 资料支持 PDF 原页预览、现代 Office 文档、文本、图片和手绘。
- AI 聊天可以使用本机已有的 Codex 登录，或从「管理 → 模型服务」配置兼容 API 或本机 Ollama。生成图片和语音转写需要对应的服务。
- 从「文件 → 打开本地保存目录」可找到画布和附件。

独立画布是参考 Slashspace 客户端行为开发的独立应用。聊天历史保存在本机画布里。Codex 在临时会话中处理每次请求。

## 从源码运行

需要 Node.js 22 或以上，以及带有 `pypdf`、`pypdfium2`、`Pillow`、`openpyxl`、`python-pptx` 的 Python 环境。可用 `PYTHON_BIN` 指定解释器。运行 `node server.mjs`，再打开 <http://127.0.0.1:4317/>。可用 `CODEX_BIN` 指定 Codex CLI。

运行测试前，再给同一 Python 环境安装 `reportlab`。测试命令为 `node --test *.test.mjs backend/*.test.mjs`。

桌面打包脚本位于 `desktop/`。在 Apple 芯片 Mac 安装该目录的 Electron 依赖和运行时后，运行 `node desktop/build-share.mjs /path/to/python3.12`。打包需要可迁移的独立 Python 3.12 运行时，且其中已安装上述文件处理依赖。第三方组件的许可证随对应文件分发。
