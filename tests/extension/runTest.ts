import * as path from 'node:path';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { runTests } from '@vscode/test-electron';

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  const extensionTestsPath = path.resolve(__dirname, 'suite/index');
  // Tests mutate files, so they run against a throwaway copy of the fixture rather than the fixture itself.
  const workspace = path.resolve(extensionDevelopmentPath, '.test-tmp/ext-workspace');
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  cpSync(path.resolve(extensionDevelopmentPath, 'tests/fixtures/react-express'), workspace, { recursive: true });
  // Prefer the locally installed VS Code so the test needs no download (offline-friendly).
  const local = ['/usr/share/code/code', '/usr/bin/code'].find((p) => existsSync(p));
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXEC ?? local,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--disable-gpu', '--no-sandbox'],
  });
}

main().catch((err) => {
  console.error('Extension tests failed:', err);
  process.exit(1);
});
