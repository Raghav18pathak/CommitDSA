import { describe, it, expect } from 'vitest';
import { generateReadmeTable } from '../../src/utils/readme.js';

const items = [
  {
    payload: {
      platform: 'leetcode',
      difficulty: 'Easy',
      title: '1. Two Sum',
      slug: 'two-sum',
      language: 'cpp',
      url: 'https://leetcode.com/problems/two-sum/'
    }
  },
  {
    payload: {
      platform: 'gfg',
      difficulty: 'Medium',
      title: 'Find Duplicates',
      slug: 'find-duplicates',
      language: 'python3',
      url: 'https://practice.geeksforgeeks.org/problems/find-duplicates/'
    }
  }
];

describe('readme.js utility tests', () => {
  it('should preserve existing rows when adding a new item', () => {
    const existingTable = generateReadmeTable('', items);
    const updatedTable = generateReadmeTable(existingTable, [{
      payload: {
        platform: 'leetcode',
        difficulty: 'Hard',
        title: '3. Longest Substring',
        slug: 'longest-substring',
        language: 'java',
        url: 'https://leetcode.com/problems/longest-substring/'
      }
    }]);

    expect(updatedTable.match(/^\| \d+ \|/gm)).toHaveLength(3);
  });

  it('should replace a row when re-solving the same problem in another language', () => {
    const existingTable = generateReadmeTable('', [items[0]]);
    const updatedTable = generateReadmeTable(existingTable, [{
      payload: {
        ...items[0].payload,
        language: 'python3'
      }
    }]);

    expect(updatedTable.match(/^\| \d+ \|/gm)).toHaveLength(1);
    expect(updatedTable).toContain('solution.py');
    expect(updatedTable).not.toContain('solution.cpp');
  });
});
