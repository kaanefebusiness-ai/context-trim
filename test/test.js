import assert from 'node:assert';
import path from 'node:path';
import { scanCodebase, estimateTokens, formatAIContext } from '../src/index.js';

console.log('Running context-trim test suite...');

// Test 1: estimateTokens
assert.strictEqual(estimateTokens(''), 0);
assert.strictEqual(estimateTokens('abcd'), 2);

// Test 2: scanCodebase
const currentDir = path.resolve('.');
const scan = scanCodebase(currentDir);

assert.ok(scan.totalFiles > 0, 'Should find files in repo');
assert.ok(scan.totalTokens > 0, 'Should calculate tokens');
assert.strictEqual(typeof scan.skippedCount, 'number');

// Test 3: formatAIContext
const formatted = formatAIContext(scan);
assert.ok(formatted.includes('# Codebase Context'), 'Should include header');
assert.ok(formatted.includes('Total Files:'), 'Should include stats');

// Test 4: budget capping
const capped = formatAIContext(scan, { budget: 100 });
assert.ok(capped.includes('TRUNCATED - EXCEEDED TOKEN BUDGET'), 'Should cap tokens when budget is exceeded');

console.log('✔ All tests passed successfully!');
