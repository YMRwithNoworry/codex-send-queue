import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { QueueEdit, QueueEntry, QueueItem } from '../types'

const pending = atom(
  { plugin: 'codex-send-queue', key: 'pending' } as const,
  [] as QueueEntry[],
)
const editing = atom(
  { plugin: 'codex-send-queue', key: 'editing' } as const,
  null as QueueEdit,
)

let isDraining = false
let completedWhileDraining = false
let drainingItemId: string | undefined
let drainingTurnStarted = false
let activeMainTurnId: string | undefined
let nextId = 0

function createId() {
  nextId += 1
  return `${Date.now().toString(36)}-${nextId.toString(36)}`
}

function normalizeQueue(entries: QueueEntry[]): QueueItem[] {
  return entries.map((entry, index) =>
    typeof entry === 'string' ? { id: `legacy-${index}`, text: entry } : entry,
  )
}

async function readQueue($: EngineInterface) {
  return normalizeQueue(await read($, pending))
}

function scheduleDrain($: EngineInterface) {
  $.clock.after(0, () => {
    void drain($)
  })
}

async function clearCapturedPrompt($: EngineInterface, text: string) {
  try {
    const prompt = await $.prompt.read()
    if (prompt.text !== text) {
      $.ui.toast('消息已加入队列；输入栏内容已变化，为保留新内容未自动清空。')
      return
    }

    const result = await $.prompt.fill({ text: '' })
    if (!result.isFilled || result.text !== '') {
      $.ui.toast('消息已加入队列，但输入栏未能自动清空。')
    }
  } catch {
    $.ui.toast('消息已加入队列，但输入栏未能自动清空。')
  }
}

async function drain($: EngineInterface) {
  if (isDraining) return
  isDraining = true

  try {
    const [item] = await readQueue($)
    if (item === undefined) return

    drainingItemId = item.id
    drainingTurnStarted = false
    const result = await $.prompt.submit({ text: item.text, asUser: true })
    if ('drop' in result) {
      $.ui.toast(`排队消息暂未发送，仍保留在队列中：${result.drop}`)
      return
    }

    await update($, pending, entries =>
      normalizeQueue(entries).filter(queued => queued.id !== item.id),
    )
  } catch {
    $.ui.toast('排队消息发送失败，已保留在队列中。')
  } finally {
    isDraining = false
    drainingItemId = undefined
    drainingTurnStarted = false
    if (completedWhileDraining) {
      completedWhileDraining = false
      scheduleDrain($)
    }
  }
}

async function sendImmediately($: EngineInterface, id: string) {
  if (isDraining) {
    $.ui.toast('已有排队消息正在发送，请稍后再试。')
    return
  }

  const ordered = await update($, pending, entries => {
    const messages = normalizeQueue(entries)
    const index = messages.findIndex(item => item.id === id)
    const item = messages[index]
    if (item === undefined) return messages
    return [item, ...messages.filter(queued => queued.id !== id)]
  })

  if (normalizeQueue(ordered)[0]?.id !== id) return

  await update($, editing, current => (current?.id === id ? null : current))
  let interrupted = false
  if (activeMainTurnId) {
    try {
      await $.turn.abort({ turnId: activeMainTurnId })
      interrupted = true
    } catch {
      // If the turn already ended, drain will send once the session is idle.
    }
  }
  $.ui.toast(
    interrupted
      ? '已停止当前任务，并将该消息设为优先发送。'
      : '该消息已设为优先发送；若有任务运行，会在其结束后发送。',
  )
  scheduleDrain($)
}

async function removeQueued($: EngineInterface, id: string) {
  await update($, pending, entries =>
    normalizeQueue(entries).filter(item => item.id !== id),
  )
  await update($, editing, current => (current?.id === id ? null : current))
}

async function beginEdit($: EngineInterface, item: QueueItem) {
  await update($, editing, () => ({ id: item.id, text: item.text }))
}

