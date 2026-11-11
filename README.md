# zh-en-bridge

一个 Claude Code mod。输入框上方有一个 **译成英文** 按钮：写好中文 prompt 后点一下，输入框里的中文会换成英文译文，你检查、修改后再按 Enter 发送。Claude 读到的是英文，也用英文回复，回复再翻回中文显示。界面上你看到的是中文，Claude 那边是英文。

翻译默认用通义 `qwen3.7-flash`（阿里云百炼 / DashScope 的 OpenAI 兼容接口），接口、模型和两个方向的翻译 prompt 都可以在配置里换。

- 不点按钮，prompt 就按你写的原样发送，插件不调用翻译接口。
- 对话记录里存的是英文：发出去的英文 prompt 和 Claude 的英文原回复。中文只用于界面显示，不进入模型上下文。
- 被翻译的 prompt 和回复会发到翻译接口（默认是阿里云）。里面可能有代码、路径和项目细节，请自行判断能不能发。

## 使用

**发送英文 prompt**：
1. 照常在输入框里用中文写 prompt。
2. 点输入框上方的 **译成英文**。按钮显示「翻译中…」，几秒后输入框里的中文换成英文。
3. 检查或修改英文，按 Enter 发送。

- 翻译失败（没配 Key、超时、接口报错）时，输入框里的中文不会被改动，会弹出提示说明原因。
- 输入框里没有中文（代码块里的中文不算）时，点按钮不会调用翻译。
- 如果当前界面的输入框插件写不进去，译文会放在输入框上方的草稿框里，可以在那里修改，然后点 **发送英文**（草稿框里按 Enter 也行），或者点 **放弃**。
- 点完按钮又改回中文发送，就按中文原样发出去。

**看消息**：
- 你用译文发出的消息显示你写的中文，下面的 **发送的英文** 按钮点亮后显示实际发出去的英文，再点一下回到中文。修改过译文的消息会标注「经你修改后发送」。
- Claude 的回复下面有 **中文译文** 按钮：点亮时显示中文译文，再点一下显示英文原文。用译文发出的 prompt，Claude 的回复会自动翻译；其他回复只有正文（不算代码）里至少有 20 个英文单词时才出现这个按钮，点了才翻译。
- 子代理的输出不翻译。
- 装了 readable-rewrite-cn 的话，两个插件在回复下面的按钮会排在同一行。两个插件互不依赖，各装各的、各配各的。

**让 Claude 用英文回复**：system prompt 里有一段固定说明，要求「用户最新一条消息是什么语言，就用什么语言回复」；用译文发出的 prompt 旁边还会附一条只有模型看得到的「请用英文回复」。

## 配置

`plugin.json` 的 `userConfig`：

| 字段 | 说明 | 默认值 |
|---|---|---|
| `api_key` | 翻译接口的 API Key（存进系统钥匙串） | 空 |
| `base_url` | OpenAI 兼容地址，不含 `/chat/completions` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `model` | 模型 ID | `qwen3.7-flash` |
| `extra_body` | 合并进请求体的 JSON；换成不认这个参数的模型时清空 | `{"enable_thinking": false}` |
| `to_english_system` | 中译英的 system prompt | 见 `plugin.json` |
| `to_english_template` | 中译英的 user prompt 模板，`{{text}}` 换成你写的中文 | 见 `plugin.json` |
| `to_chinese_system` | 英译中的 system prompt | 见 `plugin.json` |
| `to_chinese_template` | 英译中的 user prompt 模板，`{{text}}` 换成 Claude 的回复 | 见 `plugin.json` |
| `timeout_seconds` | 单次请求超时（秒） | `30` |

prompt 字段清空就用插件内置的默认值；模板里没有 `{{text}}` 时，原文接在模板后面。

只想改其中几项，就只写那几项：

```bash
claude plugin configure zh-en-bridge@zh-en-bridge --values-stdin <<'EOF'
{"base_url": "https://api.example.com/v1", "model": "your-model-id"}
EOF
```

非敏感字段也会出现在 Claude Code 的 `/config` 菜单里，改完 mod 会自动重载。

### API Key 放哪

读取顺序：
1. `api_key` 配置项（系统钥匙串）；
2. 插件数据目录里的 `.env`：`~/.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env` 中的 `DASHSCOPE_API_KEY`；
3. 环境变量 `DASHSCOPE_API_KEY`（桌面 app 读不到 shell 里 export 的变量）。

推荐第 2 种：

```bash
mkdir -p ~/.claude/plugins/data/zh-en-bridge-zh-en-bridge
cp .env.example ~/.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env
```

然后编辑这个文件填入 Key，新开会话生效。数据目录在插件更新时保留，**卸载插件时会被删掉**。换成别家接口时，Key 也写在 `DASHSCOPE_API_KEY` 这一行（变量名沿用默认服务商），或者直接填 `api_key` 配置项。

## 安装

从 GitHub 私有仓库 [REXKEV214/zh-en-bridge](https://github.com/REXKEV214/zh-en-bridge) 安装，本机 git 要能访问它（`gh auth login` 或 SSH key）：

```bash
claude plugin install zh-en-bridge --marketplace REXKEV214/zh-en-bridge --scope user
```

发布更新时，先改 `.claude-plugin/plugin.json` 的 `version`，推送后运行：

```bash
claude plugin marketplace update zh-en-bridge && claude plugin update zh-en-bridge@zh-en-bridge
```

## 开发

```bash
claude plugin test .
claude plugin validate .
```

测试会 mock 掉 HTTP 请求，不会真的调用 API。`hooks/actions.ts` 是回复下面按钮行的约定：其他插件把按钮放在 key 为 `reply-actions` 的 Box 里，两边的按钮就会排成一行。readable-rewrite-cn 里有一份相同的文件，改了要两边同步。
