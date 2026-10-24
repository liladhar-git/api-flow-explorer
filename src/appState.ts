import type { Graph } from './types/graph';
import type { ScanReport } from './types/analyzer';
import type { GraphIndex } from './graph/graphQueries';

export interface AppState {
  graph?: Graph;
  index?: GraphIndex;
  report?: ScanReport;
  root?: string;
  scanning: boolean;
  lastError?: string;
}
