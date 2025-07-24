const chalk = require('chalk');

class AskCommand {
  constructor(program, gitRepo, errorHandler) {
    this.gitRepo = gitRepo;
    this.errorHandler = errorHandler;
    this.setupCommand(program);
  }

  setupCommand(program) {
    program
      .command('ask')
      .description('Ask AI assistant for Git help and command suggestions')
      .argument('<question>', 'Your question about Git or the repository')
      .option('--explain', 'Get detailed explanation of suggested commands')
      .action(async (question, options) => {
        try {
          await this.execute(question, options);
        } catch (error) {
          await this.errorHandler.handleError(error, this.gitRepo);
          process.exit(1);
        }
      });
  }

  async execute(question, options = {}) {
    console.log(chalk.blue('🤖 AI Assistant (Gemini CLI integration coming soon)'));
    console.log(chalk.yellow(`Question: ${question}`));
    
    // For now, provide basic responses based on keywords
    const response = this.getBasicResponse(question);
    console.log(chalk.green(`Answer: ${response}`));
    
    console.log(chalk.cyan('\n💡 Full AI integration with Gemini CLI will be available in the next update'));
  }

  getBasicResponse(question) {
    const q = question.toLowerCase();
    
    if (q.includes('commit') && q.includes('undo')) {
      return 'Use "easygit undo --commit 1" to undo the last commit safely.';
    }
    
    if (q.includes('merge') && q.includes('conflict')) {
      return 'Use "easygit sync" to handle merge conflicts with guided resolution.';
    }
    
    if (q.includes('branch') && (q.includes('switch') || q.includes('change'))) {
      return 'Use "easygit switch" to interactively switch branches with fuzzy finding.';
    }
    
    if (q.includes('push') && q.includes('reject')) {
      return 'Use "easygit sync" to pull remote changes first, then push your commits.';
    }
    
    if (q.includes('stash')) {
      return 'easygit automatically handles stashing when switching branches or syncing.';
    }
    
    return 'I can help with Git workflows! Try asking about commits, branches, merging, or conflicts.';
  }
}

module.exports = AskCommand;

