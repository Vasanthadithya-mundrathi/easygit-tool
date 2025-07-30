const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class GeminiIntegration {
  constructor() {
    this.isAvailable = false;
    this.initializeGemini();
  }

  async initializeGemini() {
    try {
      // Check if gemini CLI is available
      const result = await this.executeCommand('which gemini');
      this.isAvailable = result.code === 0;
      
      if (this.isAvailable) {
        console.log(chalk.green('✓ Gemini CLI found and ready'));
      } else {
        console.log(chalk.yellow('⚠️  Gemini CLI not found. Using fallback responses.'));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️  Gemini CLI not available. Using fallback responses.'));
      this.isAvailable = false;
    }
  }

  async executeCommand(command, timeout = 30000) {
    return new Promise((resolve) => {
      const process = spawn('sh', ['-c', command], {
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        process.kill();
        resolve({ code: 1, stdout: '', stderr: 'Command timeout' });
      }, timeout);

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });

      process.on('error', (error) => {
        clearTimeout(timer);
        resolve({ code: 1, stdout: '', stderr: error.message });
      });
    });
  }

  async askGemini(question, context = {}) {
    if (!this.isAvailable) {
      return this.getFallbackResponse(question);
    }

    try {
      // Prepare context for Gemini
      const contextPrompt = this.buildContextPrompt(question, context);
      
      // Create a temporary file for the prompt to avoid shell escaping issues
      const tempFile = `/tmp/gemini_prompt_${Date.now()}.txt`;
      await fs.writeFile(tempFile, contextPrompt);
      
      // Use Gemini CLI to get response
      const result = await this.executeCommand(`gemini --prompt "$(cat "${tempFile}")"`, 45000);
      
      // Clean up temp file
      try {
        await fs.unlink(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      if (result.code === 0 && result.stdout.trim()) {
        return this.parseGeminiResponse(result.stdout);
      } else {
        console.log(chalk.yellow('⚠️  Gemini API error, using fallback response'));
        console.log(chalk.gray(`Error: ${result.stderr}`));
        return this.getFallbackResponse(question);
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️  Gemini API error, using fallback response'));
      return this.getFallbackResponse(question);
    }
  }

  buildContextPrompt(question, context) {
    const { repositoryState, currentBranch, uncommittedChanges, recentCommits } = context;
    
    let prompt = `You are an expert Git assistant integrated into the 'easygit' tool. `;
    prompt += `Provide concise, actionable advice for Git operations. `;
    prompt += `Always suggest specific easygit commands when applicable.\n\n`;
    
    if (repositoryState) {
      prompt += `Repository Context:\n`;
      prompt += `- Current branch: ${currentBranch || 'unknown'}\n`;
      prompt += `- Uncommitted changes: ${uncommittedChanges ? 'Yes' : 'No'}\n`;
      
      if (recentCommits && recentCommits.length > 0) {
        prompt += `- Recent commits:\n`;
        recentCommits.slice(0, 3).forEach(commit => {
          prompt += `  * ${commit.hash.substring(0, 8)}: ${commit.message}\n`;
        });
      }
    }
    
    prompt += `\nUser Question: ${question}\n\n`;
    prompt += `Please provide a helpful response that includes:\n`;
    prompt += `1. A clear explanation of the solution\n`;
    prompt += `2. Specific easygit commands to use (if applicable)\n`;
    prompt += `3. Any warnings or considerations\n\n`;
    prompt += `Keep the response concise and practical. Focus on easygit commands over raw git commands.`;
    
    return prompt;
  }

  parseGeminiResponse(rawResponse) {
    // Clean up the response
    let response = rawResponse.trim();
    
    // Remove any markdown formatting for terminal display
    response = response.replace(/\*\*(.*?)\*\*/g, '$1'); // Bold
    response = response.replace(/\*(.*?)\*/g, '$1'); // Italic
    response = response.replace(/`(.*?)`/g, '$1'); // Code
    
    // Extract commands from the response
    const commands = [];
    const commandRegex = /easygit\s+[a-zA-Z-]+(?:\s+[^\n]*)?/g;
    const matches = response.match(commandRegex);
    if (matches) {
      commands.push(...matches.map(cmd => cmd.trim()));
    }
    
    return {
      answer: response,
      commands: commands,
      source: 'gemini',
      confidence: 'high'
    };
  }

  getFallbackResponse(question) {
    const q = question.toLowerCase();
    
    const responses = {
      // Commit related
      'commit': {
        answer: 'Use "easygit save [message]" to intelligently stage and commit changes. It includes pre-flight checks for large files, sensitive data, and protected branches.',
        commands: ['easygit save "your commit message"'],
        confidence: 'medium'
      },
      
      // Undo operations
      'undo': {
        answer: 'Use "easygit undo --commit [count]" to safely undo commits. For merge commits, use "easygit undo --merge". Always confirms before making changes.',
        commands: ['easygit undo --commit 1', 'easygit undo --merge'],
        confidence: 'medium'
      },
      
      // Branch operations
      'branch': {
        answer: 'Use "easygit switch [branch]" for intelligent branch switching with fuzzy finding. It automatically stashes uncommitted changes.',
        commands: ['easygit switch', 'easygit switch main'],
        confidence: 'medium'
      },
      
      // Merge conflicts
      'conflict': {
        answer: 'Use "easygit sync" to handle merge conflicts with guided resolution. It provides step-by-step conflict resolution assistance.',
        commands: ['easygit sync'],
        confidence: 'medium'
      },
      
      // Synchronization
      'sync': {
        answer: 'Use "easygit sync" to intelligently synchronize with remote repositories. It handles both pulling and pushing with conflict detection.',
        commands: ['easygit sync'],
        confidence: 'medium'
      },
      
      // Status and health
      'status': {
        answer: 'Use "easygit status" for enhanced repository status with intelligent insights, or "easygit doctor" for comprehensive health checks.',
        commands: ['easygit status', 'easygit doctor'],
        confidence: 'medium'
      },

      // Rebase operations
      'rebase': {
        answer: 'Use "easygit rebase" for interactive rebase with visual interface. It provides step-by-step guidance for complex rebase operations.',
        commands: ['easygit rebase', 'easygit rebase --interactive'],
        confidence: 'medium'
      }
    };

    // Find best matching response
    for (const [key, response] of Object.entries(responses)) {
      if (q.includes(key)) {
        return {
          answer: response.answer,
          commands: response.commands || [],
          source: 'fallback',
          confidence: response.confidence
        };
      }
    }

    // Default response
    return {
      answer: 'I can help with Git operations! Try asking about commits, branches, merging, conflicts, or synchronization. For specific help, use commands like "easygit status" or "easygit doctor".',
      commands: ['easygit status', 'easygit doctor', 'easygit --help'],
      source: 'fallback',
      confidence: 'low'
    };
  }

  async getSmartSuggestions(repositoryState) {
    const suggestions = [];
    
    if (repositoryState.uncommittedChanges) {
      suggestions.push({
        action: 'commit',
        command: 'easygit save',
        description: 'Commit your uncommitted changes',
        priority: 'high'
      });
    }
    
    if (repositoryState.behind > 0) {
      suggestions.push({
        action: 'sync',
        command: 'easygit sync',
        description: `Pull ${repositoryState.behind} commits from remote`,
        priority: 'medium'
      });
    }
    
    if (repositoryState.ahead > 0) {
      suggestions.push({
        action: 'push',
        command: 'easygit sync',
        description: `Push ${repositoryState.ahead} commits to remote`,
        priority: 'medium'
      });
    }
    
    if (repositoryState.stashCount > 0) {
      suggestions.push({
        action: 'stash',
        command: 'git stash pop',
        description: `You have ${repositoryState.stashCount} stashed changes`,
        priority: 'low'
      });
    }
    
    return suggestions;
  }

  async explainGitConcept(concept) {
    if (this.isAvailable) {
      try {
        const prompt = `Explain the Git concept "${concept}" in detail. Include when to use it, how it works, and any warnings or best practices. Focus on practical usage.`;
        const tempFile = `/tmp/gemini_concept_${Date.now()}.txt`;
        await fs.writeFile(tempFile, prompt);
        
        const result = await this.executeCommand(`gemini --prompt "$(cat "${tempFile}")"`, 30000);
        
        try {
          await fs.unlink(tempFile);
        } catch (e) {
          // Ignore cleanup errors
        }
        
        if (result.code === 0 && result.stdout.trim()) {
          const response = result.stdout.trim();
          return {
            explanation: response,
            when_to_use: 'See explanation above',
            easygit_command: this.getEasygitCommandForConcept(concept),
            warning: 'Always be careful with Git operations that rewrite history'
          };
        }
      } catch (error) {
        // Fall through to fallback
      }
    }
    
    // Fallback concepts
    const concepts = {
      'rebase': {
        explanation: 'Rebase replays commits from one branch onto another, creating a linear history. Unlike merge, it does not create merge commits.',
        when_to_use: 'Use rebase to keep a clean, linear history when integrating feature branches.',
        easygit_command: 'easygit rebase',
        warning: 'Never rebase commits that have been pushed to shared repositories.'
      },
      
      'merge': {
        explanation: 'Merge combines changes from different branches, preserving the branching history with merge commits.',
        when_to_use: 'Use merge when you want to preserve the context of feature development.',
        easygit_command: 'easygit sync --merge',
        warning: 'Merge conflicts may occur when the same lines are modified in both branches.'
      },
      
      'stash': {
        explanation: 'Stash temporarily saves uncommitted changes, allowing you to switch branches or pull updates.',
        when_to_use: 'Use stash when you need to quickly switch contexts without committing incomplete work.',
        easygit_command: 'Automatic stashing in easygit switch and easygit sync',
        warning: 'Stashed changes are local and not backed up to remote repositories.'
      },
      
      'reset': {
        explanation: 'Reset moves the current branch pointer to a different commit, potentially changing the working directory.',
        when_to_use: 'Use reset to undo commits or unstage changes.',
        easygit_command: 'easygit undo --commit [count]',
        warning: 'Hard reset permanently discards changes. Use with caution.'
      }
    };
    
    const conceptInfo = concepts[concept.toLowerCase()];
    if (conceptInfo) {
      return conceptInfo;
    }
    
    return {
      explanation: `I don't have detailed information about "${concept}". Try asking about specific Git operations like rebase, merge, stash, or reset.`,
      when_to_use: '',
      easygit_command: 'easygit ask "explain [concept]"',
      warning: ''
    };
  }

  getEasygitCommandForConcept(concept) {
    const commandMap = {
      'rebase': 'easygit rebase',
      'merge': 'easygit sync --merge',
      'stash': 'easygit switch (auto-stashing)',
      'reset': 'easygit undo',
      'commit': 'easygit save',
      'push': 'easygit sync',
      'pull': 'easygit sync',
      'branch': 'easygit switch',
      'status': 'easygit status'
    };
    
    return commandMap[concept.toLowerCase()] || 'easygit --help';
  }
}

module.exports = GeminiIntegration;

