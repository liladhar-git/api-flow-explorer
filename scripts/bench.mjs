// Reproducible benchmark: generates a synthetic Express + React project of N source files and measures the
// production worker bundle (dist/analyzer-worker.js): cold scan, warm rescan, and incremental updates.
//   npm run build && npm run bench -- 3000
import { Worker } from 'node:worker_threads';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILES = Number(process.argv[2] ?? 3000);
const ROOT = resolve('.test-tmp', `bench-${FILES}`);
const CACHE = resolve('.test-tmp', `bench-${FILES}-cache`);
const SLICES = Math.ceil(FILES / 8);

function write(rel, text) {
  const p = join(ROOT, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
}

function generate() {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(CACHE, { recursive: true, force: true });
  write('package.json', JSON.stringify({ name: 'bench', dependencies: { express: '4', react: '18', axios: '1', mongoose: '8' } }));
  write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] }, jsx: 'react-jsx' } }));
  const imports = [];
  for (let i = 0; i < SLICES; i++) {
    const n = `Feature${i}`;
    const l = `feature${i}`;
    write(`src/server/models/${n}.ts`, `import mongoose from 'mongoose';\nexport const ${n} = mongoose.model('${n}', new mongoose.Schema({ name: String }));\n`);
    write(`src/server/services/${l}Service.ts`, `import { ${n} } from '../models/${n}';\nexport async function list() { return ${n}.find(); }\nexport async function byId(id: string) { return ${n}.findById(id); }\nexport async function create(d: unknown) { return ${n}.create(d); }\nexport async function remove(id: string) { return ${n}.deleteOne({ _id: id }); }\n`);
    write(`src/server/controllers/${l}Controller.ts`, `import * as svc from '../services/${l}Service';\nexport const list = async (req: any, res: any) => res.json(await svc.list());\nexport const get = async (req: any, res: any) => res.json(await svc.byId(req.params.id));\nexport const create = async (req: any, res: any) => res.json(await svc.create(req.body));\nexport const remove = async (req: any, res: any) => res.json(await svc.remove(req.params.id));\n`);
    write(`src/server/routes/${l}.ts`, `import { Router } from 'express';\nimport * as c from '../controllers/${l}Controller';\nconst router = Router();\nrouter.get('/', c.list);\nrouter.get('/:id', c.get);\nrouter.post('/', c.create);\nrouter.delete('/:id', c.remove);\nexport default router;\n`);
    write(`src/client/api/${l}.ts`, `import axios from 'axios';\nconst api = axios.create({ baseURL: '/api' });\nexport const list = () => api.get('/${l}');\nexport const get = (id: string) => api.get(\`/${l}/\${id}\`);\nexport const create = (d: unknown) => api.post('/${l}', d);\nexport const remove = (id: string) => api.delete(\`/${l}/\${id}\`);\n`);
    write(`src/client/hooks/use${n}.ts`, `import { useEffect, useState } from 'react';\nimport { list } from '../api/${l}';\nexport function use${n}() {\n  const [d, setD] = useState<unknown>();\n  useEffect(() => { list().then((r) => setD(r.data)); }, []);\n  return d;\n}\n`);
    write(`src/client/components/${n}List.tsx`, `import { use${n} } from '../hooks/use${n}';\nexport function ${n}List() {\n  const d = use${n}();\n  return <ul>{String(d)}</ul>;\n}\n`);
    write(`src/client/pages/${n}Page.tsx`, `import { ${n}List } from '../components/${n}List';\nimport { remove } from '../api/${l}';\nexport default function ${n}Page() {\n  return <div onClick={() => remove('1')}><${n}List /></div>;\n}\n`);
    imports.push(l);
  }
  write('src/server/app.ts', `import express from 'express';\n${imports.map((l) => `import ${l}Router from './routes/${l}';`).join('\n')}\nconst app = express();\n${imports.map((l) => `app.use('/api/${l}', ${l}Router);`).join('\n')}\nexport default app;\n`);
}

function run(extra = {}) {
  const t0 = performance.now();
  let peak = 0;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
  return new Promise((res, rej) => {
    const w = new Worker(resolve('dist/analyzer-worker.js'), {
      workerData: { root: ROOT, ignoredDirectories: [], includeTests: false, maxFiles: 100000, baseUrls: {}, cacheDir: CACHE, ...extra },
      resourceLimits: { maxOldGenerationSizeMb: 8192 },
    });
    w.on('message', (m) => {
      if (m.type === 'result') {
        clearInterval(sampler);
        const r = m.result.report;
        res({ ms: Math.round(performance.now() - t0), peakRssMb: Math.round(Math.max(peak, process.memoryUsage().rss) / 1048576), files: r.filesDiscovered, analyzed: r.filesAnalyzed, cached: r.filesFromCache, nodes: m.result.graph.nodes.length, edges: m.result.graph.edges.length, endpoints: m.result.graph.nodes.filter((n) => n.kind === 'api-endpoint').length, unresolved: r.unresolvedEdges, diagnostics: r.diagnostics.length, timings: r.timingsMs });
        w.terminate();
      } else if (m.type === 'error') {
        clearInterval(sampler);
        rej(new Error(m.message));
      }
    });
    w.on('error', (e) => {
      clearInterval(sampler);
      rej(e);
    });
  });
}

generate();
const results = {};
results.cold = await run();
results.warm = await run();
const leaf = join(ROOT, 'src/client/components/Feature0List.tsx');
writeFileSync(leaf, readFileSync(leaf, 'utf8') + '\n// touched\n');
results.incrementalLeaf = await run();
const svc = join(ROOT, 'src/server/services/feature1Service.ts');
writeFileSync(svc, readFileSync(svc, 'utf8').replace('export async function list()', 'export async function listAll()'));
results.incrementalService = await run();
results.fullRescan = await run({ fullRescan: true });
console.log(JSON.stringify({ requestedFiles: FILES, node: process.version, cpus: (await import('node:os')).cpus().length, results }, null, 2));
rmSync(ROOT, { recursive: true, force: true });
rmSync(CACHE, { recursive: true, force: true });
