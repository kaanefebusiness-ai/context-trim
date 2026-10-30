import fs from 'node:fs';
import path from 'node:path';

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
  'Thumbs.db'
]);

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
  const results = [];
  const skipped = [];

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
    const segments = relPath.split(path.sep);
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
      if (relPath === pat || relPath.startsWith(pat + path.sep) || baseName === pat) {
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
      const relPath = path.relative(root, fullPath);

      if (entry.isDirectory()) {
        if (!shouldIgnore(relPath, true)) {
          walk(fullPath);
        } else {
          skipped.push({ path: relPath, reason: 'directory ignored' });
        }
      } else if (entry.isFile()) {
        if (shouldIgnore(relPath, false)) {
          skipped.push({ path: relPath, reason: 'file type / lockfile ignored' });
          continue;
        }

        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > maxFileSizeBytes) {
            skipped.push({ path: relPath, reason: `exceeds size limit (${Math.round(stat.size / 1024)} KB)` });
            continue;
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

  // Read content & calculate tokens
  let totalRawBytes = 0;
  let totalRawTokens = 0;

  const files = results.map(item => {
    let content = '';
    try {
      content = fs.readFileSync(item.fullPath, 'utf8');
    } catch (_) {
      content = '[Binary or unreadable file]';
    }

    const tokens = estimateTokens(content);
    totalRawBytes += item.size;
    totalRawTokens += tokens;

    return {
      path: item.relPath,
      size: item.size,
      tokens,
      content
    };
  });

  return {
    root,
    files,
    skippedCount: skipped.length,
    totalFiles: files.length,
    totalBytes: totalRawBytes,
    totalTokens: totalRawTokens
  };
}

/**
 * Format files into optimized AI Markdown context
 */
export function formatAIContext(scanResult, options = {}) {
  const { files, totalTokens, totalFiles } = scanResult;
  const budget = options.budget || Infinity;
  const includeTree = options.tree !== false;

  const header = [
    `# Codebase Context (Packed via context-trim)`,
    `Total Files: ${totalFiles} | Estimated Tokens: ${totalTokens.toLocaleString()}`
  ];

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
