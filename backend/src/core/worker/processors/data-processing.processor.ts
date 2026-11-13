import { IJobProcessor } from '../processor.registry.js';
import { IJobDocument } from '../../../models/job.model.js';

export interface DataRecord {
  id: string | number;
  value: number;
  category?: string;
}

export interface DataProcessingPayload {
  items?: DataRecord[];
  operation?: 'aggregate' | 'transform' | 'filter';
  threshold?: number;
  shouldFail?: boolean;
}

export class DataProcessingProcessor implements IJobProcessor {
  async process(
    job: IJobDocument,
    updateProgress: (percentage: number, logMessage?: string) => Promise<void>
  ): Promise<Record<string, unknown>> {
    const payload = job.payload as DataProcessingPayload;
    const items = payload.items || [
      { id: 1, value: 45.5, category: 'finance' },
      { id: 2, value: 120.0, category: 'sales' },
      { id: 3, value: 89.2, category: 'finance' },
      { id: 4, value: 310.8, category: 'infrastructure' },
      { id: 5, value: 15.0, category: 'sales' },
    ];

    if (payload.shouldFail) {
      throw new Error('Data processing interrupted: corrupt schema or invalid numeric column');
    }

    const startTime = Date.now();
    await updateProgress(20, `Ingested ${items.length} records for dataset processing`);

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const categoryTotals: Record<string, number> = {};

    const total = items.length;
    for (let i = 0; i < total; i++) {
      const item = items[i];
      const val = Number(item.value) || 0;
      sum += val;
      if (val < min) min = val;
      if (val > max) max = val;

      const cat = item.category || 'unclassified';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + val;

      if ((i + 1) % Math.max(1, Math.floor(total / 3)) === 0 || i === total - 1) {
        const pct = Math.min(95, 20 + Math.floor(((i + 1) / total) * 75));
        await updateProgress(pct, `Processed batch ${i + 1}/${total} records`);
      }
    }

    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 0;
    const average = total > 0 ? Number((sum / total).toFixed(2)) : 0;

    await updateProgress(100, `Completed aggregation of ${total} records`);

    return {
      recordCount: total,
      metrics: {
        sum: Number(sum.toFixed(2)),
        average,
        min: Number(min.toFixed(2)),
        max: Number(max.toFixed(2)),
      },
      categoryDistribution: categoryTotals,
      durationMs: Date.now() - startTime,
      processedAt: new Date().toISOString(),
    };
  }
}
