import type { EndpointSummary } from '../../../src/types/graph';
import type { HostToWebview } from '../../../src/messaging/messageSchemas';
import type { ApiRequest, ApiResponse } from '../../../src/types/apiTest';
import { bodyTemplate, describeField, parseRequestSchema, pathParamNames, type FieldSchema, type RequestSchema } from '../../../src/types/requestSchema';
import { defaultFilterState, type FilterState } from '../../../src/types/filterState';
import { toFilters } from './filterSync';
import { emptyFilters, type Filters, type GraphEdge, type GraphNode, type LayoutDirection, type Selection } from '../types/view';

/**
 * Rows and body skeleton for an endpoint, from what the analysis found it accepts. Every known key is listed with an
 * empty value of the right type; required query params are enabled, optional ones are present but switched off.
 */
export function requestFromSchema(method: string, path: string, schema: RequestSchema | undefined): Pick<ApiRequest, 'pathParams' | 'queryParams' | 'body'> {
  const row = (f: FieldSchema, enabled: boolean) => ({ key: f.name, value: f.example !== undefined ? String(f.example) : f.enumValues?.length ? String(f.enumValues[0]) : '', enabled, description: describeField(f) });
  const pathNames = pathParamNames(path);
  const typed = new Map((schema?.pathParams ?? []).map((f) => [f.name, f]));
  const hasBody = !!schema?.body.length && !/^(GET|HEAD)$/i.test(method);
  return {
    pathParams: pathNames.map((n) => row(typed.get(n) ?? { name: n, type: 'string', required: true }, true)).map((r) => ({ ...r, value: '' })),
    queryParams: (schema?.query ?? []).map((f) => row(f, f.required)),
    body: hasBody ? { type: 'json', content: JSON.stringify(bodyTemplate(schema!.body), null, 2) } : { type: 'none', content: '' },
  };
}

export interface EndpointRef {
  method: string;
  path: string;
  id: string;
  requestSchema?: string;
}

const HTTP = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function endpointRefOf(node: GraphNode | undefined): EndpointRef | undefined {
  if (!node || node.kind !== 'api-endpoint') return undefined;
  return {
    method: String(node.metadata.method || 'GET'),
    path: String(node.metadata.path || node.name),
    id: node.id,
    requestSchema: typeof node.metadata.requestSchema === 'string' ? node.metadata.requestSchema : undefined,
  };
}

/**
 * The tester request for an endpoint: method, URL, path variables, query rows and body skeleton all come from the
 * endpoint. Headers, auth and timeout are the user's and carry over, so a token set once keeps working across endpoints.
 */
export function requestForEndpoint(prev: ApiRequest, ep: EndpointRef): ApiRequest {
  const method = (HTTP.includes(ep.method.toUpperCase()) ? ep.method.toUpperCase() : 'GET') as ApiRequest['method'];
  return {
    ...prev,
    id: `req_${Date.now()}`,
    method,
    url: `{{baseUrl}}${ep.path.startsWith('/') ? ep.path : `/${ep.path}`}`,
    endpointId: ep.id,
    ...requestFromSchema(method, ep.path, parseRequestSchema(ep.requestSchema)),
  };
}

export const defaultRequest: ApiRequest = {
  id: 'req_1',
  method: 'GET',
  url: '{{baseUrl}}/api/users',
  queryParams: [],
  pathParams: [],
  headers: [],
  auth: { type: 'none' },
  body: { type: 'none', content: '' },
  timeoutMs: 30000,
};

