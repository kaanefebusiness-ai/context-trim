import assert from 'node:assert';
import path from 'node:path';
import { scanCodebase, estimateTokens, formatAIContext, redactSecrets } from '../src/index.js';

console.log('Running context-trim comprehensive test suite...');

// Test 1: estimateTokens
assert.strictEqual(estimateTokens(''), 0);
assert.strictEqual(estimateTokens('abcd'), 2);

// Test 2: redactSecrets (Security Shield)
const sampleWithKey = 'const apiKey = "sk-ant-api03-abcdef1234567890abcdef1234567890";';
const { redacted, foundCount } = redactSecrets(sampleWithKey);
assert.strictEqual(foundCount, 1);
assert.ok(redacted.includes('[REDACTED_SECRET_KEY]'), 'Key must be replaced with redacted token');
assert.ok(!redacted.includes('sk-ant-api03'), 'Raw secret must not leak');

// Test 3: scanCodebase
const currentDir = path.resolve('.');
const scan = scanCodebase(currentDir);

assert.ok(scan.totalFiles > 0, 'Should find files in repo');
assert.ok(scan.totalTokens > 0, 'Should calculate tokens');
assert.strictEqual(typeof scan.skippedCount, 'number');
assert.strictEqual(typeof scan.totalSecretsMasked, 'number');

// Test 4: formatAIContext
const formatted = formatAIContext(scan);
assert.ok(formatted.includes('# Codebase Context'), 'Should include header');
assert.ok(formatted.includes('Total Files:'), 'Should include stats');

// Test 5: budget capping
const capped = formatAIContext(scan, { budget: 100 });
assert.ok(capped.includes('TRUNCATED - EXCEEDED TOKEN BUDGET'), 'Should cap tokens when budget is exceeded');

console.log('✔ All tests passed successfully!');
