import { expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, On } from 'claude-code'

const ZH = '帮我看一下 `hooks/register.tsx` 里的重试逻辑有没有问题'
const EN = 'Please check whether the retry logic in `hooks/register.tsx` has any problems'
const REPLY = 'The retry logic looks fine: a timeout or a 5xx is retried once, and a 401 is not retried.'
const REPLY_ZH = '重试逻辑没问题：超时或 5xx 会重试一次，401 不重试。'

const OPTIONS = { qwen_api_key: 'test-qwen-key', qwen_model: 'qwen3.7-flash' }

type Ask = { url: string; headers: Record<string, string>; body: { messages: { role: string; content: string }[] } & Record<string, unknown> }
type Submitted = { text: string; context?: readonly string[] }

function ok(content: string): HttpResponse {
  return { status: 200, ok: true, headers: {}, text: JSON.stringify({ choices: [{ message: { content } }] }) }
}

function engine(on: On, answer?: (ask: Ask, calls: number) => HttpResponse | undefined) {
  const asks: Ask[] = []
  const submitted: Submitted[] = []
  const toasts: string[] = []
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'en' } }))
  on('command.run', () => ({ text: '' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    submitted.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context }
  })
  on('http.fetch', (_, e) => {
    const ask = { url: e.url, headers: e.init?.headers ?? {}, body: JSON.parse(String(e.init?.body)) }
    asks.push(ask)
    const custom = answer?.(ask, asks.length)
    if (custom) return { value: custom }
    const toEnglish = ask.body.messages[0]?.content.startsWith('You are a translator')
    return { value: ok(toEnglish ? EN : REPLY_ZH) }
  })
  // Stands for the engine's own drawing of a message row.
  on('ui.render', ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={(e.props as { text: string }).text} />
  })
  return { asks, submitted, toasts, clock: mock.clock(on), session: mock.session(on) }
}

function typed(text: string) {
  return { text, wait: false, origin: { kind: 'composer' } } as never
}

function reply(uuid: string, text = REPLY, agentId?: string) {
  return {
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid,
    ...(agentId ? { agentId } : {}),
  } as never
}

function row(component: 'UserMessage' | 'AssistantMessage' | 'AbovePrompt', requestId: string, text: string, surface: 'desktop' | 'terminal' = 'desktop') {
  const props =
    component === 'UserMessage'
      ? { text, origin: { kind: 'composer' }, isExpanded: false }
      : component === 'AssistantMessage'
        ? { text, isFirstOfReply: true }
        : { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80 }
  return { plugin: 'zh-en-bridge', surface, component, requestId, props } as never
}

type Drawing = { find: (q: { type: string; text?: string | RegExp }) => Promise<unknown>; press: (q: { key: string }) => Promise<unknown> }
async function press(ui: Drawing, label: string) {
  const button = (await ui.find({ type: 'Button', text: label })) as { key: string } | undefined
  if (!button) throw new Error(`no button ${label}`)
  await ui.press({ key: button.key })
}
async function shown(ui: Drawing): Promise<string> {
  return String(((await ui.find({ type: 'Markdown' })) as { text: string }).text)
}

test('off by default: the prompt goes out as typed and nothing is called', { options: OPTIONS }, async ($, on) => {
  const { asks, submitted, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit(typed(ZH))
  await $.session.append(reply('row-off'))
  await clock.settle()
  expect(submitted).toEqual([{ text: ZH, context: undefined }])
  expect(asks).toEqual([])
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`English mode: prompt sent in English, shown in Chinese; reply shown in Chinese (${surface})`, { options: OPTIONS }, async ($, on) => {
    const { asks, submitted, clock, session } = engine(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true })

    const band = await $.ui.mount(row('AbovePrompt', 'band', '', surface))
    await press(band, '英文模式：关')
    expect(await band.find({ type: 'Button', text: '英文模式：开' })).toBeTruthy()
    await band.unmount()

    await $.prompt.submit(typed(ZH))
    expect(submitted.length).toBe(1)
    expect(submitted[0]?.text).toBe(EN)
    expect(submitted[0]?.context?.join('\n')).toContain('Reply in English')
    const toEnglish = asks[0]
    expect(toEnglish?.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(toEnglish?.headers.Authorization).toBe('Bearer test-qwen-key')
    expect(toEnglish?.body.model).toBe('qwen3.7-flash')
    expect(toEnglish?.body.enable_thinking).toBe(false)
    expect(toEnglish?.body.messages[1]?.content).toContain(`<text>\n${ZH}\n</text>`)

    // The row stores the English; the screen shows what was typed.
    const user = await $.ui.mount(row('UserMessage', 'u-1', EN, surface))
    expect(await shown(user)).toBe(ZH)
    await press(user, '看英文')
    expect(await shown(user)).toBe(EN)
    await press(user, '看中文')
    expect(await shown(user)).toBe(ZH)
    await user.unmount()

    await $.session.append(reply('row-1'))
    await $.session.append(reply('row-sub', REPLY + ' (subagent)', 'a1'))
    await clock.settle()
    expect(asks.length).toBe(2)
    expect(asks[1]?.body.messages[1]?.content).toContain(`<原文>\n${REPLY}\n</原文>`)

    const answer = await $.ui.mount(row('AssistantMessage', 'row-1', REPLY, surface))
    expect(await shown(answer)).toBe(REPLY_ZH)
    await press(answer, '看原文')
    expect(await shown(answer)).toBe(REPLY)
    await press(answer, '看中文')
    expect(await shown(answer)).toBe(REPLY_ZH)
    await answer.unmount()

    // What the model reads back next turn stays English.
    const stored = JSON.stringify(session.appended())
    expect(stored).toContain(REPLY)
    expect(stored).not.toContain(REPLY_ZH)
  })
}

test('/en toggles, and /en off sends as typed again', { options: OPTIONS }, async ($, on) => {
  const { submitted, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'en', args: '' } as never)
  await $.prompt.submit(typed(ZH))
  await $.command.run({ command: 'en', args: 'off' } as never)
  await $.prompt.submit(typed(ZH))
  await clock.settle()
  expect(submitted.map(s => s.text)).toEqual([EN, ZH])
  expect(submitted[1]?.context).toBeUndefined()
})

