import { CorrelationContext } from '../types';

export interface ContextPropagatorPort {
  extract(headers: Record<string, string | string[] | undefined>): CorrelationContext | null;
  inject(context: CorrelationContext): Record<string, string>;
}
