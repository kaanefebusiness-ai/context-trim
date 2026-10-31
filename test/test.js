import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanCodebase, estimateTokens, formatAIContext, redactSecrets, isSecretFile } from '../src/index.js';
import { createMessageHandler, resolveInsideRoot, SERVER_VERSION } from '../src/mcp.js';
import { parseRepository, extractTar } from '../src/remote.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'context-trim-test-'));

console.log('Running context-trim comprehensive test suite...');

// Test 1: estimateTokens
assert.strictEqual(estimateTokens(''), 0);
assert.strictEqual(estimateTokens('abcd'), 2);

// Test 2: redactSecrets (Security Shield)
// Fake keys are glued together at run time so secret scanners don't flag this file
const fake = (...parts) => parts.join('');
const sampleWithKey = `const apiKey = "${fake('sk-', 'ant-api03-', 'abcdef1234567890abcdef1234567890')}";`;
const { redacted, foundCount } = redactSecrets(sampleWithKey);
assert.strictEqual(foundCount, 1);
assert.ok(redacted.includes('[REDACTED_SECRET_KEY]'), 'Key must be replaced with redacted token');
assert.ok(!redacted.includes('sk-ant-api03'), 'Raw secret must not leak');

const mustMask = {
  'postgres password': ['DATABASE_URL=postgres://admin:SuperGizli123@db.example.com/prod', 'SuperGizli123'],
  'stripe key': [`STRIPE=${fake('sk_', 'live_', '51Habcdefghijklmnopqrstuv')}`, '51Habcdef'],
  'google key': [`k = ${fake('AI', 'zaSyA', '1234567890abcdefghijklmnopqrstuv')}`, 'zaSyA'],
  'github pat': [`token: ${fake('github_', 'pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123')}`, '11ABCDEFG'],
  'env assignment': ['export DB_PASSWORD=Ankara2026x', 'Ankara2026x'],
  'quoted json secret': ['"client_secret": "GOCSPX-abcdefgh12345"', 'GOCSPX'],
  'jwt': [`auth = ${fake('ey', 'JhbGciOiJIUzI1NiJ9.', 'ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0.', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')}`, 'dozjgNryP4J3']
};
for (const [label, [input, leaked]] of Object.entries(mustMask)) {
  assert.ok(!redactSecrets(input).redacted.includes(leaked), `Must mask ${label}`);
}

const mustKeep = [
  'const password = getPassword();',
  'const k = process.env.API_KEY;',
  'password: string;',
  'API_KEY=${MY_KEY}',
  'API_KEY=your-api-key-here'
];
for (const line of mustKeep) {
  assert.strictEqual(redactSecrets(line).redacted, line, `Must not touch ordinary code: ${line}`);
}

// Test 3: credential files are never read
assert.ok(isSecretFile('.env'));
assert.ok(isSecretFile('.env.production'));
assert.ok(isSecretFile('id_rsa'));
assert.ok(isSecretFile('server.pem'));
assert.ok(!isSecretFile('.env.example'), 'Templates stay in');
assert.ok(!isSecretFile('env.js'));

const project = path.join(tmp, 'project');
fs.mkdirSync(path.join(project, 'src'), { recursive: true });
fs.writeFileSync(path.join(project, '.env'), 'SECRET=hunter2hunter2\n');
fs.writeFileSync(path.join(project, '.env.example'), 'SECRET=\n');
fs.writeFileSync(path.join(project, 'src', 'app.js'), 'console.log("hi");\n');
fs.writeFileSync(path.join(project, 'package-lock.json'), '{}');

const projectScan = scanCodebase(project);
const packedPaths = projectScan.files.map(f => f.path);
assert.ok(!packedPaths.includes('.env'), '.env must be left out');
assert.ok(packedPaths.includes('.env.example'));
assert.strictEqual(projectScan.secretFilesSkipped, 1);
assert.ok(!formatAIContext(projectScan).includes('hunter2'), 'Secret value must never reach the pack');

