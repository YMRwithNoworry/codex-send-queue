export type QueueItem = { id: string; text: string }
export type QueueEntry = QueueItem | string
export type QueueEdit = { id: string; text: string } | null

declare module 'claude-code' {
  interface PluginState {
    'codex-send-queue': {
      pending: QueueEntry[]
      editing: QueueEdit
    }
  }
}
