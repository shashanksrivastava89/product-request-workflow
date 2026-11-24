/**
 * Product master sync from the command line - the runbook's tool, and the way to load a file on a
 * host where the edge's 8KB body limit makes the browser upload slow.
 *
 *   node dist/scripts/product-sync.js preview <file.xlsx|csv>        parse, plan, persist; prints counts + guards
 *   node dist/scripts/product-sync.js apply <runId> [--reason "..."]  apply a previewed run (reason overrides a failed guard)
 *   node dist/scripts/product-sync.js list                            recent runs
 *   node dist/scripts/product-sync.js versions                        applied versions, newest first
 *   node dist/scripts/product-sync.js rows <runId> <ACTION>           one bucket as CSV on stdout
 *
 * In the container: docker exec product-request-backend node dist/scripts/product-sync.js ...
 * Locally:          npx ts-node src/scripts/product-sync.ts ...
 */

import fs from 'fs';
import path from 'path';

import {
  ROW_ACTIONS,
  applyRun,
  createRun,
  exportRunRowsCsv,
  isRowAction,
  listRuns,
  listVersions,
  previewRun,
  storeRunFile,
} from '../services/product-sync/product-sync.service';
import { validateImportFileBuffer } from '../utils/import-file-validation.util';

function usage(): never {
  console.error('usage: product-sync preview <file> | apply <runId> [--reason "..."] | list | versions | rows <runId> <ACTION>');
  process.exit(2);
}

function printCounts(counts: Record<string, unknown>): void {
  const keys = ['read', 'kept', 'skippedByRule', 'invalid', 'held', 'create', 'update', 'reactivate', 'unchanged', 'retire', 'keepInactive', 'manualRetire', 'protectedInvalid'];
  for (const k of keys) if (k in counts) console.log(`  ${k.padEnd(14)} ${String(counts[k]).padStart(8)}`);
  const per = counts.perBusinessGroup as Record<string, Record<string, number>> | undefined;
  if (per) for (const [bg, c] of Object.entries(per)) console.log(`  ${bg}: kept ${c.kept}, active before ${c.activeBefore}, create ${c.create}, update ${c.update}, retire ${c.retire}, reactivate ${c.reactivate}`);
}

function printGuards(guards: Array<{ name: string; ok: boolean; severity: string; detail: string }>): void {
  for (const g of guards) console.log(`  [${g.ok ? ' ok ' : g.severity === 'fail' ? 'FAIL' : 'warn'}] ${g.name}: ${g.detail}`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();

  if (cmd === 'preview') {
    const file = rest[0];
    if (!file || !fs.existsSync(file)) usage();
    const { kind } = validateImportFileBuffer(fs.readFileSync(file));
    const run = await createRun({ source: 'cli', trigger: 'cli', fileName: path.basename(file), userName: process.env.USER ?? process.env.USERNAME ?? 'cli' });
    console.log(`run ${run.id}`);
    await storeRunFile(run.id, file, kind, path.basename(file));
    const out = await previewRun(run.id, { filePath: file, kind });
    printCounts(out.counts as unknown as Record<string, unknown>);
    printGuards(out.guards);
    console.log(out.blocked ? 'BLOCKED: a guard failed; apply needs --reason' : 'ready to apply');
    return;
  }

  if (cmd === 'apply') {
    const runId = rest[0];
    if (!runId) usage();
    const i = rest.indexOf('--reason');
    const reason = i >= 0 ? rest[i + 1] : undefined;
    const out = await applyRun(runId, { overrideReason: reason, userName: process.env.USER ?? process.env.USERNAME ?? 'cli' });
    console.log(`applied ${out.runId} as v${out.version}`);
    printCounts(out.counts as unknown as Record<string, unknown>);
    console.log('  written', JSON.stringify(out.written));
    return;
  }

  if (cmd === 'list') {
    for (const r of await listRuns(30)) {
      const c = (r.counts ?? {}) as Record<string, number>;
      console.log(`${r.id}  ${r.status.padEnd(10)} ${r.version ? `v${r.version}`.padEnd(5) : '     '} ${r.startedAt.toISOString()}  ${r.fileName ?? r.source}  kept=${c.kept ?? '-'} create=${c.create ?? '-'} update=${c.update ?? '-'} retire=${c.retire ?? '-'}${r.error ? `  error: ${r.error}` : ''}`);
    }
    return;
  }

  if (cmd === 'versions') {
    for (const v of await listVersions(50)) {
      const c = (v.counts ?? {}) as Record<string, number>;
      console.log(`v${String(v.version).padEnd(4)} ${v.runId}  ${v.appliedAt?.toISOString() ?? '-'}  ${v.fileName ?? '-'}  create=${c.create ?? '-'} update=${c.update ?? '-'} retire=${c.retire ?? '-'}${v.restoredFromVersion ? `  (restore of v${v.restoredFromVersion})` : ''}${v.fileKept ? '' : '  [file not kept]'}`);
    }
    return;
  }

  if (cmd === 'rows') {
    const [runId, action] = rest;
    if (!runId || !action || !isRowAction(action.toUpperCase())) {
      console.error(`ACTION must be one of ${ROW_ACTIONS.join(', ')}`);
      usage();
    }
    process.stdout.write(await exportRunRowsCsv(runId, action.toUpperCase() as (typeof ROW_ACTIONS)[number]));
    return;
  }

  usage();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