async function saveEdit($: EngineInterface, id: string, text?: string) {
  const draft = await read($, editing)
  if (draft?.id !== id) return

  const nextText = text ?? draft.text
  if (!nextText.trim()) {
    $.ui.toast('排队消息不能为空。')
    return
  }

  const messages = await readQueue($)
  if (!messages.some(item => item.id === id)) {
    await update($, editing, () => null)
    return
  }

  await update($, pending, entries =>
    normalizeQueue(entries).map(item => (item.id === id ? { ...item, text: nextText } : item)),
  )
  await update($, editing, () => null)
  $.ui.toast('排队消息已更新。')
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || !e.wait) return next(e)
    if (e.turnId !== undefined) activeMainTurnId = e.turnId

    const messages = await readQueue($)
    const mustWait = e.turnId !== undefined || messages.length > 0
    if (!mustWait) return next(e)

    if (e.attachments?.length) {
      return {
        drop: '严格顺序队列暂不支持图片或文件附件；请等当前任务完成后重新发送附件。',
      }
    }

    const item: QueueItem = { id: createId(), text: e.text }
    const queued = await update($, pending, entries => [...normalizeQueue(entries), item])
    await clearCapturedPrompt($, e.text)
    $.ui.toast(`已加入严格顺序队列（${queued.length} 条）；当前任务完成后发送。`)

    if (e.turnId === undefined) scheduleDrain($)

    return { drop: '已排队；当前任务完成后会作为下一轮发送。' }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    if (e.origin.kind === 'composer') {
      return { drop: '严格顺序队列暂时不可用；消息未发送，请稍后重试。' }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      activeMainTurnId = undefined
      if (isDraining) {
        if (drainingTurnStarted) completedWhileDraining = true
      } else {
        scheduleDrain($)
      }
    }
    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      activeMainTurnId = e.turnId
      if (isDraining && drainingItemId !== undefined) drainingTurnStarted = true
    }
    return result
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    scheduleDrain($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const messages = await readQueue($)
    const draft = await read($, editing)
    const previewWidth = Math.max(12, e.props.bodyColumns - 32)

    return (
      <Box flexDirection="column">
        <Text dimColor>
          Tab：严格排队（当前任务完成后发送）　·　Enter：立即发送（可能中断）
        </Text>
        {messages.length > 0 && <Text dimColor>排队消息（{messages.length}）</Text>}
        {messages.map((item, index) => {
          if (draft?.id === item.id) {
            return (
              <Box key={`queue:${item.id}`} flexDirection="row">
                <Input
                  key={`queue-edit:${item.id}`}
                  label={`${index + 1}. 编辑`}
                  value={draft.text}
                  onInput={value => {
                    void update($, editing, current =>
                      current?.id === item.id ? { ...current, text: value } : current,
                    )
                  }}
                  onSubmit={value => saveEdit($, item.id, value)}
                />
                <Button key={`save:${item.id}`} label="保存" onPress={() => saveEdit($, item.id)} />
                <Button
                  key={`cancel:${item.id}`}
                  label="取消"
                  onPress={() => update($, editing, () => null)}
                />
              </Box>
            )
          }

          const label = item.text.replace(/\s+/g, ' ').trim() || '（空消息）'
          const preview = label.length > previewWidth
            ? `${label.slice(0, previewWidth - 1)}…`
            : label

          return (
            <Box key={`queue:${item.id}`} flexDirection="row">
              <Text>{`${index + 1}. ${preview} `}</Text>
              <Button
                key={`send:${item.id}`}
                label="立刻发送"
                onPress={() => sendImmediately($, item.id)}
              />
              <Button
                key={`edit:${item.id}`}
                label="编辑"
                onPress={() => beginEdit($, item)}
              />
              <Button
                key={`delete:${item.id}`}
                label="删除"
                onPress={() => removeQueued($, item.id)}
              />
            </Box>
          )
        })}
        {messages.length > 0 && (
          <Button key="resume-queue" label="继续发送队列" onPress={() => scheduleDrain($)} />
        )}
      </Box>
    )
  })
}
