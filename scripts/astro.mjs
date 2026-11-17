import { mkdirSync } from 'node:fs';
import { parse, resolve } from 'node:path';

const cacheRoot = resolve('.cache');
const xdgRoot = resolve(cacheRoot, 'xdg');
const tempRoot = resolve(
  parse(process.cwd()).root,
  'npm-cache',
  'pigeonhole-tmp',
);
mkdirSync(xdgRoot, { recursive: true });
mkdirSync(tempRoot, { recursive: true });
process.env.ASTRO_TELEMETRY_DISABLED = '1';
process.env.XDG_CONFIG_HOME = xdgRoot;
process.env.TEMP = tempRoot;
process.env.TMP = tempRoot;
await import('../node_modules/astro/bin/astro.mjs');
