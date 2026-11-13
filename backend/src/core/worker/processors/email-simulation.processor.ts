import { IJobProcessor } from '../processor.registry.js';
import { IJobDocument } from '../../../models/job.model.js';

export interface EmailJobPayload {
  to?: string;
  recipient?: string;
  subject?: string;
  template?: string;
  shouldFail?: boolean;
  failUntilAttempt?: number;
}

export class EmailSimulationProcessor implements IJobProcessor {
  async process(
    job: IJobDocument,
    updateProgress: (percentage: number, logMessage?: string) => Promise<void>
  ): Promise<Record<string, unknown>> {
    const payload = job.payload as EmailJobPayload;
    const recipient = payload.to || payload.recipient || 'noreply@taskflow.dev';
    const subject = payload.subject || 'TaskFlow Notification';
    const template = payload.template || 'default_alert';

    const startTime = Date.now();

    // Step 1: Validate recipient and render template (25%)
    await updateProgress(25, `Validating recipient format for: ${recipient}`);
    if (!recipient.includes('@')) {
      throw new Error(`Invalid email address: ${recipient}`);
    }

    // Step 2: Render email template (50%)
    await updateProgress(50, `Rendering email template: ${template} with subject "${subject}"`);

    // Check if test-induced failure is requested
    const currentAttempt = (job.attemptsMade || 0) + 1;
    if (payload.shouldFail) {
      const failThreshold = payload.failUntilAttempt || 999;
      if (currentAttempt <= failThreshold) {
        throw new Error(
          `SMTP 503 Transient Relay Failure: Mailbox busy or connection timeout (Attempt ${currentAttempt})`
        );
      }
    }

    // Step 3: Connect to simulated SMTP relay (75%)
    await updateProgress(75, 'Connecting to SMTP relay server...');

    // Step 4: Dispatch email (100%)
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const durationMs = Date.now() - startTime;
    await updateProgress(100, `Email dispatched successfully. Message ID: ${messageId}`);

    return {
      messageId,
      recipient,
      subject,
      template,
      deliveredAt: new Date().toISOString(),
      durationMs,
      relayStatus: '250 2.0.0 Ok: queued for delivery',
    };
  }
}
