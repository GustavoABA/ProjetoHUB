import type { ApplicationStore } from './applications';
import type { HubStore } from './store';

/** Replays answered application fields safely after a crash between the two persisted stores. */
export function reconcileApplicationAnswers(hub: HubStore, applications: ApplicationStore): number {
  let applied = 0;
  for (const question of hub.listQuestions()) {
    if (question.state !== 'answered' || !question.answer || !question.applicationId || !question.fieldName || question.appliedAt) continue;
    try {
      const app = applications.get(question.applicationId);
      if (!app) throw new Error('Candidatura não encontrada');
      if (!['draft', 'awaiting_approval', 'approved'].includes(app.status)) throw new Error('Candidatura com envio iniciado não pode ser editada');
      if (app.answers[question.fieldName] !== question.answer) applications.setAnswers(app.id, { ...app.answers, [question.fieldName]: question.answer });
      hub.markQuestionApplied(question.id);
      applied++;
    } catch (error) {
      hub.markQuestionSyncError(question.id, error instanceof Error ? error.message : 'Falha ao registrar resposta na candidatura');
    }
  }
  return applied;
}
