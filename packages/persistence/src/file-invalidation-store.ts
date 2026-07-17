import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { RevisionInvalidationStore } from '@preview/approval';
import { identifierSchema } from '@preview/domain';

export class FileRevisionInvalidationStore implements RevisionInvalidationStore {
  readonly #path: string;

  public constructor(path: string) {
    this.#path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  public invalidate(revisionId: string): void {
    const parsed = identifierSchema.parse(revisionId);
    if (this.isInvalidated(parsed)) return;
    const handle = openSync(this.#path, 'a');
    try {
      writeSync(handle, `${JSON.stringify(parsed)}\n`, undefined, 'utf8');
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  }

  public isInvalidated(revisionId: string): boolean {
    const parsed = identifierSchema.parse(revisionId);
    if (!existsSync(this.#path)) return false;
    return readFileSync(this.#path, 'utf8')
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .some((line) => JSON.parse(line) === parsed);
  }
}
