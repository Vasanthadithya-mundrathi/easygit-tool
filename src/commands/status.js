const chalk = require('chalk');

class StatusCommand {
  constructor(program, gitRepo, errorHandler) {
    this.gitRepo = gitRepo;
    this.errorHandler = errorHandler;
    this.setupCommand(program);
  }

  setupCommand(program) {
    program
      .command('status')
      .description('Show enhanced repository status with intelligent insights')
      .option('-s, --short', 'Show short format status')
      .option('-v, --verbose', 'Show detailed status information')
      .option('--porcelain', 'Machine-readable output')
      .option('--branch-info', 'Show detailed branch information')
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

    if (options.porcelain) {
      return await this.showPorcelainStatus();
    }

    const status = await this.gatherStatusInformation();
    
    if (options.short) {
      await this.showShortStatus(status);
    } else {
      await this.showDetailedStatus(status, options);
    }
  }

  async gatherStatusInformation() {
    try {
      const [gitStatus, branches, remotes, stashList, lastCommit] = await Promise.all([
        this.gitRepo.getStatus(),
        this.gitRepo.getBranches(),
        this.gitRepo.getRemotes(),
        this.gitRepo.getStashList(),
        this.gitRepo.getLastCommit().catch(() => null)
      ]);

      // Get repository health information
      const isMonorepo = await this.gitRepo.isMonorepo();
      const repoStats = await this.gitRepo.gatherRepoStats().catch(() => null);

      return {
        git: gitStatus,
        branches,
        remotes,
        stashList,
        lastCommit,
        isMonorepo,
        repoStats,
        workingDir: this.gitRepo.workingDir
      };
    } catch (error) {
      throw new Error(`Failed to gather status information: ${error.message}`);
    }
  }

  async showShortStatus(status) {
    const { git } = status;
    
    console.log(chalk.bold(`On branch ${git.current || 'HEAD (detached)'}`));
    
    if (git.ahead > 0 || git.behind > 0) {
      const aheadBehind = [];
      if (git.ahead > 0) aheadBehind.push(chalk.green(`↑${git.ahead}`));
      if (git.behind > 0) aheadBehind.push(chalk.red(`↓${git.behind}`));
      console.log(`Branch is ${aheadBehind.join(' ')}`);
    }

    // Show file changes in short format
    const allChanges = [
      ...git.staged.map(f => chalk.green('A ') + f),
      ...git.modified.map(f => chalk.red('M ') + f),
      ...git.deleted.map(f => chalk.red('D ') + f),
      ...git.created.map(f => chalk.yellow('? ') + f),
      ...git.renamed.map(f => chalk.blue('R ') + f.from + ' -> ' + f.to)
    ];

    if (allChanges.length > 0) {
      console.log('\nChanges:');
      allChanges.forEach(change => console.log('  ' + change));
    } else {
      console.log(chalk.green('\nWorking tree clean'));
    }

    if (status.stashList.total > 0) {
      console.log(chalk.cyan(`\nStash: ${status.stashList.total} entries`));
    }
  }

  async showDetailedStatus(status, options) {
    const { git, branches, remotes, stashList, lastCommit, isMonorepo, repoStats } = status;

    // Header with repository information
    console.log(chalk.bold.blue('📊 Repository Status\n'));
    
    // Branch information
    await this.showBranchStatus(git, branches, options);
    
    // Remote information
    if (remotes.length > 0) {
      await this.showRemoteStatus(remotes);
    }

    // Working directory changes
    await this.showWorkingDirectoryStatus(git);

    // Staging area
    await this.showStagingAreaStatus(git);

    // Last commit information
    if (lastCommit) {
      await this.showLastCommitInfo(lastCommit);
    }

    // Stash information
    if (stashList.total > 0) {
      await this.showStashInfo(stashList);
    }

    // Repository health and performance
    if (options.verbose) {
      await this.showRepositoryHealth(isMonorepo, repoStats);
    }

    // Suggestions and next steps
    await this.showSuggestions(git, status);
  }

