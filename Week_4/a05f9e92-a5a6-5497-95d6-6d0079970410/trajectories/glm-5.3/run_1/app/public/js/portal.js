// The requester portal: knowledge search, catalog and my requests.
import { api, announce, navigate } from './core.js';
import { currentUser } from './shell.js';
/** The portal: three regions in a responsive grid. */
export async function portal() {
    const section = document.createElement('section');
    const user = currentUser();
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gap = '16px';
    if (window.matchMedia('(min-width: 1024px)').matches) {
        grid.style.gridTemplateColumns = '1fr 1fr 1fr';
    }
    else if (window.matchMedia('(min-width: 768px)').matches) {
        grid.style.gridTemplateColumns = '1fr 1fr';
    }
    else {
        grid.style.gridTemplateColumns = '1fr';
    }
    const searchRegion = document.createElement('div');
    searchRegion.setAttribute('role', 'region');
    searchRegion.setAttribute('aria-label', 'Search knowledge');
    const search = document.createElement('input');
    search.type = 'search';
    search.setAttribute('aria-label', 'Search knowledge');
    const results = document.createElement('ul');
    results.setAttribute('aria-label', 'Knowledge results');
    searchRegion.append(search, results);
    const runSearch = async () => {
        const query = search.value.trim();
        if (!query) {
            results.textContent = '';
            return;
        }
        const data = await api(`/api/knowledge/articles?q=${encodeURIComponent(query)}`);
        results.textContent = '';
        if (!data.articles.length) {
            const line = document.createElement('p');
            line.className = 'state-line';
            line.textContent = `No articles match "${query}".`;
            const report = document.createElement('button');
            report.className = 'solid';
            report.textContent = 'Report a fault';
            report.addEventListener('click', () => navigate('/portal/fault'));
            line.appendChild(report);
            results.appendChild(line);
            return;
        }
        for (const article of data.articles) {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = `/portal/knowledge/${article.number}`;
            link.textContent = article.title;
            item.appendChild(link);
            results.appendChild(item);
        }
    };
    let timer;
    search.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void runSearch(), 300);
    });
    grid.appendChild(searchRegion);
    const catalogRegion = document.createElement('div');
    catalogRegion.setAttribute('role', 'region');
    catalogRegion.setAttribute('aria-label', 'Catalog');
    const items = await api('/api/catalog/items');
    const catalogList = document.createElement('ul');
    for (const item of items.items) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/portal/items/${item.id}`;
        link.textContent = item.name;
        li.appendChild(link);
        catalogList.appendChild(li);
    }
    const guideLink = document.createElement('a');
    guideLink.href = '/portal/guides/new-starter';
    guideLink.textContent = 'New starter';
    const faultLink = document.createElement('a');
    faultLink.href = '/portal/fault';
    faultLink.textContent = 'Report a fault';
    catalogRegion.append(catalogList, guideLink, faultLink);
    grid.appendChild(catalogRegion);
    const mineRegion = document.createElement('div');
    mineRegion.setAttribute('role', 'region');
    mineRegion.setAttribute('aria-label', 'My requests');
    const mine = document.createElement('ul');
    if (user) {
        const incidents = await api('/api/tables/incident/records');
        for (const incident of incidents.records) {
            const li = document.createElement('li');
            const link = document.createElement('a');
            link.href = `/portal/incidents/${incident.number}`;
            link.textContent = `${incident.number} ${incident.short_description}: ${incident.state_label}`;
            li.appendChild(link);
            mine.appendChild(li);
        }
    }
    mineRegion.appendChild(mine);
    grid.appendChild(mineRegion);
    section.appendChild(grid);
    return section;
}
/** A catalog item with its typed variables. */
export async function catalogItem(id) {
    const section = document.createElement('section');
    section.className = 'white';
    section.setAttribute('data-subject', id);
    const wrapper = document.createElement('div');
    wrapper.style.maxWidth = '64ch';
    wrapper.style.margin = '0 auto';
    const data = await api(`/api/catalog/items/${encodeURIComponent(id)}`);
    wrapper.setAttribute('data-name', data.item.name);
    const heading = document.createElement('h2');
    heading.textContent = data.item.name;
    wrapper.appendChild(heading);
    const form = document.createElement('form');
    const values = {};
    for (const variable of data.item.variables) {
        const label = document.createElement('label');
        label.textContent = variable.label;
        let control;
        if (variable.type === 'select') {
            const select = document.createElement('select');
            select.setAttribute('aria-label', variable.label);
            control = select;
        }
        else if (variable.type === 'checkbox') {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.setAttribute('aria-label', variable.label);
            control = checkbox;
        }
        else if (variable.type === 'number') {
            const spin = document.createElement('input');
            spin.type = 'number';
            spin.setAttribute('aria-label', variable.label);
            control = spin;
        }
        else {
            const input = document.createElement('input');
            input.setAttribute('aria-label', variable.label);
            control = input;
        }
        label.appendChild(control);
        form.appendChild(label);
    }
    const quantity = document.createElement('label');
    quantity.textContent = 'Quantity';
    const quantityInput = document.createElement('input');
    quantityInput.type = 'number';
    quantityInput.value = '1';
    quantityInput.setAttribute('aria-label', 'Quantity');
    quantity.appendChild(quantityInput);
    form.appendChild(quantity);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'solid';
    submit.textContent = 'Add to cart';
    form.appendChild(submit);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        submit.textContent = 'Saving...';
        try {
            await api('/api/cart/lines', {
                method: 'POST',
                body: JSON.stringify({ item: id, quantity: Number(quantityInput.value) || 1, variables: values }),
            });
            announce('Added to cart.');
            navigate('/portal/cart');
        }
        catch (err) {
            submit.textContent = 'Add to cart';
            announce(err instanceof Error ? err.message : 'The item could not be added.');
        }
    });
    wrapper.appendChild(form);
    section.appendChild(wrapper);
    return section;
}
/** An order guide: questions, then the resolved item groups. */
export async function orderGuide(id) {
    const section = document.createElement('section');
    section.className = 'white';
    const wrapper = document.createElement('div');
    wrapper.style.maxWidth = '64ch';
    wrapper.style.margin = '0 auto';
    const data = await api(`/api/catalog/guides/${encodeURIComponent(id)}`);
    const guide = data.guide;
    wrapper.setAttribute('data-name', guide.name);
    const heading = document.createElement('h2');
    heading.textContent = guide.name;
    wrapper.appendChild(heading);
    const form = document.createElement('form');
    const answers = {};
    for (const question of guide.questions) {
        const label = document.createElement('label');
        label.textContent = question.label;
        const select = document.createElement('select');
        select.setAttribute('aria-label', question.label);
        for (const choice of question.choices ?? []) {
            const option = document.createElement('option');
            option.value = choice.value;
            option.textContent = choice.label;
            select.appendChild(option);
        }
        select.addEventListener('change', () => {
            answers[question.name] = select.value;
            void resolve();
        });
        label.appendChild(select);
        form.appendChild(label);
    }
    const groups = document.createElement('div');
    form.appendChild(groups);
    const resolve = async () => {
        const resolved = await api(`/api/catalog/guides/${encodeURIComponent(id)}/resolve`, {
            method: 'POST',
            body: JSON.stringify({ answers }),
        });
        groups.textContent = '';
        for (const itemId of resolved.items) {
            const group = document.createElement('div');
            group.setAttribute('role', 'group');
            const itemData = await api(`/api/catalog/items/${encodeURIComponent(itemId)}`);
            group.setAttribute('aria-label', itemData.item.name);
            group.textContent = itemData.item.name;
            groups.appendChild(group);
        }
    };
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'solid';
    submit.textContent = 'Add all to cart';
    form.appendChild(submit);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const resolved = await api(`/api/catalog/guides/${encodeURIComponent(id)}/resolve`, {
            method: 'POST',
            body: JSON.stringify({ answers }),
        });
        for (const itemId of resolved.items) {
            await api('/api/cart/lines', { method: 'POST', body: JSON.stringify({ item: itemId, quantity: 1, variables: {} }) });
        }
        announce('Added to cart.');
        navigate('/portal/cart');
    });
    wrapper.appendChild(form);
    section.appendChild(wrapper);
    return section;
}
/** The cart: submit creates one request with one item per line. */
export async function cart() {
    const section = document.createElement('section');
    section.className = 'white';
    const wrapper = document.createElement('div');
    wrapper.style.maxWidth = '64ch';
    wrapper.style.margin = '0 auto';
    const data = await api('/api/cart');
    const heading = document.createElement('h2');
    heading.textContent = 'Cart';
    wrapper.appendChild(heading);
    const list = document.createElement('ul');
    for (const line of data.lines) {
        const li = document.createElement('li');
        li.textContent = `${line.item} x${line.quantity}`;
        const remove = document.createElement('button');
        remove.textContent = `Remove ${line.item}`;
        remove.addEventListener('click', async () => {
            await api(`/api/cart/lines/${line.id}`, { method: 'DELETE' });
            navigate('/portal/cart');
        });
        li.appendChild(remove);
        list.appendChild(li);
    }
    wrapper.appendChild(list);
    const submit = document.createElement('button');
    submit.className = 'solid';
    submit.textContent = 'Submit request';
    submit.addEventListener('click', async () => {
        submit.textContent = 'Submitting...';
        try {
            const result = await api('/api/cart/checkout', {
                method: 'POST',
                body: JSON.stringify({ requested_for: null }),
            });
            announce(`Request ${result.request.number} submitted with ${result.request.items.length} items.`);
            navigate(`/portal/requests/${result.request.number}`);
        }
        catch (err) {
            submit.textContent = 'Submit request';
            announce(err instanceof Error ? err.message : 'The request could not be submitted.');
        }
    });
    wrapper.appendChild(submit);
    section.appendChild(wrapper);
    return section;
}
/** The request page tracks each item and task. */
export async function requestPage(number) {
    const section = document.createElement('section');
    section.className = 'white';
    const wrapper = document.createElement('div');
    wrapper.style.maxWidth = '64ch';
    wrapper.style.margin = '0 auto';
    const heading = document.createElement('h2');
    heading.textContent = number;
    wrapper.appendChild(heading);
    const data = await api(`/api/requests/${encodeURIComponent(number)}`);
    const status = document.createElement('div');
    status.setAttribute('role', 'region');
    status.setAttribute('aria-label', 'Request status');
    const list = document.createElement('ul');
    for (const item of data.request.items) {
        const li = document.createElement('li');
        li.textContent = `${item.number} ${item.item}: ${item.state_label}`;
        list.appendChild(li);
        for (const task of item.tasks) {
            const sub = document.createElement('li');
            sub.textContent = `${task.number}: ${task.state_label}`;
            list.appendChild(sub);
        }
    }
    status.appendChild(list);
    wrapper.appendChild(status);
    section.appendChild(wrapper);
    return section;
}
/** Report a fault: an incident with the signed-in person as caller. */
export async function reportFault() {
    const section = document.createElement('section');
    section.className = 'white';
    const wrapper = document.createElement('div');
    wrapper.style.maxWidth = '64ch';
    wrapper.style.margin = '0 auto';
    const form = document.createElement('form');
    form.setAttribute('aria-label', 'Report a fault');
    const shortLabel = document.createElement('label');
    shortLabel.textContent = 'Short description';
    const short = document.createElement('input');
    short.setAttribute('aria-label', 'Short description');
    shortLabel.appendChild(short);
    form.appendChild(shortLabel);
    const descLabel = document.createElement('label');
    descLabel.textContent = 'Description';
    const description = document.createElement('textarea');
    description.setAttribute('aria-label', 'Description');
    descLabel.appendChild(description);
    form.appendChild(descLabel);
    const ciLabel = document.createElement('label');
    ciLabel.textContent = 'Service or item';
    const ci = document.createElement('input');
    ci.setAttribute('aria-label', 'Service or item');
    ciLabel.appendChild(ci);
    form.appendChild(ciLabel);
    const suggestions = document.createElement('ul');
    suggestions.setAttribute('aria-label', 'Suggested articles');
    form.appendChild(suggestions);
    let timer;
    short.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(async () => {
            const data = await api(`/api/knowledge/suggest?text=${encodeURIComponent(short.value)}`);
            suggestions.textContent = '';
            for (const article of data.articles) {
                const li = document.createElement('li');
                const link = document.createElement('a');
                link.href = `/portal/knowledge/${article.number}`;
                link.textContent = article.title;
                li.appendChild(link);
                suggestions.appendChild(li);
            }
        }, 300);
    });
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'solid';
    submit.textContent = 'Report fault';
    form.appendChild(submit);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const result = await api('/api/tables/incident/records', {
                method: 'POST',
                body: JSON.stringify({ fields: { short_description: short.value, description: description.value, configuration_item: ci.value || null } }),
            });
            announce(`Saved ${result.record.number}.`);
            navigate(`/portal/incidents/${result.record.number}`);
        }
        catch (err) {
            announce(err instanceof Error ? err.message : 'The fault could not be reported.');
        }
    });
    wrapper.appendChild(form);
    section.appendChild(wrapper);
    return section;
}
/** The portal incident page: state, SLA, comments and reopen. */
export async function portalIncident(number) {
    const section = document.createElement('section');
    section.className = 'white';
    const wrapper = document.createElement('div');
    wrapper.style.maxWidth = '64ch';
    wrapper.style.margin = '0 auto';
    const heading = document.createElement('h2');
    heading.textContent = number;
    wrapper.appendChild(heading);
    const data = await api(`/api/records/${encodeURIComponent(number)}`);
    const status = document.createElement('div');
    status.setAttribute('role', 'region');
    status.setAttribute('aria-label', 'Incident status');
    status.textContent = `${number}: ${data.record.state_label}`;
    wrapper.appendChild(status);
    const sla = document.createElement('div');
    sla.setAttribute('role', 'region');
    sla.setAttribute('aria-label', 'SLA');
    for (const view of data.record.slas) {
        if (view.stage === 'cancelled')
            continue;
        const row = document.createElement('p');
        row.textContent = `${view.definition}: ${view.percent} percent`;
        sla.appendChild(row);
    }
    wrapper.appendChild(sla);
    const comments = await api(`/api/records/${encodeURIComponent(number)}/activity`);
    const commentList = document.createElement('ul');
    commentList.setAttribute('aria-label', 'Comments');
    for (const entry of comments.entries.filter(e => e.kind === 'comment')) {
        const li = document.createElement('li');
        li.textContent = `${entry.actor}: ${entry.text}`;
        commentList.appendChild(li);
    }
    wrapper.appendChild(commentList);
    const commentLabel = document.createElement('label');
    commentLabel.textContent = 'Comment';
    const comment = document.createElement('textarea');
    comment.setAttribute('aria-label', 'Comment');
    commentLabel.appendChild(comment);
    wrapper.appendChild(commentLabel);
    const add = document.createElement('button');
    add.textContent = 'Add comment';
    add.addEventListener('click', async () => {
        await api(`/api/records/${encodeURIComponent(number)}/comments`, { method: 'POST', body: JSON.stringify({ text: comment.value }) });
        announce('Note added.');
        navigate(`/portal/incidents/${number}`);
    });
    wrapper.appendChild(add);
    if (data.record.state_label === 'Resolved') {
        const reopen = document.createElement('button');
        reopen.textContent = 'Reopen';
        reopen.addEventListener('click', () => {
            const dialog = document.createElement('dialog');
            dialog.setAttribute('aria-label', 'Reopen');
            const form = document.createElement('form');
            const label = document.createElement('label');
            label.textContent = 'Reopen reason';
            const input = document.createElement('input');
            input.setAttribute('aria-label', 'Reopen reason');
            label.appendChild(input);
            const submit = document.createElement('button');
            submit.textContent = 'Reopen incident';
            submit.addEventListener('click', async () => {
                await api(`/api/records/${encodeURIComponent(number)}/transition`, {
                    method: 'POST',
                    body: JSON.stringify({ to: 'in_progress', fields: { reopen_reason: { value: input.value, version: 1 } } }),
                });
                announce(`${number} moved to In progress.`);
                dialog.close();
                navigate(`/portal/incidents/${number}`);
            });
            form.append(label, submit);
            dialog.appendChild(form);
            document.body.appendChild(dialog);
            dialog.showModal();
        });
        wrapper.appendChild(reopen);
    }
    section.appendChild(wrapper);
    return section;
}
/** An article with helpful votes. */
export async function article(number) {
    const section = document.createElement('section');
    section.className = 'white';
    const wrapper = document.createElement('div');
    wrapper.style.maxWidth = '64ch';
    wrapper.style.margin = '0 auto';
    const data = await api(`/api/knowledge/articles/${encodeURIComponent(number)}`);
    const heading = document.createElement('h2');
    heading.textContent = data.article.title;
    wrapper.appendChild(heading);
    const body = document.createElement('p');
    body.textContent = data.article.body;
    wrapper.appendChild(body);
    const helpful = document.createElement('button');
    helpful.textContent = 'Helpful';
    helpful.addEventListener('click', async () => {
        await api(`/api/knowledge/articles/${encodeURIComponent(number)}/vote`, { method: 'POST', body: JSON.stringify({ helpful: true }) });
        announce('Vote recorded.');
    });
    const notHelpful = document.createElement('button');
    notHelpful.textContent = 'Not helpful';
    notHelpful.addEventListener('click', async () => {
        await api(`/api/knowledge/articles/${encodeURIComponent(number)}/vote`, { method: 'POST', body: JSON.stringify({ helpful: false }) });
        announce('Vote recorded.');
    });
    wrapper.append(helpful, notHelpful);
    section.appendChild(wrapper);
    return section;
}
