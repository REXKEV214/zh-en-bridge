import { expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, On } from 'claude-code'

const ZH = '帮我看一下 `hooks/register.tsx` 里的重试逻辑有没有问题'
const EN = 'Please check whether the retry logic in `hooks/register.tsx` has any problems'
const REPLY =
  'The retry logic looks fine: a timeout or a server error is retried exactly once, and an invalid key is reported right away without another request being sent.'
const REPLY_ZH = '重试逻辑没问题：超时或服务端错误会重试一次，Key 无效会直接报错，不再发请求。'

const OPTIONS = { api_key: 'test-qwen-key' }

type Ask = { url: string; headers: Record<string, string>; body: { messages: { role: string; content: string }[] } & Record<string, unknown> }
type Submitted = { text: string; context?: readonly string[] }

function ok(content: string): HttpResponse {
  return { status: 200, ok: true, headers: {}, text: JSON.stringify({ choices: [{ message: { content } }] }) }
}
function failed(message: string): HttpResponse {
  return { status: 401, ok: false, headers: {}, text: JSON.stringify({ error: { message } }) }
}
const isToEnglish = (ask: Ask) => ask.body.messages[0]?.content.startsWith('You are a translator') ?? false

/**
 * The engine beneath the plugin. `draft` is what the prompt box holds;
 * `hasBox` false stands for a surface whose prompt box a plugin cannot write.
 */
function engine(on: On, opts: { answer?: (ask: Ask, calls: number) => HttpResponse | undefined; hasBox?: boolean; draft?: string; env?: Record<string, string> } = {}) {
  const asks: Ask[] = []
  const submitted: Submitted[] = []
  const fills: string[] = []
  const toasts: string[] = []
  const box = { text: opts.draft ?? '' }
  mock.env(on, opts.env ?? {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined }
  })
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }))
  on('prompt.fill', (_, e) => {
    if (opts.hasBox === false) return { isFilled: false, refusal: 'no_composer' as const }
    fills.push(e.text)
    box.text = e.text
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    submitted.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context }
  })
  on('http.fetch', (_, e) => {
    const ask = { url: e.url, headers: e.init?.headers ?? {}, body: JSON.parse(String(e.init?.body)) }
    asks.push(ask)
    const custom = opts.answer?.(ask, asks.length)
    if (custom) return { value: custom }
    return { value: ok(isToEnglish(ask) ? EN : REPLY_ZH) }
  })
  // Stands for the engine's own drawing of a message row.
  on('ui.render', ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={(e.props as { text: string }).text} />
  })
  return { asks, submitted, fills, toasts, box, clock: mock.clock(on), session: mock.session(on) }
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
        : { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 80 }
  return { plugin: 'zh-en-bridge', surface, component, requestId, props } as never
}

type Found = { key?: string; text: string; props: Record<string, unknown> }
type Drawing = {
  find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<unknown>
  press: (q: { key: string }) => Promise<unknown>
}
async function button(ui: Drawing, label: string): Promise<Found | undefined> {
  return (await ui.find({ type: 'Button', text: label })) as Found | undefined
}
async function press(ui: Drawing, label: string) {
  const b = await button(ui, label)
  if (!b?.key) throw new Error(`no button ${label}`)
  await ui.press({ key: b.key })
}
async function shown(ui: Drawing): Promise<string> {
  return String(((await ui.find({ type: 'Markdown' })) as { text: string }).text)
}

/** Presses 「译成英文」 in the band above the prompt box. */
async function translateBox($: { ui: { mount: (a: never) => Promise<unknown> } }, settle: () => Promise<unknown>, surface: 'desktop' | 'terminal' = 'desktop') {
  const band = (await $.ui.mount(row('AbovePrompt', 'band', '', surface))) as Drawing & { unmount: () => Promise<void> }
  await press(band, '译成英文')
  await settle()
  await band.unmount()
}

