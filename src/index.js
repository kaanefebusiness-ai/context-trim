import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Default smart ignore directories (Node, Python, Go, Rust, Java, Docker, IDEs)
export const DEFAULT_IGNORE_DIRS = new Set([
  // Node / Web
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  '.output',
  'coverage',
  '.turbo',
  '.cache',
  // Python
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.eggs',
  // Go & Rust
  'target',
  'vendor',
  // VCS & IDEs
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  '.gemini',
  '.claude'
]);

export const DEFAULT_IGNORE_EXTENSIONS = new Set([
  // Binaries and media
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.avif',
  '.mp4', '.mov', '.avi', '.mp3', '.wav', '.ogg',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.exe', '.bin', '.dll', '.so', '.dylib', '.pyc', '.pyo', '.pyd',
  // Minified and maps
  '.min.js', '.min.css', '.map',
  // Lockfiles & databases
  '.sqlite', '.db', '.lock'
]);

export const DEFAULT_IGNORE_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'poetry.lock',
  'Pipfile.lock',
  'Cargo.lock',
  'composer.lock',
  '.DS_Store',
  'Thumbs.db',
  // Our own output, so a second run never re-packs the previous pack
  'ai-context.md'
]);

// Files that hold credentials are never read, not even for redaction
const SECRET_FILE_PATTERNS = [
  /^\.env(\..+)?$/i,            // .env, .env.local, .env.production ...
  /^\.envrc$/i,
  /\.(pem|key|p12|pfx|jks|keystore|asc|gpg|kdbx)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.(npmrc|pypirc|netrc|pgpass|git-credentials)$/i,
  /^(credentials|secrets?)(\.(json|ya?ml|toml|ini))?$/i,
  /^service[-_]?account.*\.json$/i,
  /\.tfstate(\.backup)?$/i
];

export function isSecretFile(baseName) {
  // Templates such as .env.example carry no real values and help the model
  if (/\.(example|sample|template|dist)$/i.test(baseName)) return false;
  return SECRET_FILE_PATTERNS.some(re => re.test(baseName));
}

// Secret regex patterns to redact sensitive credentials before LLM dispatch.
// Order matters: specific prefixes run before the generic `sk-` rule.
const SECRET_PATTERNS = [
  // Private key blocks (RSA, EC, OpenSSH, PGP)
  /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY( BLOCK)?-----/g,
  // Anthropic API Key
  /sk-ant-[A-Za-z0-9_-]{20,200}/g,
  // OpenAI API Key (sk-, sk-proj-, sk-svcacct-)
  /sk-[A-Za-z0-9_-]{20,200}/g,
  // Stripe secret / restricted keys
  /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,200}/g,
  // GitHub tokens (classic and fine-grained)
  /\bgh[pousr]_[A-Za-z0-9]{30,255}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,255}/g,
  // AWS Access Key ID
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // Google API Key
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // Slack tokens and webhooks
  /\bxox[abprs]-[0-9A-Za-z-]{10,200}/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
  // JSON Web Tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
];

// Password inside a connection string: scheme://user:PASSWORD@host
const URL_PASSWORD_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi;

// Names that signal a secret value: API_KEY, client_secret, dbPassword ...
const SECRET_NAME = '[A-Za-z0-9_.-]*?(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer)[A-Za-z0-9_]*';

// Quoted literal in code or config: apiKey = "...", "password": "...", secret: '...'
const QUOTED_SECRET_PATTERN = new RegExp(
  `(${SECRET_NAME}["']?\\s*[:=]\\s*)(["'\`])([^"'\`\\s]{8,})\\2`, 'gi');

// .env / shell style line: API_KEY=value or export API_KEY=value
const ENV_SECRET_PATTERN = new RegExp(
  `^(\\s*(?:export\\s+)?${SECRET_NAME}\\s*=\\s*)([^\\s"'#]{8,})\\s*$`, 'gim');

const REDACTED = '[REDACTED_SECRET_KEY]';

