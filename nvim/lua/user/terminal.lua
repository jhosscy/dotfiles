-- Native terminal toggles using Neovim's built-in terminal + floating windows.
-- Inspired by toggleterm.nvim's core idea: keep terminal buffers alive and
-- only show/hide their windows.

local M = {}

local terminals = {}
local group = vim.api.nvim_create_augroup('UserNativeTerminal', { clear = true })

local function valid_buf(buf)
  return buf and vim.api.nvim_buf_is_valid(buf)
end

local function valid_win(win)
  return win and vim.api.nvim_win_is_valid(win)
end

local function current_count_or(default)
  return vim.v.count > 0 and vim.v.count or default
end

local function term_id(id)
  return id and id > 0 and id or current_count_or(1)
end

local function next_id()
  local id = 1
  while terminals[id] and valid_buf(terminals[id].buf) do
    id = id + 1
  end
  return id
end

local function is_float(win)
  return valid_win(win) and vim.api.nvim_win_get_config(win).relative ~= ''
end

local function shorten_title(title)
  title = tostring(title):gsub('\r', ''):gsub('\n', ' ')

  if vim.env.HOME and vim.env.HOME ~= '' then
    title = title:gsub(vim.pesc(vim.env.HOME), '~')
  end

  local max = 50
  if #title > max then
    return title:sub(1, max - 1) .. '…'
  end

  return title
end

local function terminal_title(term)
  if term and term.display_name and term.display_name ~= '' then
    return term.display_name
  end

  if term and valid_buf(term.buf) then
    local title = vim.b[term.buf].term_title
    if title and title ~= '' then
      return shorten_title(title)
    end
  end

  return 'Terminal ' .. term.id
end

local function apply_window_options(win)
  vim.wo[win].number = false
  vim.wo[win].relativenumber = false
  vim.wo[win].signcolumn = 'no'
  vim.wo[win].foldcolumn = '0'
  vim.wo[win].wrap = false
  vim.wo[win].spell = false
end

local function float_config(term)
  local max_width = math.max(1, vim.o.columns - 4)
  local max_height = math.max(1, vim.o.lines - vim.o.cmdheight - 4)

  local width = math.min(math.max(40, math.floor(vim.o.columns * 0.85)), max_width)
  local height = math.min(math.max(10, math.floor(vim.o.lines * 0.8)), max_height)

  return {
    relative = 'editor',
    width = width,
    height = height,
    row = math.max(0, math.floor((vim.o.lines - height) / 2) - 1),
    col = math.max(0, math.floor((vim.o.columns - width) / 2)),
    style = 'minimal',
    border = vim.o.winborder ~= '' and vim.o.winborder or 'rounded',
    title = ' ' .. terminal_title(term) .. ' ',
    title_pos = 'center',
  }
end

local function refresh_float_title(term)
  if term and term.direction == 'float' and is_float(term.win) then
    vim.api.nvim_win_set_config(term.win, float_config(term))
  end
end

local function set_terminal_keymaps(buf)
  local opts = { buffer = buf, silent = true }

  vim.keymap.set('t', '<Esc><Esc>', [[<C-\><C-n>]], opts)

  -- Window navigation without leaving Terminal-mode permanently.
  vim.keymap.set('t', '<C-h>', [[<Cmd>wincmd h<CR>]], opts)
  vim.keymap.set('t', '<C-j>', [[<Cmd>wincmd j<CR>]], opts)
  vim.keymap.set('t', '<C-k>', [[<Cmd>wincmd k<CR>]], opts)
  vim.keymap.set('t', '<C-l>', [[<Cmd>wincmd l<CR>]], opts)

  -- Preserve the native <C-w> window prefix from terminal-mode.
  vim.keymap.set('t', '<C-w>', [[<C-\><C-n><C-w>]], opts)

  local function toggle_current_terminal()
    local id = vim.b.user_terminal_id
    local term = id and terminals[id]
    if term then
      M.toggle(id, term.direction)
    end
  end

  vim.keymap.set({ 'n', 't' }, '<leader>tt', toggle_current_terminal, opts)

  vim.keymap.set({ 'n', 't' }, '<leader>tq', function()
    local id = vim.b.user_terminal_id
    if id then
      M.kill(id)
    end
  end, opts)

  vim.keymap.set({ 'n', 't' }, '<leader>tr', function()
    local id = vim.b.user_terminal_id
    if id then
      M.rename(id)
    end
  end, opts)
end

