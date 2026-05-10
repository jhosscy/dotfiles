vim.opt.showtabline = 1
vim.opt.tabline = "%!v:lua.UserTabLine()"

local function file_icon(filename)
  local ok, icons = pcall(require, "mini.icons")
  if not ok then
    return ""
  end

  local icon = icons.get("file", filename)
  return icon or ""
end

local function tab_label(n)
  local buflist = vim.fn.tabpagebuflist(n)
  local winnr = vim.fn.tabpagewinnr(n)
  local bufnr = buflist[winnr]

  local name = vim.fn.bufname(bufnr)
  if name == "" then
    name = "[No Name]"
  else
    name = vim.fn.fnamemodify(name, ":t")
  end

  local modified = vim.fn.getbufvar(bufnr, "&modified") == 1 and " +" or ""

  return " " .. file_icon(name) .. " " .. name .. modified .. " "
end

function _G.UserTabLine()
  local line = ""
  local current = vim.fn.tabpagenr()
  local total = vim.fn.tabpagenr("$")

  for i = 1, total do
    line = line .. "%" .. i .. "T"

    if i == current then
      line = line .. "%#TabLineSelSep#%#TabLineSel#"
      line = line .. tab_label(i)
      line = line .. "%#TabLineSelSep#"
    else
      line = line .. "%#TabLine#"
      line = line .. tab_label(i)
    end
  end

  return line .. "%#TabLineFill#%T"
end
