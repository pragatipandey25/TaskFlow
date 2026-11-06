import { Request, Response } from 'express';
import { HealthService } from './health.service.js';
import { APISuccessResponse } from '@taskflow/shared';

export class HealthController {
  public static getLiveness(_req: Request, res: Response): void {
    const health = HealthService.getBasicHealth();
    const response: APISuccessResponse<typeof health> = {
      success: true,
      data: health,
    };
    res.status(200).json(response);
  }

  public static async getReadiness(_req: Request, res: Response): Promise<void> {
    const readiness = await HealthService.getReadiness();
    const response: APISuccessResponse<typeof readiness> = {
      success: true,
      data: readiness,
    };

    // Return 200 if healthy or degraded (partially available), 503 if completely unhealthy
    const statusCode = readiness.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(response);
  }
}
