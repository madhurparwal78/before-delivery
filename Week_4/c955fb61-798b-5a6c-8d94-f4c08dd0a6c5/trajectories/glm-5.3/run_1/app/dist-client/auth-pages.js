// Sign-in, sign-up and the signed-in Projects list, with the New project dialog.
import { api, ApiFail } from "./api.js";
function shell(title) {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    const heading = document.createElement('h1');
    heading.textContent = title;
    const form = document.createElement('form');
    form.className = 'form-column';
    wrap.append(heading, form);
    return { page: wrap, form };
}
export function renderSignIn(root, next) {
    const { page: wrap, form } = shell('Sign in');
    form.innerHTML = `
    <label>Email <input type="email" name="email" autocomplete="email"></label>
    <label>Password <input type="password" name="password" autocomplete="current-password"></label>
    <button type="submit" class="primary">Sign in</button>
    <p class="form-error" role="alert" id="form-alert" hidden></p>
    <p>New here? <a class="plain-link" href="/signup">Start a plan</a></p>
  `;
    const alert = form.querySelector('#form-alert');
    const email = form.querySelector('input[name="email"]');
    const password = form.querySelector('input[name="password"]');
    const button = form.querySelector('button');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        alert.hidden = true;
        button.disabled = true;
        try {
            await api.signin({ email: email.value, password: password.value });
            window.location.href = next;
        }
        catch (error) {
            const message = error instanceof ApiFail && error.status === 401 ? 'Email or password is incorrect.' : 'Your change could not be saved. Try again.';
            alert.textContent = message;
            alert.hidden = false;
        }
        finally {
            button.disabled = false;
        }
    });
    root.replaceChildren(wrap);
    email.focus();
}
export function renderSignUp(root, next) {
    const { page: wrap, form } = shell('Start a plan');
    form.innerHTML = `
    <label>Name <input type="text" name="name" autocomplete="name"></label>
    <label>Email <input type="email" name="email" autocomplete="email"></label>
    <label>Password <input type="password" name="password" autocomplete="new-password"></label>
    <button type="submit" class="primary">Create account</button>
    <p class="form-error" role="alert" id="form-alert" hidden></p>
    <p>Already have an account? <a class="plain-link" href="/signin">Sign in</a></p>
  `;
    const alert = form.querySelector('#form-alert');
    const name = form.querySelector('input[name="name"]');
    const email = form.querySelector('input[name="email"]');
    const password = form.querySelector('input[name="password"]');
    const button = form.querySelector('button');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        alert.hidden = true;
        const trimName = name.value.trim();
        if (trimName.length === 0) {
            alert.textContent = 'Enter your name.';
            alert.hidden = false;
            return;
        }
        button.disabled = true;
        try {
            await api.signup({ name: trimName, email: email.value, password: password.value });
            window.location.href = next;
        }
        catch (error) {
            let message = 'Your change could not be saved. Try again.';
            if (error instanceof ApiFail) {
                if (error.status === 409)
                    message = 'That email already has an account.';
                else if (error.status === 422) {
                    const field = String(error.body.field);
                    if (field === 'name')
                        message = 'Enter your name.';
                    else if (field === 'email')
                        message = 'Enter a valid email address.';
                    else
                        message = 'Password must be at least 10 characters.';
                }
            }
            alert.textContent = message;
            alert.hidden = false;
        }
        finally {
            button.disabled = false;
        }
    });
    root.replaceChildren(wrap);
    name.focus();
}
export async function renderProjects(root, me) {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    const list = await api.projects();
    wrap.innerHTML = `<h1>Projects</h1>`;
    const ul = document.createElement('ul');
    ul.className = 'projects-list';
    for (const project of list.projects) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `/projects/${project.id}`;
        a.textContent = project.name;
        li.append(a);
        ul.append(li);
    }
    ul.setAttribute('aria-label', 'Projects');
    const button = document.createElement('button');
    button.id = 'new-project';
    button.textContent = 'New project';
    button.addEventListener('click', () => openNewProject(wrap, me));
    wrap.append(ul, button);
    root.replaceChildren(wrap);
}
function openNewProject(page, me) {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'New project');
    const eligible = me.workspaces.filter((w) => w.role === 'owner' || w.role === 'editor');
    const defaultWorkspace = eligible[0]?.id ?? '';
    dialog.innerHTML = `
    <form class="dialog-body" method="dialog">
      <h2>New project</h2>
      <label>Project name <input name="name" autocomplete="off"></label>
      <label>Workspace
        <select name="workspace">
          ${eligible.map((w) => `<option value="${w.id}" ${w.id === defaultWorkspace ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('')}
        </select>
      </label>
      <p class="alert" role="alert" id="np-alert" hidden></p>
      <div class="dialog-actions">
        <button type="submit" class="primary">Create project</button>
        <button type="button" data-cancel>Cancel</button>
      </div>
    </form>
  `;
    page.append(dialog);
    const form = dialog.querySelector('form');
    const alert = dialog.querySelector('#np-alert');
    const nameInput = dialog.querySelector('input[name="name"]');
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (name.length < 1 || name.length > 80) {
            alert.textContent = 'Project name must be 1 to 80 characters.';
            alert.hidden = false;
            return;
        }
        const workspace = form.elements.namedItem('workspace').value;
        try {
            const result = await api.createProject({ name, workspace });
            window.location.href = `/projects/${result.project.id}`;
        }
        catch {
            alert.textContent = 'Your change could not be saved. Try again.';
            alert.hidden = false;
        }
    });
    dialog.showModal();
    trapTabs(dialog);
    nameInput.focus();
}
export function trapTabs(container) {
    container.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab')
            return;
        const focusables = Array.from(container.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (focusables.length === 0)
            return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
}
export function escapeHtml(value) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
