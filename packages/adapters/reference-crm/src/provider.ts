import { crmRecordSchema, type CrmRecord } from './schemas.js';

export interface CrmReadPort {
  readRecord(recordId: string): Promise<CrmRecord | undefined>;
}

export class InMemoryReferenceCrmProvider {
  readonly #records = new Map<string, CrmRecord>();

  public constructor(records: readonly CrmRecord[]) {
    for (const record of records) {
      const parsed = crmRecordSchema.parse(record);
      this.#records.set(parsed.id, structuredClone(parsed));
    }
  }

  public createReadPort(): CrmReadPort {
    return Object.freeze({
      readRecord: (recordId: string) => Promise.resolve(this.#readRecord(recordId)),
    });
  }

  public snapshotBytes(): Buffer {
    const records = [...this.#records.values()]
      .sort((left, right) => {
        if (left.id < right.id) return -1;
        if (left.id > right.id) return 1;
        return 0;
      })
      .map((record) => structuredClone(record));
    return Buffer.from(JSON.stringify(records), 'utf8');
  }

  #readRecord(recordId: string): CrmRecord | undefined {
    const record = this.#records.get(recordId);
    return record === undefined ? undefined : structuredClone(record);
  }
}
