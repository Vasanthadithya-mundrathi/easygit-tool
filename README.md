# easygit - Intelligent Git Tool

An intelligent Git tool that makes version control safer, easier, and more productive through AI-powered assistance, comprehensive error handling, and intelligent workflow automation.

## 🚀 Features

### Core Commands
- **`easygit save`** - Intelligent staging and committing with pre-flight checks
- **`easygit sync`** - Smart synchronization with conflict resolution
- **`easygit switch`** - Branch switching with fuzzy finding and safety checks
- **`easygit status`** - Enhanced repository status with insights
- **`easygit update`** - Safe fetching without modifying working directory
- **`easygit undo`** - Safe undo operations for commits and merges
- **`easygit ask`** - AI assistant for Git help (Gemini CLI integration)
- **`easygit doctor`** - Repository health checks and optimizations

### Intelligent Features
- **Error Handling**: Context-aware explanations for 20+ common Git errors
- **Pre-flight Checks**: Detect large files, sensitive data, protected branches
- **Fuzzy Finding**: Interactive branch and file selection
- **Auto-stashing**: Automatic stash/restore during operations
- **Team Configuration**: Support for team workflows and conventions
- **Monorepo Support**: Performance optimizations for large repositories
- **AI Integration**: Natural language Git assistance with Gemini CLI

## 📦 Installation

```bash
npm install -g easygit
```

Or clone and link for development:
```bash
git clone <repository-url>
cd easygit
npm install
npm link
```

## 🤖 AI Assistant Setup (Optional but Recommended)

To enable the full AI-powered assistance features:

1. **Get a free Gemini API key:**
   - Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Create a new API key (free tier includes 1000 requests/day)

2. **Set up the API key:**
   ```bash
   # Option 1: Environment variable (recommended)
   export GEMINI_API_KEY="your_api_key_here"
   
   # Option 2: Add to your shell profile for persistence
   echo 'export GEMINI_API_KEY="your_api_key_here"' >> ~/.bashrc
   source ~/.bashrc
   ```

3. **Test AI integration:**
   ```bash
   easygit ask "How do I create a new branch?"
   ```

Without the API key, easygit will use intelligent fallback responses that still provide helpful guidance.

## 🎯 Quick Start

```bash
# Initialize configuration
easygit doctor

# Check repository status
easygit status

# Stage and commit changes intelligently
easygit save "Add new feature"

# Switch branches with fuzzy finding
easygit switch

# Synchronize with remote
easygit sync

# Get AI assistance
easygit ask "how do I resolve merge conflicts?"
```

## 📖 Command Reference

### `easygit save [message]`
Intelligently stage and commit changes with comprehensive safety checks.

**Options:**
- `-a, --all` - Stage all changes including untracked files
- `-p, --partial` - Interactively stage parts of files
- `-f, --force` - Skip pre-flight checks (dangerous)
- `--no-hooks` - Skip pre-commit hooks
- `--amend` - Amend the previous commit
- `--empty` - Allow empty commits

**Features:**
- Large file detection with Git LFS suggestions
- Sensitive file detection (API keys, credentials)
- Protected branch enforcement
- Pre/post-commit hook support
- Conventional commit validation
- Interactive file selection for untracked files

### `easygit sync [options]`
Intelligently synchronize with remote repository with conflict resolution.

**Options:**
- `-r, --remote <remote>` - Remote to sync with (default: origin)
- `-b, --branch <branch>` - Branch to sync (defaults to current)
- `--rebase` - Force rebase strategy
- `--merge` - Force merge strategy
- `--force` - Force push (dangerous)
- `--force-with-lease` - Force push with lease (safer)
- `--dry-run` - Show what would be done without executing

**Features:**
- Automatic conflict detection and resolution guidance
- Network connectivity checks with offline queueing
- Diverged history handling with user choice
- Auto-stashing of uncommitted changes
- Intelligent merge vs rebase strategy selection

### `easygit switch [branch]`
Intelligently switch branches with fuzzy finding and safety checks.

**Options:**
- `-c, --create` - Create new branch if it doesn't exist
- `-f, --force` - Force switch even with uncommitted changes
- `-r, --remote` - Include remote branches in search
- `--track <remote>` - Set up tracking with specified remote
- `--no-stash` - Don't automatically stash uncommitted changes
- `--fuzzy` - Use interactive fuzzy finder

