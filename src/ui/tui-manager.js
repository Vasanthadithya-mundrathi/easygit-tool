const blessed = require('blessed');
const contrib = require('blessed-contrib');
const chalk = require('chalk');
const ora = require('ora');
const boxen = require('boxen');
const gradient = require('gradient-string');
const figlet = require('figlet');

class TUIManager {
  constructor() {
    this.screen = null;
    this.isInteractive = false;
    this.currentInterface = null;
  }

  createScreen() {
    if (this.screen) {
      return this.screen;
    }

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'easygit - Intelligent Git Tool',
      dockBorders: true,
      fullUnicode: true,
      autoPadding: true
    });

    // Handle screen exit
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.cleanup();
      process.exit(0);
    });

    return this.screen;
  }

  cleanup() {
    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }
    this.isInteractive = false;
    this.currentInterface = null;
  }

  showWelcomeBanner() {
    try {
      const banner = figlet.textSync('easygit', {
        font: 'Small',
        horizontalLayout: 'default',
        verticalLayout: 'default'
      });
      
      const coloredBanner = gradient.rainbow(banner);
      console.log('\n' + coloredBanner);
      console.log(chalk.cyan('🚀 Intelligent Git Tool with AI Assistance\n'));
    } catch (error) {
      // Fallback if figlet fails
      console.log(chalk.cyan.bold('\n🚀 easygit - Intelligent Git Tool\n'));
    }
  }

  showProgressSpinner(message, promise) {
    const spinner = ora({
      text: message,
      spinner: 'dots',
      color: 'cyan'
    }).start();

    return promise
      .then(result => {
        spinner.succeed(chalk.green(`✓ ${message}`));
        return result;
      })
      .catch(error => {
        spinner.fail(chalk.red(`✗ ${message}`));
        throw error;
      });
  }

  showInfoBox(title, content, options = {}) {
    const boxOptions = {
      title: title,
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: options.color || 'cyan',
      ...options
    };

    console.log('\n' + boxen(content, boxOptions));
  }

  showSuccessMessage(message) {
    this.showInfoBox('✅ Success', message, { borderColor: 'green' });
  }

  showWarningMessage(message) {
    this.showInfoBox('⚠️  Warning', message, { borderColor: 'yellow' });
  }

  showErrorMessage(message) {
    this.showInfoBox('❌ Error', message, { borderColor: 'red' });
  }

  async showInteractiveRebase(commits) {
    return new Promise((resolve, reject) => {
      try {
        const screen = this.createScreen();
        this.isInteractive = true;

        // Create main container
        const container = blessed.box({
          parent: screen,
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          border: {
            type: 'line'
          },
          style: {
            border: {
              fg: 'cyan'
            }
          }
        });

        // Title
        const title = blessed.text({
          parent: container,
          top: 1,
          left: 'center',
          content: chalk.bold.cyan('Interactive Rebase'),
          style: {
            fg: 'cyan',
            bold: true
          }
        });

        // Instructions
        const instructions = blessed.text({
          parent: container,
          top: 3,
          left: 2,
          content: 'Use ↑/↓ to navigate, SPACE to change action, ENTER to confirm, ESC to cancel',
          style: {
            fg: 'yellow'
          }
        });

        // Commits list
        const commitsList = blessed.list({
          parent: container,
          top: 5,
          left: 2,
          width: '96%',
          height: '70%',
          border: {
            type: 'line'
          },
          style: {
            border: {
              fg: 'white'
            },
            selected: {
              bg: 'blue',
              fg: 'white'
            }
          },
          keys: true,
          vi: true,
          mouse: true,
          scrollable: true,
          alwaysScroll: true
        });

        // Populate commits
        const actions = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];
        const commitData = commits.map(commit => ({
          action: 'pick',
          hash: commit.hash,
          message: commit.message
        }));

        const updateCommitsList = () => {
          const items = commitData.map((commit, index) => {
            const actionColor = {
              'pick': 'green',
              'reword': 'yellow',
              'edit': 'cyan',
              'squash': 'magenta',
              'fixup': 'blue',
              'drop': 'red'
            }[commit.action] || 'white';

            return `${chalk[actionColor](commit.action.padEnd(8))} ${commit.hash.substring(0, 8)} ${commit.message}`;
          });
          commitsList.setItems(items);
          screen.render();
        };

        updateCommitsList();

        // Handle space key to cycle actions
        commitsList.key('space', () => {
          const selected = commitsList.selected;
          const currentAction = commitData[selected].action;
          const currentIndex = actions.indexOf(currentAction);
          const nextIndex = (currentIndex + 1) % actions.length;
          commitData[selected].action = actions[nextIndex];
          updateCommitsList();
        });

        // Handle enter to confirm
        commitsList.key('enter', () => {
          this.cleanup();
          resolve(commitData);
        });

        // Handle escape to cancel
        commitsList.key('escape', () => {
          this.cleanup();
          reject(new Error('Rebase cancelled by user'));
        });

        // Action legend
        const legend = blessed.text({
          parent: container,
          bottom: 2,
          left: 2,
          content: 'Actions: pick (use), reword (edit message), edit (stop for amending), squash (combine), fixup (combine, discard message), drop (remove)',
          style: {
            fg: 'gray'
          }
        });

        commitsList.focus();
        screen.render();

      } catch (error) {
        this.cleanup();
        reject(error);
      }
    });
  }

  async showBranchSelector(branches, currentBranch) {
    return new Promise((resolve, reject) => {
      try {
        const screen = this.createScreen();
        this.isInteractive = true;

        // Create main container
        const container = blessed.box({
          parent: screen,
          top: 'center',
          left: 'center',
          width: '80%',
          height: '60%',
          border: {
            type: 'line'
          },
          style: {
            border: {
              fg: 'cyan'
            }
          }
        });

        // Title
        const title = blessed.text({
          parent: container,
          top: 1,
          left: 'center',
          content: chalk.bold.cyan('Select Branch'),
          style: {
            fg: 'cyan',
            bold: true
          }
        });

        // Search box
        const searchBox = blessed.textbox({
          parent: container,
          top: 3,
          left: 2,
          width: '96%',
          height: 3,
          border: {
            type: 'line'
          },
          style: {
            border: {
              fg: 'yellow'
            }
          },
          inputOnFocus: true,
          placeholder: 'Type to search branches...'
        });

        // Branches list
        const branchList = blessed.list({
          parent: container,
          top: 7,
          left: 2,
          width: '96%',
          height: '70%',
          border: {
            type: 'line'
          },
          style: {
            border: {
              fg: 'white'
            },
            selected: {
              bg: 'blue',
              fg: 'white'
            }
          },
          keys: true,
          vi: true,
          mouse: true,
          scrollable: true
        });

        let filteredBranches = branches;

        const updateBranchList = (filter = '') => {
          filteredBranches = branches.filter(branch => 
            branch.toLowerCase().includes(filter.toLowerCase())
          );

          const items = filteredBranches.map(branch => {
            if (branch === currentBranch) {
              return `${chalk.green('* ' + branch)} ${chalk.gray('(current)')}`;
            }
            return `  ${branch}`;
          });

          branchList.setItems(items);
          screen.render();
        };

        updateBranchList();

        // Handle search input
        searchBox.on('submit', (value) => {
          updateBranchList(value);
          branchList.focus();
        });

        searchBox.on('keypress', (ch, key) => {
          if (key.name === 'escape') {
            this.cleanup();
            reject(new Error('Branch selection cancelled'));
          }
        });

        // Handle branch selection
        branchList.key('enter', () => {
          const selected = branchList.selected;
          const selectedBranch = filteredBranches[selected];
          this.cleanup();
          resolve(selectedBranch);
        });

        branchList.key('escape', () => {
          this.cleanup();
          reject(new Error('Branch selection cancelled'));
        });

        searchBox.focus();
        screen.render();

      } catch (error) {
        this.cleanup();
        reject(error);
      }
    });
  }

  async showConflictResolution(conflicts) {
    return new Promise((resolve, reject) => {
      try {
        const screen = this.createScreen();
        this.isInteractive = true;

        // Create main container
        const container = blessed.box({
          parent: screen,
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          border: {
            type: 'line'
          },
          style: {
            border: {
              fg: 'red'
            }
          }
        });

        // Title
        const title = blessed.text({
          parent: container,
          top: 1,
          left: 'center',
          content: chalk.bold.red('Merge Conflict Resolution'),
          style: {
            fg: 'red',
            bold: true
          }
        });

        // Instructions
        const instructions = blessed.text({
          parent: container,
          top: 3,
          left: 2,
          content: 'Resolve conflicts in your editor, then press ENTER to continue or ESC to abort',
          style: {
            fg: 'yellow'
          }
        });

        // Conflicts list
        const conflictsList = blessed.list({
          parent: container,
          top: 5,
          left: 2,
          width: '96%',
          height: '80%',
          border: {
            type: 'line'
          },
          style: {
            border: {
              fg: 'white'
            }
          },
          items: conflicts.map(file => `${chalk.red('✗')} ${file}`)
        });

        // Handle enter to continue
        screen.key('enter', () => {
          this.cleanup();
          resolve('continue');
        });

        // Handle escape to abort
        screen.key('escape', () => {
          this.cleanup();
          resolve('abort');
        });

        screen.render();

      } catch (error) {
        this.cleanup();
        reject(error);
      }
    });
  }

  showRepositoryStatus(status) {
    const { branch, ahead, behind, modified, staged, untracked } = status;
    
    console.log(chalk.bold.cyan('\n📊 Repository Status\n'));
    
    // Branch info
    console.log(chalk.yellow('Branch:'), chalk.green(branch));
    
    if (ahead > 0) {
      console.log(chalk.yellow('Ahead:'), chalk.green(`${ahead} commits`));
    }
    
    if (behind > 0) {
      console.log(chalk.yellow('Behind:'), chalk.red(`${behind} commits`));
    }
    
    // Changes
    if (staged.length > 0) {
      console.log(chalk.yellow('\nStaged files:'));
      staged.forEach(file => console.log(chalk.green(`  + ${file}`)));
    }
    
    if (modified.length > 0) {
      console.log(chalk.yellow('\nModified files:'));
      modified.forEach(file => console.log(chalk.red(`  M ${file}`)));
    }
    
    if (untracked.length > 0) {
      console.log(chalk.yellow('\nUntracked files:'));
      untracked.forEach(file => console.log(chalk.gray(`  ? ${file}`)));
    }
    
    if (staged.length === 0 && modified.length === 0 && untracked.length === 0) {
      console.log(chalk.green('\n✅ Working directory clean'));
    }
    
    console.log('');
  }

  showCommandHelp(command, description, options = [], examples = []) {
    console.log(chalk.bold.cyan(`\n📖 ${command}\n`));
    console.log(description);
    
    if (options.length > 0) {
      console.log(chalk.yellow('\nOptions:'));
      options.forEach(option => {
        console.log(`  ${chalk.green(option.flag.padEnd(20))} ${option.description}`);
      });
    }
    
    if (examples.length > 0) {
      console.log(chalk.yellow('\nExamples:'));
      examples.forEach(example => {
        console.log(`  ${chalk.gray('$')} ${chalk.green(example.command)}`);
        if (example.description) {
          console.log(`    ${chalk.gray(example.description)}`);
        }
      });
    }
    
    console.log('');
  }

  async promptConfirmation(message, defaultValue = false) {
    return new Promise((resolve) => {
      const screen = this.createScreen();
      
      const dialog = blessed.question({
        parent: screen,
        top: 'center',
        left: 'center',
        width: '60%',
        height: 'shrink',
        border: {
          type: 'line'
        },
        style: {
          border: {
            fg: 'yellow'
          }
        }
      });

      dialog.ask(message + ` (${defaultValue ? 'Y/n' : 'y/N'}): `, (err, value) => {
        this.cleanup();
        if (err) {
          resolve(defaultValue);
          return;
        }
        
        const answer = value.toLowerCase().trim();
        if (answer === '') {
          resolve(defaultValue);
        } else {
          resolve(answer === 'y' || answer === 'yes');
        }
      });
    });
  }
}

module.exports = TUIManager;

