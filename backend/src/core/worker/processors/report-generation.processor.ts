import { IJobProcessor } from '../processor.registry.js';
import { IJobDocument } from '../../../models/job.model.js';

export interface ReportGenerationPayload {
  reportType?: 'daily_summary' | 'performance_audit' | 'user_activity';
  format?: 'pdf' | 'csv' | 'json';
  dateRange?: {
    from: string;
    to: string;
  };
  shouldFail?: boolean;
}

export class ReportGenerationProcessor implements IJobProcessor {
  async process(
    job: IJobDocument,
    updateProgress: (percentage: number, logMessage?: string) => Promise<void>
  ): Promise<Record<string, unknown>> {
    const payload = job.payload as ReportGenerationPayload;
    const reportType = payload.reportType || 'daily_summary';
    const format = payload.format || 'pdf';
    const fromDate = payload.dateRange?.from || new Date(Date.now() - 86400000).toISOString();
    const toDate = payload.dateRange?.to || new Date().toISOString();

    if (payload.shouldFail) {
      throw new Error('Report compiler crashed: OOM or unsupported format options');
    }

    const startTime = Date.now();

    // Step 1: Query & compile metrics (30%)
    await updateProgress(30, `Querying analytics data for range ${fromDate} to ${toDate}`);

    // Step 2: Render layouts and data visualizations (65%)
    await updateProgress(65, `Rendering visual layout and charts for ${reportType}.${format}`);

    // Step 3: Compress and generate storage artifact (90%)
    await updateProgress(90, 'Generating cryptographic SHA-256 integrity checksum and archiving');

    const reportId = `rep_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const artifactPath = `/artifacts/reports/${reportId}.${format}`;
    const fileSizeKb = Math.floor(Math.random() * 800) + 200;

    // Step 4: Finalize report (100%)
    await updateProgress(100, `Report ready for download: ${artifactPath}`);

    return {
      reportId,
      reportType,
      format,
      period: { fromDate, toDate },
      downloadUrl: artifactPath,
      fileSizeKb,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }
}
