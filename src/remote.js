import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { scanCodebase } from './index.js';

/**
 * Public GitHub repository reader for the remote (HTTP) server.
 * Downloads the repository tarball from GitHub only, unpacks it into a
 * private temp folder, scans it with the same rules as the local CLI,
 * and deletes the folder before returning. Nothing is kept or logged.
 */

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;   // compressed tarball
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

const NAME_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const REF_PART = /^[A-Za-z0-9_./-]{1,200}$/;

/**
 * Accepts "owner/repo", "github.com/owner/repo", "https://github.com/owner/repo(.git)",
 * and ".../tree/<ref>". Returns { owner, repo, ref }.
 */
export function parseRepository(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('repository is required, e.g. "owner/repo".');
  }
  let s = input.trim().replace(/^git\+/, '');

  if (/^https?:\/\//i.test(s) || /^(www\.)?github\.com\//i.test(s)) {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) {
      throw new Error('Only github.com repositories are supported.');
    }
    s = url.pathname.replace(/^\/+|\/+$/g, '');
  }

  const [owner, rawRepo, kind, ...rest] = s.split('/');
  const repo = (rawRepo || '').replace(/\.git$/i, '');
  const ref = kind === 'tree' && rest.length ? rest.join('/') : 'HEAD';

  const isName = part => NAME_PART.test(part || '') && !/^\.+$/.test(part);
  if (!isName(owner) || !isName(repo)) {
    throw new Error(`Not a GitHub repository: "${input}". Use "owner/repo".`);
  }
  if (!REF_PART.test(ref) || ref.includes('..')) {
    throw new Error(`Invalid branch or tag: "${ref}".`);
  }
  return { owner, repo, ref };
}

async function downloadTarball({ owner, repo, ref }) {
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'context-trim' },
    redirect: 'error',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  });

  if (res.status === 404) {
    throw new Error(`Repository or branch not found: ${owner}/${repo}@${ref}. Private repositories are not supported.`);
  }
  if (!res.ok) throw new Error(`GitHub download failed (HTTP ${res.status}).`);

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error('Repository is larger than the 50 MB download limit.');

  const chunks = [];
  let received = 0;
  for await (const chunk of res.body) {
    received += chunk.length;
    if (received > MAX_DOWNLOAD_BYTES) throw new Error('Repository is larger than the 50 MB download limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function readString(buf, start, length) {
  const end = buf.indexOf(0, start);
  return buf.toString('utf8', start, end === -1 || end > start + length ? start + length : end);
}

function readOctal(buf, start, length) {
  return parseInt(readString(buf, start, length).trim() || '0', 8);
}

function parsePaxPath(data) {
  // Records look like "<len> path=<value>\n"
  for (const record of data.toString('utf8').split('\n')) {
    const m = record.match(/^\d+ path=(.*)$/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Minimal tar reader: regular files and folders only. Symlinks, devices and
 * any entry that would land outside `dest` are skipped.
 */
export function extractTar(tar, dest) {
  const destRoot = path.resolve(dest);
  let offset = 0;
  let unpacked = 0;
  let paxPath = null;
  let longName = null;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'x') { paxPath = parsePaxPath(data); continue; }
    if (type === 'g') continue;
    if (type === 'L') { longName = readString(data, 0, data.length); continue; }

    let name = paxPath || longName;
    if (!name) {
      const prefix = header.toString('utf8', 257, 263).startsWith('ustar') ? readString(header, 345, 155) : '';
      name = (prefix ? prefix + '/' : '') + readString(header, 0, 100);
    }
    paxPath = null;
    longName = null;

    // GitHub wraps everything in "<repo>-<sha>/"; drop that first folder
    const rel = name.split('/').slice(1).join('/');
    if (!rel) continue;

    const target = path.resolve(destRoot, rel);
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) continue;

    if (type === '5') {
      fs.mkdirSync(target, { recursive: true });
    } else if (type === '0' || type === '\0' || type === '7') {
      unpacked += size;
      if (unpacked > MAX_UNPACKED_BYTES) throw new Error('Repository is larger than the 200 MB unpacked limit.');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data, { mode: 0o600 });
    }
  }
}

/**
 * Download, scan and clean up. `use(scan, label)` builds the reply text.
 */
export async function withRepository(input, use) {
  const spec = parseRepository(input);
  const label = `${spec.owner}/${spec.repo}${spec.ref === 'HEAD' ? '' : `@${spec.ref}`}`;
  const tarball = await downloadTarball(spec);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-trim-'));
  try {
    let tar;
    try {
      tar = zlib.gunzipSync(tarball, { maxOutputLength: MAX_UNPACKED_BYTES + 10 * 1024 * 1024 });
    } catch (_) {
      throw new Error('Repository is larger than the 200 MB unpacked limit, or the download was damaged.');
    }
    extractTar(tar, dir);
    return use(scanCodebase(dir), label);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
