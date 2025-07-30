const chalk = require('chalk');
const inquirer = require('inquirer');

class SyncCommand {
  constructor(program, gitRepoGetter, errorHandler) {
    this.gitRepoGetter = gitRepoGetter;
    this.errorHandler = errorHandler;
    this.setupCommand(program);
  }

  get gitRepo() {
    return this.gitRepoGetter();
  }

  setupCommand(program) {
    program
      .command('sync')
      .description('Intelligently synchronize with remote repository')
      .option('-r, --remote <remote>', 'Remote to sync with', 'origin')
      .option('-b, --branch <branch>', 'Branch to sync (defaults to current)')
      .option('--rebase', 'Force rebase strategy')
      .option('--merge', 'Force merge strategy')
      .option('--force', 'Force push (dangerous)')
      .option('--force-with-lease', 'Force push with lease (safer)')
      .option('--dry-run', 'Show what would be done without executing')
      .option('--allow-unrelated', 'Allow merging unrelated histories')
      .action(async (options) => {
        try {
          await this.execute(options);
        } catch (error) {
          await this.errorHandler.handleError(error, this.gitRepo);
          process.exit(1);
        }
      });
  }

  async execute(options = {}) {
    if (!this.gitRepo || !this.gitRepo.isRepository()) {
      throw new Error('Not in a Git repository. Use "git init" to create a new repository.');
    }

    console.log(chalk.blue('🔄 Analyzing synchronization state...'));

    // Get current repository state
    const currentBranch = options.branch || await this.gitRepo.getCurrentBranch();
    const remote = options.remote;

    // Check network connectivity
    if (!options.dryRun) {
      await this.checkNetworkConnectivity(remote);
    }

    // Fetch latest changes
    console.log(chalk.blue(`📡 Fetching from ${remote}...`));
    if (!options.dryRun) {
      await this.gitRepo.fetch(remote);
    }

    // Analyze branch state
    const branchState = await this.analyzeBranchState(currentBranch, remote);
    
    if (options.dryRun) {
      return await this.showDryRun(branchState, options);
    }

    // Execute synchronization strategy
    await this.executeSyncStrategy(branchState, options);
  }

  async checkNetworkConnectivity(remote) {
    try {
      const remotes = await this.gitRepo.getRemotes();
      const remoteInfo = remotes.find(r => r.name === remote);
      
      if (!remoteInfo) {
        throw new Error(`Remote "${remote}" not found. Available remotes: ${remotes.map(r => r.name).join(', ')}`);
      }

      // Test connectivity with a simple fetch
      await this.gitRepo.git.raw(['ls-remote', '--heads', remote]);
      
    } catch (error) {
      if (error.message.includes('Could not resolve hostname') || 
          error.message.includes('Connection refused') ||
          error.message.includes('Network is unreachable')) {
        
        console.log(chalk.yellow('⚠️  Network connectivity issue detected.'));
        console.log(chalk.yellow('   Your sync operation will be queued for when connectivity is restored.'));
        
        await this.queueSyncOperation(options);
        return;
      }
      throw error;
    }
  }

  async queueSyncOperation(options) {
    const queueFile = require('path').join(require('os').homedir(), '.easygit', 'sync-queue.json');
    
    try {
      const fs = require('fs').promises;
      await fs.mkdir(require('path').dirname(queueFile), { recursive: true });
      
      let queue = [];
      try {
        const existing = await fs.readFile(queueFile, 'utf8');
        queue = JSON.parse(existing);
      } catch (error) {
        // File doesn't exist or is invalid, start with empty queue
      }

      const operation = {
        timestamp: new Date().toISOString(),
        workingDir: this.gitRepo.workingDir,
        branch: await this.gitRepo.getCurrentBranch(),
        options: options,
        id: Date.now().toString()
      };

      queue.push(operation);
      await fs.writeFile(queueFile, JSON.stringify(queue, null, 2));
      
      console.log(chalk.green('✓ Sync operation queued'));
      console.log(chalk.cyan('💡 Run "easygit sync --process-queue" when online to execute queued operations'));
      
    } catch (error) {
      console.warn(chalk.yellow('Warning: Could not queue sync operation'));
    }
  }

