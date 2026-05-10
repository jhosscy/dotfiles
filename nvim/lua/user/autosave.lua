local autosave = {
  enabled = false,
  group = vim.api.nvim_create_augroup("UserAutosave", { clear = true }),
  timer = nil,
  delay = 100, -- 300ms debounce: equilibrio entre velocidad y rendimiento
}
-- Verificar si el buffer es guardable
local function can_save()
  local bo = vim.bo
  return bo.modified 
    and bo.modifiable 
    and not bo.readonly
    and bo.buftype == ""      -- Solo buffers normales (no terminales, floats, etc)
    and vim.fn.expand("%") ~= ""  -- Tiene nombre de archivo
end
-- Guardado real
local function do_save()
  if not can_save() then return end
  vim.cmd("silent! write")
end
-- Debounce: programa el guardado tras el delay sin cambios
local function schedule_save()
  -- Cancelar timer anterior si existe
  if autosave.timer then
    autosave.timer:stop()
    autosave.timer:close()
  end
  
  -- Crear nuevo timer
  autosave.timer = vim.uv.new_timer()
  autosave.timer:start(autosave.delay, 0, vim.schedule_wrap(do_save))
end
function autosave.enable()
  if autosave.enabled then return end
  
  autosave.enabled = true
  vim.api.nvim_clear_autocmds({ group = autosave.group })
  
  -- CRÍTICO PARA VITE HMR: TextChangedI guarda MIENTRAS escribes en modo insert
  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
    group = autosave.group,
    callback = schedule_save,
    desc = "Autosave with debounce for Vite HMR",
  })
  
  vim.notify("Autosave enabled", vim.log.levels.INFO)
end
function autosave.disable()
  if not autosave.enabled then return end
  
  autosave.enabled = false
  
  -- Limpiar timer
  if autosave.timer then
    autosave.timer:stop()
    autosave.timer:close()
    autosave.timer = nil
  end
  
  vim.api.nvim_clear_autocmds({ group = autosave.group })
  vim.notify("Autosave disabled", vim.log.levels.INFO)
end
function autosave.toggle()
  if autosave.enabled then
    autosave.disable()
  else
    autosave.enable()
  end
end
-- Comandos
vim.api.nvim_create_user_command("AutosaveEnable", autosave.enable, {})
vim.api.nvim_create_user_command("AutosaveDisable", autosave.disable, {})
vim.api.nvim_create_user_command("AutosaveToggle", autosave.toggle, {})
return autosave
