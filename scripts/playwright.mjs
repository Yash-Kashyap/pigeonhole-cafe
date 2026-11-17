import { mkdirSync } from 'node:fs';
import { parse, resolve } from 'node:path';

const browserRoot = resolve(
  parse(process.cwd()).root,
  'npm-cache',
  'pigeonhole-playwright',
);
const tempRoot = resolve(
  parse(process.cwd()).root,
  'npm-cache',
  'pigeonhole-tmp',
);
mkdirSync(browserRoot, { recursive: true });
mkdirSync(tempRoot, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
process.env.PW_MANUAL_SERVER = '1';
process.env.TEMP = tempRoot;
process.env.TMP = tempRoot;
await import('../node_modules/@playwright/test/cli.js');
