# Codex Send Queue

Claude Code plugin that keeps follow-up prompts out of the running turn and submits them as separate turns after the current turn completes.

## Installation

At a Claude Code prompt:

```text
/plugin install codex-send-queue --marketplace YMRwithNoworry/codex-send-queue
```

For local development, use `claude --plugin-dir <path>`.

The keybindings are configured separately in `~/.claude/keybindings.json`. Preserve existing bindings and add these contexts:

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "tab": "chat:queueSubmit",
        "enter": "chat:sendNow"
      }
    },
    {
      "context": "Autocomplete",
      "bindings": {
        "tab": "autocomplete:accept"
      }
    }
  ]
}
```

## Behavior

- `Tab`: while a turn is running, move the prompt into the queue, clear it from the composer, and send it only after the current turn completes. Image and document attachments are rejected with a notice because Claude Code's plugin API does not provide a way to persist a user's attachment and attach its bytes to a later plugin-submitted turn.
- Queued messages appear left-aligned above the composer, in the lower part of the chat. Each row has `立刻发送` (move it to the front and stop the active turn when possible), `编辑` (edit inline and save), and `删除` controls.
- `Tab` while the autocomplete menu is open: accept the highlighted completion instead of submitting or queuing the prompt.
- `Enter`: keep Claude Code's native `chat:sendNow` behavior for an intentional immediate send. This may interrupt current work.
- `Ctrl+X Enter`: the native `chat:queueSubmit` action is also captured by the strict queue.
- Queued messages are submitted one at a time as separate user turns, in order. The queue is scoped to the current session.
- The strict queue currently supports text-only messages. If a prompt contains attachments, the plugin rejects it with a notice instead of silently sending it into the active turn.

The plugin draws a reminder and queue count above the prompt. If sending a queued message is rejected, it remains queued and can be retried with the `Continue queue` button.
