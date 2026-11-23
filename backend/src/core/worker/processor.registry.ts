import { IJobDocument } from '../../models/job.model.js';
import { logger } from '../logging/logger.js';

export interface IJobProcessor {
  process(
    job: IJobDocument,
    updateProgress: (percentage: number, logMessage?: string) => Promise<void>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>>;
}

class JobProcessorRegistry {
  private processors = new Map<string, IJobProcessor>();

  register(jobType: string, processor: IJobProcessor): void {
    if (this.processors.has(jobType)) {
      logger.warn(`Job processor for type '${jobType}' is being overwritten.`);
    }
    this.processors.set(jobType, processor);
    logger.info(`Registered job processor for '${jobType}'`);
  }

  get(jobType: string): IJobProcessor | undefined {
    return this.processors.get(jobType);
  }

  has(jobType: string): boolean {
    return this.processors.has(jobType);
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.processors.keys());
  }
}

export const processorRegistry = new JobProcessorRegistry();