  async analyzeBranchState(currentBranch, remote) {
    try {
      const status = await this.gitRepo.getStatus();
      
      // Get commit counts
      const ahead = status.ahead || 0;
      const behind = status.behind || 0;
      
      // Check if remote branch exists
      const branches = await this.gitRepo.getBranches();
      const remoteBranch = `${remote}/${currentBranch}`;
      const hasRemoteBranch = branches.all.includes(remoteBranch);
      
      // Check for uncommitted changes
      const hasUncommittedChanges = !status.isClean();
      
      return {
        currentBranch,
        remote,
        remoteBranch,
        hasRemoteBranch,
        ahead,
        behind,
        hasUncommittedChanges,
        status: this.determineSyncStatus(ahead, behind, hasRemoteBranch)
      };
    } catch (error) {
      throw new Error(`Failed to analyze branch state: ${error.message}`);
    }
  }

  determineSyncStatus(ahead, behind, hasRemoteBranch) {
    if (!hasRemoteBranch) {
      return 'new-branch';
    }
    
    if (ahead === 0 && behind === 0) {
      return 'up-to-date';
    }
    
    if (ahead > 0 && behind === 0) {
      return 'ahead';
    }
    
    if (ahead === 0 && behind > 0) {
      return 'behind';
    }
    
    if (ahead > 0 && behind > 0) {
      return 'diverged';
    }
    
    return 'unknown';
  }

  async showDryRun(branchState, options) {
    console.log(chalk.cyan('\n🔍 Dry run - showing what would be executed:\n'));
    
    console.log(chalk.white('Repository State:'));
    console.log(`  Current branch: ${branchState.currentBranch}`);
    console.log(`  Remote: ${branchState.remote}`);
    console.log(`  Status: ${branchState.status}`);
    console.log(`  Ahead: ${branchState.ahead} commits`);
    console.log(`  Behind: ${branchState.behind} commits`);
    console.log(`  Uncommitted changes: ${branchState.hasUncommittedChanges ? 'Yes' : 'No'}`);
    
    console.log(chalk.white('\nPlanned Actions:'));
    
    switch (branchState.status) {
      case 'up-to-date':
        console.log('  • No action needed - branch is up to date');
        break;
        
      case 'ahead':
        console.log(`  • Push ${branchState.ahead} commits to ${branchState.remoteBranch}`);
        break;
        
      case 'behind':
        const strategy = await this.getSyncStrategy(options);
        console.log(`  • ${strategy === 'rebase' ? 'Rebase' : 'Merge'} ${branchState.behind} commits from ${branchState.remoteBranch}`);
        break;
        
      case 'diverged':
        console.log('  • Handle diverged history (requires user intervention)');
        break;
        
      case 'new-branch':
        console.log(`  • Create new remote branch ${branchState.remoteBranch}`);
        console.log(`  • Push ${branchState.ahead} commits`);
        break;
    }
    
    if (branchState.hasUncommittedChanges) {
      console.log('  • Stash uncommitted changes before sync');
      console.log('  • Restore stashed changes after sync');
    }
  }

