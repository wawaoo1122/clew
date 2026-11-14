# Clew

随手收集碎片（链接、想法、截图），让 AI 整理成主题和时间链条，方便复盘和追进度。

Collect bits — links, thoughts, screenshots — and let an LLM file them into topics and time-ordered chains.

## 下载 / Download
到 [Releases](../../releases) 下载最新的 `Clew-x.y.z-win.zip`，解压后双击 `Clew.exe`。压缩包里有《使用说明.txt》。

## 第一次使用
右上角齿轮 → 粘贴 MiMo / Kimi / DeepSeek 任意一个的 API key → Save & test → “Brain” 选一个已连通的模型。

## 开发 / Development
```bash
npm install
npm start        # run the app
npm test         # logic tests
npm run dist     # build the Windows zip (on Windows)
```
See `CLAUDE.md` for architecture and product decisions.

## Third-party
- Mozilla Readability (`src/Readability.js`) — Apache License 2.0, see `src/Readability.LICENSE.md`.
- Fonts in `renderer/fonts/` — Inter, DM Serif Display, Noto Serif SC (SIL Open Font License 1.1), via Fontsource.
