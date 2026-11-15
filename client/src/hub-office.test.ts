import { describe, expect, it } from 'vitest';
import { agentActivity } from './hub-office';

const agent = { id: 'a', name: 'Pesquisador', objective: 'Encontrar vagas', status: 'active' as const, systemKey: 'job-search/researcher' };
const task = (status: string, updatedAt: string) => ({ id: updatedAt, agentId: 'a', instruction: 'Pesquisa', status, updatedAt });

describe('agentActivity', () => {
  it('uses a live dispatch and never claims a queued task is already running', () => {
    expect(agentActivity(agent, [task('queued', '2026-11-07T10:00:00Z')]).label).toBe('Na fila');
    expect(agentActivity(agent, [task('dispatching', '2026-11-07T10:00:00Z')]).label).toBe('Pesquisando');
  });

  it('shows the most recent active task over older failures', () => {
    expect(agentActivity(agent, [task('failed', '2026-11-07T09:00:00Z'), task('waiting_input', '2026-11-07T10:00:00Z')]).label)
      .toBe('Aguardando resposta');
  });

  it('shows a running task even when a newer task is queued for the same agent', () => {
    expect(agentActivity(agent, [task('dispatching', '2026-11-07T09:00:00Z'), task('queued', '2026-11-07T10:00:00Z')]).label)
      .toBe('Pesquisando');
  });

  it('distinguishes accepted Codex instruction from completed work', () => {
    expect(agentActivity(agent, [task('sent', '2026-11-07T10:00:00Z')]).label).toBe('Aguardando Codex');
    expect(agentActivity(agent, [task('result_ready', '2026-11-07T10:00:00Z')]).label).toBe('Resultado pronto');
  });

  it('honors paused and ended agent states', () => {
    expect(agentActivity({ ...agent, status: 'paused' }, [task('dispatching', '2026-11-07T10:00:00Z')]).label).toBe('Pausado');
    expect(agentActivity({ ...agent, status: 'ended' }, []).label).toBe('Encerrado');
  });

  it('keeps an idle agent idle and reports failed work', () => {
    expect(agentActivity(agent, []).label).toBe('Ocioso');
    expect(agentActivity(agent, [task('failed', '2026-11-07T10:00:00Z')]).label).toBe('Erro');
  });

  it('shows a real pending application approval for the application specialist', () => {
    const specialist = { ...agent, systemKey: 'job-search/applications' };
    const applications = [{ id: 'app', status: 'awaiting_approval' }];
    expect(agentActivity(specialist, [task('done', '2026-11-07T10:00:00Z')], applications).label).toBe('Aguardando permissão');
    expect(agentActivity(agent, [], applications).label).toBe('Ocioso');
    expect(agentActivity(specialist, [], [{ id: 'app', status: 'approved' }]).label).toBe('Ocioso');
    expect(agentActivity(specialist, [task('dispatching', '2026-11-07T10:00:00Z')], applications).label).toBe('Trabalhando');
  });
});
