-- Preview window helpers based on :help preview-window.
-- Use <leader>p to preview the tag under cursor without replacing LSP's `K` hover.

vim.opt.previewheight = 12
vim.api.nvim_set_hl(0, 'PreviewWord', { bold = true, bg = '#3a5f3a' })

local function current_word()
  local word = vim.fn.expand('<cword>')
  if word == '' or not word:match('%a') then
    return nil
  end
  return word
end

local function make_preview_buffer_transient()
  if not vim.wo.previewwindow then
    return
  end

  local buf = vim.api.nvim_get_current_buf()

  -- Keep preview buffers visible in :ls, but wipe them when the preview
  -- window stops showing them. This prevents accumulation without hiding them.
  if #vim.fn.win_findbuf(buf) == 1 then
    vim.bo[buf].buflisted = true
    vim.bo[buf].bufhidden = 'wipe'
  end
end

local function clear_preview_highlight()
  local origin = vim.api.nvim_get_current_win()

  pcall(vim.cmd, 'silent! wincmd P')
  if vim.wo.previewwindow then
    make_preview_buffer_transient()

    local match_id = vim.w.preview_word_match
    if match_id then
      pcall(vim.fn.matchdelete, match_id)
      vim.w.preview_word_match = nil
    end
  end

  if vim.api.nvim_win_is_valid(origin) then
    vim.api.nvim_set_current_win(origin)
  end
end

local function preview_tag_under_cursor(opts)
  opts = opts or {}

  if vim.wo.previewwindow then
    return
  end

  local word = current_word()
  if not word then
    if opts.notify then
      vim.notify('No word under cursor to preview', vim.log.levels.INFO)
    end
    return
  end

  clear_preview_highlight()

  local origin = vim.api.nvim_get_current_win()
  local ok = pcall(vim.cmd, 'silent! ptag ' .. vim.fn.fnameescape(word))
  if not ok then
    if opts.notify then
      vim.notify('No tag found for: ' .. word, vim.log.levels.WARN)
    end
    return
  end

  pcall(vim.cmd, 'silent! wincmd P')
  if vim.wo.previewwindow then
    make_preview_buffer_transient()
    pcall(vim.cmd, 'silent! normal! zv')

    local escaped_word = vim.fn.escape(word, [[\]])
    vim.fn.search([[\<\V]] .. escaped_word .. [[\>]])

    local pattern = [[\%]] .. vim.fn.line('.') .. [[l\%]] .. vim.fn.col('.') .. [[c\k*]]
    vim.w.preview_word_match = vim.fn.matchadd('PreviewWord', pattern)
  end

  if vim.api.nvim_win_is_valid(origin) then
    vim.api.nvim_set_current_win(origin)
  end
end

vim.keymap.set('n', '<leader>p', function()
  preview_tag_under_cursor({ notify = true })
end, { desc = 'Preview tag under cursor', silent = true })

vim.keymap.set('n', '<leader>P', function()
  local origin = vim.api.nvim_get_current_win()

  pcall(vim.cmd, 'silent! wincmd P')
  if vim.wo.previewwindow then
    make_preview_buffer_transient()
  end

  if vim.api.nvim_win_is_valid(origin) then
    vim.api.nvim_set_current_win(origin)
  end

  pcall(vim.cmd, 'pclose')
end, { desc = 'Close preview window', silent = true })