local function ensure_terminal(id)
  local term = terminals[id]
  if term and valid_buf(term.buf) then
    return term
  end

  local buf = vim.api.nvim_create_buf(false, false)
  vim.bo[buf].bufhidden = 'hide'
  vim.bo[buf].buflisted = false
  vim.bo[buf].swapfile = false
  vim.b[buf].user_terminal_id = id

  term = {
    id = id,
    buf = buf,
    win = nil,
    job = nil,
    direction = 'float',
    origin = nil,
    display_name = nil,
  }
  terminals[id] = term

  set_terminal_keymaps(buf)

  return term
end

local function start_job(term)
  if term.job then
    return
  end

  vim.api.nvim_buf_call(term.buf, function()
    term.job = vim.fn.jobstart(vim.o.shell, {
      term = true,
      cwd = vim.fn.getcwd(),
      on_exit = function()
        vim.schedule(function()
          if valid_win(term.win) then
            pcall(vim.api.nvim_win_close, term.win, true)
          end
          if valid_buf(term.buf) then
            pcall(vim.api.nvim_buf_delete, term.buf, { force = true })
          end
          terminals[term.id] = nil
        end)
      end,
    })

    if term.job <= 0 then
      vim.notify('Failed to start terminal shell: ' .. vim.o.shell, vim.log.levels.ERROR)
      term.job = nil
    end
  end)
end

local function remember_origin(term)
  local win = vim.api.nvim_get_current_win()
  if win ~= term.win then
    term.origin = win
  end
end

function M.close(id)
  local term = terminals[id]
  if not term or not valid_win(term.win) then
    return
  end

  local origin = term.origin
  local ok = pcall(vim.api.nvim_win_close, term.win, true)
  if ok then
    term.win = nil
  end

  if ok and valid_win(origin) then
    pcall(vim.api.nvim_set_current_win, origin)
  end
end

function M.kill(id)
  id = term_id(id)

  local term = terminals[id]
  if not term then
    vim.notify('Terminal ' .. id .. ' does not exist', vim.log.levels.INFO)
    return
  end

  local origin = term.origin

  if valid_win(term.win) then
    pcall(vim.api.nvim_win_close, term.win, true)
  end

  if term.job then
    pcall(vim.fn.jobstop, term.job)
  end

  if valid_buf(term.buf) then
    pcall(vim.api.nvim_buf_delete, term.buf, { force = true })
  end

  terminals[id] = nil

  if valid_win(origin) then
    pcall(vim.api.nvim_set_current_win, origin)
  end
end

function M.kill_all()
  for id in pairs(vim.deepcopy(terminals)) do
    M.kill(id)
  end
end

function M.open(id, direction)
  id = term_id(id)
  direction = direction or 'float'

  local term = ensure_terminal(id)
  remember_origin(term)

  if valid_win(term.win) then
    if term.direction == direction then
      vim.api.nvim_set_current_win(term.win)
      return term
    end
    M.close(id)
  end

  term.direction = direction

  if direction == 'float' then
    term.win = vim.api.nvim_open_win(term.buf, true, float_config(term))
  elseif direction == 'horizontal' then
    vim.cmd('botright split')
    term.win = vim.api.nvim_get_current_win()
    vim.api.nvim_win_set_buf(term.win, term.buf)
    vim.cmd('resize 15')
  elseif direction == 'vertical' then
    vim.cmd('botright vsplit')
    term.win = vim.api.nvim_get_current_win()
    vim.api.nvim_win_set_buf(term.win, term.buf)
    vim.cmd('vertical resize ' .. math.floor(vim.o.columns * 0.4))
  else
    vim.notify('Invalid terminal direction: ' .. direction, vim.log.levels.ERROR)
    return
  end

  apply_window_options(term.win)
  start_job(term)
  vim.cmd('startinsert')

  return term
end

function M.toggle(id, direction)
  id = term_id(id)
  direction = direction or 'float'

  local term = terminals[id]
  if term and valid_win(term.win) and term.direction == direction then
    M.close(id)
    return
  end

  M.open(id, direction)
end

function M.toggle_float(id)
  M.toggle(id, 'float')
end

function M.toggle_horizontal(id)
  M.toggle(id, 'horizontal')
end

function M.toggle_vertical(id)
  M.toggle(id, 'vertical')
end

function M.new(direction)
  M.open(next_id(), direction or 'float')
end

function M.rename(id, name)
  id = id and id > 0 and id or vim.b.user_terminal_id or current_count_or(1)

  local term = terminals[id]
  if not term or not valid_buf(term.buf) then
    vim.notify('Terminal ' .. id .. ' does not exist', vim.log.levels.INFO)
    return
  end

  if not name or name == '' then
    vim.ui.input({
      prompt = 'Terminal name: ',
      default = term.display_name or terminal_title(term),
    }, function(input)
      if input ~= nil then
        M.rename(id, input)
      end
    end)
    return
  end

  term.display_name = name
  refresh_float_title(term)
