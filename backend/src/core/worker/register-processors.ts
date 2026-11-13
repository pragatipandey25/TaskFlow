import { processorRegistry } from './processor.registry.js';
import { JobType } from '@taskflow/shared';
import { EmailSimulationProcessor } from './processors/email-simulation.processor.js';
import { DataProcessingProcessor } from './processors/data-processing.processor.js';
import { ReportGenerationProcessor } from './processors/report-generation.processor.js';

export function registerDefaultProcessors(): void {
  processorRegistry.register(JobType.EMAIL_SIMULATION, new EmailSimulationProcessor());
  processorRegistry.register(JobType.DATA_PROCESSING, new DataProcessingProcessor());
  processorRegistry.register(JobType.REPORT_GENERATION, new ReportGenerationProcessor());
}
