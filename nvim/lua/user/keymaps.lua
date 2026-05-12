vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- ============================================================================
-- fzf-lua: lazy loader (carga solo al usar un keymap por primera vez)
-- ============================================================================
local fzf_loaded = false
local function lazy_fzf(cmd)
  if not fzf_loaded then
    fzf_loaded = true
    vim.cmd('packadd fzf-lua')
    require('user.fzf')
  end
  require('fzf-lua')[cmd]()
end

vim.keymap.set('n', '<C-p>',      function() lazy_fzf('files') end,           { desc = 'Find files',       silent = true })
vim.keymap.set('n', '<leader>fg', function() lazy_fzf('live_grep') end,     { desc = 'Live grep',        silent = true })
vim.keymap.set('n', '<leader>fb', function() lazy_fzf('buffers') end,       { desc = 'Buffers',          silent = true })
vim.keymap.set('n', '<leader>fo', function() lazy_fzf('oldfiles') end,      { desc = 'Recent files',     silent = true })
vim.keymap.set('n', '<leader>fr', function() lazy_fzf('lsp_references') end, { desc = 'LSP references',   silent = true })
vim.keymap.set('n', '<leader>fd', function() lazy_fzf('lsp_definitions') end, { desc = 'LSP definitions', silent = true })
vim.keymap.set('n', '<leader>fG', function() lazy_fzf('grep_project') end, { desc = 'Grep all project lines', silent = true })
vim.keymap.set('n', '<leader>fk', function() lazy_fzf('builtin') end, { desc = 'Fzf builtin commands', silent = true })

-- ============================================================================
-- Native :Undotree (Neovim 0.12+)
-- ============================================================================
vim.keymap.set('n', '<leader>u', '<Cmd>Undotree<CR>', { desc = 'Toggle undo tree', silent = true })

-- Exit insert mode with 'ii'
vim.keymap.set('i', 'ii', '<Esc>', { desc = 'Exit insert mode with ii', silent = true })

-- Window navigation with Ctrl+hjkl
vim.keymap.set('n', '<C-h>', '<C-w>h', { desc = 'Move to left window', silent = true })
vim.keymap.set('n', '<C-j>', '<C-w>j', { desc = 'Move to lower window', silent = true })
vim.keymap.set('n', '<C-k>', '<C-w>k', { desc = 'Move to upper window', silent = true })
vim.keymap.set('n', '<C-l>', '<C-w>l', { desc = 'Move to right window', silent = true })

-- Visual mode
vim.keymap.set('x', 'J', ":move '>+1<CR>gv=gv", { desc = 'Move to down', silent = true })
vim.keymap.set('x', 'K', ":move '<-2<CR>gv=gv", { desc = 'Move to up', silent = true })
vim.keymap.set('x', '<leader>p', '"_dP', { desc = 'Paste without replacing register', silent = true })
vim.keymap.set('v', '<', '<gv', { desc = 'Indent left and reselect', silent = true })
vim.keymap.set('v', '>', '>gv', { desc = 'Indent right and reselect', silent = true })

-- ============================================================================
-- mini.completion navigation mappings
-- These are recommended by mini.completion documentation (not auto-set by design)
-- ============================================================================

-- Tab: Next completion item if popup visible, else insert Tab
vim.keymap.set('i', '<Tab>', function()
  return vim.fn.pumvisible() == 1 and '<C-n>' or '<Tab>'
end, {
  expr = true,
  desc = 'Next completion item or Tab',
})

-- Shift-Tab: Previous completion item if popup visible, else insert Shift-Tab
vim.keymap.set('i', '<S-Tab>', function()
  return vim.fn.pumvisible() == 1 and '<C-p>' or '<S-Tab>'
end, {
  expr = true,
  desc = 'Previous completion item or Shift-Tab',
})

-- Smart Enter: Accept selected completion item or insert newline
_G.cr_action = function()
  if vim.fn.complete_info()['selected'] ~= -1 then
    return '<C-y>' -- Accept completion item
  end
  return '<CR>' -- Normal Enter
end

vim.keymap.set('i', '<CR>', 'v:lua.cr_action()', {
  expr = true,
  desc = 'Accept completion or insert newline',
})
