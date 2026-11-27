// Run backend unit tests and the webapp Vitest suite.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const backend = readdirSync('tests_js').filter((f) => f.endsWith('.test.js')).map((f) => join('tests_js', f));
if (backend.length) {
  execFileSync(process.execPath, ['--test', ...backend], { stdio: 'inherit' });
}
execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--environment', 'jsdom'], {
  cwd: 'webapp-src',
  stdio: 'inherit',
});
