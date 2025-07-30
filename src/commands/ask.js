const chalk = require('chalk');
const GeminiIntegration = require('../ai/gemini-integration');

class AskCommand {
  constructor(program, gitRepoGetter, errorHandler) {
    this.gitRepoGetter = gitRepoGetter;
    this.errorHandler = errorHandler;
    this.gemini = new GeminiIntegration();
    this.setupCommand(program);
  }

  get gitRepo() {
    return this.gitRepoGetter();
  }

  setupCommand(program) {
    program
      .command('ask')
      .description('Ask AI assistant for Git help and command suggestions')
      .argument('<question>', 'Your question about Git or the repository')
      .option('--explain', 'Get detailed explanation of suggested commands')
      .option('--concept <concept>', 'Explain a Git concept (rebase, merge, stash, etc.)')
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
    console.log(chalk.blue('🤖 AI Assistant'));
    console.log(chalk.yellow(`Question: ${question}`));
    
    // Check if Gemini CLI is properly configured
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENAI_USE_VERTEXAI) {
      console.log(chalk.yellow('\n⚠️  Gemini CLI not configured. To enable AI features:'));
      console.log(chalk.gray('1. Get a free API key from https://aistudio.google.com/app/apikey'));
      console.log(chalk.gray('2. Set environment variable: export GEMINI_API_KEY="your_key_here"'));
      console.log(chalk.gray('3. Or run: gemini (and follow authentication prompts)'));
      console.log(chalk.cyan('\n💡 Using intelligent fallback responses for now...\n'));
    }
    
    console.log('');

    // Handle concept explanation
    if (options.concept) {
      return await this.explainConcept(options.concept);
    }

    // Gather repository context
    const context = await this.gatherRepositoryContext();
    
    // Get AI response
    const response = await this.gemini.askGemini(question, context);
    
    // Display response
    this.displayResponse(response, options.explain);
    
    // Show smart suggestions if available
    if (context.repositoryState) {
      await this.showSmartSuggestions(context.repositoryState);
    }
  }

  async gatherRepositoryContext() {
    if (!this.gitRepo) {
      return { repositoryState: null };
    }

    try {
      const status = await this.gitRepo.getStatus();
      const currentBranch = await this.gitRepo.getCurrentBranch();
      const commits = await this.gitRepo.getCommitHistory(5);
      
      return {
        repositoryState: {
          currentBranch,
          uncommittedChanges: !status.isClean(),
          behind: status.behind || 0,
          ahead: status.ahead || 0,
          stashCount: 0 // Would need to implement stash counting
        },
        currentBranch,
        uncommittedChanges: !status.isClean(),
        recentCommits: commits.all || []
      };
    } catch (error) {
      return { repositoryState: null };
    }
  }

  displayResponse(response, showExplanation = false) {
    // Display main answer
    console.log(chalk.green('Answer:'));
    console.log(this.formatResponseText(response.answer));
    console.log('');

    // Display commands if available
    if (response.commands && response.commands.length > 0) {
      console.log(chalk.cyan('Suggested Commands:'));
      response.commands.forEach(command => {
        console.log(chalk.gray(`  $ ${command}`));
      });
      console.log('');
    }

    // Show source and confidence
    const sourceColor = response.source === 'gemini' ? 'green' : 'yellow';
    const confidenceIcon = this.getConfidenceIcon(response.confidence);
    console.log(chalk.gray(`${confidenceIcon} Source: ${response.source} (${response.confidence} confidence)`));

    // Show detailed explanation if requested
    if (showExplanation && response.source === 'gemini') {
      console.log('');
      console.log(chalk.blue('💡 Detailed Explanation:'));
      console.log(chalk.gray('This response was generated using AI analysis of your repository state and Git best practices.'));
    }
  }

  formatResponseText(text) {
    // Add some basic formatting for better readability
    return text
      .split('\\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => `  ${line}`)
      .join('\\n');
  }

  getConfidenceIcon(confidence) {
    switch (confidence) {
      case 'high': return '🎯';
      case 'medium': return '📊';
      case 'low': return '💭';
      default: return '❓';
    }
  }

  async explainConcept(concept) {
    console.log(chalk.blue(`📚 Git Concept: ${concept.toUpperCase()}`));
    console.log('');

    const explanation = await this.gemini.explainGitConcept(concept);
    
    console.log(chalk.green('Explanation:'));
    console.log(this.formatResponseText(explanation.explanation));
    console.log('');

    if (explanation.when_to_use) {
      console.log(chalk.cyan('When to use:'));
      console.log(this.formatResponseText(explanation.when_to_use));
      console.log('');
    }

    if (explanation.easygit_command) {
      console.log(chalk.blue('easygit command:'));
      console.log(chalk.gray(`  $ ${explanation.easygit_command}`));
      console.log('');
    }

    if (explanation.warning) {
      console.log(chalk.red('⚠️  Warning:'));
      console.log(this.formatResponseText(explanation.warning));
      console.log('');
    }
  }

  async showSmartSuggestions(repositoryState) {
    const suggestions = await this.gemini.getSmartSuggestions(repositoryState);
    
    if (suggestions.length === 0) {
      return;
    }

    console.log('');
    console.log(chalk.blue('🔮 Smart Suggestions:'));
    
    suggestions.forEach(suggestion => {
      const priorityIcon = this.getPriorityIcon(suggestion.priority);
      console.log(`${priorityIcon} ${suggestion.description}`);
      console.log(chalk.gray(`   $ ${suggestion.command}`));
    });
  }

  getPriorityIcon(priority) {
    switch (priority) {
      case 'high': return chalk.red('🔴');
      case 'medium': return chalk.yellow('🟡');
      case 'low': return chalk.green('🟢');
      default: return chalk.gray('⚪');
    }
  }
}

module.exports = AskCommand;