  async showBranchStatus(git, branches, options) {
    console.log(chalk.yellow('🌿 Branch Information:'));
    
    const currentBranch = git.current || 'HEAD (detached)';
    console.log(`   Current: ${chalk.bold(currentBranch)}`);
    
    if (git.tracking) {
      console.log(`   Tracking: ${git.tracking}`);
      
      if (git.ahead > 0 || git.behind > 0) {
        const status = [];
        if (git.ahead > 0) status.push(chalk.green(`${git.ahead} ahead`));
        if (git.behind > 0) status.push(chalk.red(`${git.behind} behind`));
        console.log(`   Status: ${status.join(', ')}`);
      } else {
        console.log(`   Status: ${chalk.green('up to date')}`);
      }
    } else {
      console.log(`   Tracking: ${chalk.yellow('no upstream branch')}`);
    }

    if (options.branchInfo) {
      const localBranches = branches.all.filter(b => !b.startsWith('remotes/'));
      const remoteBranches = branches.all.filter(b => b.startsWith('remotes/'));
      
      console.log(`   Local branches: ${localBranches.length}`);
      console.log(`   Remote branches: ${remoteBranches.length}`);
      
      if (localBranches.length > 10) {
        console.log(chalk.cyan('   💡 Consider cleaning up old branches with "easygit doctor"'));
      }
    }
    
    console.log('');
  }

  async showRemoteStatus(remotes) {
    console.log(chalk.yellow('🌐 Remote Repositories:'));
    
    remotes.forEach(remote => {
      console.log(`   ${remote.name}: ${remote.refs.fetch}`);
      if (remote.refs.push !== remote.refs.fetch) {
        console.log(`   ${' '.repeat(remote.name.length)}  (push: ${remote.refs.push})`);
      }
    });
    
    console.log('');
  }

  async showWorkingDirectoryStatus(git) {
    const hasChanges = git.modified.length > 0 || git.deleted.length > 0 || git.created.length > 0;
    
    if (!hasChanges) {
      console.log(chalk.green('✓ Working directory clean'));
      console.log('');
      return;
    }

    console.log(chalk.yellow('📝 Working Directory Changes:'));

    if (git.modified.length > 0) {
      console.log(chalk.red(`   Modified (${git.modified.length}):`));
      git.modified.slice(0, 10).forEach(file => {
        console.log(chalk.red(`     M ${file}`));
      });
      if (git.modified.length > 10) {
        console.log(chalk.gray(`     ... and ${git.modified.length - 10} more`));
      }
    }

    if (git.deleted.length > 0) {
      console.log(chalk.red(`   Deleted (${git.deleted.length}):`));
      git.deleted.slice(0, 10).forEach(file => {
        console.log(chalk.red(`     D ${file}`));
      });
      if (git.deleted.length > 10) {
        console.log(chalk.gray(`     ... and ${git.deleted.length - 10} more`));
      }
    }

    if (git.created.length > 0) {
      console.log(chalk.yellow(`   Untracked (${git.created.length}):`));
      git.created.slice(0, 10).forEach(file => {
        console.log(chalk.yellow(`     ? ${file}`));
      });
      if (git.created.length > 10) {
        console.log(chalk.gray(`     ... and ${git.created.length - 10} more`));
      }
    }

    if (git.renamed.length > 0) {
      console.log(chalk.blue(`   Renamed (${git.renamed.length}):`));
      git.renamed.forEach(file => {
        console.log(chalk.blue(`     R ${file.from} -> ${file.to}`));
      });
    }

    console.log('');
  }

  async showStagingAreaStatus(git) {
    if (git.staged.length === 0) {
      return;
    }

    console.log(chalk.green(`📦 Staged Changes (${git.staged.length}):`));
    git.staged.slice(0, 10).forEach(file => {
      console.log(chalk.green(`     + ${file}`));
    });
    
    if (git.staged.length > 10) {
      console.log(chalk.gray(`     ... and ${git.staged.length - 10} more`));
    }
    
    console.log('');
  }

