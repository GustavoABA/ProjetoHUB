import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { JobStore } from './jobs';
import { LeverBoardStore, registerLeverBoard, searchLeverBoards } from './lever';

it.skipIf(process.env.PROJECTHUB_LEVER_E2E !== '1')('reads the public Lever demo API without saving to user state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-lever-live-'));
  try {
    const boards = new LeverBoardStore(join(dir, 'boards.json'));
    const jobs = new JobStore(join(dir, 'jobs.json'));
    await registerLeverBoard(boards, 'https://jobs.lever.co/leverdemo', 'Lever demo');
    const first = await fetch('https://api.lever.co/v0/postings/leverdemo?mode=json&limit=1', { signal: AbortSignal.timeout(15_000) });
    if (!first.ok) throw new Error(`Lever demo respondeu HTTP ${first.status}`);
    const listings: unknown = await first.json();
    if (!Array.isArray(listings) || typeof listings[0]?.text !== 'string') throw new Error('Lever demo sem anúncio para o teste');
    const query = listings[0].text.slice(0, 100);
    const found = await searchLeverBoards(boards, jobs, query);
    expect(found.jobs.some((job) => job.title.includes(query) && job.source === 'Lever' &&
      job.originalUrl.startsWith('https://jobs.lever.co/leverdemo/'))).toBe(true);
    expect(new JobStore(join(dir, 'jobs.json')).list().length).toBeGreaterThan(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);