test('without the button a prompt goes out as typed and nothing is called', { options: OPTIONS }, async ($, on) => {
  const { asks, submitted, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit(typed(ZH))
  await $.session.append(reply('row-off'))
  await clock.settle()
  expect(submitted).toEqual([{ text: ZH, context: undefined }])
  expect(asks).toEqual([])
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the button puts the English in the box; Enter sends it; rows show English, Chinese on request (${surface})`, { options: OPTIONS }, async ($, on) => {
    const { asks, submitted, fills, clock, session } = engine(on, { draft: ZH })
    await $.session.start({ cwd: '/', surface, isInteractive: true })

    await translateBox($, () => clock.settle(), surface)
    expect(fills).toEqual([EN])
    expect(submitted).toEqual([])
    const toEnglish = asks[0]
    expect(toEnglish?.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(toEnglish?.headers.Authorization).toBe('Bearer test-qwen-key')
    expect(toEnglish?.body.model).toBe('qwen3.7-flash')
    expect(toEnglish?.body.enable_thinking).toBe(false)
    expect(toEnglish?.body.messages[1]?.content).toContain(`<text>\n${ZH}\n</text>`)

    // Enter on the English: it goes out, asking for an English reply.
    await $.prompt.submit(typed(EN))
    expect(submitted.map(s => s.text)).toEqual([EN])
    expect(submitted[0]?.context?.join('\n')).toContain('Reply in English')
    expect(asks.length).toBe(1)

    // The row stores and shows the English; the button reveals what was typed.
    const user = await $.ui.mount(row('UserMessage', 'u-1', EN, surface))
    expect(await shown(user)).toBe(EN)
    expect((await button(user, '中文原文'))?.props.variant).toBe('secondary')
    expect((await user.find({ type: 'Text', text: /已译成英文发送/ })) !== undefined).toBe(true)
    await press(user, '中文原文')
    expect(await shown(user)).toBe(ZH)
    expect((await button(user, '中文原文'))?.props.variant).toBe('primary')
    await press(user, '中文原文')
    expect(await shown(user)).toBe(EN)
    await user.unmount()

    // The reply to a translated prompt is translated up front; a subagent's is not.
    await $.session.append(reply('row-1'))
    await $.session.append(reply('row-sub', REPLY + ' (subagent)', 'a1'))
    await clock.settle()
    expect(asks.length).toBe(2)
    expect(asks[1]?.body.messages[1]?.content).toContain(`<原文>\n${REPLY}\n</原文>`)

    // One toggle: lit shows the translation, pressed again shows the original.
    const answer = await $.ui.mount(row('AssistantMessage', 'row-1', REPLY, surface))
    expect(await shown(answer)).toBe(REPLY_ZH)
    expect((await button(answer, '中文译文'))?.props.variant).toBe('primary')
    await press(answer, '中文译文')
    expect(await shown(answer)).toBe(REPLY)
    expect((await button(answer, '中文译文'))?.props.variant).toBe('secondary')
    await press(answer, '中文译文')
    expect(await shown(answer)).toBe(REPLY_ZH)
    await answer.unmount()

    // What the model reads back next turn stays English.
    const stored = JSON.stringify(session.appended())
    expect(stored).toContain(REPLY)
    expect(stored).not.toContain(REPLY_ZH)
  })
}

test('an edited translation goes out as edited and says so', { options: OPTIONS }, async ($, on) => {
  const { submitted, clock } = engine(on, { draft: ZH })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await translateBox($, () => clock.settle())
  const edited = EN + ', especially the timeout.'
  await $.prompt.submit(typed(edited))
  expect(submitted.map(s => s.text)).toEqual([edited])
  const user = await $.ui.mount(row('UserMessage', 'u-e', edited))
  expect(await shown(user)).toBe(edited)
  await press(user, '中文原文')
  expect(await shown(user)).toBe(ZH)
  expect((await user.find({ type: 'Text', text: /经你修改后发送/ })) !== undefined).toBe(true)
  await user.unmount()
})

test('a translation that keeps quoted Chinese still counts as the translation', { options: OPTIONS }, async ($, on) => {
  const QUOTED = 'Rename the button "发送的英文" to "中文原文", and show the English by default.'
  const { asks, submitted, clock } = engine(on, { draft: ZH, answer: ask => (isToEnglish(ask) ? ok(QUOTED) : undefined) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await translateBox($, () => clock.settle())
  const edited = QUOTED + ' Keep the change small.'
  await $.prompt.submit(typed(edited))
  expect(submitted[0]?.context?.join('\n')).toContain('Reply in English')

  const user = await $.ui.mount(row('UserMessage', 'u-q', edited))
  expect(await shown(user)).toBe(edited)
  await press(user, '中文原文')
  expect(await shown(user)).toBe(ZH)
  await user.unmount()

  // Its reply is translated up front, like any reply to a translated prompt.
  await $.session.append(reply('row-q'))
  await clock.settle()
  expect(asks.length).toBe(2)
  const answer = await $.ui.mount(row('AssistantMessage', 'row-q', REPLY))
  expect(await shown(answer)).toBe(REPLY_ZH)
  await answer.unmount()
})

test('after the button, whatever is sent keeps the Chinese; without it, nothing is translated up front', { options: OPTIONS }, async ($, on) => {
  const { asks, submitted, clock } = engine(on, { draft: ZH })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await translateBox($, () => clock.settle())
  // Edited back into mostly Chinese: still the translation.
  const edited = '算了，直接用中文问：' + ZH
  await $.prompt.submit(typed(edited))
  expect(submitted[0]?.text).toBe(edited)
  expect(submitted[0]?.context?.join('\n')).toContain('Reply in English')
  const sent = await $.ui.mount(row('UserMessage', 'u-c', edited))
  expect(await shown(sent)).toBe(edited)
  await press(sent, '中文原文')
  expect(await shown(sent)).toBe(ZH)
  await sent.unmount()
  await $.session.append(reply('row-c'))
  await clock.settle()
  expect(asks.length).toBe(2)

  // The draft is gone: the next prompt, sent without the button, goes out as typed.
  await $.prompt.submit(typed('hello'))
  expect(submitted[1]?.context).toBeUndefined()
  const user = await $.ui.mount(row('UserMessage', 'u-h', 'hello'))
  expect(await button(user, '中文原文')).toBeFalsy()
  await user.unmount()
  // Its reply keeps the on-request button and is not translated until pressed.
  const other = REPLY + ' The tests cover both paths.'
  await $.session.append(reply('row-h', other))
  await clock.settle()
  expect(asks.length).toBe(2)
  const answer = await $.ui.mount(row('AssistantMessage', 'row-h', other))
  expect(await shown(answer)).toBe(other)
  expect((await button(answer, '中文译文'))?.props.variant).toBe('secondary')
  await answer.unmount()
})

test('with no writable prompt box the translation waits in the band, editable', { options: OPTIONS }, async ($, on) => {
  const { submitted, clock } = engine(on, { hasBox: false, draft: ZH })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await translateBox($, () => clock.settle())
  expect(submitted).toEqual([])

  const band = await $.ui.mount(row('AbovePrompt', 'band', ''))
  expect(((await band.find({ type: 'Input', key: 'draft' })) as Found).props.value).toBe(EN)
  const edited = EN + ' Please be brief.'
  await (band as unknown as { input: (t: { key: string; text: string; kind: 'change' }) => Promise<unknown> }).input({
    key: 'draft',
    text: edited,
    kind: 'change',
  })
  await press(band, '发送英文')
  await clock.settle()
  expect(submitted.map(s => s.text)).toEqual([edited])
  expect(await band.find({ type: 'Input', key: 'draft' })).toBeFalsy()
  await band.unmount()

  const user = await $.ui.mount(row('UserMessage', 'u-b', edited))
  expect(await shown(user)).toBe(edited)
  await press(user, '中文原文')
  expect(await shown(user)).toBe(ZH)
  await user.unmount()
})

test('a failed translation leaves the Chinese in the box and says why', { options: OPTIONS }, async ($, on) => {
  const { submitted, fills, toasts, box, clock } = engine(on, { draft: ZH, answer: () => failed('invalid api key') })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await translateBox($, () => clock.settle())
  expect(fills).toEqual([])
  expect(box.text).toBe(ZH)
  expect(submitted).toEqual([])
  expect(toasts.join('\n')).toContain('invalid api key')
  const band = await $.ui.mount(row('AbovePrompt', 'band', ''))
  expect(await band.find({ type: 'Input', key: 'draft' })).toBeFalsy()
  expect(await button(band, '译成英文')).toBeTruthy()
  await band.unmount()
})

test('a box with no Chinese, or an empty one, calls nothing', { options: OPTIONS }, async ($, on) => {
  const { asks, fills, toasts, box, clock } = engine(on, { draft: 'already English' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await translateBox($, () => clock.settle())
  box.text = '   '
  await translateBox($, () => clock.settle())
  expect(asks).toEqual([])
  expect(fills).toEqual([])
  expect(toasts.length).toBe(2)
})

test('a slash command and another plugin\'s prompt pass untouched', { options: OPTIONS }, async ($, on) => {
  const { asks, submitted, clock } = engine(on, { draft: ZH })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await translateBox($, () => clock.settle())
  await $.prompt.submit({ text: '/review args', wait: false, origin: { kind: 'composer' }, command: { name: 'review', args: 'args' } } as never)
  await $.prompt.submit({ text: 'from another plugin', wait: false, origin: { kind: 'plugin', name: 'other' } } as never)
  expect(asks.length).toBe(1)
  expect(submitted.map(s => [s.text, s.context])).toEqual([
    ['/review args', undefined],
    ['from another plugin', undefined],
  ])
})

test('the reply button needs at least 20 English words in the prose', { options: OPTIONS }, async ($, on) => {
  const { asks, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const nineteen = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'
  const short = await $.ui.mount(row('AssistantMessage', 'row-19', `${nineteen}\n\`\`\`\nconst moreWords = inside(the, code, block)\n\`\`\``))
  expect(await button(short, '中文译文')).toBeFalsy()
  await short.unmount()

  const long = await $.ui.mount(row('AssistantMessage', 'row-20', `${nineteen} twenty`))
  expect((await button(long, '中文译文'))?.props.variant).toBe('secondary')
  await long.unmount()

  // A reply to a prompt sent as typed is not translated until the button is pressed.
  await $.session.append(reply('row-b'))
  await clock.settle()
  expect(asks).toEqual([])
  const ui = await $.ui.mount(row('AssistantMessage', 'row-b', REPLY))
  await press(ui, '中文译文')
  await clock.settle()
  expect(await shown(ui)).toBe(REPLY_ZH)
  await ui.unmount()
})