  async executeSyncStrategy(branchState, options) {
    // Handle uncommitted changes
    let stashCreated = false;
    if (branchState.hasUncommittedChanges && branchState.status !== 'ahead') {
      console.log(chalk.blue('📦 Stashing uncommitted changes...'));
      await this.gitRepo.stash('easygit-sync-auto-stash');
      stashCreated = true;
    }

    try {
      switch (branchState.status) {
        case 'up-to-date':
          await this.handleUpToDate(branchState);
          break;
          
        case 'ahead':
          await this.handleAhead(branchState, options);
          break;
          
        case 'behind':
          await this.handleBehind(branchState, options);
          break;
          
        case 'diverged':
          await this.handleDiverged(branchState, options);
          break;
          
        case 'new-branch':
          await this.handleNewBranch(branchState, options);
          break;
          
        default:
          throw new Error(`Unknown sync status: ${branchState.status}`);
      }
    } finally {
      // Restore stashed changes
      if (stashCreated) {
        try {
          console.log(chalk.blue('📦 Restoring stashed changes...'));
          await this.gitRepo.stashPop();
        } catch (error) {
          console.warn(chalk.yellow('Warning: Could not restore stashed changes automatically'));
          console.log(chalk.cyan('💡 Run "git stash pop" manually to restore your changes'));
        }
      }
    }
  }

  async handleUpToDate(branchState) {
    console.log(chalk.green('✓ Branch is already up to date'));
    console.log(chalk.gray(`   ${branchState.currentBranch} is synchronized with ${branchState.remoteBranch}`));
  }

  async handleAhead(branchState, options) {
    console.log(chalk.blue(`⬆️  Pushing ${branchState.ahead} commits to ${branchState.remoteBranch}...`));
    
    try {
      if (options.force) {
        console.log(chalk.yellow('⚠️  Force pushing (this can overwrite remote history)'));
        await this.gitRepo.git.push([branchState.remote, branchState.currentBranch, '--force']);
      } else if (options.forceWithLease) {
        console.log(chalk.yellow('⚠️  Force pushing with lease (safer force push)'));
        await this.gitRepo.git.push([branchState.remote, branchState.currentBranch, '--force-with-lease']);
      } else {
        await this.gitRepo.push(branchState.remote, branchState.currentBranch);
      }
      
      console.log(chalk.green('✓ Successfully pushed changes'));
    } catch (error) {
      if (error.message.includes('rejected') && error.message.includes('non-fast-forward')) {
        console.log(chalk.red('❌ Push rejected - remote has new commits'));
        console.log(chalk.cyan('💡 Run "easygit sync" again to pull and merge remote changes'));
        throw new Error('Push rejected due to remote changes');
      }
      throw error;
    }
  }

  async handleBehind(branchState, options) {
    const strategy = await this.getSyncStrategy(options);
    
    console.log(chalk.blue(`⬇️  ${strategy === 'rebase' ? 'Rebasing' : 'Merging'} ${branchState.behind} commits from ${branchState.remoteBranch}...`));
    
    try {
      if (strategy === 'rebase') {
        await this.gitRepo.git.rebase([branchState.remoteBranch]);
      } else {
        await this.gitRepo.git.merge([branchState.remoteBranch]);
      }
      
      console.log(chalk.green(`✓ Successfully ${strategy === 'rebase' ? 'rebased' : 'merged'} remote changes`));
    } catch (error) {
      if (error.message.includes('CONFLICT')) {
        console.log(chalk.yellow('⚠️  Merge conflicts detected'));
        console.log(chalk.cyan('💡 Use "easygit resolve" to resolve conflicts interactively'));
        throw new Error('Merge conflicts need to be resolved');
      }
      throw error;
    }
  }

  async handleDiverged(branchState, options) {
    console.log(chalk.yellow('⚠️  Branch has diverged from remote'));
    console.log(chalk.gray(`   Local: ${branchState.ahead} commits ahead`));
    console.log(chalk.gray(`   Remote: ${branchState.behind} commits behind`));
    
    const choices = [
      {
        name: 'Rebase local commits on top of remote (recommended)',
        value: 'rebase',
        short: 'Rebase'
      },
      {
        name: 'Merge remote changes into local branch',
        value: 'merge',
        short: 'Merge'
      },
      {
        name: 'Force push local changes (dangerous)',
        value: 'force',
        short: 'Force push'
      },
      {
        name: 'Cancel and resolve manually',
        value: 'cancel',
        short: 'Cancel'
      }
    ];

    const { strategy } = await inquirer.prompt([{
      type: 'list',
      name: 'strategy',
      message: 'How would you like to resolve the diverged history?',
      choices,
      default: 'rebase'
    }]);

    switch (strategy) {
      case 'rebase':
        await this.handleRebaseDiverged(branchState);
        break;
      case 'merge':
        await this.handleMergeDiverged(branchState);
        break;
      case 'force':
        await this.handleForcePushDiverged(branchState);
        break;
      case 'cancel':
        throw new Error('Sync cancelled by user');
    }
  }