  async showLastCommitInfo(lastCommit) {
    console.log(chalk.yellow('📝 Last Commit:'));
    console.log(`   ${lastCommit.hash.substring(0, 8)} ${lastCommit.message}`);
    console.log(`   Author: ${lastCommit.author_name} <${lastCommit.author_email}>`);
    console.log(`   Date: ${new Date(lastCommit.date).toLocaleString()}`);
    console.log('');
  }

  async showStashInfo(stashList) {
    console.log(chalk.cyan(`💾 Stash (${stashList.total} entries):`));
    
    stashList.all.slice(0, 3).forEach((stash, index) => {
      console.log(`   ${index}: ${stash.message}`);
    });
    
    if (stashList.total > 3) {
      console.log(chalk.gray(`   ... and ${stashList.total - 3} more`));
    }
    
    console.log('');
  }

  async showRepositoryHealth(isMonorepo, repoStats) {
    console.log(chalk.yellow('🏥 Repository Health:'));
    
    if (repoStats) {
      console.log(`   Files: ${repoStats.fileCount.toLocaleString()}`);
      console.log(`   Size: ${repoStats.sizeInMB.toFixed(2)} MB`);
      console.log(`   Commits: ${repoStats.commitCount.toLocaleString()}`);
      console.log(`   Branches: ${repoStats.branchCount}`);
    }
    
    if (isMonorepo) {
      console.log(chalk.blue('   Type: Monorepo detected'));
      console.log(chalk.cyan('   💡 Run "easygit doctor" for performance optimizations'));
    }
    
    // Check for potential issues
    const issues = [];
    if (repoStats && repoStats.sizeInMB > 500) {
      issues.push('Large repository size');
    }
    if (repoStats && repoStats.branchCount > 50) {
      issues.push('Many branches (consider cleanup)');
    }
    
    if (issues.length > 0) {
      console.log(chalk.yellow(`   Issues: ${issues.join(', ')}`));
    } else {
      console.log(chalk.green('   Status: Healthy'));
    }
    
    console.log('');
  }

  async showSuggestions(git, status) {
    const suggestions = [];
    
    // Staging suggestions
    if (git.modified.length > 0 || git.created.length > 0 || git.deleted.length > 0) {
      suggestions.push('Use "easygit save" to stage and commit changes');
    }
    
    // Sync suggestions
    if (git.ahead > 0) {
      suggestions.push('Use "easygit sync" to push your commits');
    } else if (git.behind > 0) {
      suggestions.push('Use "easygit sync" to pull remote changes');
    }
    
    // Branch suggestions
    if (!git.tracking) {
      suggestions.push('Set upstream branch with "easygit sync" (will create remote branch)');
    }
    
    // Stash suggestions
    if (status.stashList.total > 5) {
      suggestions.push('Consider cleaning up old stash entries');
    }
    
    // Performance suggestions
    if (status.isMonorepo) {
      suggestions.push('Run "easygit doctor" for monorepo optimizations');
    }

    if (suggestions.length > 0) {
      console.log(chalk.cyan('💡 Suggestions:'));
      suggestions.forEach(suggestion => {
        console.log(chalk.cyan(`   • ${suggestion}`));
      });
      console.log('');
    }
  }

  async showPorcelainStatus() {
    const git = await this.gitRepo.getStatus();
    
    // Output in porcelain format for machine parsing
    const output = {
      branch: git.current,
      ahead: git.ahead,
      behind: git.behind,
      staged: git.staged,
      modified: git.modified,
      deleted: git.deleted,
      created: git.created,
      renamed: git.renamed,
      clean: git.isClean()
    };
    
    console.log(JSON.stringify(output, null, 2));
  }
}

module.exports = StatusCommand;

