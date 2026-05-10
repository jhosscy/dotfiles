vim.cmd('packadd lualine.nvim')

local ok, lualine = pcall(require, 'lualine')
if not ok then
  return
end

local c = {
  bg = 'NONE',
  fg = '#93a4c3',
  dark = '#0c0e15',
  grey = '#455574',
  blue = '#41a7fc',
  green = '#8bcd5b',
  yellow = '#efbd5d',
  red = '#f65866',
}

local function section(bg)
  return {
    a = { fg = c.dark, bg = bg, gui = 'bold' },
    b = { fg = c.fg, bg = c.bg },
    c = { fg = c.fg, bg = c.bg },
  }
end

local theme = {
  normal = section(c.fg),
  insert = section(c.green),
  visual = section(c.yellow),
  replace = section(c.red),
  command = section(c.blue),
  inactive = {
    a = { fg = c.grey, bg = c.bg },
    b = { fg = c.grey, bg = c.bg },
    c = { fg = c.grey, bg = c.bg },
  },
}

lualine.setup({
  options = {
    icons_enabled = true,
    theme = theme,
    globalstatus = true,
    component_separators = { left = '', right = '' },
    section_separators = { left = '', right = '' },
    disabled_filetypes = {
      statusline = {},
      winbar = {},
    },
  },

  sections = {
    lualine_a = { 'mode' },
    lualine_b = { 'branch' },
    lualine_c = {
      {
        'filename',
        path = 0,
        symbols = {
          modified = ' +',
          readonly = ' ',
          unnamed = '[No Name]',
        },
      },
    },
    lualine_x = {
      {
        'diagnostics',
        sources = { 'nvim_diagnostic' },
        symbols = {
          error = ' ',
          warn = ' ',
          info = ' ',
          hint = ' ',
        },
      },
      'diff',
      'filetype',
    },
    lualine_y = { 'progress' },
    lualine_z = { 'location' },
  },

  inactive_sections = {
    lualine_a = {},
    lualine_b = {},
    lualine_c = { 'filename' },
    lualine_x = { 'location' },
    lualine_y = {},
    lualine_z = {},
  },

  tabline = {},
  winbar = {},
  inactive_winbar = {},
  extensions = { 'quickfix', 'fzf' },
})
