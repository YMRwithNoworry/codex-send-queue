import type { Register } from 'claude-code'

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>Tab：排队发送　·　Enter：直接发送</Text>
      </Box>
    )
  })
}