/**
 * Mask and redact known sensitive keys from file content
 */
export function redactSecrets(content) {
  if (!content) return { redacted: '', foundCount: 0 };
  let count = 0;
  let text = content;

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      count++;
      return REDACTED;
    });
  }

  text = text.replace(URL_PASSWORD_PATTERN, (_, before, _pw, at) => {
    count++;
    return before + REDACTED + at;
  });

  const isReference = v => v.includes('REDACTED') || /^(\$\{|\$[A-Za-z_]|<.*>$|your[_-]|xxx|\*{3})/i.test(v);

  text = text.replace(QUOTED_SECRET_PATTERN, (match, before, quote, value) => {
    if (isReference(value)) return match;
    count++;
    return before + quote + REDACTED + quote;
  });

  text = text.replace(ENV_SECRET_PATTERN, (match, before, value) => {
    if (isReference(value)) return match;
    count++;
    return before + REDACTED;
  });

  return { redacted: text, foundCount: count };
}

/**
 * Estimate token count from character length.
 * Standard heuristic: ~3.8 to 4.0 characters per token for source code.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

/**
 * Scan directory recursively and collect file paths
 */
export function scanCodebase(dirPath, options = {}) {
  const root = path.resolve(dirPath);
  const maxFileSizeBytes = options.maxSize || 250 * 1024; // 250 KB default
  const maxFiles = options.maxFiles || 5000;
  const results = [];
  const skipped = [];
  let secretFilesSkipped = 0;
  let truncatedAtFileLimit = false;

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  // Parse local .gitignore if exists
  const gitignorePatterns = [];
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          gitignorePatterns.push(trimmed.replace(/\/$/, ''));
        }
      });
    } catch (_) {}
  }

  function shouldIgnore(relPath, isDir) {
    const segments = relPath.split('/');
    for (const seg of segments) {
      if (DEFAULT_IGNORE_DIRS.has(seg)) return true;
    }

    const baseName = path.basename(relPath);
    if (!isDir) {
      if (DEFAULT_IGNORE_FILES.has(baseName)) return true;
      const ext = path.extname(baseName).toLowerCase();
      if (DEFAULT_IGNORE_EXTENSIONS.has(ext)) return true;
      if (baseName.endsWith('.min.js') || baseName.endsWith('.min.css')) return true;
    }

    // Quick match on gitignore patterns
    for (const pat of gitignorePatterns) {
      if (relPath === pat || relPath.startsWith(pat + '/') || baseName === pat) {
        return true;
      }
    }
    return false;
  }

  function walk(currentDir) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      // Forward slashes everywhere, so .gitignore rules and the packed output match on Windows too
      const relPath = path.relative(root, fullPath).split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (!shouldIgnore(relPath, true)) {
          walk(fullPath);
        } else {
          skipped.push({ path: relPath, size: 0, reason: 'directory ignored' });
        }
      } else if (entry.isFile()) {
        if (isSecretFile(entry.name)) {
          secretFilesSkipped++;
          skipped.push({ path: relPath, size: 0, reason: 'credential file never read' });
          continue;
        }

        if (shouldIgnore(relPath, false)) {
          let s = 0;
          try { s = fs.statSync(fullPath).size; } catch (_) {}
          skipped.push({ path: relPath, size: s, reason: 'file type / lockfile ignored' });
          continue;
        }

        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > maxFileSizeBytes) {
            skipped.push({ path: relPath, size: stat.size, reason: `exceeds size limit (${Math.round(stat.size / 1024)} KB)` });
            continue;
          }

          if (results.length >= maxFiles) {
            truncatedAtFileLimit = true;
            return;
          }

          results.push({
            fullPath,
            relPath,
            size: stat.size
          });
        } catch (_) {}
      }
    }
  }

  walk(root);

  // Read content, redact secrets & calculate tokens
  let totalRawBytes = 0;
  let totalRawTokens = 0;
  let totalSecretsMasked = 0;

  const files = results.map(item => {
    let content = '';
    try {
      content = fs.readFileSync(item.fullPath, 'utf8');
    } catch (_) {
      content = '[Binary or unreadable file]';
    }

    const { redacted, foundCount } = redactSecrets(content);
    totalSecretsMasked += foundCount;

    const tokens = estimateTokens(redacted);
    totalRawBytes += item.size;
    totalRawTokens += tokens;

    return {
      path: item.relPath,
      size: item.size,
      tokens,
      content: redacted
    };
  });

  // Calculate estimated saved tokens from skipped files
  const skippedBytes = skipped.reduce((acc, f) => acc + (f.size || 0), 0);
  const estimatedSavedTokens = Math.max(estimateTokens('x'.repeat(skippedBytes)), 0);

  return {
    root,
    files,
    skippedCount: skipped.length,
    skippedBytes,
    estimatedSavedTokens,
    totalFiles: files.length,
    totalBytes: totalRawBytes,
    totalTokens: totalRawTokens,
    totalSecretsMasked,
    secretFilesSkipped,
    truncatedAtFileLimit,
    maxFiles
  };
}

