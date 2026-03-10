import { readFileSync, writeFileSync } from 'node:fs';
const p = new URL('../dist/index.js', import.meta.url);
const file = new URL(p).pathname;
const src = readFileSync(file, 'utf8');
const shebang = '#!/usr/bin/env node\n';
if (!src.startsWith(shebang)) {
  writeFileSync(file, shebang + src, 'utf8');
}

