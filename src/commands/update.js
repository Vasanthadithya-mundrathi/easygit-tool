const chalk = require('chalk');

class UpdateCommand {
  constructor(program, gitRepo, errorHandler) {
    this.gitRepo = gitRepo;
    this.errorHandler = errorHandler;
    this.setupCommand(program);
  }

  setupCommand(program) {
    program
      .command('update')
      .description('Safely fetch and report remote changes without modifying working directory')
      .option('-r, --remote <remote>', 'Remote to fetch from', 'origin')
      .option('-a, --all', 'Fetch from all remotes')
      .option('--prune', 'Remove remote-tracking references that no longer exist')
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

    console.log(chalk.blue('📡 Fetching remote updates...'));

    if (options.all) {
      await this.gitRepo.git.fetch(['--all']);
    } else {
      await this.gitRepo.fetch(options.remote);
    }

    const status = await this.gitRepo.getStatus();
    
    if (status.behind > 0) {
      console.log(chalk.yellow(`⬇️  ${status.behind} new commits available`));
      console.log(chalk.cyan('💡 Run "easygit sync" to pull changes'));
    } else {
      console.log(chalk.green('✓ Up to date with remote'));
    }
  }
}

module.exports = UpdateCommand;

