// The browser's one fetch layer, plus the live channel subscription.
export class ApiFail extends Error {
    status;
    body;
    constructor(status, body) {
        super(String(body.error ?? status));
        this.status = status;
        this.body = body;
    }
}
async function request(method, path, body) {
    const init = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { 'Content-Type': 'application/json' };
    }
    const res = await fetch(path, init);
    const text = await res.text();
    const parsed = text === '' ? {} : JSON.parse(text);
    if (!res.ok) {
        throw new ApiFail(res.status, (parsed ?? {}));
    }
    return parsed;
}
export const api = {
    health: () => request('GET', '/api/health'),
    config: () => request('GET', '/api/config'),
    signup: (body) => request('POST', '/api/signup', body),
    signin: (body) => request('POST', '/api/session', body),
    signout: () => request('DELETE', '/api/session'),
    me: () => request('GET', '/api/me'),
    projects: () => request('GET', '/api/projects'),
    createProject: (body) => request('POST', '/api/projects', body),
    project: (id) => request('GET', `/api/projects/${id}`),
    createItem: (projectId, body) => request('POST', `/api/projects/${projectId}/items`, body),
    patchItem: (id, body) => request(`PATCH`, `/api/items/${id}`, body),
    deleteItem: (id) => request('DELETE', `/api/items/${id}`),
    reorder: (id, direction) => request('POST', `/api/items/${id}/reorder`, { direction }),
    predecessors: (id, baseVersion, text) => request('PUT', `/api/items/${id}/predecessors`, { baseVersion, text }),
    createLink: (projectId, body) => request('POST', `/api/projects/${projectId}/links`, body),
    deleteLink: (id) => request('DELETE', `/api/links/${id}`),
    addHoliday: (projectId, body) => request('POST', `/api/projects/${projectId}/holidays`, body),
    removeHoliday: (projectId, date) => request('DELETE', `/api/projects/${projectId}/holidays/${date}`),
    saveBaseline: (projectId, body) => request('POST', `/api/projects/${projectId}/baseline`, body),
    addAssignee: (itemId, body) => request('POST', `/api/items/${itemId}/assignees`, body),
    removeAssignee: (itemId, userId) => request('DELETE', `/api/items/${itemId}/assignees/${userId}`),
    comments: (itemId) => request('GET', `/api/items/${itemId}/comments`),
    postComment: (itemId, text) => request('POST', `/api/items/${itemId}/comments`, { text }),
    workload: (workspaceId, from) => request('GET', `/api/workspaces/${workspaceId}/workload?from=${from}`),
    presence: (projectId, selected) => request('GET', `/api/projects/${projectId}/presence?selected=${selected ?? ''}`),
    createExport: (projectId, format) => request('POST', `/api/projects/${projectId}/exports`, { format }),
    exports: (projectId) => request('GET', `/api/projects/${projectId}/exports`),
};
export function openLive(projectId, onEvent) {
    const source = new EventSource(`/api/projects/${projectId}/live`);
    source.onmessage = (message) => {
        try {
            onEvent(JSON.parse(message.data));
        }
        catch {
            // Ignore malformed frames.
        }
    };
    return source;
}
