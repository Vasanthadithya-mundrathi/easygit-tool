const chalk = require('chalk');
const inquirer = require('inquirer');

class UndoCommand {
  constructor(program, gitRepo, errorHandler) {
    this.gitRepo = gitRepo;
    this.errorHandler = errorHandler;
    this.setupCommand(program);
  }

  setupCommand(program) {
    program
      .command('undo')
      .description('Safely undo commits, merges, or other Git operations')
      .option('--commit [count]', 'Undo last N commits (default: 1)', '1')
      .option('--merge', 'Undo last merge')
      .option('--hard', 'Hard reset (dangerous - loses changes)')
      .option('--soft', 'Soft reset (keeps changes staged)')
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

    if (options.merge) {
      await this.undoMerge();
    } else {
      const count = parseInt(options.commit) || 1;
      const mode = options.hard ? 'hard' : (options.soft ? 'soft' : 'mixed');
      await this.undoCommits(count, mode);
    }
  }

  async undoCommits(count, mode) {
    const commits = await this.gitRepo.getCommitHistory(count + 1);
    
    if (commits.all.length <= count) {
      throw new Error('Not enough commits to undo');
    }

    console.log(chalk.yellow(`⚠️  About to undo ${count} commit(s) using ${mode} reset:`));
    commits.all.slice(0, count).forEach((commit, i) => {
      console.log(`   ${i + 1}. ${commit.hash.substring(0, 8)} ${commit.message}`);
    });

    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: `Confirm undo ${count} commit(s)?`,
      default: false
    }]);

    if (!confirmed) {
      console.log(chalk.yellow('Undo cancelled'));
      return;
    }

    await this.gitRepo.reset(mode, `HEAD~${count}`);
    console.log(chalk.green(`✓ Undid ${count} commit(s)`));
  }

  async undoMerge() {
    const lastCommit = await this.gitRepo.getLastCommit();
    
    if (!lastCommit || lastCommit.parents.length < 2) {
      throw new Error('No merge commit found to undo');
    }

    console.log(chalk.yellow(`⚠️  About to undo merge commit: ${lastCommit.hash.substring(0, 8)} ${lastCommit.message}`));

    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: 'Confirm undo merge?',
      default: false
    }]);

    if (!confirmed) {
      console.log(chalk.yellow('Undo cancelled'));
      return;
    }

    await this.gitRepo.reset('hard', 'HEAD~1');
    console.log(chalk.green('✓ Merge undone'));
  }
}

module.exports = UndoCommand;

