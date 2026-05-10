-- 1. Diagnostic configuration (gutter signs and virtual text)
vim.diagnostic.config({
  virtual_text = { prefix = '●' },
  signs = {
    text = {
      [vim.diagnostic.severity.ERROR] = '',
      [vim.diagnostic.severity.WARN] = '',
      [vim.diagnostic.severity.HINT] = '',
      [vim.diagnostic.severity.INFO] = '',
    },
  },
  underline = true,
  float = { border = "rounded" },
  severity_sort = true,
})

local ecosystem_loaded = false

-- 2. Activate LSP completion when server attaches
vim.api.nvim_create_autocmd('LspAttach', {
  group = vim.api.nvim_create_augroup('UserLspConfig', { clear = true }),
  callback = function(ev)
    local client = vim.lsp.get_client_by_id(ev.data.client_id)
    if not client then return end

    -- Solo cargamos los plugins la primera vez.
    if not ecosystem_loaded then
      ecosystem_loaded = true
      require('user.icons')
      require('user.snippets')
      require('user.completion')
    end

    -- Usamos package.loaded en lugar de _G para verificar si el plugin está cargado.
    -- Esto hace exactamente lo mismo pero el linter no se queja.
    if package.loaded['mini.completion'] and client:supports_method('textDocument/completion') then
      vim.bo[ev.buf].completefunc = 'v:lua.MiniCompletion.completefunc_lsp'
    end

    -- Activar inlay hints si el servidor lo soporta
    if client:supports_method('textDocument/inlayHint') then
      vim.lsp.inlay_hint.enable(true, { bufnr = ev.buf })
    end
  end,
})

-- 3. Lazy-start
local servers = {
  lua_ls = { '*.lua' },
  ts_ls  = { '*.ts', '*.js', '*.tsx', '*.jsx' },
  deno_ls = { '*.ts', '*.js', '*.tsx', '*.jsx' },
}

for server_name, file_patterns in pairs(servers) do
  vim.api.nvim_create_autocmd('InsertEnter', {
    pattern = file_patterns,
    once = true,
    callback = function()
      vim.lsp.enable(server_name)
    end,
    desc = 'Lazy-start ' .. server_name .. ' on first insert',
  })
end