// Test 4: scanCodebase on this repository
const scan = scanCodebase(repoRoot);
assert.ok(scan.totalFiles > 0, 'Should find files in repo');
assert.ok(scan.totalTokens > 0, 'Should calculate tokens');
assert.strictEqual(typeof scan.skippedCount, 'number');
assert.strictEqual(typeof scan.totalSecretsMasked, 'number');
assert.throws(() => scanCodebase(path.join(tmp, 'missing')), /Not a directory/);

// Test 5: file limit
const limited = scanCodebase(repoRoot, { maxFiles: 2 });
assert.strictEqual(limited.totalFiles, 2);
assert.ok(limited.truncatedAtFileLimit);

// Test 6: formatAIContext and budget capping
const formatted = formatAIContext(scan);
assert.ok(formatted.includes('# Codebase Context'), 'Should include header');
assert.ok(formatted.includes('Total Files:'), 'Should include stats');
const capped = formatAIContext(scan, { budget: 100 });
assert.ok(capped.includes('TRUNCATED - EXCEEDED TOKEN BUDGET'), 'Should cap tokens when budget is exceeded');

// Test 7: MCP server never leaves its workspace
assert.strictEqual(resolveInsideRoot(project, 'src'), fs.realpathSync(path.join(project, 'src')));
assert.throws(() => resolveInsideRoot(project, '..'), /outside the workspace/);
assert.throws(() => resolveInsideRoot(project, '/'), /outside the workspace/);
// Windows needs extra rights to create symlinks; the check itself is platform-neutral
if (process.platform !== 'win32') {
  fs.symlinkSync(os.tmpdir(), path.join(project, 'escape'));
  assert.throws(() => resolveInsideRoot(project, 'escape'), /outside the workspace/, 'Symlinks must not escape');
  fs.unlinkSync(path.join(project, 'escape'));
}

// Test 8: MCP message handler
const handle = createMessageHandler({ mode: 'local', root: project });
const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
assert.strictEqual(init.result.protocolVersion, '2025-03-26', 'Echo a supported client version');
assert.strictEqual(init.result.serverInfo.version, SERVER_VERSION);
const initUnknown = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
assert.strictEqual(initUnknown.result.protocolVersion, '2025-06-18');
assert.strictEqual(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
assert.deepStrictEqual((await handle({ jsonrpc: '2.0', id: 3, method: 'ping' })).result, {});

const { tools } = (await handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).result;
for (const tool of tools) {
  assert.ok(tool.title, `${tool.name} needs a title`);
  assert.strictEqual(tool.annotations.readOnlyHint, true);
  assert.strictEqual(tool.annotations.destructiveHint, false);
  assert.strictEqual(typeof tool.annotations.openWorldHint, 'boolean');
}

const packed = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_clean_codebase_context', arguments: {} } });
assert.ok(packed.result.content[0].text.includes('src/app.js'));
assert.ok(!packed.result.isError);

const denied = await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'analyze_token_waste', arguments: { path: '/' } } });
assert.strictEqual(denied.result.isError, true, 'Tool errors come back as isError results');
assert.ok(denied.result.content[0].text.includes('outside the workspace'));

const unknown = await handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope' } });
assert.strictEqual(unknown.error.code, -32602);

// Test 9: stdio transport speaks newline-delimited JSON, nothing else
const stdout = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(repoRoot, 'bin', 'cli.js'), '--mcp'], { cwd: project });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.on('error', reject);
  child.on('close', () => resolve(out));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  setTimeout(() => child.stdin.end(), 300);
});
assert.ok(!stdout.includes('Content-Length'), 'No LSP-style headers on stdout');
const lines = stdout.trim().split('\n');
assert.strictEqual(lines.length, 2, 'One line per reply, none for the notification');
assert.deepStrictEqual(lines.map(l => JSON.parse(l).id), [1, 2]);

