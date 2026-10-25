import { expect, mock, test } from 'claude-code/testing'

const ABOVE_PROMPT = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

test('queue items can be edited and deleted on every supported surface', async ($, on) => {
  const values: Record<string, unknown> = {
    pending: [{ id: 'queued-1', text: '检查这个问题' }],
    editing: null,
  }
  const versions: Record<string, number> = { pending: 1, editing: 1 }

  on('state.get', { plugin: 'codex-send-queue' }, (_, e) => ({
    value: { value: values[e.key], version: versions[e.key] ?? 0 },
  }))
  on('state.set', { plugin: 'codex-send-queue' }, (_, e) => {
    values[e.key] = e.value
    const version = (versions[e.key] ?? 0) + 1
    versions[e.key] = version
    return { value: { isSet: true, version } }
  })
  on('ui.toast', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop'] as const) {
    values.pending = [{ id: 'queued-1', text: '检查这个问题' }]
    values.editing = null
    versions.pending += 1
    versions.editing += 1

    let ui = await $.ui.mount({
      plugin: 'codex-send-queue',
      surface,
      component: 'AbovePrompt',
      props: ABOVE_PROMPT,
    })

    expect((await ui.find({ type: 'Text', text: /检查这个问题/ }))?.text).toMatch(/检查这个问题/)
    await ui.press({ key: 'edit:queued-1' })
    expect(values.editing).toEqual({ id: 'queued-1', text: '检查这个问题' })
    await ui.unmount()

    ui = await $.ui.mount({
      plugin: 'codex-send-queue',
      surface,
      component: 'AbovePrompt',
      props: ABOVE_PROMPT,
    })
    await ui.input({ key: 'queue-edit:queued-1', text: '已修改的说明', kind: 'change' })
    await ui.press({ key: 'save:queued-1' })
    expect(values.pending).toEqual([{ id: 'queued-1', text: '已修改的说明' }])
    expect(values.editing).toBeNull()
    await ui.unmount()

    ui = await $.ui.mount({
      plugin: 'codex-send-queue',
      surface,
      component: 'AbovePrompt',
      props: ABOVE_PROMPT,
    })
    await ui.press({ key: 'delete:queued-1' })
    expect(values.pending).toEqual([])
    await ui.unmount()
  }
})

test('the drain submits one queued message as a separate user turn', async ($, on) => {
  const values: Record<string, unknown> = {
    pending: [{ id: 'queued-1', text: '请检查这个改动' }],
    editing: null,
  }
  const versions: Record<string, number> = { pending: 1, editing: 1 }
  let submitted: { text: string; origin?: unknown } | undefined

  on('state.get', { plugin: 'codex-send-queue' }, (_, e) => ({
    value: { value: values[e.key], version: versions[e.key] ?? 0 },
  }))
  on('state.set', { plugin: 'codex-send-queue' }, (_, e) => {
    values[e.key] = e.value
    const version = (versions[e.key] ?? 0) + 1
    versions[e.key] = version
    return { value: { isSet: true, version } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'plugin' && e.origin.name === 'codex-send-queue') {
      submitted = { text: e.text, origin: e.origin }
      return { text: e.text, origin: e.origin }
    }
    return next(e)
  })

  const clock = mock.clock(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect(submitted?.text).toBe('请检查这个改动')
  expect(values.pending).toEqual([])
})
