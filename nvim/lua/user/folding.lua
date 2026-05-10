-- Minimal folding enhancements: keep fold options in options.lua,
-- and keep fold display logic isolated here.

local fold_icon = "\u{f0da}"  -- nf-fa-caret_right
local lines_icon = "\u{f03a}" -- nf-fa-list

function _G.UserFoldText()
  local line = vim.fn.getline(vim.v.foldstart):gsub("^%s*", "")
  local line_count = vim.v.foldend - vim.v.foldstart + 1

  if line == "" then
    line = "[empty]"
  end

  local suffix = line_count == 1 and " line" or " lines"
  return "  " .. fold_icon .. " " .. line .. "  " .. lines_icon .. " " .. line_count .. suffix
end

vim.opt.foldtext = "v:lua.UserFoldText()"
