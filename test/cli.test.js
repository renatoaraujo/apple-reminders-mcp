import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distCli = path.resolve(__dirname, '../dist/index.js');

test('prints version with --version', () => {
  const res = spawnSync(process.execPath, [distCli, '--version'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `exit ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
  assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+(-.*)?$/);
});

