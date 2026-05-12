vim.cmd("hi clear")
if vim.fn.exists("syntax_on") == 1 then
    vim.cmd("syntax reset")
end

vim.o.termguicolors = true
vim.g.colors_name = "onedark_deep_transparent"

local c = {
    black       = "#0c0e15",
    bg0         = "#1a212e",
    bg1         = "#21283b",
    bg2         = "#283347",
    bg3         = "#2a324a",
    bg_d        = "#141b24",
    bg_blue     = "#54b0fd",
    bg_yellow   = "#f2cc81",
    fg          = "#93a4c3",
    purple      = "#c75ae8",
    green       = "#8bcd5b",
    orange      = "#dd9046",
    blue        = "#41a7fc",
    yellow      = "#efbd5d",
    cyan        = "#34bfd0",
    red         = "#f65866",
    grey        = "#455574",
    light_grey  = "#6c7d9c",
    dark_cyan   = "#1b6a73",
    dark_red    = "#992525",
    dark_yellow = "#8f610d",
    dark_purple = "#862aa1",
    diff_add    = "#27341c",
    diff_delete = "#331c1e",
    diff_change = "#102b40",
    diff_text   = "#1c4a6e",
    none        = "NONE",
}

-- 3. Definición de los grupos de resaltado
-- Nota: Para lograr la transparencia, se omite el campo `bg` o se asigna `c.none`.
local highlights = {
    -- ===============
    -- UI Base (Transparente)
    -- ===============
    Normal       = { fg = c.fg, bg = c.none },
    Terminal     = { fg = c.fg, bg = c.none },
    EndOfBuffer  = { fg = c.grey, bg = c.none },
    SignColumn   = { fg = c.fg, bg = c.none },
    FoldColumn   = { fg = c.blue, bg = c.none },
    Folded       = { fg = c.blue, bg = c.none, italic = true },
    CursorLine   = { bg = c.none }, -- Línea del cursor transparente
    CursorColumn = { bg = c.bg1 },
    ColorColumn  = { bg = c.bg1 },
    LineNr       = { fg = c.grey, bg = c.none },
    CursorLineNr = { fg = c.fg, bg = c.none },
    Conceal      = { fg = c.grey, bg = c.none },
    Cursor       = { reverse = true },
    vCursor      = { reverse = true },
    iCursor      = { reverse = true },

    -- ===============
    -- Ventanas Flotantes y Menús (Transparentes)
    -- ===============
    NormalFloat  = { fg = c.fg, bg = c.none },
    FloatBorder  = { fg = c.grey, bg = c.none },
    Pmenu        = { fg = c.fg, bg = c.none },
    PmenuSel     = { fg = c.bg0, bg = c.bg_blue },
    PmenuBorder  = { fg = c.grey, bg = c.none },
    PmenuShadow  = { bg = c.bg_d },
    PmenuShadowThrough = { bg = c.bg_d },
    PmenuSbar    = { bg = c.bg1 },
    PmenuThumb   = { bg = c.grey },

    -- ===============
    -- Línea de Estado / Pestañas
    -- ===============
    StatusLine   = { fg = c.fg, bg = c.none },
    StatusLineNC = { fg = c.grey, bg = c.none },
    WinSeparator = { fg = c.bg3 },
    WinBar       = { fg = c.fg, bg = c.none },
    WinBarNC     = { fg = c.grey, bg = c.none },
    TabLine       = { fg = c.grey, bg = c.none },
    TabLineFill   = { fg = c.grey, bg = c.none },
    TabLineSel    = { fg = c.bg0, bg = c.fg, bold = true },
    TabLineSelSep = { fg = c.fg, bg = c.none },

    -- ===============
    -- Búsqueda y Visual Mode
    -- ===============
    Visual       = { bg = c.bg3 },
    VisualNOS    = { bg = c.bg2, underline = true },
    Search       = { fg = c.bg0, bg = c.bg_yellow },
    IncSearch    = { fg = c.bg0, bg = c.orange },
    CurSearch    = { fg = c.bg0, bg = c.orange },
    MatchParen   = { fg = c.none, bg = c.bg3 },
    Substitute   = { fg = c.bg0, bg = c.green },

    -- ===============
    -- Mensajes
    -- ===============
    Directory  = { fg = c.blue },
    ErrorMsg   = { fg = c.red, bold = true },
    WarningMsg = { fg = c.yellow, bold = true },
    MoreMsg    = { fg = c.blue, bold = true },
    Question   = { fg = c.yellow },

    -- ===============
    -- Sintaxis Clásica (Fallback)
    -- ===============
    Comment        = { fg = c.grey, italic = true },
    String         = { fg = c.green },
    Character      = { fg = c.orange },
    Number         = { fg = c.orange },
    Float          = { fg = c.orange },
    Boolean        = { fg = c.orange },
    Identifier     = { fg = c.red },
    Function       = { fg = c.blue },
    Statement      = { fg = c.purple },
    Conditional    = { fg = c.purple },
    Repeat         = { fg = c.purple },
    Label          = { fg = c.purple },
    Operator       = { fg = c.purple },
    Keyword        = { fg = c.purple },
    Exception      = { fg = c.purple },
    PreProc        = { fg = c.purple },
    Include        = { fg = c.purple },
    Define         = { fg = c.purple },
    Macro          = { fg = c.red },
    PreCondit      = { fg = c.purple },
    Type           = { fg = c.yellow },
    StorageClass   = { fg = c.yellow },
    Structure      = { fg = c.yellow },
    Typedef        = { fg = c.yellow },
    Special        = { fg = c.red },
    SpecialChar    = { fg = c.red },
    Tag            = { fg = c.green },
    Delimiter      = { fg = c.light_grey },
    SpecialComment = { fg = c.grey },
    Debug          = { fg = c.yellow },
    Underlined     = { underline = true },
    Ignore         = { fg = c.none },
    Error          = { fg = c.purple },
    Todo           = { fg = c.red },

    -- ===============
    -- TreeSitter (Soporte Nativo Neovim 0.9+)
    -- ===============
    ["@attribute"]           = { fg = c.cyan },
    ["@boolean"]             = { fg = c.orange },
    ["@character"]           = { fg = c.orange },
    ["@character.special"]   = { fg = c.red },
    ["@comment"]             = { fg = c.grey, italic = true },
    ["@comment.error"]       = { fg = c.red },
    ["@comment.note"]        = { fg = c.blue },
    ["@comment.todo"]        = { fg = c.purple },
    ["@comment.warning"]     = { fg = c.yellow },
    ["@constant"]            = { fg = c.orange },
    ["@constant.builtin"]    = { fg = c.orange },
    ["@constant.macro"]      = { fg = c.orange },
    ["@constructor"]         = { fg = c.yellow, bold = true },
    ["@function"]            = { fg = c.blue },
    ["@function.builtin"]    = { fg = c.cyan },
    ["@function.call"]       = { fg = c.blue },
    ["@function.macro"]      = { fg = c.cyan },
    ["@function.method"]     = { fg = c.blue },
    ["@function.method.call"]= { fg = c.blue },
    ["@keyword"]             = { fg = c.purple },
    ["@keyword.conditional"] = { fg = c.purple },
    ["@keyword.function"]    = { fg = c.purple },
    ["@keyword.operator"]    = { fg = c.purple },
    ["@keyword.repeat"]      = { fg = c.purple },
    ["@keyword.return"]      = { fg = c.purple },
    ["@keyword.type"]        = { fg = c.purple },
    ["@label"]               = { fg = c.red },
    ["@markup.strong"]       = { fg = c.fg, bold = true },
    ["@markup.italic"]       = { fg = c.fg, italic = true },
    ["@markup.strikethrough"]= { fg = c.fg, strikethrough = true },
    ["@markup.underline"]    = { fg = c.fg, underline = true },
    ["@markup.heading"]      = { fg = c.orange, bold = true },
    ["@markup.link.url"]     = { fg = c.cyan, underline = true },
    ["@module"]              = { fg = c.yellow },
    ["@module.builtin"]      = { fg = c.orange },
    ["@number"]              = { fg = c.orange },
    ["@number.float"]        = { fg = c.orange },
    ["@operator"]            = { fg = c.fg },
    ["@property"]            = { fg = c.cyan },
    ["@punctuation.bracket"] = { fg = c.light_grey },
    ["@punctuation.delimiter"]= { fg = c.light_grey },
    ["@punctuation.special"] = { fg = c.red },
    ["@string"]              = { fg = c.green },
    ["@string.escape"]       = { fg = c.red },
    ["@string.regexp"]       = { fg = c.orange },
    ["@string.special.url"]  = { fg = c.cyan, underline = true },
    ["@tag"]                 = { fg = c.purple },
    ["@tag.attribute"]       = { fg = c.yellow },
    ["@tag.delimiter"]       = { fg = c.purple },
    ["@type"]                = { fg = c.yellow },
    ["@type.builtin"]        = { fg = c.orange },
    ["@variable"]            = { fg = c.fg },
    ["@variable.builtin"]    = { fg = c.red },
    ["@variable.member"]     = { fg = c.cyan },
    ["@variable.parameter"]  = { fg = c.red },

    -- ===============
    -- LSP Semantic Tokens
    -- ===============
    ["@lsp.type.comment"]     = { link = "@comment" },
    ["@lsp.type.enum"]        = { link = "@type" },
    ["@lsp.type.keyword"]     = { link = "@keyword" },
    ["@lsp.type.namespace"]   = { link = "@module" },
    ["@lsp.type.parameter"]   = { link = "@variable.parameter" },
    ["@lsp.type.property"]    = { link = "@property" },
    ["@lsp.type.variable"]    = { link = "@variable" },
    ["@lsp.type.macro"]       = { link = "@function.macro" },
    ["@lsp.type.method"]      = { link = "@function.method" },
    ["@lsp.type.number"]      = { link = "@number" },
    ["@lsp.type.builtinType"] = { link = "@type.builtin" },

    -- ===============
    -- Diagnósticos (LSP)
    -- ===============
    DiagnosticError = { fg = c.red },
    DiagnosticWarn  = { fg = c.yellow },
    DiagnosticInfo  = { fg = c.cyan },
    DiagnosticHint  = { fg = c.purple },
    DiagnosticOk    = { fg = c.green },
    DiagnosticUnnecessary = { fg = c.grey },
    DiagnosticDeprecated  = { fg = c.orange, strikethrough = true },

    -- Líneas en diagnóstico (Subrayado rizado si la terminal lo soporta)
    DiagnosticUnderlineError = { sp = c.red, undercurl = true },
    DiagnosticUnderlineWarn  = { sp = c.yellow, undercurl = true },
    DiagnosticUnderlineInfo  = { sp = c.blue, undercurl = true },
    DiagnosticUnderlineHint  = { sp = c.purple, undercurl = true },
    DiagnosticUnderlineOk    = { sp = c.green, undercurl = true },

    -- Texto Virtual transparente
    DiagnosticVirtualTextError = { fg = c.red, bg = c.none },
    DiagnosticVirtualTextWarn  = { fg = c.yellow, bg = c.none },
    DiagnosticVirtualTextInfo  = { fg = c.cyan, bg = c.none },
    DiagnosticVirtualTextHint  = { fg = c.purple, bg = c.none },
    DiagnosticVirtualTextOk    = { fg = c.green, bg = c.none },

    -- ===============
    -- Git y Diff
    -- ===============
    DiffAdd    = { fg = c.none, bg = c.diff_add },
    DiffChange = { fg = c.none, bg = c.diff_change },
    DiffDelete = { fg = c.none, bg = c.diff_delete },
    DiffText   = { fg = c.none, bg = c.diff_text },

    GitSignsAdd    = { fg = c.green, bg = c.none },
    GitSignsChange = { fg = c.blue, bg = c.none },
    GitSignsDelete = { fg = c.red, bg = c.none },

    -- ===============
    -- IndentScope
    -- ===============
    MiniIndentscopeSymbol = { fg = c.bg_yellow }
}

for group, opts in pairs(highlights) do
    vim.api.nvim_set_hl(0, group, opts)
end
