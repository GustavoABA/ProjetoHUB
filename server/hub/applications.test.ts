import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ApplicationStore } from './applications';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-app-')); dirs.push(dir);
  const file = join(dir, 'applications.json');
  return { file, store: new ApplicationStore(file) };
}
const vacancy = { jobId: 'job-1', source: 'Remotive', sourceId: '101', originalUrl: 'https://remotive.com/remote-jobs/support/role-101', title: 'Assistente', company: 'Empresa' };

it('creates one draft per source vacancy and persists it', () => {
  const { file, store } = setup();
  const first = store.create(vacancy);
  expect(first).toMatchObject({ jobId: 'job-1', status: 'draft', sourceId: '101', answers: {} });
  expect(() => store.create({ ...vacancy, jobId: 'another-id' })).toThrow('existe candidatura');
  expect(new ApplicationStore(file).list()).toMatchObject([{ id: first.id, status: 'draft' }]);
});

it('requires user-confirmed answers and explicit approval without marking submission', () => {
  const { file, store } = setup(); const app = store.create(vacancy);
  expect(() => store.requestApproval(app.id)).toThrow('resposta confirmada');
  store.setAnswers(app.id, { experience: 'Sem experiência formal' });
  expect(store.requestApproval(app.id).status).toBe('awaiting_approval');
  expect(store.approve(app.id).status).toBe('approved');
  expect(new ApplicationStore(file).list()[0]).toMatchObject({ status: 'approved', answers: { experience: 'Sem experiência formal' } });
  expect(store.list()[0].status).not.toBe('submitted');
});

it('invalidates approval after answer changes and supports denial', () => {
  const { store } = setup(); const app = store.create(vacancy);
  store.setAnswers(app.id, { name: 'Nome confirmado' });
  store.requestApproval(app.id);
  expect(store.deny(app.id).status).toBe('draft');
  store.requestApproval(app.id); store.approve(app.id);
  expect(store.setAnswers(app.id, { name: 'Nome corrigido' }).status).toBe('draft');
  expect(() => store.approve(app.id)).toThrow('aguardando aprovação');
});

it('rejects unsafe source links and oversized answers', () => {
  const { store } = setup();
  expect(() => store.create({ ...vacancy, originalUrl: 'http://example.com' })).toThrow('URL');
  const app = store.create(vacancy);
  expect(() => store.setAnswers(app.id, { name: 'x'.repeat(5001) })).toThrow('resposta');
  expect(() => store.setAnswers(app.id, { 'bad\nkey': 'x' })).toThrow('campo');
  expect(() => store.setAnswers(app.id, { Senha: 'não guardar' })).toThrow('credencial');
  expect(store.setAnswers(app.id, { Experiência: 'Nenhuma' }).answers).toMatchObject({ Experiência: 'Nenhuma' });
});

it('persists an uncertain submission after restart and only confirms with browser evidence', () => {
  const { file, store } = setup(); const app = store.create(vacancy);
  store.setAnswers(app.id, { name: 'Nome confirmado' });
  store.requestApproval(app.id); store.approve(app.id);
  const attempt = store.startSubmission(app.id, 'https://empresa.example/apply');
  expect(attempt.status).toBe('submitting');
  const recovered = new ApplicationStore(file);
  expect(recovered.get(app.id)?.status).toBe('submission_uncertain');
  expect(() => recovered.startSubmission(app.id, 'https://empresa.example/apply')).toThrow();
  expect(() => recovered.setAnswers(app.id, { name: 'Mudança' })).toThrow();
  const done = recovered.confirmSubmission(app.id, { url: 'https://empresa.example/thanks', confirmationText: 'Candidatura recebida', screenshot: Buffer.from('89504e470d0a1a0a00112233', 'hex') });
  expect(done).toMatchObject({ status: 'submitted', submission: { confirmationText: 'Candidatura recebida' } });
  expect(recovered.evidence(app.id)).toEqual(Buffer.from('89504e470d0a1a0a00112233', 'hex'));
  expect(new ApplicationStore(file).get(app.id)?.status).toBe('submitted');
});
