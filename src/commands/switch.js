const chalk = require('chalk');
const inquirer = require('inquirer');
const fuzzy = require('fuzzy');

class SwitchCommand {
  constructor(program, gitRepo, errorHandler) {
    this.gitRepo = gitRepo;
    this.errorHandler = errorHandler;
    this.setupCommand(program);
  }

  setupCommand(program) {
    program
      .command('switch')
      .description('Intelligently switch branches with fuzzy finding and safety checks')
      .argument('[branch]', 'Branch name to switch to (supports fuzzy matching)')
      .option('-c, --create', 'Create new branch if it doesn\'t exist')
      .option('-f, --force', 'Force switch even with uncommitted changes')
      .option('-r, --remote', 'Include remote branches in search')
      .option('--track <remote>', 'Set up tracking with specified remote')
      .option('--no-stash', 'Don\'t automatically stash uncommitted changes')
      .option('--fuzzy', 'Use interactive fuzzy finder (default if no branch specified)')
      .action(async (branch, options) => {
        try {
          await this.execute(branch, options);
        } catch (error) {
          await this.errorHandler.handleError(error, this.gitRepo);
          process.exit(1);
        }
      });
  }

  async execute(branchName, options = {}) {
    if (!this.gitRepo || !this.gitRepo.isRepository()) {
      throw new Error('Not in a Git repository. Use "git init" to create a new repository.');
    }

    console.log(chalk.blue('🔍 Analyzing branch state...'));

    // Get current state
    const currentBranch = await this.gitRepo.getCurrentBranch();
    const hasUncommittedChanges = await this.gitRepo.hasUncommittedChanges();

    // If no branch specified or fuzzy option, use fuzzy finder
    if (!branchName || options.fuzzy) {
      branchName = await this.fuzzyFindBranch(branchName, options);
      if (!branchName) {
        console.log(chalk.yellow('No branch selected'));
        return;
      }
    }

    // Resolve branch name (handle fuzzy matching)
    const targetBranch = await this.resolveBranchName(branchName, options);

    // Check if already on target branch
    if (targetBranch === currentBranch) {
      console.log(chalk.yellow(`Already on branch '${targetBranch}'`));
      return;
    }

    // Pre-switch safety checks
    await this.performPreSwitchChecks(targetBranch, hasUncommittedChanges, options);

    // Handle uncommitted changes
    let stashCreated = false;
    if (hasUncommittedChanges && !options.force) {
      stashCreated = await this.handleUncommittedChanges(options);
    }

    try {
      // Perform the branch switch
      await this.performBranchSwitch(targetBranch, options);
      
      // Post-switch actions
      await this.postSwitchActions(currentBranch, targetBranch, stashCreated);
      
    } catch (error) {
      // If switch failed and we stashed, try to restore
      if (stashCreated) {
        try {
          await this.gitRepo.stashPop();
          console.log(chalk.blue('📦 Restored stashed changes after failed switch'));
        } catch (restoreError) {
          console.warn(chalk.yellow('Warning: Could not restore stashed changes'));
        }
      }
      throw error;
    }
  }

