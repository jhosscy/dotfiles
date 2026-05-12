-- =====================================================================
-- PERFORMANCE & SYSTEM
-- =====================================================================
vim.opt.lazyredraw = true       -- Don't redraw the screen while executing macros/registers (improves performance)
vim.opt.ttyfast = true          -- Note: Always enabled in Neovim by default (kept for Vim compatibility)
vim.opt.timeout = true          -- Wait for a mapped key sequence to complete
vim.opt.timeoutlen = 1000       -- Time in milliseconds to wait for a mapped key sequence (1 second)
vim.opt.updatetime = 300        -- Faster completion and CursorHold events (fixes LSP sluggishness)

-- =====================================================================
-- BACKUP, SWAP & UNDO
-- =====================================================================
vim.opt.swapfile = false        -- Disable the use of swap files for buffers
vim.opt.backup = false          -- Disable making a backup before overwriting a file
vim.opt.writebackup = false     -- Disable making a backup during file write
vim.opt.undofile = true         -- Automatically save and restore undo history to/from an undo file
vim.opt.undodir = vim.fn.stdpath('cache') .. '/undo' -- Set the directory where undo files are stored

-- =====================================================================
-- USER INTERFACE (UI) & DISPLAY
-- =====================================================================
vim.opt.termguicolors = true    -- Enable 24-bit RGB colors in the TUI (Terminal UI)
vim.opt.number = true           -- Print the absolute line number in front of each line
vim.opt.relativenumber = true   -- Show the line number relative to the line with the cursor
vim.opt.numberwidth = 1         -- Minimal number of columns to use for the line number
vim.opt.signcolumn = "yes"      -- Always show the signcolumn (prevents text from shifting when signs appear)
vim.opt.laststatus = 3          -- Global statusline: always and ONLY show the statusline on the last window
vim.opt.showmode = false        -- Don't show mode messages on the last line (e.g., "-- INSERT --")
vim.opt.showcmd = true          -- Show (partial) command in the last line of the screen
vim.opt.cmdheight = 0           -- Neovim 0.12 UI2: hide cmdline until needed
vim.opt.ruler = true            -- Show the line and column number of the cursor position
vim.opt.scrolloff = 8           -- Minimal number of screen lines to keep above and below the cursor
vim.opt.sidescrolloff = 8       -- Minimal number of screen columns to keep to the left/right of the cursor
vim.opt.wrap = false            -- Disable line wrapping (long lines extend off-screen)
vim.opt.showtabline = 1         -- Show tabline only if there are at least two tab pages
vim.opt.inccommand = "split"    -- Show live preview of substitute commands (search & replace) in a split window
vim.opt.winblend = 0            -- Enable subtle pseudo-transparency for floating windows (like LSP docs)
vim.opt.winborder = "rounded"   -- Default border for all floating windows (Hover, Signature, etc.)
vim.opt.splitbelow = true       -- Splitting a window will put the new window below the current one
vim.opt.splitright = true       -- Splitting a window will put the new window right of the current one

-- Experimental Neovim 0.12 UI: redesigned messages/cmdline, works better with cmdheight=0
pcall(function()
  require('vim._core.ui2').enable()
end)

-- =====================================================================
-- FOLDING
-- =====================================================================
vim.opt.foldmethod = "indent"   -- Simple folding based on indentation, no plugins needed
vim.opt.foldlevel = 99          -- Keep folds open by default while editing
vim.opt.foldlevelstart = 99     -- Open all folds when opening a buffer
vim.opt.foldenable = true       -- Enable folding without forcing folds closed
vim.opt.foldminlines = 3        -- Avoid tiny folds that add visual noise
vim.opt.foldcolumn = "0"        -- Do not show an extra fold column

-- =====================================================================
-- MOUSE & SELECTION
-- =====================================================================
vim.opt.mouse = ""              -- Disable mouse support completely (use keyboard only)
vim.opt.mousehide = true        -- Hide the mouse pointer while typing characters
vim.opt.selectmode = ""         -- Don't automatically start Select mode instead of Visual mode

-- =====================================================================
-- INDENTATION & TABS
-- =====================================================================
vim.opt.autoindent = false      -- Disable copying indent from current line when starting a new line
vim.opt.smartindent = false     -- Disable smart autoindenting (often handled better by LSP/Treesitter)
vim.opt.expandtab = true        -- Use the appropriate number of spaces to insert a <Tab>
vim.opt.tabstop = 2             -- Number of spaces that a <Tab> in the file counts for
vim.opt.shiftwidth = 2          -- Number of spaces to use for each step of (auto)indentation

-- =====================================================================
-- SEARCHING
-- =====================================================================
vim.opt.ignorecase = true       -- Ignore case in search patterns
vim.opt.smartcase = true        -- Override 'ignorecase' if the search pattern contains uppercase characters

-- =====================================================================
-- CLIPBOARD
-- =====================================================================
vim.opt.clipboard = "unnamedplus" -- Use the system clipboard (+ register) for all yank, delete, change, and put operations

-- =====================================================================
-- COMPLETION (PUM & COMMAND-LINE)
-- =====================================================================
vim.opt.completeopt = "menu,menuone,noselect,popup,fuzzy" -- Neovim 0.12+: popup docs + fuzzy matching
vim.opt.pumheight = 5           -- Maximum number of items to show in the popup menu
vim.opt.pumwidth = 15           -- Minimum width for the popup menu
vim.opt.pummaxwidth = 80        -- Neovim 0.12+: maximum width for the popup menu
vim.opt.pumblend = 0            -- Enable subtle pseudo-transparency for the completion popup menu
vim.opt.pumborder = "rounded"   -- Neovim 0.12+: add border to native completion popup menu
vim.opt.wildmenu = true         -- Enable enhanced command-line completion
vim.opt.wildmode = "longest:full,full" -- Command-line completion mode: longest common substring, then cycle full matches
vim.opt.complete = ".,w,b,u,t"  -- Places to scan for completion: current buffer, windows, buffers, unloaded buffers, tags

-- List of file patterns to ignore when expanding wildcards or completing files/directories
vim.opt.wildignore = {
  "*.o", "*.obj", "*.pyc",        -- Compiled files
  "*.so", "*.dll", "*.dylib",     -- Shared libraries
  "__pycache__", ".git", ".hg",   -- Version control and cache directories
  "*.png", "*.jpg", "*.gif",      -- Image files
  "*.pdf", "*.zip", "*.tar.gz",   -- Archives and documents
  "node_modules", "vendor",       -- Dependency directories
  ".DS_Store",                    -- macOS specific files
}
vim.opt.wildignorecase = true   -- Ignore case when completing file names and directories

-- =====================================================================
-- FILE HANDLING & ENCODING
-- =====================================================================
vim.opt.autoread = true         -- Automatically re-read files if they were changed outside of Neovim
vim.opt.path = ".,,**"          -- Search path for 'gf'/'find': current dir, empty, and all subdirectories recursively (**)
vim.opt.encoding = "utf-8"      -- Internal string-encoding (Note: Neovim always uses utf-8 internally)
vim.opt.fileencoding = "utf-8"  -- File-content encoding for the current buffer


vim.opt.tags = { "./tags;", "tags" }
