# Clew — notes for Claude Code

## Who you're working with
- The owner (Illion) is an investor, not a developer — he describes himself as a complete beginner at software. Talk to him in Chinese, explain what you changed and how to try it in plain words, and don't assume he can debug code himself.
- He wants honesty over polish: say when something is untested, unverified, or a guess. Keep facts and inferences separate.
- He uses Windows and the Chrome browser. Model APIs he has: MiMo, Kimi, DeepSeek (Hunyuan HY4 / Qwen possible later).

## What Clew is
A Windows desktop app (Electron) for collecting research "bits" — links, typed thoughts, screenshots — that an LLM tidies up, files under topics, and links into time-ordered chains, so he can catch up on how a story evolved and revisit his own past takes.

## Product decisions already made (don't undo without asking)
- **Layout**: portrait, phone-like single column feed (~480px window). Three top sections: Feed / Reminders / Topics; settings behind the gear.
- **Look**: black / white / grey only, few borders (hairline dividers, no boxed cards). Logo + topic names in DM Serif Display; Chinese titles in Noto Serif SC bold; body in Inter / system sans. UI chrome in casual English; the content itself (titles, summaries) in Chinese.
- **Cards**: show the full summary by default; the chain only expands when tapped ("See the chain"), and older bits in the chain can be peeked in place.
- **Filters**: topic chips on the feed, multi-select (OR), show the first 4, "All N ›" to show the rest.
- **Topics**: fully auto-generated, named by the broadest concrete noun (e.g. "InP" covers InP shortage / yield / export controls; never industry buckets like "半导体"). A bit can belong to several topics. A topic only forms once N bits share the name (default 3, setting `minTopic`); until then they sit in Unsorted.
- **Two layers**: topic → event chains inside it. Each bit has one chain (from its first topic).
- **Relations**: follow-up vs flip (contradicts earlier). Every link shows why it was made.
- **Timeline date rule**: sort by event date; if the report came more than N days after the event (default 30, setting `lateDays`), sort by publish date and mark it "late news". Screenshots with no date sit at the day they were logged.
- **Reminders**: in-app only. Kinds: clash (a new bit flips one of his own takes), dates spotted in content (he confirms), and ones he sets ("Revisit on…").
- **Capture button** is called "Log". Name of the app: Clew (earlier ideas: Linki, Doti — rejected).
- **Data stays local**: one JSON file + images folder in `%APPDATA%\Clew\data`. API keys encrypted with Electron safeStorage (DPAPI on Windows).

## Code map
- `main.js` — app start, windows, IPC, processing queue (one bit at a time).
- `src/store.js` — JSON storage, default provider settings.
- `src/llm.js` — OpenAI-compatible chat call (all providers), JSON extraction from replies.
- `src/pipeline.js` — the prompt (Chinese) and `applyResult`: topics, chains, relations, reminders, timeline placement. Pure functions — test here first.
- `src/extract.js` — reads a page in a hidden window sharing the built-in browser's cookies; uses Mozilla Readability (`src/Readability.js`, Apache-2.0).
- `renderer/` — `index.html` + `app.js` + `styles.css` (main window, vanilla JS, no framework), `browser.html/js` (built-in browser with "Log this page"), `fonts/` (bundled subset).
- `test/pipeline.test.js` — logic tests (`npm test`).
- `test/selftest.js` — end-to-end run against a fake model server. On Linux: `CLEW_SELFTEST=1 CLEW_DATA_DIR=/tmp/clewdata xvfb-run -a npx electron . --no-sandbox` — saves screenshots to `test/out/`.

## Providers (checked 2026-11-14 from official docs; all OpenAI-compatible, editable in Settings)
- MiMo: `https://api.xiaomimimo.com/v1`, model `mimo-v2.5-pro`
- Kimi: `https://api.moonshot.cn/v1` (China keys) or `https://api.moonshot.ai/v1` (global keys), model `kimi-k2.6`
- DeepSeek: `https://api.deepseek.com`, model `deepseek-v4-flash` (`deepseek-chat` was deprecated 2026-07-24)
- Which of these accept images (for the "Eyes" role) is **not verified**. Failure falls back to the user's caption.
- As of v0.1 nothing has been tested with real keys — only with the fake server.

## Building for Windows
- Every push to `main` (code changes, not docs) → GitHub Actions (`.github/workflows/build-windows.yml`) builds on Windows and publishes a Release `vX.Y.Z-build.N` with `Clew-X.Y.Z-win.zip`. Bump `version` in package.json for real releases. It can also be run by hand from the Actions tab. (Pushing git tags from the Claude web session was blocked, hence branch-triggered releases.)
- Locally on Windows: `npm install` then `npm run dist`.

## Known gaps / next ideas
- AI-written "what changed" recap per topic (currently just lists new titles).
- Merge topics; move a bit to another topic/chain by hand.
- Embeddings for better candidate search (currently sends the 60 most recent bits to the model).
- PDF links, app icon, auto-update, Hunyuan/Qwen presets, WeChat chat export as an input.
