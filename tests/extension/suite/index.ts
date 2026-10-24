import * as path from 'node:path';
import { readdirSync } from 'node:fs';

export interface TestCase {
  name: string;
  fn: () => Promise<void> | void;
}

/** Minimal runner: every *.test.js in this directory exports `tests: TestCase[]`. */
export async function run(): Promise<void> {
  const files = readdirSync(__dirname).filter((f) => f.endsWith('.test.js'));
  let failed = 0;
  for (const file of files) {
    const mod = require(path.join(__dirname, file)) as { tests: TestCase[] };
    for (const t of mod.tests) {
      try {
        await t.fn();
        console.log(`  ok   ${file} :: ${t.name}`);
      } catch (e) {
        failed++;
        console.error(`  FAIL ${file} :: ${t.name}\n       ${(e as Error).stack ?? e}`);
      }
    }
  }
  if (failed) throw new Error(`${failed} extension test(s) failed`);
}