test('a prompt with no Chinese is not translated but still asks for English', { options: OPTIONS }, async ($, on) => {
  const { asks, submitted } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'en', args: 'on' } as never)
  await $.prompt.submit(typed('fix the bug in ```\n// 注释\nretry()\n```'))
  expect(asks).toEqual([])
  expect(submitted[0]?.context?.join('\n')).toContain('Reply in English')
})

test('a slash command and a plugin prompt pass untouched', { options: OPTIONS }, async ($, on) => {
  const { asks, submitted } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'en', args: 'on' } as never)
  await $.prompt.submit({ text: '/review 中文参数', wait: false, origin: { kind: 'composer' }, command: { name: 'review', args: '中文参数' } } as never)
  await $.prompt.submit({ text: ZH, wait: false, origin: { kind: 'plugin', name: 'other' } } as never)
  expect(asks).toEqual([])
  expect(submitted.map(s => s.text)).toEqual(['/review 中文参数', ZH])
})

test('a failed translation sends the Chinese as typed and leaves replies alone', { options: OPTIONS }, async ($, on) => {
  const { asks, submitted, toasts, clock } = engine(on, () => ({
    status: 401,
    ok: false,
    headers: {},
    text: JSON.stringify({ error: { message: 'invalid api key' } }),
  }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'en', args: 'on' } as never)
  await $.prompt.submit(typed(ZH))
  expect(submitted).toEqual([{ text: ZH, context: undefined }])
  expect(toasts.join('\n')).toContain('invalid api key')
  await $.session.append(reply('row-f'))
  await clock.settle()
  expect(asks.length).toBe(1)
})

test('a failed reply translation shows why; pressing retries', { options: OPTIONS }, async ($, on) => {
  const { clock } = engine(on, (ask, calls) =>
    calls === 2 ? { status: 401, ok: false, headers: {}, text: JSON.stringify({ error: { message: 'quota' } }) } : undefined,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'en', args: 'on' } as never)
  await $.prompt.submit(typed(ZH))
  await $.session.append(reply('row-r'))
  await clock.settle()
  const ui = await $.ui.mount(row('AssistantMessage', 'row-r', REPLY))
  expect(await shown(ui)).toBe(REPLY)
  expect(String(((await ui.find({ type: 'Text', text: /翻译失败/ })) as { text: string }).text)).toContain('quota')
  await press(ui, '重试翻译')
  await clock.settle()
  expect(await shown(ui)).toBe(REPLY_ZH)
  await ui.unmount()
})

test('an English reply outside English mode gets a button, not a call', { options: OPTIONS }, async ($, on) => {
  const { asks, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.append(reply('row-b'))
  await clock.settle()
  expect(asks).toEqual([])
  const ui = await $.ui.mount(row('AssistantMessage', 'row-b', REPLY))
  await press(ui, '译成中文')
  await clock.settle()
  expect(await shown(ui)).toBe(REPLY_ZH)
  await ui.unmount()

  const zh = await $.ui.mount(row('AssistantMessage', 'row-zh', '这是一条中文回复，提到了 `retry()` 函数。'))
  expect(await zh.find({ type: 'Button', text: '译成中文' })).toBeFalsy()
  await zh.unmount()
})

test('a wrapped answer is unwrapped', { options: OPTIONS }, async ($, on) => {
  const { submitted } = engine(on, ask =>
    ask.body.messages[0]?.content.startsWith('You are a translator') ? ok('```\n<text>\n' + EN + '\n</text>\n```') : undefined,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'en', args: 'on' } as never)
  await $.prompt.submit(typed(ZH))
  expect(submitted[0]?.text).toBe(EN)
})
