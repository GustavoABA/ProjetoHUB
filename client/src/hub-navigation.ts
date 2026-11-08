import { tr } from '../../shared/i18n';

const views = [
  ['agents', 'Agentes'], ['tasks', 'Tarefas'], ['jobs', 'Vagas'], ['applications', 'Candidaturas'],
  ['browser', 'Navegador'], ['settings', 'Configurações'],
] as const;
type View = typeof views[number][0];

/** Moves existing HUD controls into panels without replacing them or their listeners. */
export function mountHubNavigation(panel: HTMLElement, close: () => void): void {
  const heading = panel.querySelector(':scope > .hub-head');
  const intro = heading?.nextElementSibling;
  const message = panel.querySelector('#projecthub-message');
  if (!heading || !intro || !message) throw new Error('Painel ProjetoHUB incompleto');
  intro.after(message);

  const sections = new Map<View, HTMLElement>();
  const tabs = new Map<View, HTMLButtonElement>();
  const nav = document.createElement('nav'); nav.id = 'hub-nav'; nav.setAttribute('aria-label', tr('Visões do escritório'));
  const office = document.createElement('button'); office.type = 'button'; office.dataset.view = 'office'; office.textContent = tr('Escritório'); office.onclick = close;
  const tablist = document.createElement('div'); tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', tr('Áreas do ProjetoHUB'));
  nav.append(office, tablist);
  for (const [id, label] of views) {
    const section = document.createElement('section'); section.id = `hub-view-${id}`; section.className = 'hub-view';
    section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', `hub-tab-${id}`);
    const tab = document.createElement('button'); tab.type = 'button'; tab.id = `hub-tab-${id}`; tab.dataset.view = id;
    tab.textContent = tr(label); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', section.id);
    tablist.append(tab); sections.set(id, section); tabs.set(id, tab);
  }
  const original = [...panel.children].filter((child) => child !== heading && child !== intro && child !== message);
  let current: View | undefined;
  for (const child of original) {
    if (child.tagName === 'H3') {
      const view = (child as HTMLElement).dataset.hubView as View | undefined;
      if (!view || !sections.has(view)) throw new Error('Seção do ProjetoHUB sem visão configurada');
      current = view;
    }
    if (!current) throw new Error('Conteúdo do ProjetoHUB sem visão configurada');
    sections.get(current)!.append(child);
  }
  heading.after(nav);
  panel.append(...sections.values());

  const activate = (view: View, focus = false) => {
    for (const [id, section] of sections) {
      const selected = id === view;
      section.hidden = !selected;
      const tab = tabs.get(id)!;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    if (focus) tabs.get(view)?.focus();
    sections.get(view)!.scrollTop = 0;
  };
  for (const [view, tab] of tabs) tab.onclick = () => activate(view);
  tablist.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const selected = views.findIndex(([id]) => tabs.get(id)?.getAttribute('aria-selected') === 'true');
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1
      : (selected + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
    event.preventDefault(); activate(views[next][0], true);
  });
  activate('agents');
}
