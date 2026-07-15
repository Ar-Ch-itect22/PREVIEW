import { mailMessageSchema, type MailMessage } from './schemas.js';

export interface MailReadPort {
  readMessage(messageId: string): Promise<MailMessage | undefined>;
}

export class InMemoryReferenceMailProvider {
  readonly #messages = new Map<string, MailMessage>();

  public constructor(messages: readonly MailMessage[]) {
    for (const message of messages) {
      const parsed = mailMessageSchema.parse(message);
      this.#messages.set(parsed.id, structuredClone(parsed));
    }
  }

  public createReadPort(): MailReadPort {
    return Object.freeze({
      readMessage: (messageId: string) => Promise.resolve(this.#readMessage(messageId)),
    });
  }

  public snapshotBytes(): Buffer {
    const messages = [...this.#messages.values()]
      .sort((left, right) => {
        if (left.id < right.id) return -1;
        if (left.id > right.id) return 1;
        return 0;
      })
      .map((message) => structuredClone(message));
    return Buffer.from(JSON.stringify(messages), 'utf8');
  }

  #readMessage(messageId: string): MailMessage | undefined {
    const message = this.#messages.get(messageId);
    return message === undefined ? undefined : structuredClone(message);
  }
}
