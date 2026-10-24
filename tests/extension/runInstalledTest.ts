/**
 * Installs the packaged .vsix into a clean extensions directory and runs the extension test suite against the
 * *installed* copy (not the development folder): proves the shipped package works on its own.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

async function main() {
  const root = path.resolve(__dirname, '../../..');
  const vsix = path.join(root, 'api-flow-explorer.vsix');
  if (!existsSync(vsix)) throw new Error('api-flow-explorer.vsix not found; run `npm run package` first');
  const exec = process.env.VSCODE_EXEC ?? ['/usr/share/code/code', '/usr/bin/code'].find((p) => existsSync(p));
  if (!exec) throw new Error('No local VS Code found; set VSCODE_EXEC');

  const base = path.join(root, '.test-tmp/vsix-verify');
  rmSync(base, { recursive: true, force: true });
  const extDir = path.join(base, 'extensions');
  const userDir = path.join(base, 'user-data');
  const workspace = path.join(base, 'workspace');
  const dummyDev = path.join(base, 'dummy-dev');
  for (const d of [extDir, userDir, dummyDev]) mkdirSync(d, { recursive: true });
  cpSync(path.join(root, 'tests/fixtures/react-express'), workspace, { recursive: true });
  // runTests requires an extensionDevelopmentPath; a no-op extension keeps the *installed* one as the only subject
  writeFileSync(path.join(dummyDev, 'package.json'), JSON.stringify({ name: 'noop', publisher: 'test', version: '0.0.0', engines: { vscode: '^1.90.0' } }));

  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(exec, { reuseMachineInstall: true });
  const common = ['--extensions-dir', extDir, '--user-data-dir', userDir];
  const install = spawnSync(cli, [...cliArgs, ...common, '--install-extension', vsix, '--force'], { encoding: 'utf8', shell: false });
  console.log(install.stdout.trim());
  if (install.status !== 0) throw new Error(`install failed (${install.status}): ${install.stderr}`);
  const list = spawnSync(cli, [...cliArgs, ...common, '--list-extensions', '--show-versions'], { encoding: 'utf8' });
  console.log('installed extensions:', list.stdout.trim());
  if (!/local\.api-flow-explorer@0\.1\.0/.test(list.stdout)) throw new Error('extension is not listed after install');
  const installedDir = readdirSync(extDir).find((d) => d.startsWith('local.api-flow-explorer'));
  console.log('installed folder:', installedDir, readdirSync(path.join(extDir, installedDir!, 'dist')).join(', '));

  await runTests({
    vscodeExecutablePath: exec,
    extensionDevelopmentPath: dummyDev,
    extensionTestsPath: path.resolve(__dirname, 'suite/index'),
    launchArgs: [workspace, ...common, '--disable-gpu', '--no-sandbox', '--disable-workspace-trust'],
  });
}

main().catch((err) => {
  console.error('Installed-extension verification failed:', err);
  process.exit(1);
});