  async handleRebaseDiverged(branchState) {
    try {
      console.log(chalk.blue('🔄 Rebasing local commits on top of remote...'));
      await this.gitRepo.git.rebase([branchState.remoteBranch]);
      
      console.log(chalk.blue('⬆️  Pushing rebased commits...'));
      await this.gitRepo.push(branchState.remote, branchState.currentBranch);
      
      console.log(chalk.green('✓ Successfully rebased and pushed'));
    } catch (error) {
      if (error.message.includes('CONFLICT')) {
        console.log(chalk.yellow('⚠️  Rebase conflicts detected'));
        console.log(chalk.cyan('💡 Resolve conflicts and run "git rebase --continue"'));
        console.log(chalk.cyan('   Or run "git rebase --abort" to cancel the rebase'));
        throw new Error('Rebase conflicts need to be resolved');
      }
      throw error;
    }
  }

  async handleMergeDiverged(branchState) {
    try {
      console.log(chalk.blue('🔀 Merging remote changes...'));
      await this.gitRepo.git.merge([branchState.remoteBranch]);
      
      console.log(chalk.blue('⬆️  Pushing merge commit...'));
      await this.gitRepo.push(branchState.remote, branchState.currentBranch);
      
      console.log(chalk.green('✓ Successfully merged and pushed'));
    } catch (error) {
      if (error.message.includes('CONFLICT')) {
        console.log(chalk.yellow('⚠️  Merge conflicts detected'));
        console.log(chalk.cyan('💡 Use "easygit resolve" to resolve conflicts interactively'));
        throw new Error('Merge conflicts need to be resolved');
      }
      throw error;
    }
  }

  async handleForcePushDiverged(branchState) {
    console.log(chalk.red('⚠️  WARNING: Force push will overwrite remote history!'));
    console.log(chalk.red('   This may cause data loss for other team members.'));
    
    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: 'Are you absolutely sure you want to force push?',
      default: false
    }]);

    if (!confirmed) {
      throw new Error('Force push cancelled by user');
    }

    try {
      console.log(chalk.yellow('💥 Force pushing with lease...'));
      await this.gitRepo.git.push([branchState.remote, branchState.currentBranch, '--force-with-lease']);
      
      console.log(chalk.green('✓ Force push completed'));
      console.log(chalk.yellow('⚠️  Notify your team about the history rewrite'));
    } catch (error) {
      if (error.message.includes('stale info')) {
        throw new Error('Force push rejected - remote has newer commits. Someone else pushed while you were working.');
      }
      throw error;
    }
  }

  async handleNewBranch(branchState, options) {
    console.log(chalk.blue(`🌟 Creating new remote branch ${branchState.remoteBranch}...`));
    
    try {
      await this.gitRepo.git.push([branchState.remote, branchState.currentBranch, '-u']);
      console.log(chalk.green('✓ Successfully created remote branch and pushed commits'));
      console.log(chalk.gray(`   Upstream tracking set to ${branchState.remoteBranch}`));
    } catch (error) {
      throw new Error(`Failed to create remote branch: ${error.message}`);
    }
  }

  async getSyncStrategy(options) {
    if (options.rebase) return 'rebase';
    if (options.merge) return 'merge';
    
    // Get from configuration
    const configManager = require('../core/config-manager');
    const config = new configManager();
    return await config.getSyncStrategy();
  }
}

module.exports = SyncCommand;