test('a failed reply translation shows why; pressing again retries', { options: OPTIONS }, async ($, on) => {
  let isFirst = true
  const { clock } = engine(on, {
    answer: () => {
      if (!isFirst) return undefined
      isFirst = false
      return failed('quota')
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(row('AssistantMessage', 'row-r', REPLY))
  await press(ui, '中文译文')
  await clock.settle()
  expect(await shown(ui)).toBe(REPLY)
  expect(((await ui.find({ type: 'Text', text: /翻译失败/ })) as Found).text).toContain('quota')
  await press(ui, '中文译文')
  await clock.settle()
  expect(await shown(ui)).toBe(REPLY_ZH)
  await ui.unmount()
})

test('another plugin\'s reply buttons join this one on a single row', { options: OPTIONS }, async ($, on) => {
  let otherPressed = 0
  // Stands for a plugin beneath (readable-rewrite-cn) that keys its row `reply-actions`.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Box, Button, Markdown } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Markdown text={e.props.text} />
        <Box key="reply-actions" flexDirection="row" gap={1} marginTop={1}>
          <Button key="other-rewrite" label="通义 改写" onPress={() => void otherPressed++} />
        </Box>
      </Box>
    )
  })
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(row('AssistantMessage', 'row-j', REPLY))
  const rows = (await ui.findAll({ type: 'Box', key: 'reply-actions' })) as Found[]
  expect(rows.length).toBe(2)
  expect(rows[0]?.props.flexDirection).toBe('row')
  const outer = JSON.stringify(rows[0])
  expect(outer.indexOf('通义 改写')).toBeGreaterThan(-1)
  expect(outer.indexOf('中文译文')).toBeGreaterThan(outer.indexOf('通义 改写'))
  expect(rows[1]?.props.marginTop).toBeUndefined()
  await ui.press({ key: 'other-rewrite', plugin: 'test' })
  expect(otherPressed).toBe(1)
  await ui.unmount()
})

