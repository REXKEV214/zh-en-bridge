# zh-en-bridge

一个 Claude Code mod。打开「英文模式」后，你用中文写的 prompt 在发出前先由通义（默认 `qwen3.7-flash`）翻成英文；Claude 读到的是英文，也用英文回复，回复再由通义翻回中文显示。界面上你看到的始终是中文，Claude 那边整段对话都是英文。

英文模式要你自己打开，默认关闭，关闭时 prompt 按原文发送。

- 对话记录里存的是英文：发出去的英文 prompt 和 Claude 的英文原回复。中文只用于界面显示，不进入模型上下文。
- 每条消息下面有按钮：用户消息可以「看英文」（实际发出去的内容），回复可以「看原文」。
- 发送前翻译失败（没配 Key、超时、API 报错）时，会弹出提示并直接发送中文原文，不拦截这条消息。
- 子代理的输出、斜杠命令、其他插件发的 prompt 都不翻译。
- 英文模式下，prompt 里没有中文（代码块里的中文不算）就不调用翻译，只附上「用英文回复」的要求。
- 每条 prompt 和英文回复都会发到阿里云。里面可能有代码、路径和项目细节，请自行判断能不能发。

## 使用

- 输入框上方的 **英文模式：关 / 开** 按钮：点一下切换。
- `/en`：切换；`/en on`、`/en off`：直接设置。
- 开启时状态栏显示「中→英 发送：开」。
- 英文模式下，每条英文回复会自动翻译；关闭时，看起来是英文的回复下面有一个 **译成中文** 按钮，点了才翻译。

Claude 被要求用英文回复，靠的是每条翻译后的 prompt 旁边附带的一段只有模型看得到的说明，不改 system prompt，所以开关英文模式不会让 prompt cache 失效。

## 配置

`plugin.json` 的 `userConfig`：

| 字段 | 说明 | 默认值 |
|---|---|---|
| `qwen_api_key` | 通义 API Key（存进系统钥匙串） | 空 |
| `qwen_model` | 通义模型 ID | `qwen3.7-flash` |
| `qwen_base_url` | OpenAI 兼容地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `qwen_extra_body` | 合并进请求体的 JSON | `{"enable_thinking": false}` |
| `enabled_by_default` | 新会话默认开启英文模式 | `false` |
| `timeout_seconds` | 单次请求超时（秒） | `30` |

API Key 的读取顺序：
1. `qwen_api_key` 配置项；
2. `~/.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env` 里的 `DASHSCOPE_API_KEY`；
3. `~/.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn/.env` 里的 `DASHSCOPE_API_KEY`（装了 readable-rewrite-cn 的话可以共用同一个 Key）；
4. 环境变量 `DASHSCOPE_API_KEY`（桌面 app 读不到 shell 里 export 的变量）。

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

测试会 mock 掉 HTTP 请求，不会真的调用 API。
