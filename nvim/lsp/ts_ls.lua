--- @param bufnr integer
--- @return boolean
local function is_deno(bufnr)
 return vim.fs.root(bufnr, { 'deno.json', 'deno.jsonc' }) ~= nil
end

return {
  cmd = { 'typescript-language-server', '--stdio' },
  filetypes = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact' },

  root_dir = function(bufnr, on_dir)
    -- 1. REGLA DE ORO: Si es un proyecto Deno, ABORTAMOS ts_ls inmediatamente
    if is_deno(bufnr) then
      return -- Al hacer return sin llamar a on_dir(), ts_ls se desactiva
    end

    -- 2. Si no es Deno, buscamos la raíz normal de Node o Git
    local root = vim.fs.root(bufnr, { 'package.json', 'tsconfig.json', 'jsconfig.json' })

    -- 3. Si encontramos la raíz de Node, activamos ts_ls
    if root then
      on_dir(root)
    end
  end,
}