test('the API, model and prompts can all be replaced in the options', {
  options: {
    api_key: 'other-key',
    base_url: 'https://api.example.com/v1/',
    model: 'other-model',
    extra_body: '',
    to_english_system: 'Translate to English.',
    to_english_template: 'ZH: {{text}}',
  },
}, async ($, on) => {
  const { asks, fills, clock } = engine(on, { draft: ZH, answer: () => ok(EN) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await translateBox($, () => clock.settle())
  expect(fills).toEqual([EN])
  const ask = asks[0]
  expect(ask?.url).toBe('https://api.example.com/v1/chat/completions')
  expect(ask?.headers.Authorization).toBe('Bearer other-key')
  expect(ask?.body.model).toBe('other-model')
  expect(ask?.body.enable_thinking).toBeUndefined()
  expect(ask?.body.messages).toEqual([
    { role: 'system', content: 'Translate to English.' },
    { role: 'user', content: `ZH: ${ZH}` },
  ])
})

test('a prompt option left empty falls back to the built-in default', {
  options: { api_key: 'k', to_chinese_system: '', to_chinese_template: '' },
}, async ($, on) => {
  const { asks, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(row('AssistantMessage', 'row-d', REPLY))
  await press(ui, '中文译文')
  await clock.settle()
  expect(asks[0]?.body.messages[0]?.content).toContain('你是一名翻译')
  expect(asks[0]?.body.messages[1]?.content).toContain(`<原文>\n${REPLY}\n</原文>`)
  await ui.unmount()
})

test('the system prompt asks to reply in the language of the latest message', { options: OPTIONS }, async ($, on) => {
  engine(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const input = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never
  const composed = (await $.prompt.compose(input)) as { sections: { id: string; text: string; scope: string }[] }
  expect(composed.sections.map(s => s.id)).toEqual(['intro', 'zh-en-bridge:language'])
  expect(composed.sections[1]?.text).toContain('when it is in English, reply in English')
})

test('a wrapped answer is unwrapped', { options: OPTIONS }, async ($, on) => {
  const { fills, clock } = engine(on, { draft: ZH, answer: ask => (isToEnglish(ask) ? ok('```\n<text>\n' + EN + '\n</text>\n```') : undefined) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await translateBox($, () => clock.settle())
  expect(fills).toEqual([EN])
})

test('with no key option the key comes from this plugin\'s own .env, then the environment', { options: { api_key: '' } }, async ($, on) => {
  const reads: string[] = []
  on('fs.read', (_, e) => {
    reads.push(e.path)
    return { value: '# key\nexport DASHSCOPE_API_KEY="key-from-dotenv"\n' }
  })
  const { asks, clock } = engine(on, { draft: ZH, env: { HOME: '/Users/k', DASHSCOPE_API_KEY: 'key-from-env' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await translateBox($, () => clock.settle())
  expect(asks[0]?.headers.Authorization).toBe('Bearer key-from-dotenv')
  expect(reads).toEqual(['/Users/k/.claude/plugins/data/zh-en-bridge-zh-en-bridge/.env'])
})

test('with no key option and no .env the environment variable is used', { options: { api_key: '' } }, async ($, on) => {
  const { asks, clock } = engine(on, { draft: ZH, env: { HOME: '/Users/k', DASHSCOPE_API_KEY: 'key-from-env' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await translateBox($, () => clock.settle())
  expect(asks[0]?.headers.Authorization).toBe('Bearer key-from-env')
})
