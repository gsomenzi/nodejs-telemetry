export const METRICS_PORT = 'METRICS_PORT';

export interface MetricsPort {
  incrementCounter(
    name: string,
    value?: number,
    attributes?: Record<string, string | number | boolean>,
  ): void;

  recordHistogram(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void;

  recordGauge(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void;
}
