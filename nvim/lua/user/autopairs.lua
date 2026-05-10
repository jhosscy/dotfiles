-- 1. Definimos un grupo (augroup) según recomienda la documentación
-- para mantener la memoria limpia y evitar duplicados.
local autopairs_group = vim.api.nvim_create_augroup("UserAutopairs", { clear = true })

vim.api.nvim_create_autocmd("InsertEnter", {
  group = autopairs_group,
  desc = "Carga perezosa de autopairs",
  once = true, -- Se auto-elimina tras ejecutarse una vez
  callback = function()
    -- 2. Usamos vim.schedule para no bloquear la UI 
    -- y que el modo insertar entre instantáneamente.
    vim.schedule(function()
      vim.cmd('packadd mini.pairs')
      local ok, autopairs = pcall(require, "mini.pairs")
      if ok then
        autopairs.setup()
      end
    end)
  end,
})
