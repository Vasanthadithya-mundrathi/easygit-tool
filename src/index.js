#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

// Import command modules
const SaveCommand = require('./commands/save');
const SyncCommand = require('./commands/sync');
const SwitchCommand = require('./commands/switch');
const UpdateCommand = require('./commands/update');
const UndoCommand = require('./commands/undo');
const AskCommand = require('./commands/ask');
const DoctorCommand = require('./commands/doctor');
const StatusCommand = require('./commands/status');

// Import core modules
const GitRepository = require('./core/git-repository');
const ErrorHandler = require('./core/error-handler');
const ConfigManager = require('./core/config-manager');

class EasygitCLI {
  constructor() {
    this.program = new Command();
    this.gitRepo = null;
    this.errorHandler = new ErrorHandler();
    this.configManager = new ConfigManager();
    
    this.setupProgram();
    this.registerCommands();
  }

  setupProgram() {
    this.program
      .name('easygit')
      .description('An intelligent Git tool with error solutions and problem hints')
      .version('1.0.0')
      .option('-v, --verbose', 'Enable verbose output')
      .option('--no-color', 'Disable colored output')
      .hook('preAction', async (thisCommand) => {
        // Initialize Git repository context
        try {
          this.gitRepo = new GitRepository(process.cwd());
          await this.gitRepo.initialize();
        } catch (error) {
          if (error.message.includes('not a git repository')) {
            console.log(chalk.yellow('⚠️  Not in a Git repository. Some commands may not work.'));
          } else {
            console.error(chalk.red('Error initializing Git repository:'), error.message);
          }
        }
      });
  }

  registerCommands() {
    // Core commands
    new SaveCommand(this.program, this.gitRepo, this.errorHandler);
    new SyncCommand(this.program, this.gitRepo, this.errorHandler);
    new SwitchCommand(this.program, this.gitRepo, this.errorHandler);
    new UpdateCommand(this.program, this.gitRepo, this.errorHandler);
    new UndoCommand(this.program, this.gitRepo, this.errorHandler);
    new StatusCommand(this.program, this.gitRepo, this.errorHandler);
    
    // AI and diagnostic commands
    new AskCommand(this.program, this.gitRepo, this.errorHandler);
    new DoctorCommand(this.program, this.gitRepo, this.errorHandler);
  }

  async run() {
    try {
      await this.program.parseAsync(process.argv);
    } catch (error) {
      await this.errorHandler.handleError(error, this.gitRepo);
      process.exit(1);
    }
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught Exception:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled Rejection at:'), promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
const cli = new EasygitCLI();
cli.run();

