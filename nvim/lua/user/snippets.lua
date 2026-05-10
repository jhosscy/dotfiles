-- mini.snippets: Snippet engine with LSP integration
-- Provides snippet expansion and LSP server for completion integration

vim.cmd('packadd mini.snippets')
local ok, snippets = pcall(require, "mini.snippets")
if not ok then return end

local gen_loader = snippets.gen_loader

snippets.setup({
  -- Load snippets from files
  snippets = {
    -- Global snippets available in all buffers
    gen_loader.from_file('~/.config/nvim/snippets/global.json'),
    -- Language-specific snippets (searches in 'snippets/' directories)
    gen_loader.from_lang(),
  },

  -- Mappings:
  -- <C-j> = expand snippet
  -- <C-l> = jump to next tabstop
  -- <C-h> = jump to previous tabstop  
  -- <C-c> = stop snippet session
  mappings = {
    expand = '<C-j>',
    jump_next = '<C-l>',
    jump_prev = '<C-h>',
    stop = '<C-c>',
  },
})

-- Start LSP server to show snippets in completion
snippets.start_lsp_server()
