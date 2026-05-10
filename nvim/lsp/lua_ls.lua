return {
  -- Command to start the language server (must be installed on your system)
  cmd = { 'lua-language-server' },
  -- Filetypes to automatically attach to
  filetypes = { 'lua' },
  -- Root markers to identify the workspace directory
  root_markers = { '.luarc.json', '.luarc.jsonc', '.git' },
  -- Specific settings for the Lua language server
  settings = {
    Lua = {
      runtime = {
        -- Tell the language server which version of Lua you're using (LuaJIT for Neovim)
        version = 'LuaJIT',
      },
      workspace = {
        -- Make the server aware of Neovim runtime files
        library = { vim.env.VIMRUNTIME },
        -- Disable the annoying "Do you need to configure your work environment as..." prompt
        checkThirdParty = false,
      },
      telemetry = {
        -- Do not send telemetry data
        enable = false,
      },
    },
  },
}