// Test 9b: when the client shares MCP roots, they become the workspace
const rootsReply = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(repoRoot, 'bin', 'cli.js'), '--mcp'], { cwd: os.tmpdir() });
  let out = '';
  const replies = [];
  child.on('error', reject);
  child.on('close', () => resolve(replies));
  child.stdout.on('data', d => {
    out += d;
    let i;
    while ((i = out.indexOf('\n')) !== -1) {
      const msg = JSON.parse(out.slice(0, i));
      out = out.slice(i + 1);
      replies.push(msg);
      if (msg.method === 'roots/list') {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { roots: [{ uri: pathToFileURL(project).href }] } }) + '\n');
        setTimeout(() => {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_clean_codebase_context', arguments: {} } }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'analyze_token_waste', arguments: { path: os.tmpdir() } } }) + '\n');
        }, 50);
      }
      if (msg.id === 3) child.stdin.end();
    }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { roots: {} } } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
});
const rootsPack = rootsReply.find(m => m.id === 2);
assert.ok(rootsPack.result.content[0].text.includes('src/app.js'), 'Client root is packed, not the working directory');
assert.strictEqual(rootsReply.find(m => m.id === 3).result.isError, true, 'Working directory is off limits once roots are shared');

// Test 10: GitHub repository parsing
assert.deepStrictEqual(parseRepository('vercel/next.js'), { owner: 'vercel', repo: 'next.js', ref: 'HEAD' });
assert.deepStrictEqual(parseRepository('https://github.com/a/b.git'), { owner: 'a', repo: 'b', ref: 'HEAD' });
assert.deepStrictEqual(parseRepository('github.com/a/b/tree/release/v2'), { owner: 'a', repo: 'b', ref: 'release/v2' });
assert.throws(() => parseRepository('https://gitlab.com/a/b'), /Only github.com/);
assert.throws(() => parseRepository('../etc'), /Not a GitHub repository/);
assert.throws(() => parseRepository('a/b/tree/../x'), /Invalid branch/);

// Test 11: tar reader keeps files inside the target folder
function tarEntry(name, body = '', type = '0') {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100);
  header.write(Buffer.byteLength(body).toString(8).padStart(11, '0') + '\0', 124);
  header.write(type, 156);
  header.write('ustar\0', 257);
  const data = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / 512) * 512);
  data.write(body);
  return Buffer.concat([header, data]);
}
const tarball = Buffer.concat([
  tarEntry('repo-abc/src/index.js', 'export {};'),
  tarEntry('repo-abc/../../evil.txt', 'nope'),
  tarEntry('repo-abc/link', '', '2'),
  Buffer.alloc(1024)
]);
const unpackDir = path.join(tmp, 'unpack');
fs.mkdirSync(unpackDir);
extractTar(zlib.gunzipSync(zlib.gzipSync(tarball)), unpackDir);
assert.strictEqual(fs.readFileSync(path.join(unpackDir, 'src', 'index.js'), 'utf8'), 'export {};');
assert.ok(!fs.existsSync(path.resolve(unpackDir, '..', '..', 'evil.txt')), 'Path traversal must be blocked');
assert.ok(!fs.existsSync(path.join(unpackDir, 'link')), 'Symlinks are skipped');

// Test 11b: HTTP listener (remote server) without touching the network
const { createRequestListener } = await import('../src/http.js');
const http = await import('node:http');
process.env.OPENAI_APPS_CHALLENGE = 'challenge-token-123\n';
const server = http.createServer(createRequestListener());
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
assert.strictEqual(await (await fetch(`${base}/.well-known/openai-apps-challenge`)).text(), 'challenge-token-123');
assert.strictEqual((await fetch(`${base}/privacy`)).status, 200);
assert.strictEqual((await fetch(`${base}/mcp`)).status, 405);
const rpc = body => fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
assert.strictEqual((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
const remoteTools = (await (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json()).result.tools;
assert.deepStrictEqual(remoteTools.map(t => t.name), ['pack_github_repository', 'analyze_github_repository_waste']);
assert.ok(remoteTools.every(t => t.annotations.openWorldHint === true));
server.close();
delete process.env.OPENAI_APPS_CHALLENGE;

// Test 12: every manifest ships the same version as package.json
for (const manifest of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
  const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, manifest), 'utf8'));
  assert.strictEqual(version, SERVER_VERSION, `${manifest} version must match package.json`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✔ All tests passed successfully!');
