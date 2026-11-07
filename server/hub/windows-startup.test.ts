import { expect, it, vi } from 'vitest';
import { WindowsStartupManager } from './windows-startup';

it('reports and changes only the current installation shortcut', async () => {
  let installed = false;
  const runner = vi.fn(async (action: 'Status' | 'Install' | 'Remove') => {
    if (action === 'Install') installed = true;
    if (action === 'Remove') installed = false;
    return JSON.stringify({ installed, owned: installed, shortcut: 'C:/Startup/ProjetoHUB.lnk' });
  });
  const manager = new WindowsStartupManager(runner, 'win32');
  expect((await manager.status()).enabled).toBe(false);
  expect((await manager.setEnabled(true)).enabled).toBe(true);
  expect((await manager.setEnabled(false)).enabled).toBe(false);
  expect(runner.mock.calls.map(([action]) => action)).toEqual(['Status', 'Status', 'Install', 'Status', 'Remove']);
});

it('never changes a foreign shortcut or a non-Windows system', async () => {
  const foreign = new WindowsStartupManager(async () => JSON.stringify({ installed: true, owned: false }), 'win32');
  await expect(foreign.setEnabled(true)).rejects.toThrow('outra instalação');
  const runner = vi.fn();
  const other = new WindowsStartupManager(runner, 'linux');
  expect(await other.status()).toMatchObject({ supported: false });
  await expect(other.setEnabled(true)).rejects.toThrow('Windows');
  expect(runner).not.toHaveBeenCalled();
});
