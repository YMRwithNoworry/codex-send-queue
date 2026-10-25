declare module 'claude-code' {
  interface PluginState {
    'codex-send-queue': { pending: string[] }
  }
}
