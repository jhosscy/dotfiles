-- mini.icons: Icon provider for filetypes, LSP kinds, and more
-- This enhances the visual appearance of completion items

vim.cmd('packadd mini.icons')
local ok, icons = pcall(require, "mini.icons")
if not ok then return end

icons.setup({
  style = 'glyph', -- Use Nerd Font glyphs
})

icons.mock_nvim_web_devicons()

-- Add icons to LSP completion items (e.g., "󰊕 Function")
icons.tweak_lsp_kind('prepend')
