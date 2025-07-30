const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs').promises;
const path = require('path');

class SaveCommand {
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
      .command('save')
      .description('Intelligently stage and commit changes with safety checks')
      .argument('[message]', 'Commit message')
      .option('-a, --all', 'Stage all changes including untracked files')
      .option('-p, --partial', 'Interactively stage parts of files')
      .option('-f, --force', 'Skip pre-flight checks (dangerous)')
      .option('--no-hooks', 'Skip pre-commit hooks')
      .option('--amend', 'Amend the previous commit')
      .option('--empty', 'Allow empty commits')
      .action(async (message, options) => {
        try {
          await this.execute(message, options);
        } catch (error) {
          await this.errorHandler.handleError(error, this.gitRepo);
          process.exit(1);
        }
      });
  }

  async execute(message, options = {}) {
    if (!this.gitRepo || !this.gitRepo.isRepository()) {
      throw new Error('Not in a Git repository. Use "git init" to create a new repository.');
    }

    console.log(chalk.blue('🔍 Analyzing repository state...'));

    // Pre-flight checks
    if (!options.force) {
      await this.performPreflightChecks();
    }

    // Handle amend case
    if (options.amend) {
      return await this.handleAmend(message, options);
    }

    // Get repository status
    const status = await this.gitRepo.getStatus();
    
    // Check if there are changes to commit
    const hasChanges = !status.isClean() || options.empty;
    if (!hasChanges && !options.empty) {
      console.log(chalk.yellow('ℹ️  No changes detected to commit.'));
      console.log(chalk.gray('   Use "easygit status" to see repository state.'));
      return;
    }

    // Handle staging
    await this.handleStaging(status, options);

    // Get or prompt for commit message
    const commitMessage = await this.getCommitMessage(message, options);

    // Validate commit message
    await this.validateCommitMessage(commitMessage);

    // Execute pre-commit hooks
    if (!options.noHooks) {
      await this.executePreCommitHooks();
    }

    // Perform the commit
    await this.performCommit(commitMessage, options);

    // Post-commit actions
    await this.postCommitActions();
  }

  async performPreflightChecks() {
    const checks = [
      this.checkProtectedBranch(),
      this.checkLargeFiles(),
      this.checkSensitiveFiles(),
      this.checkCommitMessageFormat(),
      this.checkBranchState()
    ];

    console.log(chalk.blue('🛡️  Running pre-flight checks...'));

    const results = await Promise.allSettled(checks);
    const failures = results.filter(result => result.status === 'rejected');

    if (failures.length > 0) {
      console.log(chalk.red('\n❌ Pre-flight checks failed:'));
      failures.forEach(failure => {
        console.log(chalk.red('   • ' + failure.reason.message));
      });
      
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: 'Do you want to proceed anyway?',
        default: false
      }]);

      if (!proceed) {
        throw new Error('Commit cancelled by user');
      }
    } else {
      console.log(chalk.green('✓ Pre-flight checks passed'));
    }
  }

  async checkProtectedBranch() {
    const currentBranch = await this.gitRepo.getCurrentBranch();
    const configManager = require('../core/config-manager');
    const config = new configManager();
    
    const protectedBranches = await config.getProtectedBranches();
    
    if (protectedBranches.includes(currentBranch)) {
      const { createBranch } = await inquirer.prompt([{
        type: 'confirm',
        name: 'createBranch',
        message: `You're about to commit to protected branch "${currentBranch}". Create a new branch instead?`,
        default: true
      }]);

      if (createBranch) {
        const { branchName } = await inquirer.prompt([{
          type: 'input',
          name: 'branchName',
          message: 'Enter new branch name:',
          validate: (input) => {
            if (!input.trim()) return 'Branch name cannot be empty';
            if (input.includes(' ')) return 'Branch name cannot contain spaces';
            return true;
          }
        }]);

        await this.gitRepo.createBranch(branchName);
        console.log(chalk.green(`✓ Created and switched to branch "${branchName}"`));
      }
    }
  }

  async checkLargeFiles() {
    const status = await this.gitRepo.getStatus();
    const allFiles = [...status.created, ...status.modified];
    const largeFiles = [];

    for (const file of allFiles) {
      try {
        const stats = await fs.stat(path.join(this.gitRepo.workingDir, file));
        if (stats.size > 50 * 1024 * 1024) { // 50MB threshold
          largeFiles.push({ file, size: stats.size });
        }
      } catch (error) {
        // File might have been deleted, skip
      }
    }

    if (largeFiles.length > 0) {
      console.log(chalk.yellow('\n⚠️  Large files detected:'));
      largeFiles.forEach(({ file, size }) => {
        const sizeMB = (size / (1024 * 1024)).toFixed(2);
        console.log(chalk.yellow(`   • ${file} (${sizeMB} MB)`));
      });

      console.log(chalk.cyan('\n💡 Consider using Git LFS for large files:'));
      console.log(chalk.cyan('   git lfs track "*.{extension}"'));
      
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: 'Continue with large files?',
        default: false
      }]);

      if (!proceed) {
        throw new Error('Large files detected - commit cancelled');
      }
    }
  }

  async checkSensitiveFiles() {
    const status = await this.gitRepo.getStatus();
    // Get all files that are either modified, created, or untracked and not ignored
    const allRelevantFiles = [
      ...status.modified,
      ...status.staged,
      ...status.deleted, // Deleted files might still have sensitive names
      ...(await this.gitRepo.git.raw(["ls-files", "--others", "--exclude-standard"])) // Untracked, non-ignored files
        .split("\n")
        .filter(Boolean)
    ];

    const sensitivePatterns = [
      /\.env$/,
      /\.env\./,
      /id_rsa$/,
      /id_dsa$/,
      /\.pem$/,
      /\.key$/,
      /\.p12$/,
      /\.pfx$/,
      /config\.json$/,
      /secrets?\.json$/,
      /credentials?\.json$/,
      /\.aws\/credentials$/,
      /\.ssh\/config$/,
      /api_key\.txt$/ // Add the specific file name for testing
    ];

    const sensitiveFiles = allRelevantFiles.filter(file => {
      const isSensitive = sensitivePatterns.some(pattern => pattern.test(file));
      if (isSensitive) {
        console.log(`DEBUG: Detected sensitive file: ${file}`); // Debug log
      }
      return isSensitive;
    });

    if (sensitiveFiles.length > 0) {
      console.log(chalk.red("\n🚨 Potentially sensitive files detected:"));
      sensitiveFiles.forEach(file => {
        console.log(chalk.red(`   • ${file}`));
      });

      const { proceed } = await inquirer.prompt([{
        type: "confirm",
        name: "proceed",
        message: "These files may contain sensitive information. Continue?",
        default: false
      }]);

      if (!proceed) {
        throw new Error("Sensitive files detected - commit cancelled");
      }
    }
  }

  async checkCommitMessageFormat() {
    const configManager = require('../core/config-manager');
    const config = new configManager();
    const format = await config.get('team.commitMessageFormat', 'free');
    
    if (format === 'conventional') {
      // Will be validated later when we have the actual message
      return;
    }
    
    if (format === 'custom') {
      // Custom validation logic could be added here
      return;
    }
  }

  async checkBranchState() {
    const status = await this.gitRepo.getStatus();
    
    if (status.behind > 0) {
      console.log(chalk.yellow(`\n⚠️  Your branch is ${status.behind} commits behind the remote.`));
      console.log(chalk.yellow('   Consider running "easygit sync" before committing.'));
      
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: 'Continue with commit?',
        default: true
      }]);

      if (!proceed) {
        throw new Error('Branch is behind - commit cancelled');
      }
    }
  }

  async handleStaging(status, options) {
    if (options.partial) {
      return await this.handlePartialStaging(status);
    }

    // Handle untracked files
    if (status.created.length > 0) {
      console.log("Untracked files in status.created:", status.created); // Debug log
      if (options.all) {
        console.log(chalk.blue(`📁 Staging ${status.created.length} new files...`));
        await this.gitRepo.addFiles(status.created);
      } else {
        await this.handleUntrackedFiles(status.created);
      }
    }

    // Stage modified files
    if (status.modified.length > 0) {
      console.log(chalk.blue(`📝 Staging ${status.modified.length} modified files...`));
      await this.gitRepo.addFiles(status.modified);
    }

    // Handle deleted files
    if (status.deleted.length > 0) {
      console.log(chalk.blue(`🗑️  Staging ${status.deleted.length} deleted files...`));
      await this.gitRepo.addFiles(status.deleted);
    }
  }

  async handleUntrackedFiles(untrackedFiles) {
    console.log(chalk.yellow(`\n📁 Found ${untrackedFiles.length} untracked files:`));
    
    const choices = untrackedFiles.map(file => ({
      name: file,
      value: file,
      checked: true
    }));

    const { selectedFiles } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedFiles',
      message: 'Select files to stage:',
      choices,
      pageSize: 10
    }]);

    if (selectedFiles.length > 0) {
      await this.gitRepo.addFiles(selectedFiles);
      console.log(chalk.green(`✓ Staged ${selectedFiles.length} files`));
    }
  }

  async handlePartialStaging(status) {
    console.log(chalk.blue('🎯 Entering partial staging mode...'));
    
    const modifiedFiles = status.modified;
    if (modifiedFiles.length === 0) {
      console.log(chalk.yellow('No modified files available for partial staging.'));
      return;
    }

    for (const file of modifiedFiles) {
      const { shouldStage } = await inquirer.prompt([{
        type: 'confirm',
        name: 'shouldStage',
        message: `Stage changes in ${file}?`,
        default: true
      }]);

      if (shouldStage) {
        // For now, stage the entire file
        // In a full implementation, this would use git add -p equivalent
        await this.gitRepo.addFiles([file]);
        console.log(chalk.green(`✓ Staged ${file}`));
      }
    }
  }

  async getCommitMessage(providedMessage, options) {
    if (providedMessage) {
      return providedMessage;
    }

    const { message } = await inquirer.prompt([{
      type: 'input',
      name: 'message',
      message: 'Enter commit message:',
      validate: (input) => {
        if (!input.trim()) return 'Commit message cannot be empty';
        if (input.length > 72) return 'First line should be 72 characters or less';
        return true;
      }
    }]);

    return message;
  }

  async validateCommitMessage(message) {
    const configManager = require('../core/config-manager');
    const config = new configManager();
    const format = await config.get('team.commitMessageFormat', 'free');

    if (format === 'conventional') {
      const conventionalPattern = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .{1,50}/;
      
      if (!conventionalPattern.test(message)) {
        console.log(chalk.yellow('\n⚠️  Commit message does not follow conventional format.'));
        console.log(chalk.gray('   Expected: type(scope): description'));
        console.log(chalk.gray('   Example: feat(auth): add user login validation'));
        
        const { proceed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'proceed',
          message: 'Continue with non-conventional message?',
          default: false
        }]);

        if (!proceed) {
          throw new Error('Invalid commit message format');
        }
      }
    }

    // Check for issue ID requirement
    const requireIssueId = await config.get('team.requireIssueId', false);
    if (requireIssueId) {
      const issuePattern = /#\d+|[A-Z]+-\d+/;
      if (!issuePattern.test(message)) {
        console.log(chalk.yellow('\n⚠️  Commit message should include an issue ID.'));
        console.log(chalk.gray('   Example: "Fix login bug (#123)" or "PROJ-456: Update docs"'));
        
        const { proceed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'proceed',
          message: 'Continue without issue ID?',
          default: false
        }]);

        if (!proceed) {
          throw new Error('Issue ID required in commit message');
        }
      }
    }
  }

  async executePreCommitHooks() {
    const configManager = require('../core/config-manager');
    const config = new configManager();
    const hooks = await config.getHooks('preCommit');

    if (hooks.length === 0) {
      return;
    }

    console.log(chalk.blue('🪝 Running pre-commit hooks...'));

    for (const hook of hooks) {
      try {
        console.log(chalk.gray(`   Running: ${hook}`));
        
        const { spawn } = require('child_process');
        const result = await new Promise((resolve, reject) => {
          const process = spawn('sh', ['-c', hook], {
            cwd: this.gitRepo.workingDir,
            stdio: 'pipe'
          });

          let stdout = '';
          let stderr = '';

          process.stdout.on('data', (data) => {
            stdout += data.toString();
          });

          process.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          process.on('close', (code) => {
            resolve({ code, stdout, stderr });
          });

          process.on('error', (error) => {
            reject(error);
          });
        });

        if (result.code !== 0) {
          console.log(chalk.red(`   ❌ Hook failed: ${hook}`));
          if (result.stderr) {
            console.log(chalk.red(`   Error: ${result.stderr}`));
          }
          
          const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Pre-commit hook failed. Continue anyway?',
            default: false
          }]);

          if (!proceed) {
            throw new Error('Pre-commit hook failed');
          }
        } else {
          console.log(chalk.green(`   ✓ ${hook}`));
        }
      } catch (error) {
        console.log(chalk.red(`   ❌ Hook error: ${error.message}`));
        throw new Error(`Pre-commit hook failed: ${hook}`);
      }
    }
  }

  async performCommit(message, options) {
    try {
      console.log(chalk.blue('💾 Creating commit...'));
      
      const commitOptions = {};
      if (options.empty) {
        commitOptions['--allow-empty'] = null;
      }

      const result = await this.gitRepo.commit(message, commitOptions);
      
      console.log(chalk.green('✓ Commit created successfully'));
      console.log(chalk.gray(`   ${result.commit.substring(0, 8)} "${message}"`));
      
      return result;
    } catch (error) {
      if (error.message.includes('nothing to commit')) {
        throw new Error('No changes staged for commit. Use "easygit status" to see repository state.');
      }
      throw error;
    }
  }

  async handleAmend(message, options) {
    console.log(chalk.blue('🔄 Amending previous commit...'));
    
    const lastCommit = await this.gitRepo.getLastCommit();
    if (!lastCommit) {
      throw new Error('No previous commit to amend');
    }

    console.log(chalk.gray(`   Previous: ${lastCommit.hash.substring(0, 8)} "${lastCommit.message}"`));

    const finalMessage = message || lastCommit.message;
    
    try {
      const result = await this.gitRepo.git.commit(finalMessage, ['--amend']);
      console.log(chalk.green('✓ Commit amended successfully'));
      console.log(chalk.gray(`   ${result.commit.substring(0, 8)} "${finalMessage}"`));
      
      return result;
    } catch (error) {
      throw new Error(`Failed to amend commit: ${error.message}`);
    }
  }

  async postCommitActions() {
    const status = await this.gitRepo.getStatus();
    
    console.log(chalk.green('\n🎉 Commit completed!'));
    
    // Show next steps
    console.log(chalk.cyan('\n💡 Next steps:'));
    
    if (status.ahead > 0) {
      console.log(chalk.cyan('   • Run "easygit sync" to push your changes'));
    }
    
    console.log(chalk.cyan('   • Run "easygit status" to see repository state'));
    console.log(chalk.cyan('   • Run "easygit doctor" to check repository health'));

    // Execute post-commit hooks
    const configManager = require('../core/config-manager');
    const config = new configManager();
    const postCommitHooks = await config.getHooks('postCommit');

    if (postCommitHooks.length > 0) {
      console.log(chalk.blue('\n🪝 Running post-commit hooks...'));
      
      for (const hook of postCommitHooks) {
        try {
          const { spawn } = require('child_process');
          spawn('sh', ['-c', hook], {
            cwd: this.gitRepo.workingDir,
            stdio: 'inherit',
            detached: true
          });
        } catch (error) {
          console.warn(chalk.yellow(`Warning: Post-commit hook failed: ${hook}`));
        }
      }
    }
  }
}

module.exports = SaveCommand;

