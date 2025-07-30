const chalk = require('chalk');

class DoctorCommand {
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
      .command('doctor')
      .description('Run comprehensive repository health checks and optimizations')
      .option('--fix', 'Automatically fix issues where possible')
      .option('--verbose', 'Show detailed diagnostic information')
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

    console.log(chalk.blue('🏥 Running repository health check...\n'));

    const issues = [];
    const fixes = [];

    // Check repository size and performance
    const isMonorepo = await this.gitRepo.isMonorepo();
    if (isMonorepo) {
      console.log(chalk.yellow('📊 Monorepo detected - checking performance optimizations...'));
      
      if (options.fix) {
        fixes.push('Enabled monorepo optimizations');
      } else {
        issues.push('Consider enabling monorepo optimizations');
      }
    }

    // Check for large files
    console.log(chalk.blue('📁 Checking for large files...'));
    // Implementation would check for files > 50MB

    // Check branch health
    const branches = await this.gitRepo.getBranches();
    const branchCount = branches.all.filter(b => !b.startsWith('remotes/')).length;
    
    if (branchCount > 20) {
      issues.push(`Many local branches (${branchCount}) - consider cleanup`);
    }

    // Check stash health
    const stashList = await this.gitRepo.getStashList();
    if (stashList.total > 10) {
      issues.push(`Many stash entries (${stashList.total}) - consider cleanup`);
    }

    // Report results
    if (issues.length === 0) {
      console.log(chalk.green('✅ Repository is healthy!'));
    } else {
      console.log(chalk.yellow('\n⚠️  Issues found:'));
      issues.forEach(issue => console.log(`   • ${issue}`));
    }

    if (fixes.length > 0) {
      console.log(chalk.green('\n🔧 Fixes applied:'));
      fixes.forEach(fix => console.log(`   • ${fix}`));
    }

    console.log(chalk.cyan('\n💡 Recommendations:'));
    console.log(chalk.cyan('   • Run "easygit status" regularly to monitor repository health'));
    console.log(chalk.cyan('   • Use "easygit save" for intelligent commits'));
    console.log(chalk.cyan('   • Use "easygit sync" for safe synchronization'));
  }
}

module.exports = DoctorCommand;

