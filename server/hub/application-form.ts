import type { ApplicationStore } from './applications';
import type { FormField } from './browser';
import type { HubQuestion, HubStore } from './store';

interface FormInspector { inspectFormFields(pageId: string): Promise<FormField[]> }

/** Explicit, read-only inspection creates one independent wait task per missing field. */
export async function requestMissingApplicationFields(hub: HubStore, applications: ApplicationStore,
  browser: FormInspector, applicationId: string, pageId: string): Promise<{
    fields: FormField[]; requested: HubQuestion[]; alreadyKnown: string[]; alreadyRequested: string[]; needsManual: string[]
  }> {
  const app = applications.get(applicationId);
  if (!app) throw new Error('Candidatura não encontrada');
  if (!['draft', 'awaiting_approval', 'approved'].includes(app.status)) throw new Error('Candidatura com envio iniciado não pode receber novas perguntas');
  const specialist = hub.listAgents().find((agent) => agent.systemKey === 'job-search/applications' && agent.status !== 'ended');
  if (!specialist) throw new Error('Especialista em candidaturas indisponível');
  const fields = await browser.inspectFormFields(pageId);
  const requested: HubQuestion[] = [], alreadyKnown: string[] = [], alreadyRequested: string[] = [], needsManual: string[] = [];
  const labels = new Map<string, number>();
  for (const field of fields) if (field.label) labels.set(field.label, (labels.get(field.label) ?? 0) + 1);
  for (const field of fields.filter((item) => item.required)) {
    const label = field.label;
    if (!label || !field.fillable || labels.get(label) !== 1 || !/^[\p{L}\p{N}_ .-]{1,100}$/u.test(label) ||
      /\b(senha|password|token|secret|chave de api)\b/i.test(label)) { needsManual.push(label || 'Campo sem rótulo'); continue; }
    if (app.answers[label]) { alreadyKnown.push(label); continue; }
    if (hub.listQuestions().some((question) => question.applicationId === app.id && question.fieldName === label && question.state !== 'cancelled')) {
      alreadyRequested.push(label); continue;
    }
    if (requested.length >= 20) { needsManual.push(label); continue; }
    const instruction = `application-field:${app.id}:${label}`;
    const existing = hub.listTasks().find((task) => task.agentId === specialist.id && task.instruction === instruction &&
      (task.status === 'unassigned' || task.status === 'queued'));
    const task = existing ?? hub.createTask({ agentId: specialist.id, instruction, priority: 4 });
    requested.push(hub.askQuestion({ taskId: task.id, applicationId: app.id, fieldName: label,
      text: `Para a candidatura ${app.title} em ${app.company}, qual informação confirmada deve preencher o campo “${label}”?` }));
  }
  return { fields, requested, alreadyKnown, alreadyRequested, needsManual };
}
