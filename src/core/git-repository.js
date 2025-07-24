const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;
const chalk = require('chalk');

class GitRepository {
  constructor(workingDir = process.cwd()) {
    this.workingDir = workingDir;
    this.git = simpleGit(workingDir);
    this.isInitialized = false;
    this.repositoryInfo = null;
  }

  async initialize() {
    try {
      // Check if we're in a git repository
      const status = await this.git.status();
      this.isInitialized = true;
      
      // Gather repository information
      await this.gatherRepositoryInfo();
      
      return true;
    } catch (error) {
      if (error.message.includes('not a git repository') || 
          error.message.includes('Not a git repository')) {
        throw new Error('not a git repository');
      }
      throw error;
    }
  }

  async gatherRepositoryInfo() {
    try {
      const [status, branches, remotes, tags] = await Promise.all([
        this.git.status(),
        this.git.branch(['--all']),
        this.git.getRemotes(true),
        this.git.tags()
      ]);

      this.repositoryInfo = {
        status,
        branches,
        remotes,
        tags,
        currentBranch: status.current,
        hasUncommittedChanges: !status.isClean(),
        ahead: status.ahead,
        behind: status.behind
      };
    } catch (error) {
      console.warn(chalk.yellow('Warning: Could not gather complete repository info'), error.message);
    }
  }

  async getStatus() {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.status();
  }

  async getCurrentBranch() {
    const status = await this.getStatus();
    return status.current;
  }

  async getBranches() {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.branch(['--all']);
  }

  async getRemotes() {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.getRemotes(true);
  }

  async hasUncommittedChanges() {
    const status = await this.getStatus();
    return !status.isClean();
  }

  async getModifiedFiles() {
    const status = await this.getStatus();
    return {
      modified: status.modified,
      created: status.created,
      deleted: status.deleted,
      renamed: status.renamed,
      staged: status.staged
    };
  }

  async addFiles(files = ['.']) {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.add(files);
  }

  async commit(message, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.commit(message, options);
  }

  async push(remote = 'origin', branch = null) {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    
    const currentBranch = branch || await this.getCurrentBranch();
    return await this.git.push(remote, currentBranch);
  }

  async pull(remote = 'origin', branch = null) {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    
    const currentBranch = branch || await this.getCurrentBranch();
    return await this.git.pull(remote, currentBranch);
  }

  async fetch(remote = 'origin') {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.fetch(remote);
  }

  async checkout(branchName) {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.checkout(branchName);
  }

  async createBranch(branchName, startPoint = null) {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    
    if (startPoint) {
      return await this.git.checkoutBranch(branchName, startPoint);
    } else {
      return await this.git.checkoutLocalBranch(branchName);
    }
  }

  async getCommitHistory(count = 10) {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.log({ maxCount: count });
  }

  async getLastCommit() {
    const log = await this.getCommitHistory(1);
    return log.latest;
  }

  async reset(mode = 'soft', commit = 'HEAD~1') {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.reset([`--${mode}`, commit]);
  }

  async stash(message = null) {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    
    if (message) {
      return await this.git.stash(['push', '-m', message]);
    } else {
      return await this.git.stash();
    }
  }

  async stashPop() {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.stash(['pop']);
  }

  async getStashList() {
    if (!this.isInitialized) {
      throw new Error('Repository not initialized');
    }
    return await this.git.stashList();
  }

  async isMonorepo() {
    try {
      const stats = await this.gatherRepoStats();
      
      const indicators = {
        fileCount: stats.fileCount > 10000,
        repoSize: stats.sizeInMB > 100,
        commitCount: stats.commitCount > 5000,
        branchCount: stats.branchCount > 50
      };
      
      const score = Object.values(indicators).filter(Boolean).length;
      return score >= 2; // Threshold for monorepo classification
    } catch (error) {
      return false;
    }
  }

  async gatherRepoStats() {
    const [log, branches] = await Promise.all([
      this.git.log(),
      this.git.branch(['--all'])
    ]);

    // Get file count (approximate)
    const lsFiles = await this.git.raw(['ls-files']);
    const fileCount = lsFiles.split('\n').filter(line => line.trim()).length;

    // Get repository size (approximate)
    let sizeInMB = 0;
    try {
      const gitDir = path.join(this.workingDir, '.git');
      const stats = await this.getDirectorySize(gitDir);
      sizeInMB = stats / (1024 * 1024);
    } catch (error) {
      // Fallback to 0 if we can't get size
    }

    return {
      fileCount,
      sizeInMB,
      commitCount: log.total,
      branchCount: branches.all.length
    };
  }

  async getDirectorySize(dirPath) {
    let totalSize = 0;
    
    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isDirectory()) {
          totalSize += await this.getDirectorySize(filePath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch (error) {
      // Ignore errors for inaccessible files/directories
    }
    
    return totalSize;
  }

  getRepositoryInfo() {
    return this.repositoryInfo;
  }

  isRepository() {
    return this.isInitialized;
  }
}

module.exports = GitRepository;

