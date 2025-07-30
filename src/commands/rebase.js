const chalk = require('chalk');
const inquirer = require('inquirer');
const TUIManager = require('../ui/tui-manager');

class RebaseCommand {
  constructor(program, gitRepoGetter, errorHandler) {
    this.gitRepoGetter = gitRepoGetter;
    this.errorHandler = errorHandler;
    this.tuiManager = new TUIManager();
    this.setupCommand(program);
  }

  get gitRepo() {
    return this.gitRepoGetter();
  }

  setupCommand(program) {
    program
      .command('rebase')
      .description('Interactive rebase with visual interface')
      .argument('[target]', 'Target branch or commit to rebase onto')
      .option('-i, --interactive', 'Start interactive rebase')
      .option('--onto <branch>', 'Rebase onto specific branch')
      .option('--continue', 'Continue interrupted rebase')
      .option('--abort', 'Abort current rebase')
      .option('--skip', 'Skip current commit during rebase')
      .action(async (target, options) => {
        try {
          await this.execute(target, options);
        } catch (error) {
          await this.errorHandler.handleError(error, this.gitRepo);
          process.exit(1);
        }
      });
  }

  async execute(target, options = {}) {
    if (!this.gitRepo || !this.gitRepo.isRepository()) {
      throw new Error('Not in a Git repository. Use "git init" to create a new repository.');
    }

    // Handle rebase control commands
    if (options.continue) {
      return await this.continueRebase();
    }
    
    if (options.abort) {
      return await this.abortRebase();
    }
    
    if (options.skip) {
      return await this.skipRebase();
    }

    // Check if rebase is already in progress
    const rebaseInProgress = await this.isRebaseInProgress();
    if (rebaseInProgress) {
      console.log(chalk.yellow('⚠️  Rebase already in progress.'));
      console.log(chalk.cyan('Use "easygit rebase --continue", "--skip", or "--abort"'));
      return;
    }

    // Determine target for rebase
    const rebaseTarget = target || await this.selectRebaseTarget();
    
    if (options.interactive || !target) {
      await this.interactiveRebase(rebaseTarget, options);
    } else {
      await this.standardRebase(rebaseTarget, options);
    }
  }

  async selectRebaseTarget() {
    const branches = await this.gitRepo.getBranches();
    const currentBranch = await this.gitRepo.getCurrentBranch();
    
    // Filter out current branch
    const targetBranches = branches.all
      .filter(branch => !branch.startsWith('remotes/') && branch !== currentBranch)
      .map(branch => ({ name: branch, current: false }));

    if (targetBranches.length === 0) {
      throw new Error('No available branches to rebase onto');
    }

    try {
      const selectedBranch = await this.tuiManager.showBranchSelector(
        targetBranches, 
        'Select target branch for rebase'
      );
      return selectedBranch.name;
    } catch (error) {
      throw new Error('Rebase cancelled by user');
    }
  }

  async interactiveRebase(target, options) {
    console.log(chalk.blue('🔄 Starting interactive rebase...'));
    
    // Get commits to rebase
    const commits = await this.getCommitsToRebase(target);
    
    if (commits.length === 0) {
      console.log(chalk.yellow('No commits to rebase.'));
      return;
    }

    console.log(chalk.gray(`Found ${commits.length} commits to rebase onto ${target}`));

    try {
      // Show interactive rebase UI
      const rebaseActions = await this.tuiManager.showInteractiveRebase(commits);
      
      // Execute the rebase
      await this.executeInteractiveRebase(target, rebaseActions);
      
    } catch (error) {
      if (error.message.includes('cancelled')) {
        console.log(chalk.yellow('Interactive rebase cancelled.'));
        return;
      }
      throw error;
    }
  }

  async standardRebase(target, options) {
    console.log(chalk.blue(`🔄 Rebasing onto ${target}...`));
    
    try {
      const rebaseOptions = [];
      
      if (options.onto) {
        rebaseOptions.push('--onto', options.onto);
      }
      
      rebaseOptions.push(target);
      
      await this.gitRepo.git.rebase(rebaseOptions);
      
      console.log(chalk.green('✓ Rebase completed successfully'));
      
    } catch (error) {
      if (error.message.includes('conflict')) {
        await this.handleRebaseConflicts();
      } else {
        throw error;
      }
    }
  }

  async getCommitsToRebase(target) {
    try {
      const currentBranch = await this.gitRepo.getCurrentBranch();
      const commits = await this.gitRepo.git.log({
        from: target,
        to: currentBranch
      });
      
      return commits.all.reverse(); // Reverse to show oldest first
    } catch (error) {
      throw new Error(`Failed to get commits for rebase: ${error.message}`);
    }
  }

  async executeInteractiveRebase(target, actions) {
    console.log(chalk.blue('⚙️  Executing rebase plan...'));
    
    // Create rebase todo file content
    const todoContent = actions.map(action => 
      `${action.action} ${action.commit.hash} ${action.commit.message}`
    ).join('\\n');
    
    try {
      // Start interactive rebase with custom todo
      await this.gitRepo.git.rebase(['-i', target]);
      
      console.log(chalk.green('✓ Interactive rebase completed'));
      
    } catch (error) {
      if (error.message.includes('conflict')) {
        await this.handleRebaseConflicts();
      } else {
        throw error;
      }
    }
  }

