import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ProfileStore } from './profile';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() { const dir = mkdtempSync(join(tmpdir(), 'projecthub-profile-')); dirs.push(dir); const file = join(dir, 'profile.json'); return { file, store: new ProfileStore(file) }; }

it('requires explicit confirmation and persists confirmed profile entries', () => {
  const { file, store } = setup();
  expect(() => store.confirm()).toThrow('ao menos uma');
  store.update({ skills: ['Excel', 'Atendimento'], experience: ['Suporte interno'], education: [] });
  expect(store.get().confirmedAt).toBeUndefined();
  const confirmed = store.confirm();
  expect(confirmed.confirmedAt).toBeTruthy();
  expect(new ProfileStore(file).get()).toMatchObject({ skills: ['Excel', 'Atendimento'], revision: confirmed.revision, confirmedAt: confirmed.confirmedAt });
});

it('invalidates confirmation after edit and rejects malformed entries', () => {
  const { store } = setup();
  store.update({ skills: ['Excel'], experience: [], education: [] }); store.confirm();
  const old = store.get().revision;
  store.update({ skills: ['Excel', 'Power BI'], experience: [], education: [] });
  expect(store.get().confirmedAt).toBeUndefined();
  expect(store.get().revision).not.toBe(old);
  expect(() => store.update({ skills: [''], experience: [], education: [] })).toThrow('itens');
});
