-- Directory where Neovim looks for optional packages
local pack_path = vim.fn.stdpath("data") .. "/site/pack/plugins/opt/"

-- Function to install a plugin if it doesn't exist
-- NOTE: We intentionally do NOT 'packadd' here. Each consumer loads its own
-- plugin lazily when needed, keeping startup time minimal.
local function ensure_plugin(name, url)
  local install_path = pack_path .. name
  if vim.fn.empty(vim.fn.glob(install_path)) > 0 then
    vim.notify("Installing " .. name .. "...")
    vim.fn.system({ "git", "clone", "--depth", "1", url, install_path })
    vim.notify(name .. " installed.")
  end
end

-- List of plugins (only auto-install, no eager loading)
ensure_plugin("mini.pairs", "https://github.com/nvim-mini/mini.pairs.git")
ensure_plugin("mini.indentscope", "https://github.com/nvim-mini/mini.indentscope.git")
ensure_plugin("mini.completion", "https://github.com/nvim-mini/mini.completion.git")
ensure_plugin("mini.snippets", "https://github.com/nvim-mini/mini.snippets.git")
ensure_plugin("mini.icons", "https://github.com/nvim-mini/mini.icons.git")
ensure_plugin("lualine.nvim", "https://github.com/nvim-lualine/lualine.nvim.git")
ensure_plugin("fzf-lua", "https://github.com/ibhagwan/fzf-lua.git")