**Features:**
- Interactive fuzzy branch finder
- Auto-stashing and restoration of changes
- Remote branch tracking setup
- Recent branch history
- Branch creation with validation

### `easygit status [options]`
Show enhanced repository status with intelligent insights.

**Options:**
- `-s, --short` - Show short format status
- `-v, --verbose` - Show detailed status information
- `--porcelain` - Machine-readable output
- `--branch-info` - Show detailed branch information

**Features:**
- Enhanced branch information with tracking status
- Working directory and staging area analysis
- Repository health indicators
- Intelligent suggestions for next steps
- Monorepo detection and optimization hints

### `easygit update [options]`
Safely fetch and report remote changes without modifying working directory.

**Options:**
- `-r, --remote <remote>` - Remote to fetch from (default: origin)
- `-a, --all` - Fetch from all remotes
- `--prune` - Remove remote-tracking references that no longer exist

### `easygit undo [options]`
Safely undo commits, merges, or other Git operations.

**Options:**
- `--commit [count]` - Undo last N commits (default: 1)
- `--merge` - Undo last merge
- `--hard` - Hard reset (dangerous - loses changes)
- `--soft` - Soft reset (keeps changes staged)

**Features:**
- Interactive confirmation with commit preview
- Safe reset modes with clear explanations
- Merge commit detection and handling

### `easygit ask <question>`
Ask AI assistant for Git help and command suggestions.

**Options:**
- `--explain` - Get detailed explanation of suggested commands

**Features:**
- Natural language Git assistance
- Context-aware suggestions based on repository state
- Integration with Gemini CLI (coming soon)

### `easygit doctor [options]`
Run comprehensive repository health checks and optimizations.

**Options:**
- `--fix` - Automatically fix issues where possible
- `--verbose` - Show detailed diagnostic information

**Features:**
- Repository size and performance analysis
- Branch and stash cleanup suggestions
- Monorepo optimization recommendations
- Large file detection
- Configuration validation

## ⚙️ Configuration

easygit uses a hierarchical configuration system:

1. **Global config**: `~/.easygit/config.json`
2. **Local config**: `.easygit/config.json` (in repository)
3. **Team hooks**: `.easygit/hooks.json`
4. **Environment variables**

### Configuration Options

```json
{
  "core": {
    "editor": "code --wait",
    "defaultBranch": "main",
    "syncStrategy": "rebase",
    "autoStash": true,
    "confirmDestructive": true
  },
  "ui": {
    "theme": "auto",
    "progressBars": true,
    "fuzzyFinder": true,
    "colorOutput": true
  },
  "ai": {
    "enabled": true,
    "explainByDefault": false,
    "provider": "gemini"
  },
  "team": {
    "protectedBranches": ["main", "develop"],
    "requireIssueId": false,
    "commitMessageFormat": "free"
  },
  "hooks": {
    "preCommit": ["lint", "test"],
    "prePush": ["integration-tests"]
  }
}
```

### Environment Variables

- `EASYGIT_EDITOR` - Override default editor
- `EASYGIT_AI_ENABLED` - Enable/disable AI features
- `EASYGIT_THEME` - UI theme (light/dark/auto)
- `EASYGIT_NO_COLOR` - Disable colored output

## 🔧 Development

### Prerequisites
- Node.js 16+
- Git 2.20+

### Setup
```bash
git clone <repository-url>
cd easygit
npm install
npm link
```

### Testing
```bash
npm test
```

### Project Structure
```
easygit/
├── src/
│   ├── commands/          # Command implementations
│   ├── core/             # Core functionality
│   ├── ui/               # User interface components
│   ├── utils/            # Utility functions
│   └── ai/               # AI integration
├── bin/                  # Executable scripts
├── tests/                # Test files
└── docs/                 # Documentation
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `easygit save "Add amazing feature"`
4. Push to the branch: `easygit sync`
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with Node.js and the simple-git library
- AI integration powered by Google's Gemini CLI
- Inspired by the need for safer, more intelligent Git workflows

## 📞 Support

- 🐛 **Bug Reports**: [GitHub Issues](../../issues)
- 💡 **Feature Requests**: [GitHub Discussions](../../discussions)
- 📖 **Documentation**: [Wiki](../../wiki)

---

**Made with ❤️ for developers who want Git to be easier, safer, and more productive.**

