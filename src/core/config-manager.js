const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chalk = require('chalk');

class ConfigManager {
  constructor() {
    this.globalConfigPath = path.join(os.homedir(), '.easygit', 'config.json');
    this.localConfigPath = path.join(process.cwd(), '.easygit', 'config.json');
    this.hooksConfigPath = path.join(process.cwd(), '.easygit', 'hooks.json');
    
    this.defaultConfig = {
      core: {
        editor: process.env.EDITOR || 'vim',
        defaultBranch: 'main',
        syncStrategy: 'rebase', // or 'merge'
        autoStash: true,
        confirmDestructive: true
      },
      ui: {
        theme: 'auto', // 'light', 'dark', 'auto'
        progressBars: true,
        fuzzyFinder: true,
        colorOutput: true,
        compactStatus: false
      },
      ai: {
        enabled: true,
        explainByDefault: false,
        learningMode: true,
        provider: 'gemini', // 'gemini', 'openai', 'local'
        maxTokens: 1000
      },
      performance: {
        monorepoMode: 'auto', // 'auto', 'enabled', 'disabled'
        fsmonitor: true,
        commitGraph: true,
        cacheTimeout: 300, // seconds
        maxCacheSize: 100 // MB
      },
      team: {
        protectedBranches: ['main', 'master', 'develop'],
        requireIssueId: false,
        commitMessageFormat: 'free', // 'conventional', 'free', 'custom'
        enforceLinearHistory: false
      },
      hooks: {
        preCommit: [],
        postCommit: [],
        prePush: [],
        postMerge: []
      },
      aliases: {},
      experimental: {
        betaFeatures: false,
        telemetry: false
      }
    };

    this.config = null;
    this.configLoaded = false;
  }

  async loadConfig() {
    if (this.configLoaded) {
      return this.config;
    }

    try {
      // Start with default configuration
      this.config = JSON.parse(JSON.stringify(this.defaultConfig));

      // Load and merge global configuration
      const globalConfig = await this.loadConfigFile(this.globalConfigPath);
      if (globalConfig) {
        this.config = this.mergeConfigs(this.config, globalConfig);
      }

      // Load and merge local repository configuration
      const localConfig = await this.loadConfigFile(this.localConfigPath);
      if (localConfig) {
        this.config = this.mergeConfigs(this.config, localConfig);
      }

      // Load hooks configuration separately
      const hooksConfig = await this.loadConfigFile(this.hooksConfigPath);
      if (hooksConfig) {
        this.config.hooks = { ...this.config.hooks, ...hooksConfig };
      }

      // Apply environment variable overrides
      this.applyEnvironmentOverrides();

      this.configLoaded = true;
      return this.config;
    } catch (error) {
      console.warn(chalk.yellow('Warning: Could not load configuration, using defaults'));
      this.config = this.defaultConfig;
      this.configLoaded = true;
      return this.config;
    }
  }

  async loadConfigFile(configPath) {
    try {
      const content = await fs.readFile(configPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(chalk.yellow(`Warning: Could not parse config file ${configPath}`));
      }
      return null;
    }
  }

  mergeConfigs(base, override) {
    const result = { ...base };
    
    for (const [key, value] of Object.entries(override)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.mergeConfigs(result[key] || {}, value);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  applyEnvironmentOverrides() {
    // Apply environment variable overrides
    const envMappings = {
      'EASYGIT_EDITOR': 'core.editor',
      'EASYGIT_DEFAULT_BRANCH': 'core.defaultBranch',
      'EASYGIT_SYNC_STRATEGY': 'core.syncStrategy',
      'EASYGIT_AI_ENABLED': 'ai.enabled',
      'EASYGIT_AI_PROVIDER': 'ai.provider',
      'EASYGIT_THEME': 'ui.theme',
      'EASYGIT_NO_COLOR': 'ui.colorOutput',
      'EASYGIT_MONOREPO_MODE': 'performance.monorepoMode'
    };

    for (const [envVar, configPath] of Object.entries(envMappings)) {
      const envValue = process.env[envVar];
      if (envValue !== undefined) {
        this.setNestedValue(this.config, configPath, this.parseEnvValue(envValue));
      }
    }
  }

  parseEnvValue(value) {
    // Parse environment variable values to appropriate types
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    if (!isNaN(value) && !isNaN(parseFloat(value))) return parseFloat(value);
    return value;
  }

  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  async get(path, defaultValue = undefined) {
    await this.loadConfig();
    
    const keys = path.split('.');
    let current = this.config;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return defaultValue;
      }
    }
    
    return current;
  }