export interface ViewState {
  hasAnalysis: boolean;
  scanning: boolean;
  progress?: string;
  stats?: { files: number; nodes: number; edges: number; endpoints: number; unresolved: number; diagnostics: number };
  endpoints: EndpointSummary[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  hidden: Record<string, { up: number; down: number }>;
  truncated: boolean;
  focusId?: string;
  /** Bumped whenever the visible graph is replaced so the canvas knows to re-fit. */
  graphVersion: number;
  selection?: Selection;
  /** Shared with the sidebar through the host; `filters` is the derived form used for graph filtering. */
  filterState: FilterState;
  filters: Filters;
  layoutDir: LayoutDirection;
  depth: number;
  openOnClick: boolean;
  error?: string;

  // layout of the page
  /** Right-hand details panel: visible, wide, and which tab. */
  panelOpen: boolean;
  panelWide: boolean;
  panelTab: 'details' | 'trace';
  /** Bottom dock. */
  dock: { open: boolean; tab: 'filters' | 'legend' | 'trace' };
  /** Locked graph: no dragging or panning/zooming by mouse. */
  locked: boolean;

  // API Testing state
  activeTab: 'details' | 'tester';
  activeRequest: ApiRequest;
  activeResponse?: ApiResponse;
  isRequestExecuting: boolean;
  environmentVariables: Record<string, string>;
}

export const initialState: ViewState = {
  hasAnalysis: false,
  scanning: false,
  endpoints: [],
  nodes: [],
  edges: [],
  hidden: {},
  truncated: false,
  graphVersion: 0,
  filterState: defaultFilterState(),
  filters: emptyFilters(),
  panelOpen: true,
  panelWide: false,
  panelTab: 'details',
  dock: { open: true, tab: 'legend' },
  locked: false,
  layoutDir: 'LR',
  depth: 3,
  openOnClick: true,

  // API Testing defaults
  activeTab: 'details',
  activeRequest: defaultRequest,
  activeResponse: undefined,
  isRequestExecuting: false,
  environmentVariables: {
    baseUrl: 'http://localhost:3000',
  },
};

export type Action =
  | { type: 'host'; msg: HostToWebview }
  | { type: 'select'; selection?: Selection }
  | { type: 'setFilterState'; filterState: FilterState }
  | { type: 'panel'; open?: boolean; wide?: boolean; tab?: 'details' | 'trace' }
  | { type: 'dock'; open?: boolean; tab?: 'filters' | 'legend' | 'trace' }
  | { type: 'locked'; value: boolean }
  | { type: 'layoutDir'; dir: LayoutDirection }
  | { type: 'depth'; depth: number }
  | { type: 'openOnClick'; value: boolean }
  | { type: 'dismissError' }
  // API Testing actions
  | { type: 'setTab'; tab: 'details' | 'tester' }
  | { type: 'updateRequest'; request: ApiRequest }
  | { type: 'setEnvironmentVariable'; key: string; value: string }
  | { type: 'prepopulateFromEndpoint'; endpoint: { method: string; path: string; id: string; requestSchema?: string } }
  | { type: 'clearResponse' };

export function reducer(state: ViewState, action: Action): ViewState {
  switch (action.type) {
    case 'host': {
      const m = action.msg;
      if (m.type === 'state') return { ...state, hasAnalysis: m.hasAnalysis, scanning: m.scanning, stats: m.stats, progress: m.progress };
      if (m.type === 'endpoints') return { ...state, endpoints: m.endpoints };
      if (m.type === 'filters') return { ...state, filterState: m.filters, filters: toFilters(m.filters) };
      if (m.type === 'baseUrl') return { ...state, environmentVariables: { ...state.environmentVariables, baseUrl: m.value } };
      if (m.type === 'error') return { ...state, error: m.message };
      if (m.type === 'requestStarted') {
        return { ...state, isRequestExecuting: true, activeResponse: undefined };
      }
      if (m.type === 'requestFinished') {
        return { ...state, isRequestExecuting: false, activeResponse: m.response };
      }
      if (m.type === 'requestCancelled') {
        return {
          ...state,
          isRequestExecuting: false,
          activeResponse: {
            requestId: m.requestId,
            status: 0,
            statusText: 'Cancelled',
            durationMs: 0,
            sizeBytes: 0,
            headers: {},
            body: '',
            isJson: false,
            truncated: false,
            error: 'Request was cancelled',
            timing: { start: Date.now(), end: Date.now() },
          },
        };
      }
      if (m.type === 'subgraph') {
        // The focused endpoint changed (e.g. another endpoint was clicked in the sidebar): the API tester follows it.
        const focusedEndpoint = m.focusId && m.focusId !== state.focusId ? endpointRefOf(m.nodes.find((n) => n.id === m.focusId)) : undefined;
        const followEndpoint = focusedEndpoint && focusedEndpoint.id !== state.activeRequest.endpointId;
        const selectionStillThere = state.selection?.type === 'node' ? m.nodes.some((n) => n.id === state.selection!.id) : state.selection?.type === 'edge' ? m.edges.some((e) => e.id === state.selection!.id) : false;
        return {
          ...state,
          nodes: m.nodes,
          edges: m.edges,
          hidden: m.hidden,
          truncated: m.truncated,
          focusId: m.focusId ?? state.focusId,
          graphVersion: state.graphVersion + 1,
          selection: selectionStillThere ? state.selection : m.focusId ? { type: 'node', id: m.focusId } : undefined,
          panelOpen: state.panelOpen || (!selectionStillThere && !!m.focusId),
          error: undefined,
          ...(followEndpoint ? { activeRequest: requestForEndpoint(state.activeRequest, focusedEndpoint), activeResponse: undefined } : {}),
        };
      }
      return state;
    }
    case 'select': {
      // Selecting a different endpoint node points the tester at it (keeps your edits when it is the same endpoint)
      const nextSelection = action.selection;
      const ep = nextSelection && nextSelection.type === 'node' ? endpointRefOf(state.nodes.find((n) => n.id === nextSelection.id)) : undefined;
      if (ep && ep.id !== state.activeRequest.endpointId) {
        return { ...state, selection: nextSelection, panelOpen: true, activeRequest: requestForEndpoint(state.activeRequest, ep), activeResponse: undefined };
      }
      return { ...state, selection: nextSelection, panelOpen: nextSelection ? true : state.panelOpen };
    }
    case 'setFilterState':
      return { ...state, filterState: action.filterState, filters: toFilters(action.filterState) };
    case 'panel':
      return { ...state, panelOpen: action.open ?? state.panelOpen, panelWide: action.wide ?? state.panelWide, panelTab: action.tab ?? state.panelTab };
    case 'dock':
      return { ...state, dock: { open: action.open ?? state.dock.open, tab: action.tab ?? state.dock.tab } };
    case 'locked':
      return { ...state, locked: action.value };
    case 'layoutDir':
      return { ...state, layoutDir: action.dir };
    case 'depth':
      return { ...state, depth: action.depth };
    case 'openOnClick':
      return { ...state, openOnClick: action.value };
    case 'dismissError':
      return { ...state, error: undefined };
    case 'setTab':
      return { ...state, activeTab: action.tab };
    case 'updateRequest':
      return { ...state, activeRequest: action.request };
    case 'setEnvironmentVariable':
      return {
        ...state,
        environmentVariables: {
          ...state.environmentVariables,
          [action.key]: action.value,
        },
      };
    case 'prepopulateFromEndpoint': {
      // explicit "Test Request": always start from the endpoint's own skeleton
      return { ...state, activeTab: 'tester', activeRequest: requestForEndpoint(state.activeRequest, action.endpoint), activeResponse: undefined };
    }
    case 'clearResponse':
      return { ...state, activeResponse: undefined };
  }
}
