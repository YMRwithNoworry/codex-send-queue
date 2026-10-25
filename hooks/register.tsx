import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const pending = atom(
  { plugin: 'codex-send-queue', key: 'pending' } as const,
  [] as string[],
)

let isDraining = false
let completedWhileDraining = false

function scheduleDrain($: EngineInterface) {
  $.clock.after(0, () => {
    void drain($)
  })
}

async function drain($: EngineInterface) {
  if (isDraining) return
  isDraining = true

  try {
    const [text] = await read($, pending)
    if (text === undefined) return

    const result = await $.prompt.submit({ text, asUser: true })
    if ('drop' in result) {
      $.ui.toast(`排队消息暂未发送，仍保留在队列中：${result.drop}`)
      return
    }

    await update($, pending, messages =>
      messages[0] === text ? messages.slice(1) : messages,
    )
  } catch {
    $.ui.toast('排队消息发送失败，已保留在队列中。')
  } finally {
    isDraining = false
    if (completedWhileDraining) {
      completedWhileDraining = false
      scheduleDrain($)
    }
  }
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || !e.wait) return next(e)

    const messages = await read($, pending)
    const mustWait = e.turnId !== undefined || messages.length > 0
    if (!mustWait) return next(e)

    if (e.attachments?.length) {
      return {
        drop: '严格顺序队列目前只支持文本消息；请等当前任务完成后重新发送附件。',
      }
    }

    const count = await update($, pending, queued => [...queued, e.text]).then(q => q.length)
    $.ui.toast(`已加入严格顺序队列（${count} 条）；当前任务完成后发送。`)

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
      if (isDraining) completedWhileDraining = true
      else scheduleDrain($)
    }
    return result
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    scheduleDrain($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const count = (await read($, pending)).length

    return (
      <Box flexDirection="column">
        <Text dimColor>
          Tab：严格排队（当前任务完成后发送）　·　Enter：立即发送（可能中断）
        </Text>
        {count > 0 && <Text>等待中的消息：{count}</Text>}
        {count > 0 && (
          <Button key="resume-queue" label="继续发送队列" onPress={() => scheduleDrain($)} />
        )}
      </Box>
    )
  })
}