  async fuzzyFindBranch(initialQuery = '', options) {
    console.log(chalk.blue('🔍 Opening branch finder...'));

    // Get all branches
    const branches = await this.gitRepo.getBranches();
    const allBranches = this.prepareBranchList(branches, options);

    if (allBranches.length === 0) {
      throw new Error('No branches found');
    }

    // If there's an initial query, filter branches
    let filteredBranches = allBranches;
    if (initialQuery) {
      const fuzzyResults = fuzzy.filter(initialQuery, allBranches, {
        extract: (branch) => branch.name
      });
      filteredBranches = fuzzyResults.map(result => result.original);
    }

    // Create interactive choices
    const choices = filteredBranches.map(branch => ({
      name: this.formatBranchChoice(branch),
      value: branch.name,
      short: branch.name
    }));

    if (choices.length === 0) {
      console.log(chalk.yellow(`No branches match "${initialQuery}"`));
      return null;
    }

    // If only one match and it's exact, use it
    if (choices.length === 1 && initialQuery && 
        choices[0].value.toLowerCase() === initialQuery.toLowerCase()) {
      return choices[0].value;
    }

    // Show interactive selector
    const { selectedBranch } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedBranch',
      message: 'Select branch to switch to:',
      choices: [
        ...choices,
        new inquirer.Separator(),
        {
          name: chalk.cyan('+ Create new branch'),
          value: '__create_new__'
        },
        {
          name: chalk.gray('Cancel'),
          value: null
        }
      ],
      pageSize: 15
    }]);

    if (selectedBranch === '__create_new__') {
      return await this.promptForNewBranch();
    }

    return selectedBranch;
  }

  prepareBranchList(branches, options) {
    const currentBranch = branches.current;
    const branchList = [];

    // Add local branches
    branches.all.forEach(branchName => {
      if (branchName.startsWith('remotes/')) {
        if (!options.remote) return;
        
        // Parse remote branch
        const match = branchName.match(/^remotes\/([^\/]+)\/(.+)$/);
        if (match) {
          const [, remote, name] = match;
          branchList.push({
            name: name,
            fullName: branchName,
            type: 'remote',
            remote: remote,
            current: false
          });
        }
      } else {
        branchList.push({
          name: branchName,
          fullName: branchName,
          type: 'local',
          remote: null,
          current: branchName === currentBranch
        });
      }
    });

    // Sort: current first, then local, then remote
    return branchList.sort((a, b) => {
      if (a.current) return -1;
      if (b.current) return 1;
      if (a.type === 'local' && b.type === 'remote') return -1;
      if (a.type === 'remote' && b.type === 'local') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  formatBranchChoice(branch) {
    let formatted = branch.name;
    
    if (branch.current) {
      formatted = chalk.green(`* ${formatted} (current)`);
    } else if (branch.type === 'remote') {
      formatted = chalk.blue(`${formatted} (${branch.remote})`);
    }

    return formatted;
  }

  async promptForNewBranch() {
    const { branchName } = await inquirer.prompt([{
      type: 'input',
      name: 'branchName',
      message: 'Enter new branch name:',
      validate: (input) => {
        if (!input.trim()) return 'Branch name cannot be empty';
        if (input.includes(' ')) return 'Branch name cannot contain spaces';
        if (input.includes('..')) return 'Branch name cannot contain ".."';
        if (input.startsWith('-')) return 'Branch name cannot start with "-"';
        if (input.includes('~') || input.includes('^') || input.includes(':')) {
          return 'Branch name contains invalid characters';
        }
        return true;
      }
    }]);

    return branchName.trim();
  }

  async resolveBranchName(branchName, options) {
    const branches = await this.gitRepo.getBranches();
    
    // Exact match with local branch
    if (branches.all.includes(branchName)) {
      return branchName;
    }

    // Check for remote branch match
    const remoteBranch = branches.all.find(b => 
      b.startsWith('remotes/') && b.endsWith(`/${branchName}`)
    );

    if (remoteBranch) {
      // Extract remote name
      const match = remoteBranch.match(/^remotes\/([^\/]+)\/(.+)$/);
      if (match) {
        const [, remote, name] = match;
        
        if (options.create || await this.confirmCreateTrackingBranch(name, remote)) {
          return name; // Will be created as tracking branch
        }
      }
    }

    // Fuzzy match with local branches
    const localBranches = branches.all.filter(b => !b.startsWith('remotes/'));
    const fuzzyResults = fuzzy.filter(branchName, localBranches);
    
    if (fuzzyResults.length === 1) {
      const match = fuzzyResults[0];
      if (match.score > 0.5) { // Good enough match
        console.log(chalk.blue(`Using fuzzy match: ${branchName} → ${match.string}`));
        return match.string;
      }
    }

    // If create option is set or branch doesn't exist, it will be created
    if (options.create) {
      return branchName;
    }

    // Ask if user wants to create the branch
    const { shouldCreate } = await inquirer.prompt([{
      type: 'confirm',
      name: 'shouldCreate',
      message: `Branch '${branchName}' doesn't exist. Create it?`,
      default: true
    }]);

    if (shouldCreate) {
      return branchName;
    }

    throw new Error(`Branch '${branchName}' not found and creation declined`);
  }

  async confirmCreateTrackingBranch(branchName, remote) {
    const { shouldCreate } = await inquirer.prompt([{
      type: 'confirm',
      name: 'shouldCreate',
      message: `Create local tracking branch '${branchName}' from '${remote}/${branchName}'?`,
      default: true
    }]);

    return shouldCreate;
  }

  async performPreSwitchChecks(targetBranch, hasUncommittedChanges, options) {
    const checks = [];

    // Check for uncommitted changes
    if (hasUncommittedChanges && !options.force && options.noStash) {
      checks.push(this.checkUncommittedChangesConflict(targetBranch));
    }

    // Check if target branch exists or needs to be created
    const branches = await this.gitRepo.getBranches();
    if (!branches.all.includes(targetBranch)) {
      checks.push(this.checkBranchCreation(targetBranch, options));
    }

    // Run all checks
    const results = await Promise.allSettled(checks);
    const failures = results.filter(result => result.status === 'rejected');

    if (failures.length > 0) {
      console.log(chalk.red('\n❌ Pre-switch checks failed:'));
      failures.forEach(failure => {
        console.log(chalk.red('   • ' + failure.reason.message));
      });
      throw new Error('Pre-switch checks failed');
    }
  }

  async checkUncommittedChangesConflict(targetBranch) {
    // This would check if uncommitted changes would conflict with target branch
    // For now, we'll assume it's safe if user explicitly disabled stashing
    return Promise.resolve();
  }

  async checkBranchCreation(targetBranch, options) {
    // Validate branch name
    if (targetBranch.includes('..') || targetBranch.startsWith('-') || 
        targetBranch.includes('~') || targetBranch.includes('^')) {
      throw new Error(`Invalid branch name: ${targetBranch}`);
    }
    
    return Promise.resolve();
  }

  async handleUncommittedChanges(options) {
    if (options.noStash) {
      return false;
    }

    console.log(chalk.blue('📦 Stashing uncommitted changes...'));
    
    const stashMessage = `easygit-switch-auto-stash-${Date.now()}`;
    await this.gitRepo.stash(stashMessage);
    
    console.log(chalk.green('✓ Changes stashed'));
    return true;
  }

  async performBranchSwitch(targetBranch, options) {
    const branches = await this.gitRepo.getBranches();
    
    if (branches.all.includes(targetBranch)) {
      // Switch to existing branch
      console.log(chalk.blue(`🔄 Switching to branch '${targetBranch}'...`));
      await this.gitRepo.checkout(targetBranch);
    } else {
      // Create new branch
      console.log(chalk.blue(`🌟 Creating and switching to new branch '${targetBranch}'...`));
      
      // Check if there's a remote branch to track
      const remoteBranch = branches.all.find(b => 
        b.startsWith('remotes/') && b.endsWith(`/${targetBranch}`)
      );

      if (remoteBranch) {
        // Create tracking branch
        const match = remoteBranch.match(/^remotes\/([^\/]+)\/(.+)$/);
        if (match) {
          const [, remote] = match;
          await this.gitRepo.git.checkout(['-b', targetBranch, `${remote}/${targetBranch}`]);
          console.log(chalk.green(`✓ Created tracking branch from ${remote}/${targetBranch}`));
        }
      } else {
        // Create new branch from current HEAD
        await this.gitRepo.createBranch(targetBranch);
      }
    }
  }

  async postSwitchActions(fromBranch, toBranch, stashCreated) {
    console.log(chalk.green(`✓ Switched from '${fromBranch}' to '${toBranch}'`));

    // Restore stashed changes if any
    if (stashCreated) {
      try {
        console.log(chalk.blue('📦 Restoring stashed changes...'));
        await this.gitRepo.stashPop();
        console.log(chalk.green('✓ Stashed changes restored'));
      } catch (error) {
        console.warn(chalk.yellow('Warning: Could not restore stashed changes automatically'));
        console.log(chalk.cyan('💡 Run "git stash pop" manually to restore your changes'));
      }
    }

    // Show branch status
    const status = await this.gitRepo.getStatus();
    
    if (status.ahead > 0 || status.behind > 0) {
      const statusParts = [];
      if (status.ahead > 0) statusParts.push(chalk.green(`${status.ahead} ahead`));
      if (status.behind > 0) statusParts.push(chalk.red(`${status.behind} behind`));
      console.log(`Branch status: ${statusParts.join(', ')}`);
    }

    // Check for uncommitted changes
    if (!status.isClean()) {
      const changeCount = status.modified.length + status.created.length + status.deleted.length;
      console.log(chalk.yellow(`Working directory has ${changeCount} uncommitted changes`));
    }

    // Show helpful next steps
    console.log(chalk.cyan('\n💡 Next steps:'));
    
    if (status.behind > 0) {
      console.log(chalk.cyan('   • Run "easygit sync" to pull latest changes'));
    }
    
    if (!status.isClean()) {
      console.log(chalk.cyan('   • Run "easygit save" to commit your changes'));
    }
    
    console.log(chalk.cyan('   • Run "easygit status" to see detailed branch information'));

    // Update recent branches list for future fuzzy finding
    await this.updateRecentBranches(fromBranch, toBranch);
  }

  async updateRecentBranches(fromBranch, toBranch) {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const os = require('os');
      
      const recentFile = path.join(os.homedir(), '.easygit', 'recent-branches.json');
      
      let recent = [];
      try {
        const content = await fs.readFile(recentFile, 'utf8');
        recent = JSON.parse(content);
      } catch (error) {
        // File doesn't exist or is invalid, start fresh
      }

      // Add current switch to recent list
      const switchEntry = {
        from: fromBranch,
        to: toBranch,
        timestamp: new Date().toISOString(),
        workingDir: this.gitRepo.workingDir
      };

      // Remove duplicates and add to front
      recent = recent.filter(entry => 
        !(entry.from === fromBranch && entry.to === toBranch && entry.workingDir === this.gitRepo.workingDir)
      );
      recent.unshift(switchEntry);

      // Keep only last 20 entries
      recent = recent.slice(0, 20);

      // Save back to file
      await fs.mkdir(path.dirname(recentFile), { recursive: true });
      await fs.writeFile(recentFile, JSON.stringify(recent, null, 2));
      
    } catch (error) {
      // Silently fail if we can't update recent branches
    }
  }
}

module.exports = SwitchCommand;

