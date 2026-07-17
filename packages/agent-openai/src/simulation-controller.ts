import { DomainInvariantError, type SimulationRevision } from '@preview/domain';
import type {
  CalendarEvent,
  ReferenceCalendarSimulationAdapter,
} from '@preview/reference-calendar';
import type {
  MailMessage,
  ReferenceMailSimulationAdapter,
} from '@preview/reference-mail';
import type { GraphDigestFactory, ShadowRevisionSession } from '@preview/runtime';
import { ZodError } from 'zod';

import { AgentLoopInvariantError, RecoverableToolCallError, UnknownAgentToolError } from './errors.js';
import {
  CALENDAR_READ_EVENT_TOOL,
  CALENDAR_STAGE_MOVE_TOOL,
  calendarReadEventArgumentsSchema,
  calendarStageMoveArgumentsSchema,
  MAIL_READ_MESSAGE_TOOL,
  MAIL_STAGE_ATTENDEE_MESSAGE_TOOL,
  mailReadMessageArgumentsSchema,
  mailStageAttendeeMessageArgumentsSchema,
} from './tool-schemas.js';

interface ControllerDependencies {
  readonly calendar: ReferenceCalendarSimulationAdapter;
  readonly mail: ReferenceMailSimulationAdapter;
  readonly session: ShadowRevisionSession;
}

interface StagedCalendar {
  readonly eventId: string;
  readonly resourceKey: string;
}

export class PreviewSimulationController {
  readonly #calendar: ReferenceCalendarSimulationAdapter;
  readonly #calendarReads = new Set<string>();
  readonly #calendarRereads = new Set<string>();
  readonly #mail: ReferenceMailSimulationAdapter;
  readonly #session: ShadowRevisionSession;
  #mailStaged = false;
  #stagedCalendar: StagedCalendar | undefined;

  public constructor(dependencies: ControllerDependencies) {
    this.#calendar = dependencies.calendar;
    this.#mail = dependencies.mail;
    this.#session = dependencies.session;
  }

  public async dispatch(toolName: string, encodedArguments: string): Promise<unknown> {
    switch (toolName) {
      case CALENDAR_READ_EVENT_TOOL:
      case CALENDAR_STAGE_MOVE_TOOL:
      case MAIL_READ_MESSAGE_TOOL:
      case MAIL_STAGE_ATTENDEE_MESSAGE_TOOL:
        break;
      default:
        throw new UnknownAgentToolError(toolName);
    }
    const rawArguments = this.#parseArguments(encodedArguments);
    try {
      switch (toolName) {
        case CALENDAR_READ_EVENT_TOOL:
          return await this.#readCalendar(rawArguments);
        case CALENDAR_STAGE_MOVE_TOOL:
          return await this.#stageCalendarMove(rawArguments);
        case MAIL_READ_MESSAGE_TOOL:
          return await this.#readMail(rawArguments);
        case MAIL_STAGE_ATTENDEE_MESSAGE_TOOL:
          return await this.#stageAttendeeMessage(rawArguments);
        default:
          throw new UnknownAgentToolError(toolName);
      }
    } catch (error) {
      if (
        error instanceof DomainInvariantError
        || error instanceof UnknownAgentToolError
        || error instanceof RecoverableToolCallError
      ) {
        throw error;
      }
      if (error instanceof ZodError) {
        throw new RecoverableToolCallError(
          'INVALID_TOOL_ARGUMENTS',
          error.issues.map((issue) => issue.message).join('; '),
        );
      }
      throw new RecoverableToolCallError(
        'SIMULATION_REJECTED',
        error instanceof Error ? error.message : 'Simulation rejected the tool call',
      );
    }
  }

  public seal(createDigest: GraphDigestFactory): Readonly<SimulationRevision> {
    if (!this.#mailStaged || this.#stagedCalendar === undefined) {
      throw new AgentLoopInvariantError('The required dependent simulation flow is incomplete');
    }
    const graph = this.#session.inspectEffectGraph();
    if (
      graph.effects.length !== 2
      || graph.effects[0]?.adapterId !== this.#calendar.adapterId
      || graph.effects[1]?.adapterId !== this.#mail.adapterId
      || graph.effects[1].dependencies.length !== 1
      || graph.effects[1].dependencies[0] !== graph.effects[0].id
    ) {
      throw new AgentLoopInvariantError('The staged effects do not form the required dependent graph');
    }
    return this.#session.seal(createDigest);
  }

