/** Summary row used by list views; derived from api-endpoint nodes. */
export interface EndpointSummary {
  id: string;
  method: string;
  path: string;
  framework: string;
  file: string;
  line: number;
}
