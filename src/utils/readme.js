// @ts-check

import { getFolderCategory, getSyncPath } from './path.js';

export const README_START_MARKER = '<!-- DSA-TABLE-START -->';
export const README_END_MARKER = '<!-- DSA-TABLE-END -->';

/**
 * Encodes Unicode text for the GitHub Contents API.
 *
 * @param {string} value
 * @returns {string}
 */
export function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Decodes GitHub Contents API base64 content as UTF-8.
 *
 * @param {string} value
 * @returns {string}
 */
export function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * @typedef {Object} ReadmeRow
 * @property {string} title
 * @property {string} url
 * @property {string} platform
 * @property {string} difficulty
 * @property {string} solution
 */

/**
 * Builds a row from a completed queue item.
 *
 * @param {Object} item
 * @returns {ReadmeRow}
 */
export function readmeRowFromItem(item) {
  const p = item.payload || item;
  const solutionPath = p.customPath || getSyncPath(p.platform, p.difficulty, p.title, p.language, p.slug);
  const title = String(p.title || p.slug || 'Problem').replace(/\|/g, '\\|');
  const url = p.url || '';
  return {
    title,
    url,
    platform: p.platform.toLowerCase() === 'leetcode' ? 'LeetCode' : 'GeeksforGeeks',
    difficulty: getFolderCategory(p.platform, p.difficulty),
    solution: solutionPath
  };
}

/**
 * Parses rows from an existing DSA table.
 *
 * @param {string} content
 * @returns {Array<ReadmeRow>}
 */
export function parseReadmeRows(content) {
  return content.split(/\r?\n/)
    .map(line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(' | ').map(cell => cell.trim()))
    .filter(cells => cells.length === 5 && /^\d+$/.test(cells[0]))
    .map(cells => {
      const problem = cells[1].match(/^\[(.*?)\]\((.*?)\)$/);
      const solution = cells[4].match(/^\[(?:Solution|Code)\]\((.*?)\)$/);
      if (!problem || !solution) return null;
      return {
        title: problem[1],
        url: problem[2],
        platform: cells[2],
        difficulty: cells[3],
        solution: solution[1].replace(/^(\.\/)+/, '')
      };
    })
    .filter(Boolean);
}

/**
 * Creates the marked table section, replacing rows with the same problem URL.
 *
 * @param {string} existingSection
 * @param {Array<Object>} completedItems
 * @returns {string}
 */
export function generateReadmeTable(existingSection, completedItems) {
  const rows = new Map(parseReadmeRows(existingSection).filter(row => row.url).map(row => [row.url, row]));
  for (const item of completedItems) {
    const row = readmeRowFromItem(item);
    if (row.url) rows.set(row.url, row);
  }

  const values = [...rows.values()];
  const counts = { Easy: 0, Medium: 0, Hard: 0, Basic: 0 };
  for (const row of values) {
    if (counts[row.difficulty] !== undefined) counts[row.difficulty]++;
  }

  let output = `${README_START_MARKER}\n`;
  output += `Summary: ${values.length} solved (Easy: ${counts.Easy}, Medium: ${counts.Medium}, Hard: ${counts.Hard}, Basic: ${counts.Basic})\n\n`;
  output += '| # | Problem | Platform | Difficulty | Solution |\n';
  output += '| --- | --- | --- | --- | --- |\n';
  values.forEach((row, index) => {
    output += `| ${index + 1} | [${row.title}](${row.url}) | ${row.platform} | ${row.difficulty} | [Solution](./${row.solution}) |\n`;
  });
  output += README_END_MARKER;
  return output;
}

/**
 * Updates or appends the marked DSA table in a repository README.
 *
 * @param {string} existingContent
 * @param {Array<Object>} completedItems
 * @returns {string}
 */
export function updateReadmeTable(existingContent, completedItems) {
  const start = existingContent.indexOf(README_START_MARKER);
  const end = existingContent.indexOf(README_END_MARKER);
  const section = start !== -1 && end > start
    ? existingContent.slice(start, end + README_END_MARKER.length)
    : '';
  const table = generateReadmeTable(section, completedItems);
  if (start !== -1 && end > start) {
    return existingContent.slice(0, start) + table + existingContent.slice(end + README_END_MARKER.length);
  }
  const prefix = existingContent.trim();
  return prefix ? `${prefix}\n\n${table}\n` : `${table}\n`;
}
