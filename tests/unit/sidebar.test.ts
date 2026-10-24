import { describe, expect, it } from 'vitest';
import { parseHostToSidebar } from '../../src/messaging/sidebarGuards';
import { HostToSidebarSchema, SidebarToHostSchema } from '../../src/messaging/sidebarMessages';
import { searchEndpoints } from '../../src/graph/endpointSearch';
import { defaultFilterState } from '../../src/types/filterState';

const ep = (method: string, path: string, file = 'src/a.ts') => ({ id: `${method} ${path}`, method, path, framework: 'express', file, line: 3 });

describe('sidebar messages', () => {
  const groups = { requests: [], services: [{ id: 's', name: 'UsersService', sub: 'src/u.ts' }], models: [], externals: [] };
  const filters = defaultFilterState();
  const state = { type: 'state', hasAnalysis: true, scanning: false, endpoints: [ep('GET', '/a')], groups, filters };
  const samples: unknown[] = [
    state,
    { ...state, hasAnalysis: false, scanning: true, endpoints: [] },
    { type: 'filters', filters },
    { type: 'filters', filters: { ...filters, category: 'frontend', methods: ['GET'], hiddenConfidence: ['low'] } },
    { type: 'focusSearch' },
    { type: 'clear' },
    { ...state, hasAnalysis: 'yes' },
    { ...state, groups: undefined },
    { ...state, filters: undefined },
    { ...state, groups: { ...groups, services: [{ id: 1 }] } },
    { ...state, filters: { ...filters, category: 'everything' } },
    { ...state, filters: { ...filters, hiddenConfidence: ['bogus'] } },
    { type: 'filters', filters: { ...filters, methods: 'GET' } },
    { ...state, endpoints: [{ id: 1 }] },
    { ...state, endpoints: [{ ...ep('GET', '/a'), line: '3' }] },
    { ...state, endpoints: [null] },
    { type: 'evil', html: '<img onerror=alert(1)>' },
    { type: 'openEndpoint', id: 'x' },
    null,
    'state',
    42,
    [],
  ];

  it('the dependency-free guard accepts exactly what the Zod schema accepts', () => {
    for (const s of samples) expect(parseHostToSidebar(s) !== undefined, JSON.stringify(s)).toBe(HostToSidebarSchema.safeParse(s).success);
  });

  it('host-side schema accepts well-formed page messages and rejects anything else', () => {
    for (const ok of [{ type: 'ready' }, { type: 'scan' }, { type: 'openEndpoint', id: 'endpoint:GET /a@x.ts:1' }, { type: 'openItem', id: 'sym:a.ts#B' }, { type: 'setFilters', filters: { ...defaultFilterState(), query: 'post auth', methods: ['POST'] } }]) {
      expect(SidebarToHostSchema.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    }
    const bad: unknown[] = [
      { type: 'openEndpoint' },
      { type: 'openEndpoint', id: '' },
      { type: 'openItem', id: '' },
      { type: 'openFile', path: '/etc/passwd' },
      { type: 'setFilters', filters: { ...defaultFilterState(), query: 1 } },
      { type: 'setFilters', filters: { ...defaultFilterState(), methods: new Array(50).fill('GET') } },
      { type: 'setFilters', filters: { ...defaultFilterState(), query: 'x'.repeat(501) } },
      { type: 'setFilters' },
      'ready',
      null,
    ];
    for (const b of bad) expect(SidebarToHostSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });
});

describe('endpoint search used by the sidebar', () => {
  const list = [ep('GET', '/users'), ep('POST', '/users'), ep('DELETE', '/users/:id'), ep('POST', '/auth/login', 'src/auth.ts')];
  it('combines text terms with method filters', () => {
    expect(searchEndpoints(list, { query: 'users', methods: ['POST'] }).map((e) => e.id)).toEqual(['POST /users']);
    expect(searchEndpoints(list, { query: '', methods: ['POST', 'DELETE'] })).toHaveLength(3);
    expect(searchEndpoints(list, { query: 'auth.ts login' }).map((e) => e.path)).toEqual(['/auth/login']);
    expect(searchEndpoints(list, { query: 'users', methods: ['PUT'] })).toEqual([]);
  });
});
