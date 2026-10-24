import { RealFileSystemHost } from '@ts-morph/common';

/**
 * Real file system, except that blocked files read as empty. The TypeScript parser overflows its stack on
 * pathologically nested input, and it can be handed a file from many places (the file itself, or any importer that
 * resolves it), so the only safe place to stop that is the read itself.
 */
export class GuardedFileSystem extends RealFileSystemHost {
  constructor(private readonly blocked: ReadonlySet<string>) {
    super();
  }

  override readFileSync(filePath: string, encoding?: string): string {
    return this.blocked.has(filePath) ? '' : super.readFileSync(filePath, encoding);
  }

  override async readFile(filePath: string, encoding?: string): Promise<string> {
    return this.blocked.has(filePath) ? '' : super.readFile(filePath, encoding);
  }
}
