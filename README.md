# Codex Send Queue

Claude Code plugin that gives the composer two explicit send modes. In the `Chat` context, `Tab` submits with `chat:queueSubmit`, so a prompt waits behind the active turn. `Enter` submits with `chat:sendNow`, so it uses the immediate-send action while preserving the current prompt text.

## Installation

At a Claude Code prompt, install the plugin with:

```text
/plugin install codex-send-queue --marketplace YMRwithNoworry/codex-send-queue
```

For local development, load the plugin directly with `claude --plugin-dir <path>`.

The keybinding file is installed separately at `~/.claude/keybindings.json`. Existing bindings should be preserved when merging the two `Chat` entries.

## Shortcuts

- `Tab`: queue the current prompt until the active turn finishes.
- `Enter`: send the current prompt immediately.

The plugin draws a small reminder above the prompt. The actual key behavior is provided by Claude Code's keybinding actions in `~/.claude/keybindings.json`.
