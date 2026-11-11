# zh-en-bridge

一个 Claude Code mod。打开「英文模式」后，你用中文写的 prompt 会先翻成英文，**由你确认或修改后再发出去**；Claude 读到的是英文，也用英文回复，回复再翻回中文显示。界面上你看到的是中文，Claude 那边整段对话都是英文。

翻译默认用通义 `qwen3.7-flash`（阿里云百炼 / DashScope 的 OpenAI 兼容接口），接口、模型和两个方向的翻译 prompt 都可以在配置里换。

- 英文模式要你自己打开，默认关闭，关闭时 prompt 按原文发送，不调用翻译接口。
- 对话记录里存的是英文：发出去的英文 prompt 和 Claude 的英文原回复。中文只用于界面显示，不进入模型上下文。
- 每条 prompt 和英文回复都会发到翻译接口（默认是阿里云）。里面可能有代码、路径和项目细节，请自行判断能不能发。

## 使用

**开关**：输入框上方的 **英文模式** 按钮，亮着表示开启；也可以用 `/en`（切换）、`/en on`、`/en off`。开启时状态栏显示「中→英 发送：开」。

**发送**（英文模式开启时）：
1. 照常用中文写 prompt，按 Enter。这一下不会发出去，先去翻译。
2. 译文放回输入框；如果当前界面的输入框插件写不进去（桌面 app 用的是它自己的输入框），就放在输入框上方的草稿框里。
3. 检查或修改英文，然后发送：在输入框里按 Enter，或者在草稿框里点 **发送英文**（草稿框里按 Enter 也行）。草稿框里还有 **发送中文原文** 和 **放弃**。
4. 翻译失败（没配 Key、超时、接口报错）时什么都不会发出去：草稿框里显示失败原因和你写的中文，可以修改后点 **重试翻译**，也可以点 **发送中文原文**。

prompt 里没有中文（代码块里的中文不算）时直接发送，不调用翻译。斜杠命令、子代理的输出、其他插件发的 prompt 都不处理。带了图片或文件的 prompt 翻译后直接发送，不放回输入框确认，因为放回去附件会丢。

**看消息**：
- 你发的消息显示你写的中文，下面的 **发送的英文** 按钮点亮后显示实际发出去的英文，再点一下回到中文。修改过译文的消息会标注「经你修改后发送」。
- Claude 的回复下面有 **中文译文** 按钮：点亮时显示中文译文，再点一下显示英文原文。英文模式下的回复会自动翻译；其他回复只有正文（不算代码）里至少有 20 个英文单词才出现这个按钮，点了才翻译。
- 和 readable-rewrite-cn 一起装时，两个插件的按钮排在同一行。

**让 Claude 用英文回复**：system prompt 里有一段固定说明，要求「用户最新一条消息是什么语言，就用什么语言回复」；直接从输入框发出去的英文 prompt 旁边还会附一条只有模型看得到的「请用英文回复」。这段 system prompt 不随开关变化，所以开关英文模式不会让 prompt cache 失效。

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
| `enabled_by_default` | 新会话默认开启英文模式 | `false` |
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
2. 本插件数据目录的 `.env`：`~/.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env` 里的 `DASHSCOPE_API_KEY`；
3. readable-rewrite-cn 数据目录的 `.env`（两个插件可以共用同一个通义 Key）；
4. 环境变量 `DASHSCOPE_API_KEY`（桌面 app 读不到 shell 里 export 的变量）。

推荐第 2 种，和 readable-rewrite-cn 一样放在插件自己的数据目录：

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

测试会 mock 掉 HTTP 请求，不会真的调用 API。`hooks/actions.ts` 是和 readable-rewrite-cn 共用的按钮行约定，两边要保持一致。
