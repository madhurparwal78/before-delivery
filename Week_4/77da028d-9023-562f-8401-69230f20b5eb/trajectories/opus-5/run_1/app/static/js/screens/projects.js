import { api } from '../api.js';
import { clear, el, textbox } from '../dom.js';
import { close, openDialog } from '../dialog.js';
import { duration } from '../format.js';
import { paintSkyDisc } from '../skychart.js';

export async function renderProjects(main, context) {
  const cards = el('div', { class: 'cards' });
  const updates = el('div', {
    role: 'status',
    'aria-label': 'Project updates',
  });
  const newProject = el('button', {
    type: 'button',
    class: 'pill',
    text: 'New project',
  });

  main.append(
    el('div', { class: 'stack' }, [
      el('h1', { text: 'Projects' }),
      context.card,
      newProject,
      cards,
      updates,
    ]),
  );

  async function paint() {
    const { projects } = await api('GET', '/api/projects');
    clear(cards);
    if (!projects.length) {
      const disc = el('canvas', { role: 'img', 'aria-label': 'Sky disc' });
      cards.append(
        el('div', { class: 'hero-empty' }, [
          disc,
          el('p', { text: 'No projects yet. Start one with New project.' }),
        ]),
      );
      requestAnimationFrame(() => paintSkyDisc(disc, null));
      return;
    }
    for (const project of projects) {
      cards.append(
        el('article', { class: 'card', 'aria-label': project.name }, [
          el('h2', {}, [el('a', { href: `/projects/${project.id}`, text: project.name })]),
          el('p', { class: 'muted', text: `${project.target_name} \u00b7 ${project.state}` }),
          el('p', {
            class: 'num',
            text: `${duration(project.total_integration_seconds)} total`,
          }),
          el(
            'ul',
            { class: 'filters num muted' },
            project.filters.map((entry) =>
              el('li', {
                text: `${entry.filter}: owed ${duration(entry.owed_seconds)}`,
              }),
            ),
          ),
        ]),
      );
    }
  }

  newProject.addEventListener('click', () => {
    const name = textbox('Project name', { id: 'np-name' });
    const target = textbox('Target name', { id: 'np-target' });
    const ra = textbox('Right ascension (degrees)', { id: 'np-ra' });
    const dec = textbox('Declination (degrees)', { id: 'np-dec' });
    const summary = el('div', {
      role: 'alert',
      'aria-label': 'Error summary',
      class: 'error-summary',
      hidden: true,
    });
    const dialog = openDialog({
      name: 'New project',
      body: [
        el('h2', { text: 'New project' }),
        summary,
        el('div', { class: 'form-grid' }, [
          el('div', { class: 'field' }, [
            el('label', { for: 'np-name', text: 'Project name' }),
            name,
          ]),
          el('div', { class: 'field' }, [
            el('label', { for: 'np-target', text: 'Target name' }),
            target,
          ]),
          el('div', { class: 'field' }, [
            el('label', { for: 'np-ra', text: 'Right ascension (degrees)' }),
            ra,
          ]),
          el('div', { class: 'field' }, [
            el('label', { for: 'np-dec', text: 'Declination (degrees)' }),
            dec,
          ]),
        ]),
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button',
            class: 'pill',
            text: 'Create project',
            onclick: async () => {
              clear(summary);
              summary.hidden = true;
              try {
                const created = await api('POST', '/api/projects', {
                  name: name.value.trim(),
                  target_name: target.value.trim(),
                  ra_deg: Number(ra.value),
                  dec_deg: Number(dec.value),
                });
                close(dialog);
                updates.textContent = `Project is now ${created.state}.`;
                await paint();
              } catch (error) {
                summary.hidden = false;
                summary.append(el('p', { text: error.message }));
                if (error.fields) {
                  summary.append(
                    el(
                      'ul',
                      {},
                      Object.entries(error.fields).map(([field, message]) =>
                        el('li', {}, [
                          el('a', {
                            href: '#',
                            text: `${field}: ${message}`,
                            onclick: (click) => {
                              click.preventDefault();
                              const controls = { name, target_name: target, ra_deg: ra, dec_deg: dec };
                              if (controls[field]) controls[field].focus();
                            },
                          }),
                        ]),
                      ),
                    ),
                  );
                }
              }
            },
          }),
          el('button', { type: 'button', text: 'Cancel', onclick: () => close(dialog) }),
        ]),
      ],
    });
  });

  await paint();
}