  public abort(): void {
    if (this.#session.status === 'OPEN') this.#session.abort();
  }

  public get status(): ShadowRevisionSession['status'] {
    return this.#session.status;
  }

  async #readCalendar(rawArguments: unknown): Promise<{
    readonly event: CalendarEvent | null;
    readonly source: 'BASE' | 'STAGED_REVISION';
  }> {
    const { eventId } = calendarReadEventArgumentsSchema.parse(rawArguments);
    const resourceKey = this.#calendarResourceKey(eventId);
    const staged = this.#stagedCalendar?.eventId === eventId;
    const event = await this.#session.read(resourceKey, () => this.#calendar.read(resourceKey));
    this.#calendarReads.add(eventId);
    if (staged) this.#calendarRereads.add(eventId);
    return { event: event ?? null, source: staged ? 'STAGED_REVISION' : 'BASE' };
  }

  async #stageCalendarMove(rawArguments: unknown): Promise<{
    readonly effect: unknown;
    readonly event: CalendarEvent;
  }> {
    const input = calendarStageMoveArgumentsSchema.parse(rawArguments);
    if (!this.#calendarReads.has(input.eventId)) {
      throw new RecoverableToolCallError(
        'TOOL_PRECONDITION_FAILED',
        'Read the Calendar event before staging its move',
      );
    }
    if (this.#stagedCalendar !== undefined) {
      throw new RecoverableToolCallError(
        'TOOL_PRECONDITION_FAILED',
        'This revision already contains its Calendar move',
      );
    }
    const resourceKey = this.#calendarResourceKey(input.eventId);
    const event = await this.#session.stage(
      resourceKey,
      () => this.#calendar.read(resourceKey),
      { effectId: this.#nextEffectId('calendar-move') },
      (current, context) => this.#calendar.stage(current, input, context),
    );
    this.#stagedCalendar = { eventId: input.eventId, resourceKey };
    return { effect: this.#lastEffect(), event };
  }

  async #readMail(rawArguments: unknown): Promise<{ readonly message: MailMessage | null }> {
    const { messageId } = mailReadMessageArgumentsSchema.parse(rawArguments);
    const resourceKey = this.#mailResourceKey(messageId);
    const message = await this.#session.read(resourceKey, () => this.#mail.read(resourceKey));
    return { message: message ?? null };
  }

  async #stageAttendeeMessage(rawArguments: unknown): Promise<{
    readonly effect: unknown;
    readonly message: MailMessage;
  }> {
    const input = mailStageAttendeeMessageArgumentsSchema.parse(rawArguments);
    if (
      this.#stagedCalendar?.eventId !== input.calendarEventId
      || !this.#calendarRereads.has(input.calendarEventId)
    ) {
      throw new RecoverableToolCallError(
        'TOOL_PRECONDITION_FAILED',
        'Reread the staged moved Calendar event before staging its attendee message',
      );
    }
    const stagedCalendar = this.#stagedCalendar;
    if (this.#mailStaged) {
      throw new RecoverableToolCallError(
        'TOOL_PRECONDITION_FAILED',
        'This revision already contains its attendee message',
      );
    }
    const sourceEvent = await this.#session.read(
      stagedCalendar.resourceKey,
      () => this.#calendar.read(stagedCalendar.resourceKey),
    );
    if (sourceEvent === undefined) {
      throw new RecoverableToolCallError('SIMULATION_REJECTED', 'Staged Calendar event is missing');
    }
    const resourceKey = this.#mailResourceKey(input.messageId);
    const message = await this.#session.stage(
      resourceKey,
      () => this.#mail.read(resourceKey),
      {
        dependencyResourceKeys: [stagedCalendar.resourceKey],
        effectId: this.#nextEffectId('mail-message'),
      },
      (current, context) => this.#mail.stage(current, {
        messageId: input.messageId,
        recipients: input.recipients,
        subject: `${sourceEvent.title} moved`,
        textBody: {
          field: 'start',
          prefix: `The ${sourceEvent.title} has moved to `,
          resourceKey: stagedCalendar.resourceKey,
          suffix: '.',
        },
      }, context),
    );
    this.#mailStaged = true;
    return { effect: this.#lastEffect(), message };
  }

  #calendarResourceKey(eventId: string): string {
    return `${this.#calendar.adapterId}:event:${eventId}`;
  }

  #mailResourceKey(messageId: string): string {
    return `${this.#mail.adapterId}:message:${messageId}`;
  }

  #lastEffect(): unknown {
    return this.#session.inspectEffectGraph().effects.at(-1);
  }

  #nextEffectId(operation: string): string {
    const sequence = this.#session.inspectEffectGraph().effects.length + 1;
    return `effect:${operation}:${String(sequence).padStart(4, '0')}`;
  }

  #parseArguments(encodedArguments: string): unknown {
    try {
      return JSON.parse(encodedArguments) as unknown;
    } catch {
      throw new RecoverableToolCallError(
        'INVALID_TOOL_ARGUMENTS',
        'Tool arguments must be valid JSON',
      );
    }
  }
}
