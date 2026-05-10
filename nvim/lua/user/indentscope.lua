-- mini.indentscope: visual indent guides
-- Loaded directly (not via plugins.lua) but still lightweight.
vim.cmd('packadd mini.indentscope')
local ok, indentscope = pcall(require, "mini.indentscope")
if not ok then
  vim.notify("mini.indentscope failed to load", vim.log.levels.WARN)
  return
end

indentscope.setup({
  symbol = "│",
  draw = {
    delay = 0,
    animation = indentscope.gen_animation.none(),
    priority = 2,
  },
  options = {
    border = "both",
    indent_at_cursor = true,
    try_as_border = true,
  },
  mappings = {
    object_scope = "",
    object_scope_with_border = "ai",
    goto_top = "[i",
    goto_bottom = "]i",
  },
})
