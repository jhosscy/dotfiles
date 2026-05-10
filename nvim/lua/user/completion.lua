-- mini.completion: Asynchronous two-stage completion
-- Provides LSP completion with fallback and signature help

vim.cmd('packadd mini.completion')
local ok, completion = pcall(require, "mini.completion")
if not ok then return end

completion.setup({
  -- Delays (balance between responsiveness and performance)
  delay = {
    completion = 100, -- Wait after typing stops before requesting completion
    info = 100,       -- Delay before showing item documentation
    signature = 50,   -- Faster signature help when typing function arguments
  },

  -- Floating window appearance
  window = {
    info = { height = 25, width = 80, border = 'rounded' },
    signature = { height = 25, width = 80, border = 'rounded' },
  },

  -- LSP completion configuration
  lsp_completion = {
    source_func = 'completefunc', -- Allows both auto and manual <C-X><C-U>
    auto_setup = false,           -- We handle this manually in LspAttach
    process_items = nil,          -- Use default (includes fuzzy matching)
    snippet_insert = nil,         -- Use default (mini.snippets or vim.snippet)
  },

  -- Fallback when LSP returns no results
  fallback_action = '<C-n>', -- Neovim's built-in word completion

  -- Module key mappings
  mappings = {
    force_twostep = '<C-Space>',  -- Force LSP + fallback completion
    force_fallback = '<A-Space>', -- Force only fallback completion
    scroll_down = '<C-f>',        -- Scroll documentation down
    scroll_up = '<C-b>',          -- Scroll documentation up
  },
})