end

function M.select()
  local items = {}

  for id, term in pairs(terminals) do
    if valid_buf(term.buf) then
      table.insert(items, term)
    end
  end

  table.sort(items, function(a, b)
    return a.id < b.id
  end)

  if #items == 0 then
    vim.notify('No terminals created yet', vim.log.levels.INFO)
    return
  end

  vim.ui.select(items, {
    prompt = 'Select terminal:',
    format_item = function(term)
      local state = valid_win(term.win) and 'open' or 'hidden'
      return string.format('%d: %s [%s] (%s)', term.id, terminal_title(term), term.direction, state)
    end,
  }, function(term)
    if not term then
      return
    end

    if valid_win(term.win) then
      vim.api.nvim_set_current_win(term.win)
      if vim.bo[term.buf].buftype == 'terminal' then
        vim.cmd('startinsert')
      end
    else
      M.open(term.id, term.direction)
    end
  end)
end

vim.api.nvim_create_autocmd('VimResized', {
  group = group,
  callback = function()
    for _, term in pairs(terminals) do
      if term.direction == 'float' and is_float(term.win) then
        vim.api.nvim_win_set_config(term.win, float_config(term))
      end
    end
  end,
})

vim.keymap.set('n', '<leader>tt', function()
  M.toggle_float()
end, { desc = 'Toggle floating terminal', silent = true })

vim.keymap.set('n', '<leader>th', function()
  M.toggle_horizontal()
end, { desc = 'Toggle horizontal terminal', silent = true })

vim.keymap.set('n', '<leader>tv', function()
  M.toggle_vertical()
end, { desc = 'Toggle vertical terminal', silent = true })

vim.keymap.set('n', '<leader>tn', function()
  M.new('float')
end, { desc = 'New floating terminal', silent = true })

vim.keymap.set('n', '<leader>tH', function()
  M.new('horizontal')
end, { desc = 'New horizontal terminal', silent = true })

vim.keymap.set('n', '<leader>tV', function()
  M.new('vertical')
end, { desc = 'New vertical terminal', silent = true })

vim.keymap.set('n', '<leader>ts', function()
  M.select()
end, { desc = 'Select terminal', silent = true })

vim.keymap.set('n', '<leader>tq', function()
  M.kill()
end, { desc = 'Kill terminal', silent = true })

vim.keymap.set('n', '<leader>tr', function()
  M.rename()
end, { desc = 'Rename terminal', silent = true })

vim.keymap.set('n', '<leader>tQ', function()
  M.kill_all()
end, { desc = 'Kill all terminals', silent = true })

vim.api.nvim_create_user_command('TermFloat', function(opts)
  M.toggle_float(opts.count > 0 and opts.count or nil)
end, { count = true, desc = 'Toggle floating terminal' })

vim.api.nvim_create_user_command('TermHorizontal', function(opts)
  M.toggle_horizontal(opts.count > 0 and opts.count or nil)
end, { count = true, desc = 'Toggle horizontal terminal' })

vim.api.nvim_create_user_command('TermVertical', function(opts)
  M.toggle_vertical(opts.count > 0 and opts.count or nil)
end, { count = true, desc = 'Toggle vertical terminal' })

vim.api.nvim_create_user_command('TermNew', function()
  M.new('float')
end, { desc = 'Open a new floating terminal' })

vim.api.nvim_create_user_command('TermNewHorizontal', function()
  M.new('horizontal')
end, { desc = 'Open a new horizontal terminal' })

vim.api.nvim_create_user_command('TermNewVertical', function()
  M.new('vertical')
end, { desc = 'Open a new vertical terminal' })

vim.api.nvim_create_user_command('TermSelect', function()
  M.select()
end, { desc = 'Select terminal' })

vim.api.nvim_create_user_command('TermKill', function(opts)
  M.kill(opts.count > 0 and opts.count or nil)
end, { count = true, desc = 'Kill terminal' })

vim.api.nvim_create_user_command('TermKillAll', function()
  M.kill_all()
end, { desc = 'Kill all terminals' })

vim.api.nvim_create_user_command('TermName', function(opts)
  M.rename(opts.count > 0 and opts.count or nil, opts.args ~= '' and opts.args or nil)
end, { count = true, nargs = '*', desc = 'Rename terminal' })

return M
