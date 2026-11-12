# zh-en-bridge

English | [简体中文](README.zh-CN.md)

A Claude Code plugin for writing prompts in Chinese while Claude works in English. A **译成英文** (Translate to English) button above the prompt box replaces your Chinese draft with an English translation that you can check and edit before pressing Enter. Claude reads and answers in English, and its replies are shown translated back into Chinese. You read and write Chinese; the conversation Claude sees stays English.

Translation goes through any OpenAI-compatible model you configure. The default is Qwen `qwen3.7-flash` on Alibaba Cloud Model Studio (DashScope).

## Why

Many Chinese-speaking developers think and type faster in Chinese, yet often get better results from Claude with English prompts, and Chinese text usually costs more tokens. Translating by hand in another window breaks the flow. zh-en-bridge does the round trip inside Claude Code:

- you see the English before it is sent, so nothing is translated behind your back;
- translation is opt-in per prompt: without pressing the button, your prompt is sent exactly as written;
- the Chinese is display-only, so Claude's context stays in one language.

## Features

- **译成英文** button above the prompt box: translates the Chinese in the box in place, then you review and send.
- Your sent messages show the English that was actually sent; a **中文原文** (Chinese original) toggle shows the Chinese you wrote, and edited translations are marked as such.
- A **中文译文** (Chinese translation) toggle under Claude's replies switches between the Chinese translation and the English original. Replies to translated prompts are translated automatically; other replies get the button only when their prose (excluding code) has at least 20 English words, and are translated on demand.
- Code, commands, paths, identifiers and URLs are kept as written in both directions.
- API, model and both translation prompts are configurable.
- Works side by side with [readable-rewrite-cn](https://github.com/REXKEV214/readable-rewrite-cn): both plugins put their buttons in the same row under a reply. Neither depends on the other.

## Requirements

- Claude Code (terminal or desktop app) with plugin support.
- An API key for an OpenAI-compatible chat completions endpoint ([Alibaba Cloud Model Studio](https://bailian.console.aliyun.com/) by default).

## Installation

```bash
claude plugin install zh-en-bridge --marketplace REXKEV214/zh-en-bridge --scope user
```

Then set an API key (below) and start a new session.

## Usage

**Sending a prompt in English**

1. Write your prompt in Chinese as usual.
2. Press **译成英文** above the prompt box. After a few seconds the Chinese is replaced with English.
3. Check or edit the English, then press Enter.

- If translation fails (no key, timeout, API error), the box is left unchanged and a notice explains why.
- Lines you quote by starting them with `>` are left exactly as written; only the text around them is translated. Each stretch of text between quotes is translated on its own.
- If the box has no Chinese outside quotes and code blocks, the button does nothing.
- If you keep typing (or send) while the translation is running, the box is left as it is and the translation is dropped; press the button again when ready.
- While the translation sits in the box, **还原中文** (Restore Chinese) next to the button puts your Chinese back and cancels it. Reloading the plugin, or sending the original Chinese unchanged, cancels it too.
- If the plugin cannot write into the prompt box in your current UI, the translation appears in a draft panel above it. Edit it there, then press **发送英文** (Send English) or Enter, or **放弃** (Discard).
- Once you press the button, the next prompt you send counts as the translation however you edit it: it goes out as you left it, shows that text by default, keeps your Chinese behind **中文原文**, and its reply is translated automatically.

**Reading the conversation**

- Your translated messages show the English that was sent. Turn on **中文原文** to see the Chinese you wrote; turn it off to go back to the English.
- Turn on **中文译文** under a reply to read it in Chinese; turn it off for the English original.
- Subagent output is not translated.

**Keeping Claude in English.** Claude sees only the English prompt you sent; nothing is attached to it. The plugin adds a fixed instruction to the system prompt asking Claude to reply in the language of the user's latest message.

## Configuration

Settings live in `userConfig` in [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json):

| Key | Description | Default |
|---|---|---|
| `api_key` | API key for the translation endpoint, stored in the system keychain | empty |
| `base_url` | OpenAI-compatible base URL, without `/chat/completions` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `model` | Model ID | `qwen3.7-flash` |
| `extra_body` | JSON merged into the request body; clear it if your model rejects it | `{"enable_thinking": false}` |
| `to_english_system` | System prompt for Chinese → English | see `plugin.json` |
| `to_english_template` | User prompt template for Chinese → English; `{{text}}` is your draft | see `plugin.json` |
| `to_chinese_system` | System prompt for English → Chinese | see `plugin.json` |
| `to_chinese_template` | User prompt template for English → Chinese; `{{text}}` is Claude's reply | see `plugin.json` |
| `timeout_seconds` | Per-request timeout in seconds | `30` |

An empty prompt field falls back to the built-in default. If a template has no `{{text}}`, the text is appended after it.

Change only the settings you list:

```bash
claude plugin configure zh-en-bridge@zh-en-bridge --values-stdin <<'EOF'
{"base_url": "https://api.example.com/v1", "model": "your-model-id"}
EOF
```

Non-sensitive fields also appear in Claude Code's `/config` menu.

### Where the API key is read from

1. The `api_key` setting (system keychain);
2. `DASHSCOPE_API_KEY` in `~/.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env`;
3. The `DASHSCOPE_API_KEY` environment variable (the desktop app does not see variables exported in your shell profile).

The `.env` file is the simplest option:

```bash
mkdir -p ~/.claude/plugins/data/zh-en-bridge-zh-en-bridge
cp .env.example ~/.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env
```

Fill in the key and start a new session. The data directory survives plugin updates but is **deleted when the plugin is uninstalled**. When using another provider, still put its key on the `DASHSCOPE_API_KEY` line, or set `api_key`.

## Privacy

Translated prompts and replies are sent to the translation endpoint (Alibaba Cloud by default). They may contain code, file paths and project details; decide whether that is acceptable for your work.

## Development

```bash
claude plugin test .
claude plugin validate .
```

Tests mock HTTP requests and never call a real API.

[`hooks/actions.ts`](hooks/actions.ts) defines the shared button row under replies: any plugin that puts its buttons in a Box keyed `reply-actions` joins the same row. readable-rewrite-cn ships an identical copy; keep the two in sync.

To release, bump `version` in `.claude-plugin/plugin.json`, push, then run:

```bash
claude plugin marketplace update zh-en-bridge && claude plugin update zh-en-bridge@zh-en-bridge
```

## License

[MIT](LICENSE)
