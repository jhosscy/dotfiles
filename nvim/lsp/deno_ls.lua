return {
  cmd = { 'deno', 'lsp' },
  filetypes = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact' },
  
  -- Usamos root_dir como función en lugar de root_markers
  root_dir = function(bufnr, on_dir)
    -- Buscamos si existe la configuración de Deno
    local root = vim.fs.root(bufnr, { 'deno.json', 'deno.jsonc' })
    
    -- Si existe, le decimos a Neovim que active el servidor en esa ruta
    if root then
      on_dir(root)
    end
    -- Si no existe, no llamamos a on_dir(), por lo que deno_ls NUNCA se activará
  end,

  init_options = {
    enable = true,
    lint = true,
    unstable = true,
  },
}