  async handleRebaseConflicts() {
    console.log(chalk.red('⚠️  Rebase conflicts detected!'));
    console.log('');
    
    // Get conflicted files
    const status = await this.gitRepo.getStatus();
    const conflictedFiles = status.conflicted || [];
    
    if (conflictedFiles.length > 0) {
      console.log(chalk.yellow('Conflicted files:'));
      conflictedFiles.forEach(file => {
        console.log(chalk.red(`   • ${file}`));
      });
      console.log('');
    }
    
    console.log(chalk.cyan('Resolution steps:'));
    console.log(chalk.gray('1. Resolve conflicts in the listed files'));
    console.log(chalk.gray('2. Stage resolved files: git add <file>'));
    console.log(chalk.gray('3. Continue rebase: easygit rebase --continue'));
    console.log(chalk.gray('4. Or abort rebase: easygit rebase --abort'));
    console.log('');
    
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Open conflict resolution guide', value: 'guide' },
        { name: 'Continue manually', value: 'manual' },
        { name: 'Abort rebase', value: 'abort' }
      ]
    }]);
    
    switch (action) {
      case 'guide':
        await this.showConflictResolutionGuide(conflictedFiles);
        break;
      case 'abort':
        await this.abortRebase();
        break;
      case 'manual':
        console.log(chalk.blue('💡 Resolve conflicts manually and run "easygit rebase --continue"'));
        break;
    }
  }

  async showConflictResolutionGuide(conflictedFiles) {
    console.log(chalk.blue('📖 Conflict Resolution Guide'));
    console.log('');
    
    console.log(chalk.yellow('Understanding conflict markers:'));
    console.log(chalk.gray('<<<<<<< HEAD          - Your current changes'));
    console.log(chalk.gray('=======               - Separator'));
    console.log(chalk.gray('>>>>>>> commit-hash   - Incoming changes'));
    console.log('');
    
    console.log(chalk.yellow('Resolution process:'));
    console.log(chalk.gray('1. Edit each conflicted file'));
    console.log(chalk.gray('2. Choose which changes to keep'));
    console.log(chalk.gray('3. Remove conflict markers (<<<, ===, >>>)'));
    console.log(chalk.gray('4. Save the file'));
    console.log(chalk.gray('5. Stage the resolved file: git add <file>'));
    console.log('');
    
    if (conflictedFiles.length > 0) {
      const { openFile } = await inquirer.prompt([{
        type: 'confirm',
        name: 'openFile',
        message: 'Would you like to open the first conflicted file?',
        default: true
      }]);
      
      if (openFile) {
        const editor = process.env.EDITOR || 'nano';
        console.log(chalk.blue(`Opening ${conflictedFiles[0]} with ${editor}...`));
        
        const { spawn } = require('child_process');
        const editorProcess = spawn(editor, [conflictedFiles[0]], {
          stdio: 'inherit',
          cwd: this.gitRepo.workingDir
        });
        
        editorProcess.on('close', () => {
          console.log(chalk.green('File closed. Remember to stage it after resolving conflicts.'));
        });
      }
    }
  }

  async continueRebase() {
    console.log(chalk.blue('▶️  Continuing rebase...'));
    
    try {
      await this.gitRepo.git.rebase(['--continue']);
      console.log(chalk.green('✓ Rebase continued successfully'));
      
    } catch (error) {
      if (error.message.includes('conflict')) {
        await this.handleRebaseConflicts();
      } else if (error.message.includes('nothing to commit')) {
        console.log(chalk.yellow('No changes to commit. Skipping...'));
        await this.skipRebase();
      } else {
        throw error;
      }
    }
  }

  async abortRebase() {
    console.log(chalk.yellow('🛑 Aborting rebase...'));
    
    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: 'Are you sure you want to abort the rebase?',
      default: false
    }]);
    
    if (!confirmed) {
      console.log(chalk.gray('Rebase abort cancelled.'));
      return;
    }
    
    try {
      await this.gitRepo.git.rebase(['--abort']);
      console.log(chalk.green('✓ Rebase aborted. Repository restored to original state.'));
      
    } catch (error) {
      throw new Error(`Failed to abort rebase: ${error.message}`);
    }
  }

  async skipRebase() {
    console.log(chalk.yellow('⏭️  Skipping current commit...'));
    
    try {
      await this.gitRepo.git.rebase(['--skip']);
      console.log(chalk.green('✓ Commit skipped, continuing rebase...'));
      
    } catch (error) {
      if (error.message.includes('conflict')) {
        await this.handleRebaseConflicts();
      } else {
        throw error;
      }
    }
  }

  async isRebaseInProgress() {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      const rebaseDirs = [
        path.join(this.gitRepo.workingDir, '.git', 'rebase-merge'),
        path.join(this.gitRepo.workingDir, '.git', 'rebase-apply')
      ];
      
      for (const dir of rebaseDirs) {
        try {
          await fs.access(dir);
          return true;
        } catch {
          // Directory doesn't exist, continue checking
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }
}

module.exports = RebaseCommand;

