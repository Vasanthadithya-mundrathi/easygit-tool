const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class ErrorHandler {
  constructor() {
    this.errorDatabase = this.initializeErrorDatabase();
    this.logFile = path.join(os.homedir(), '.easygit', 'error.log');
    this.initializeLogging();
  }

  async initializeLogging() {
    try {
      const logDir = path.dirname(this.logFile);
      await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
      // Silently fail if we can't create log directory
    }
  }

  initializeErrorDatabase() {
    return {
      // Authentication errors
      'Authentication failed': {
        explanation: 'Git authentication failed. This usually means your credentials are incorrect, expired, or not configured.',
        causes: [
          'Incorrect username/password',
          'Expired personal access token',
          'SSH key not configured or invalid',
          'Two-factor authentication required'
        ],
        solutions: [
          'Check your Git credentials with: git config --list',
          'Update your personal access token if using HTTPS',
          'Verify SSH key is added to your Git provider',
          'Use git credential manager for secure credential storage'
        ],
        severity: 'high'
      },

      'fatal: refusing to merge unrelated histories': {
        explanation: 'Git is refusing to merge because the repositories have completely separate histories with no common commits.',
        causes: [
          'Trying to merge a new repository with an existing one',
          'Repository was recreated from scratch',
          'Pulling from wrong remote repository'
        ],
        solutions: [
          'Use --allow-unrelated-histories flag if merge is intentional',
          'Verify you are pulling from the correct remote',
          'Consider rebasing instead of merging if appropriate'
        ],
        severity: 'medium'
      },

      'Your branch is ahead of': {
        explanation: 'Your local branch has commits that are not present on the remote branch.',
        causes: [
          'You made local commits that haven\'t been pushed',
          'Remote branch was reset or force-pushed by someone else'
        ],
        solutions: [
          'Push your changes with: easygit sync',
          'Verify the remote branch state before pushing',
          'Use force-push with caution if remote was reset'
        ],
        severity: 'low'
      },

      'Your branch is behind': {
        explanation: 'The remote branch has commits that are not in your local branch.',
        causes: [
          'Other developers pushed changes to the remote',
          'You haven\'t pulled recent changes'
        ],
        solutions: [
          'Pull the latest changes with: easygit sync',
          'Review incoming changes before merging',
          'Consider rebasing to maintain linear history'
        ],
        severity: 'low'
      },

      'CONFLICT': {
        explanation: 'Git encountered conflicting changes that cannot be automatically merged.',
        causes: [
          'Multiple people modified the same lines of code',
          'File was moved/renamed in conflicting ways',
          'Binary files were modified differently'
        ],
        solutions: [
          'Use easygit\'s guided conflict resolution',
          'Manually edit conflicted files and remove conflict markers',
          'Use a merge tool like vimdiff or meld',
          'Communicate with team members about conflicting changes'
        ],
        severity: 'high'
      },

      'fatal: not a git repository': {
        explanation: 'The current directory is not inside a Git repository.',
        causes: [
          'Running Git commands outside a repository',
          'Repository was deleted or corrupted',
          'Wrong working directory'
        ],
        solutions: [
          'Navigate to a Git repository directory',
          'Initialize a new repository with: git init',
          'Clone an existing repository',
          'Check if .git directory exists and is not corrupted'
        ],
        severity: 'high'
      },

      'fatal: remote origin already exists': {
        explanation: 'Trying to add a remote named "origin" when one already exists.',
        causes: [
          'Repository already has an origin remote configured',
          'Attempting to add duplicate remote'
        ],
        solutions: [
          'Use a different remote name',
          'Remove existing remote first: git remote remove origin',
          'Update existing remote URL: git remote set-url origin <url>'
        ],
        severity: 'low'
      },

      'error: failed to push some refs': {
        explanation: 'Push was rejected, usually because the remote has updates you don\'t have locally.',
        causes: [
          'Remote branch has new commits',
          'Force-push protection is enabled',
          'Branch is protected and requires pull request'
        ],
        solutions: [
          'Pull latest changes first: easygit sync',
          'Use force-push with --force-with-lease if safe',
          'Create pull request if branch is protected'
        ],
        severity: 'medium'
      },

      'fatal: The current branch has no upstream branch': {
        explanation: 'Local branch is not tracking any remote branch.',
        causes: [
          'New local branch hasn\'t been pushed yet',
          'Upstream tracking was not set up',
          'Remote branch was deleted'
        ],
        solutions: [
          'Push and set upstream: git push -u origin <branch-name>',
          'Set upstream for existing branch: git branch -u origin/<branch-name>',
          'Use easygit sync to automatically handle upstream setup'
        ],
        severity: 'medium'
      },

      'fatal: pathspec': {
        explanation: 'Git cannot find the specified file, branch, or path.',
        causes: [
          'File or branch name is misspelled',
          'File was deleted or moved',
          'Branch doesn\'t exist locally or remotely'
        ],
        solutions: [
          'Check spelling of file/branch names',
          'Use git status to see available files',
          'Use git branch -a to see all branches',
          'Use tab completion or fuzzy finding'
        ],
        severity: 'medium'
      },

      'error: Your local changes to the following files would be overwritten': {
        explanation: 'Git cannot complete the operation because it would overwrite uncommitted local changes.',
        causes: [
          'Uncommitted changes conflict with incoming changes',
          'Switching branches with uncommitted changes',
          'Pulling changes that modify locally changed files'
        ],
        solutions: [
          'Commit your changes first: easygit save',
          'Stash changes temporarily: git stash',
          'Discard local changes if not needed: git checkout -- <file>',
          'Use easygit switch for intelligent branch switching'
        ],
        severity: 'high'
      }
    };
  }

  async handleError(error, gitRepo = null) {
    const errorInfo = this.analyzeError(error);
    await this.logError(error, errorInfo, gitRepo);
    
    console.log(chalk.red('\n❌ Error Encountered\n'));
    
    if (errorInfo.knownError) {
      await this.displayKnownError(errorInfo);
    } else {
      await this.displayUnknownError(error, gitRepo);
    }

    // Suggest using AI assistant for complex issues
    if (errorInfo.severity === 'high' || !errorInfo.knownError) {
      console.log(chalk.cyan('\n💡 Need more help?'));
      console.log(chalk.cyan('   Try: easygit ask "' + this.sanitizeErrorForAI(error.message) + '"'));
    }
  }

  analyzeError(error) {
    const errorMessage = error.message || error.toString();
    
    // Find matching error pattern
    for (const [pattern, info] of Object.entries(this.errorDatabase)) {
      if (errorMessage.includes(pattern) || errorMessage.match(new RegExp(pattern, 'i'))) {
        return {
          knownError: true,
          pattern,
          ...info,
          originalMessage: errorMessage
        };
      }
    }

    return {
      knownError: false,
      originalMessage: errorMessage,
      severity: 'unknown'
    };
  }

  async displayKnownError(errorInfo) {
    console.log(chalk.yellow('What happened:'));
    console.log('  ' + errorInfo.explanation + '\n');

    if (errorInfo.causes && errorInfo.causes.length > 0) {
      console.log(chalk.yellow('Common causes:'));
      errorInfo.causes.forEach(cause => {
        console.log('  • ' + cause);
      });
      console.log('');
    }

    if (errorInfo.solutions && errorInfo.solutions.length > 0) {
      console.log(chalk.green('Recommended solutions:'));
      errorInfo.solutions.forEach((solution, index) => {
        console.log(`  ${index + 1}. ${solution}`);
      });
      console.log('');
    }

    // Show severity indicator
    const severityColor = {
      'low': chalk.green,
      'medium': chalk.yellow,
      'high': chalk.red
    }[errorInfo.severity] || chalk.gray;

    console.log(severityColor(`Severity: ${errorInfo.severity.toUpperCase()}`));
  }

  async displayUnknownError(error, gitRepo) {
    console.log(chalk.yellow('What happened:'));
    console.log('  An unexpected error occurred: ' + error.message + '\n');

    console.log(chalk.yellow('Debug information:'));
    if (gitRepo && gitRepo.isRepository()) {
      try {
        const status = await gitRepo.getStatus();
        const currentBranch = status.current;
        const hasChanges = !status.isClean();
        
        console.log(`  • Current branch: ${currentBranch}`);
        console.log(`  • Uncommitted changes: ${hasChanges ? 'Yes' : 'No'}`);
        console.log(`  • Repository state: ${this.getRepositoryState(status)}`);
      } catch (debugError) {
        console.log('  • Could not gather repository information');
      }
    }

    console.log('\n' + chalk.green('Recommended actions:'));
    console.log('  1. Check your Git configuration: git config --list');
    console.log('  2. Verify repository state: easygit status');
    console.log('  3. Run repository health check: easygit doctor');
    console.log('  4. Check Git version: git --version');
  }

  getRepositoryState(status) {
    if (status.isClean()) return 'Clean';
    
    const states = [];
    if (status.modified.length > 0) states.push(`${status.modified.length} modified`);
    if (status.created.length > 0) states.push(`${status.created.length} new`);
    if (status.deleted.length > 0) states.push(`${status.deleted.length} deleted`);
    if (status.staged.length > 0) states.push(`${status.staged.length} staged`);
    
    return states.join(', ');
  }

  async logError(error, errorInfo, gitRepo) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        error: error.message,
        stack: error.stack,
        knownError: errorInfo.knownError,
        severity: errorInfo.severity,
        repositoryInfo: gitRepo ? await this.getRepositoryContext(gitRepo) : null,
        nodeVersion: process.version,
        platform: process.platform
      };

      await fs.appendFile(this.logFile, JSON.stringify(logEntry) + '\n');
    } catch (logError) {
      // Silently fail if we can't log
    }
  }

  async getRepositoryContext(gitRepo) {
    try {
      if (!gitRepo.isRepository()) return null;
      
      const status = await gitRepo.getStatus();
      return {
        currentBranch: status.current,
        hasUncommittedChanges: !status.isClean(),
        ahead: status.ahead,
        behind: status.behind,
        workingDir: gitRepo.workingDir
      };
    } catch (error) {
      return { error: 'Could not gather repository context' };
    }
  }

  sanitizeErrorForAI(errorMessage) {
    // Remove sensitive information and paths
    return errorMessage
      .replace(/\/[^\s]+/g, '<path>')  // Replace file paths
      .replace(/\b[a-f0-9]{40}\b/g, '<commit-hash>')  // Replace commit hashes
      .replace(/\b[a-f0-9]{7,}\b/g, '<short-hash>')   // Replace short hashes
      .substring(0, 200);  // Limit length
  }

  // Method to add custom error patterns (for extensibility)
  addErrorPattern(pattern, errorInfo) {
    this.errorDatabase[pattern] = {
      ...errorInfo,
      custom: true
    };
  }

  // Method to get error statistics (for debugging and improvement)
  async getErrorStats() {
    try {
      const logContent = await fs.readFile(this.logFile, 'utf8');
      const entries = logContent.split('\n').filter(line => line.trim());
      
      const stats = {
        total: entries.length,
        knownErrors: 0,
        unknownErrors: 0,
        severityBreakdown: { low: 0, medium: 0, high: 0, unknown: 0 }
      };

      entries.forEach(entry => {
        try {
          const parsed = JSON.parse(entry);
          if (parsed.knownError) {
            stats.knownErrors++;
          } else {
            stats.unknownErrors++;
          }
          stats.severityBreakdown[parsed.severity]++;
        } catch (parseError) {
          // Skip malformed entries
        }
      });

      return stats;
    } catch (error) {
      return null;
    }
  }
}

module.exports = ErrorHandler;

