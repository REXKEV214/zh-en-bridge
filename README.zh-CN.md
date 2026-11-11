# zh-en-bridge

[English](README.md) | 简体中文

一个 Claude Code 插件：你用中文写 prompt，Claude 用英文干活。输入框上方有一个 **译成英文** 按钮，点一下，输入框里的中文换成英文译文，你检查、修改后再按 Enter 发送。Claude 读到的是英文，也用英文回复，回复再翻回中文显示。界面上你看到的是中文，Claude 那边是英文。

翻译走你配置的任意 OpenAI 兼容模型，默认是阿里云百炼（DashScope）上的通义 `qwen3.7-flash`。

## 缘起

很多中文开发者用中文思考和打字更快，但给 Claude 写英文 prompt 效果往往更好，中文也通常更费 token。开另一个窗口手动翻译又会打断节奏。zh-en-bridge 把这个来回放进 Claude Code 里：

- 英文在发送前就摆在你面前，不会在背后偷偷翻译；
- 翻译按条选择：不点按钮，prompt 就按你写的原样发送；
- 中文只用于显示，Claude 的上下文始终是同一种语言。

## 功能

- 输入框上方的 **译成英文** 按钮：原地翻译输入框里的中文，检查后再发送。
- 你发出的消息显示实际发出去的英文，**中文原文** 按钮可以查看你写的中文；改过译文的消息会标注出来。
- Claude 回复下面的 **中文译文** 按钮在中文译文和英文原文之间切换。用译文发出的 prompt，回复会自动翻译；其他回复只有正文（不算代码）里至少有 20 个英文单词时才出现按钮，点了才翻译。
- 两个方向都保留代码、命令、路径、标识符和 URL 原样。
- 接口、模型和两个方向的翻译 prompt 都可以配置。
- 和 [readable-rewrite-cn](https://github.com/REXKEV214/readable-rewrite-cn) 一起装时，两个插件的按钮排在回复下面同一行。两个插件互不依赖。

## 环境要求

- 支持插件的 Claude Code（终端版或桌面 app）。
- 一个 OpenAI 兼容 chat completions 接口的 API Key（默认用 [阿里云百炼](https://bailian.console.aliyun.com/)）。

## 安装

```bash
claude plugin install zh-en-bridge --marketplace REXKEV214/zh-en-bridge --scope user
```

按下文配好 API Key，新开会话即可使用。

## 使用

**发送英文 prompt**

1. 照常在输入框里用中文写 prompt。
2. 点输入框上方的 **译成英文**，几秒后输入框里的中文换成英文。
3. 检查或修改英文，按 Enter 发送。

- 翻译失败（没配 Key、超时、接口报错）时，输入框不会被改动，会弹出提示说明原因。
- 输入框里没有中文（代码块里的中文不算）时，点按钮不会调用翻译。
- 如果当前界面的输入框插件写不进去，译文会放在输入框上方的草稿框里，可以在那里修改，然后点 **发送英文**（或按 Enter），或者点 **放弃**。
- 翻译后又改回中文发送，就按中文原样发出去。

**看消息**

- 用译文发出的消息显示实际发出去的英文，点亮 **中文原文** 可以看你写的中文，再点一下回到英文。
- 点亮回复下面的 **中文译文** 显示中文，再点一下显示英文原文。
- 子代理的输出不翻译。

**让 Claude 用英文回复**：插件在 system prompt 里加了一段固定说明，要求「用户最新一条消息是什么语言，就用什么语言回复」；用译文发出的 prompt 还会附一条只有模型看得到的「请用英文回复」。

## 配置

配置项是 [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) 里的 `userConfig`：

| 字段 | 说明 | 默认值 |
|---|---|---|
| `api_key` | 翻译接口的 API Key，存进系统钥匙串 | 空 |
| `base_url` | OpenAI 兼容地址，不含 `/chat/completions` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `model` | 模型 ID | `qwen3.7-flash` |
| `extra_body` | 合并进请求体的 JSON；换成不认这个参数的模型时清空 | `{"enable_thinking": false}` |
| `to_english_system` | 中译英的 system prompt | 见 `plugin.json` |
| `to_english_template` | 中译英的 user prompt 模板，`{{text}}` 换成你写的中文 | 见 `plugin.json` |
| `to_chinese_system` | 英译中的 system prompt | 见 `plugin.json` |
| `to_chinese_template` | 英译中的 user prompt 模板，`{{text}}` 换成 Claude 的回复 | 见 `plugin.json` |
| `timeout_seconds` | 单次请求超时（秒） | `30` |

prompt 字段清空就用插件内置的默认值；模板里没有 `{{text}}` 时，原文接在模板后面。

只改其中几项，就只写那几项：

```bash
claude plugin configure zh-en-bridge@zh-en-bridge --values-stdin <<'EOF'
{"base_url": "https://api.example.com/v1", "model": "your-model-id"}
EOF
```

非敏感字段也可以在 Claude Code 的 `/config` 菜单里改。

### API Key 的读取顺序

1. `api_key` 配置项（系统钥匙串）；
2. `~/.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env` 里的 `DASHSCOPE_API_KEY`；
3. 环境变量 `DASHSCOPE_API_KEY`（桌面 app 读不到 shell 里 export 的变量）。

最省事的是 `.env`：

```bash
mkdir -p ~/.claude/plugins/data/zh-en-bridge-zh-en-bridge
cp .env.example ~/.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env
```

填入 Key，新开会话生效。数据目录在插件更新时保留，**卸载插件时会被删掉**。换成别家接口时，Key 也写在 `DASHSCOPE_API_KEY` 这一行，或者直接填 `api_key` 配置项。

## 隐私

被翻译的 prompt 和回复会发到翻译接口（默认是阿里云）。里面可能有代码、路径和项目细节，请自行判断能不能发。

## 开发

```bash
claude plugin test .
claude plugin validate .
```

测试会 mock 掉 HTTP 请求，不会真的调用 API。

[`hooks/actions.ts`](hooks/actions.ts) 是回复下面按钮行的约定：其他插件把按钮放在 key 为 `reply-actions` 的 Box 里，就会和这里的按钮排成一行。readable-rewrite-cn 里有一份相同的文件，改了要两边同步。

发布更新时，先改 `.claude-plugin/plugin.json` 的 `version`，推送后运行：

```bash
claude plugin marketplace update zh-en-bridge && claude plugin update zh-en-bridge@zh-en-bridge
```

## 许可证

[MIT](LICENSE)
