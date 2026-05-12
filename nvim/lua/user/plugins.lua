-- Neovim 0.12 native plugin manager.
-- Plugins are installed/registered during startup, but not eagerly loaded while
-- init.lua is being sourced. Each consumer still loads its plugin with :packadd.
vim.pack.add({
  { src = "https://github.com/nvim-mini/mini.pairs.git", name = "mini.pairs" },
  { src = "https://github.com/nvim-mini/mini.indentscope.git", name = "mini.indentscope" },
  { src = "https://github.com/nvim-mini/mini.completion.git", name = "mini.completion" },
  { src = "https://github.com/nvim-mini/mini.snippets.git", name = "mini.snippets" },
  { src = "https://github.com/nvim-mini/mini.icons.git", name = "mini.icons" },
  { src = "https://github.com/nvim-lualine/lualine.nvim.git", name = "lualine.nvim" },
  { src = "https://github.com/ibhagwan/fzf-lua.git", name = "fzf-lua" },
}, {
  confirm = false,
})

local function pack_names(args)
  if args == "" then
    return nil
  end
  return vim.split(args, "%s+", { trimempty = true })
end

vim.api.nvim_create_user_command("PackUpdate", function(opts)
  vim.pack.update(pack_names(opts.args), { force = opts.bang })
end, {
  bang = true,
  nargs = "*",
  complete = function()
    return vim.tbl_map(function(plugin)
      return plugin.spec.name
    end, vim.pack.get(nil, { info = false }))
  end,
  desc = "Update plugins managed by vim.pack. Use ! to skip confirmation.",
})

vim.api.nvim_create_user_command("PackUpdateOffline", function(opts)
  vim.pack.update(pack_names(opts.args), { force = opts.bang, offline = true })
end, {
  bang = true,
  nargs = "*",
  complete = function()
    return vim.tbl_map(function(plugin)
      return plugin.spec.name
    end, vim.pack.get(nil, { info = false }))
  end,
  desc = "Open vim.pack update view without fetching. Use ! to apply immediately.",
})

vim.api.nvim_create_user_command("PackList", function()
  local lines = vim.tbl_map(function(plugin)
    local state = plugin.active and "active" or "inactive"
    local rev = plugin.rev and plugin.rev:sub(1, 8) or "????????"
    return string.format("%-20s %-8s %s %s", plugin.spec.name, state, rev, plugin.path)
  end, vim.pack.get(nil, { info = false }))

  vim.api.nvim_echo({ { table.concat(lines, "\n") } }, false, {})
end, {
  desc = "List plugins managed by vim.pack.",
})
