import { processorRegistry } from '../../src/core/worker/processor.registry.js';
import { registerDefaultProcessors } from '../../src/core/worker/register-processors.js';
import { EmailSimulationProcessor } from '../../src/core/worker/processors/email-simulation.processor.js';
import { DataProcessingProcessor } from '../../src/core/worker/processors/data-processing.processor.js';
import { ReportGenerationProcessor } from '../../src/core/worker/processors/report-generation.processor.js';
import { JobType } from '@taskflow/shared';
import { IJobDocument } from '../../src/models/job.model.js';

describe('Job Processors & Registry (Unit)', () => {
  beforeAll(() => {
    registerDefaultProcessors();
  });

  describe('JobProcessorRegistry', () => {
    it('should have all 3 default processors registered', () => {
      expect(processorRegistry.has(JobType.EMAIL_SIMULATION)).toBe(true);
      expect(processorRegistry.has(JobType.DATA_PROCESSING)).toBe(true);
      expect(processorRegistry.has(JobType.REPORT_GENERATION)).toBe(true);

      const registered = processorRegistry.getRegisteredTypes();
      expect(registered).toContain(JobType.EMAIL_SIMULATION);
      expect(registered).toContain(JobType.DATA_PROCESSING);
      expect(registered).toContain(JobType.REPORT_GENERATION);
    });

    it('should return undefined for non-existent processor', () => {
      expect(processorRegistry.get('NON_EXISTENT_TYPE')).toBeUndefined();
    });
  });

  describe('EmailSimulationProcessor', () => {
    const processor = new EmailSimulationProcessor();

    it('should process email and invoke progress callbacks to 100%', async () => {
      const mockJob = {
        payload: {
          to: 'engineer@taskflow.dev',
          subject: 'Queue Health Alert',
          template: 'alert_template',
        },
        attemptsMade: 0,
      } as unknown as IJobDocument;

      const progressSteps: number[] = [];
      const updateProgress = async (pct: number) => {
        progressSteps.push(pct);
      };

      const result = await processor.process(mockJob, updateProgress);
      expect(result).toBeDefined();
      expect(result.recipient).toBe('engineer@taskflow.dev');
      expect(result.messageId).toBeDefined();
      expect(progressSteps).toEqual([25, 50, 75, 100]);
    });

    it('should throw simulated error when shouldFail flag is set', async () => {
      const mockJob = {
        payload: {
          to: 'engineer@taskflow.dev',
          shouldFail: true,
          failUntilAttempt: 2,
        },
        attemptsMade: 0,
      } as unknown as IJobDocument;

      await expect(processor.process(mockJob, async () => {})).rejects.toThrow(
        /SMTP 503 Transient Relay Failure/
      );
    });
  });

  describe('DataProcessingProcessor', () => {
    const processor = new DataProcessingProcessor();

    it('should calculate accurate metrics and aggregations across dataset', async () => {
      const mockJob = {
        payload: {
          items: [
            { id: 1, value: 10, category: 'dev' },
            { id: 2, value: 20, category: 'dev' },
            { id: 3, value: 30, category: 'qa' },
          ],
        },
      } as unknown as IJobDocument;

      const progressSteps: number[] = [];
      const result = await processor.process(mockJob, async (pct) => {
        progressSteps.push(pct);
      });

      expect(result.recordCount).toBe(3);
      expect(result.metrics).toEqual({
        sum: 60,
        average: 20,
        min: 10,
        max: 30,
      });
      expect(result.categoryDistribution).toEqual({
        dev: 30,
        qa: 30,
      });
      expect(progressSteps[progressSteps.length - 1]).toBe(100);
    });
  });

  describe('ReportGenerationProcessor', () => {
    const processor = new ReportGenerationProcessor();

    it('should generate simulated report artifact and download URL', async () => {
      const mockJob = {
        payload: {
          reportType: 'daily_summary',
          format: 'pdf',
        },
      } as unknown as IJobDocument;

      const progressSteps: number[] = [];
      const result = await processor.process(mockJob, async (pct) => {
        progressSteps.push(pct);
      });

      expect(result.reportId).toBeDefined();
      expect(result.reportType).toBe('daily_summary');
      expect(result.format).toBe('pdf');
      expect(typeof result.downloadUrl).toBe('string');
      expect(typeof result.fileSizeKb).toBe('number');
      expect(progressSteps).toEqual([30, 65, 90, 100]);
    });
  });
});