  async set(path, value, scope = 'global') {
    await this.loadConfig();
    
    // Update in-memory configuration
    this.setNestedValue(this.config, path, value);
    
    // Determine which config file to update
    const configPath = scope === 'local' ? this.localConfigPath : this.globalConfigPath;
    
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      
      // Load existing config file
      let existingConfig = await this.loadConfigFile(configPath) || {};
      
      // Update the specific value
      this.setNestedValue(existingConfig, path, value);
      
      // Write back to file
      await fs.writeFile(configPath, JSON.stringify(existingConfig, null, 2));
      
      console.log(chalk.green(`✓ Configuration updated: ${path} = ${value}`));
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error.message}`);
    }
  }

  async initializeGlobalConfig() {
    try {
      const configDir = path.dirname(this.globalConfigPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // Check if config already exists
      try {
        await fs.access(this.globalConfigPath);
        return; // Config already exists
      } catch (error) {
        // Config doesn't exist, create it
      }
      
      await fs.writeFile(this.globalConfigPath, JSON.stringify(this.defaultConfig, null, 2));
      console.log(chalk.green(`✓ Created global configuration at ${this.globalConfigPath}`));
    } catch (error) {
      console.warn(chalk.yellow(`Warning: Could not create global config: ${error.message}`));
    }
  }

  async initializeLocalConfig(projectConfig = {}) {
    try {
      const configDir = path.dirname(this.localConfigPath);
      await fs.mkdir(configDir, { recursive: true });
      
      const localConfig = {
        team: {
          protectedBranches: projectConfig.protectedBranches || ['main'],
          requireIssueId: projectConfig.requireIssueId || false,
          commitMessageFormat: projectConfig.commitMessageFormat || 'free'
        },
        hooks: projectConfig.hooks || {}
      };
      
      await fs.writeFile(this.localConfigPath, JSON.stringify(localConfig, null, 2));
      console.log(chalk.green(`✓ Created local project configuration`));
    } catch (error) {
      throw new Error(`Failed to create local configuration: ${error.message}`);
    }
  }

  async getProtectedBranches() {
    return await this.get('team.protectedBranches', ['main', 'master']);
  }

  async isProtectedBranch(branchName) {
    const protectedBranches = await this.getProtectedBranches();
    return protectedBranches.includes(branchName);
  }

  async getSyncStrategy() {
    return await this.get('core.syncStrategy', 'rebase');
  }

  async shouldConfirmDestructive() {
    return await this.get('core.confirmDestructive', true);
  }

  async isAIEnabled() {
    return await this.get('ai.enabled', true);
  }

  async getAIProvider() {
    return await this.get('ai.provider', 'gemini');
  }

  async isMonorepoModeEnabled() {
    const mode = await this.get('performance.monorepoMode', 'auto');
    return mode === 'enabled' || mode === true;
  }

  async shouldAutoDetectMonorepo() {
    const mode = await this.get('performance.monorepoMode', 'auto');
    return mode === 'auto';
  }

  async getHooks(hookType) {
    return await this.get(`hooks.${hookType}`, []);
  }

  async addHook(hookType, command) {
    const currentHooks = await this.getHooks(hookType);
    if (!currentHooks.includes(command)) {
      currentHooks.push(command);
      await this.set(`hooks.${hookType}`, currentHooks, 'local');
    }
  }

  async removeHook(hookType, command) {
    const currentHooks = await this.getHooks(hookType);
    const updatedHooks = currentHooks.filter(hook => hook !== command);
    await this.set(`hooks.${hookType}`, updatedHooks, 'local');
  }

  async getAlias(name) {
    const aliases = await this.get('aliases', {});
    return aliases[name];
  }

  async setAlias(name, commands) {
    const aliases = await this.get('aliases', {});
    aliases[name] = commands;
    await this.set('aliases', aliases);
  }

  async listAliases() {
    return await this.get('aliases', {});
  }

  async validateConfig() {
    await this.loadConfig();
    
    const issues = [];
    
    // Validate sync strategy
    const syncStrategy = await this.getSyncStrategy();
    if (!['rebase', 'merge'].includes(syncStrategy)) {
      issues.push(`Invalid sync strategy: ${syncStrategy}. Must be 'rebase' or 'merge'.`);
    }
    
    // Validate AI provider
    const aiProvider = await this.getAIProvider();
    if (!['gemini', 'openai', 'local'].includes(aiProvider)) {
      issues.push(`Invalid AI provider: ${aiProvider}. Must be 'gemini', 'openai', or 'local'.`);
    }
    
    // Validate theme
    const theme = await this.get('ui.theme');
    if (!['light', 'dark', 'auto'].includes(theme)) {
      issues.push(`Invalid theme: ${theme}. Must be 'light', 'dark', or 'auto'.`);
    }
    
    // Validate monorepo mode
    const monorepoMode = await this.get('performance.monorepoMode');
    if (!['auto', 'enabled', 'disabled', true, false].includes(monorepoMode)) {
      issues.push(`Invalid monorepo mode: ${monorepoMode}. Must be 'auto', 'enabled', or 'disabled'.`);
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }

  async exportConfig() {
    await this.loadConfig();
    return {
      global: await this.loadConfigFile(this.globalConfigPath),
      local: await this.loadConfigFile(this.localConfigPath),
      hooks: await this.loadConfigFile(this.hooksConfigPath),
      effective: this.config
    };
  }

  async resetConfig(scope = 'global') {
    const configPath = scope === 'local' ? this.localConfigPath : this.globalConfigPath;
    
    try {
      await fs.unlink(configPath);
      this.configLoaded = false; // Force reload on next access
      console.log(chalk.green(`✓ Reset ${scope} configuration`));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Failed to reset configuration: ${error.message}`);
      }
    }
  }
}

module.exports = ConfigManager;