/**
 * Format files into optimized AI Markdown context
 */
export function formatAIContext(scanResult, options = {}) {
  const { files, totalTokens, totalFiles, totalSecretsMasked, secretFilesSkipped, truncatedAtFileLimit, maxFiles } = scanResult;
  const budget = options.budget || Infinity;
  const includeTree = options.tree !== false;

  const header = [
    `# Codebase Context (Packed via context-trim)`,
    `Total Files: ${totalFiles} | Estimated Tokens: ${totalTokens.toLocaleString()}`
  ];

  if (totalSecretsMasked > 0) {
    header.push(`Security: 🛡️ ${totalSecretsMasked} sensitive credential(s) automatically redacted.`);
  }

  if (secretFilesSkipped > 0) {
    header.push(`Security: 🔒 ${secretFilesSkipped} credential file(s) (.env, keys) left out entirely.`);
  }

  if (truncatedAtFileLimit) {
    header.push(`Note: stopped at the ${maxFiles.toLocaleString()}-file limit; point at a subfolder for full coverage.`);
  }

  if (includeTree) {
    header.push(`\n## File Structure Tree\n`);
    const treeLines = files.map(f => `- ${f.path} (${f.tokens} tokens)`);
    header.push(treeLines.join('\n'));
  }
  
  header.push('\n---\n');

  let accumulatedTokens = estimateTokens(header.join('\n'));
  const body = [];

  for (const file of files) {
    const fileHeader = `\n### File: \`${file.path}\`\n\`\`\`\n`;
    const fileFooter = `\n\`\`\`\n`;
    const blockTokens = file.tokens + estimateTokens(fileHeader + fileFooter);

    if (accumulatedTokens + blockTokens > budget) {
      body.push(`\n### File: \`${file.path}\` [TRUNCATED - EXCEEDED TOKEN BUDGET OF ${budget.toLocaleString()}]\n`);
      continue;
    }

    body.push(fileHeader + file.content + fileFooter);
    accumulatedTokens += blockTokens;
  }

  return header.join('\n') + body.join('');
}

/**
 * Copy text to native clipboard (macOS, Linux, Windows) with zero dependencies
 */
export function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    let proc;
    if (process.platform === 'darwin') {
      proc = spawn('pbcopy');
    } else if (process.platform === 'win32') {
      proc = spawn('clip');
    } else {
      // Linux: try xclip, fallback to wl-copy
      proc = spawn('xclip', ['-selection', 'clipboard']);
      proc.on('error', () => {
        const fallback = spawn('wl-copy');
        fallback.on('error', reject);
        fallback.stdin.end(text);
        resolve();
      });
    }

    if (proc) {
      proc.on('error', reject);
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Clipboard command exited with code ${code}`));
      });
      proc.stdin.end(text);
    }
  });
}
