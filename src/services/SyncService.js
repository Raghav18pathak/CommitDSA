// @ts-check

import { NetworkError, InvalidTokenError, RepoNotFoundError, RateLimitError } from '../utils/errors.js';
import { Logger } from '../utils/Logger.js';
import { decodeBase64, encodeBase64, updateReadmeTable } from '../utils/readme.js';

const log = new Logger('SyncService');

export class SyncService {
  static readmeQueue = Promise.resolve();
  /**
   * Pushes a file payload directly to GitHub.
   * Strictly acts as a network caller; formatting/casing is delegated to utilities.
   * 
   * @param {Object} payload - Pre-formatted solution payload.
   * @param {string} payload.path - Relative target repository path (e.g. 'Easy/LC-0001-Two-Sum/solution.py').
   * @param {string} payload.content - Formatted file content string.
   * @param {string} payload.commitMessage - Commit message text.
   * @param {Object} config - Config settings.
   * @param {string} config.githubToken - GitHub Personal Access Token.
   * @param {string} config.githubRepo - target repository 'username/repo'.
   * @param {string} [config.githubBranch] - Optional target branch name (defaults to 'main').
   * @returns {Promise<boolean>} Resolves to true on successful push.
   * @throws {InvalidTokenError | RepoNotFoundError | RateLimitError | NetworkError | Error}
   */
  static async pushToGitHub(payload, config) {
    const { path, content, commitMessage } = payload;
    const { githubToken, githubRepo, githubBranch = 'main' } = config;

    const authHeader = `token ${githubToken}`;
    const baseUrl = `https://api.github.com/repos/${githubRepo}/contents/${path}`;
    
    // Add branch ref to the GET request if checking existence
    const getUrl = githubBranch ? `${baseUrl}?ref=${encodeURIComponent(githubBranch)}` : baseUrl;

    log.debug(`Syncing solution to GitHub path: ${path} | Branch: ${githubBranch}`);

    let getRes;
    try {
      getRes = await fetch(getUrl, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
    } catch (err) {
      log.warn('GitHub API fetch failed (network offline):', err);
      throw new NetworkError();
    }

    // Handle initial auth or path issues
    if (!getRes.ok && getRes.status !== 404) {
      await this._handleHttpError(getRes);
    }

    let sha = null;
    if (getRes.ok) {
      try {
        const getJson = await getRes.json();
        sha = getJson.sha;
      } catch (e) {
        log.warn('Failed to parse GET content JSON:', e);
      }
    }

    // Construct the commit request body
    const body = {
      message: commitMessage,
      content: encodeBase64(content),
    };
    if (sha) body.sha = sha;
    if (githubBranch) body.branch = githubBranch;

    let putRes;
    try {
      putRes = await fetch(baseUrl, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      log.warn('GitHub API PUT failed (network offline):', err);
      throw new NetworkError();
    }

    if (!putRes.ok) {
      await this._handleHttpError(putRes);
    }

    log.info(`Pushed solution: ${path} successfully to branch: ${githubBranch}`);
    return true;
  }

  /**
   * Pushes the per-problem README beside its solution.
   *
   * @param {Object} solvedProblem
   * @param {string} solutionPath
   * @param {Object} config
   * @returns {Promise<boolean>}
   */
  static async pushProblemReadme(solvedProblem, solutionPath, config) {
    const folder = solutionPath.split('/').slice(0, -1).join('/');
    const statement = solvedProblem.statement || solvedProblem.problemStatement;
    const title = solvedProblem.title || solvedProblem.slug;
    const difficulty = solvedProblem.difficulty || 'Medium';
    const url = solvedProblem.url || '';
    const solutionFile = solutionPath.split('/').pop();
    let content = `# ${title}\n\n`;
    content += `- **Platform:** ${solvedProblem.platform}\n`;
    content += `- **Difficulty:** ${difficulty}\n`;
    content += `- **Problem:** [${url}](${url})\n`;
    content += `- **Solution:** [${solutionFile}](./${solutionFile})\n`;
    if (statement) content += `\n## Problem Statement\n\n${statement}\n`;

    return this.pushToGitHub({
      path: `${folder}/README.md`,
      content,
      commitMessage: `Docs ${solvedProblem.platform} - ${title}`
    }, config);
  }

  /**
   * Helper to map HTTP status codes to custom Operational Errors.
   * 
   * @private
   * @param {Response} response
   * @throws {InvalidTokenError | RepoNotFoundError | RateLimitError | Error}
   */
  static async _handleHttpError(response) {
    const status = response.status;
    let errorMsg = `GitHub API error (Status: ${status})`;
    try {
      const errorJson = await response.json();
      if (errorJson && errorJson.message) {
        errorMsg = errorJson.message;
      }
    } catch (e) {}

    if (status === 401 || status === 403) {
      throw new InvalidTokenError(errorMsg);
    }
    if (status === 404) {
      throw new RepoNotFoundError(errorMsg);
    }
    if (status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
      throw new RateLimitError(errorMsg, delaySeconds);
    }

    throw new Error(errorMsg);
  }

  /**
   * Updates the repository's README.md file with the solved problems portfolio.
   * 
   * @param {Array<Object>} completedItems - List of completed QueueItems.
   * @param {Object} config - Config settings.
   * @param {string} config.githubToken - GitHub Personal Access Token.
   * @param {string} config.githubRepo - target repository 'username/repo'.
   * @param {string} [config.githubBranch] - Optional target branch name (defaults to 'main').
   * @returns {Promise<boolean>}
   */
  static async updateReadme(completedItems, config) {
    const update = SyncService.readmeQueue.then(() => SyncService._updateReadme(completedItems, config));
    SyncService.readmeQueue = update.catch(() => {});
    return update;
  }

  /**
   * Performs one serialized README update.
   *
   * @private
   */
  static async _updateReadme(completedItems, config, retryCount = 0) {
    const { githubToken, githubRepo, githubBranch = 'main' } = config;
    if (!githubToken || !githubRepo) return false;

    const authHeader = `token ${githubToken}`;
    const baseUrl = `https://api.github.com/repos/${githubRepo}/contents/README.md`;
    const getUrl = githubBranch ? `${baseUrl}?ref=${encodeURIComponent(githubBranch)}` : baseUrl;

    log.debug(`Fetching README.md from repo to update portfolio...`);

    let getRes;
    let existingContent = '';
    let sha = null;

    try {
      getRes = await fetch(getUrl, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (getRes.ok) {
        const getJson = await getRes.json();
        sha = getJson.sha;
        // Decode base64 to string safely
        existingContent = decodeBase64(getJson.content);
      } else if (getRes.status !== 404) {
        // Log error and proceed, don't throw to avoid breaking main sync flow
        log.warn(`Failed to fetch README.md (Status: ${getRes.status})`);
        return false;
      }
    } catch (err) {
      log.warn('Failed to fetch README.md due to network/CORS error:', err);
      return false;
    }

    const updatedContent = updateReadmeTable(existingContent, completedItems);
    const body = {
      message: 'docs: update DSA solutions table [skip ci]',
      content: encodeBase64(updatedContent),
    };
    if (sha) body.sha = sha;
    if (githubBranch) body.branch = githubBranch;

    try {
      let putRes = await fetch(baseUrl, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!putRes.ok && (putRes.status === 409 || putRes.status === 422) && retryCount === 0) {
        return this._updateReadme(completedItems, config, 1);
      }
      if (!putRes.ok) {
        log.warn(`Failed to commit README.md update (Status: ${putRes.status})`);
        return false;
      }
      log.info('README.md portfolio updated successfully.');
      return true;
    } catch (err) {
      log.warn('Failed to commit README.md update due to network/CORS error:', err);
      return false;
    }
  }
}
