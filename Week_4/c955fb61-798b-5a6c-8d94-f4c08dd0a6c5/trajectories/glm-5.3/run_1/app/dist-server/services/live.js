// The live channel and presence. One Server-Sent Events stream per open project.
export class LiveHub {
    presenceTimeoutSeconds;
    listeners = new Map();
    selected = new Map(); // projectId -> userId -> itemId
    seen = new Map(); // `${projectId}:${userId}` -> last seen
    constructor(presenceTimeoutSeconds) {
        this.presenceTimeoutSeconds = presenceTimeoutSeconds;
    }
    subscribe(projectId, userId, res) {
        const set = this.listeners.get(projectId) ?? new Set();
        set.add(res);
        this.listeners.set(projectId, set);
        const people = this.selected.get(projectId) ?? new Map();
        people.set(userId, null);
        this.selected.set(projectId, people);
        this.seen.set(key(projectId, userId), new Date());
    }
    unsubscribe(projectId, userId, res) {
        const set = this.listeners.get(projectId);
        if (set !== undefined) {
            set.delete(res);
            if (set.size === 0)
                this.listeners.delete(projectId);
        }
        this.seen.delete(key(projectId, userId));
    }
    heartbeat(projectId, userId) {
        this.seen.set(key(projectId, userId), new Date());
    }
    select(projectId, userId, itemId) {
        const people = this.selected.get(projectId);
        if (people !== undefined)
            people.set(userId, itemId);
        this.seen.set(key(projectId, userId), new Date());
    }
    leave(projectId, userId) {
        const people = this.selected.get(projectId);
        if (people !== undefined)
            people.delete(userId);
        this.seen.delete(key(projectId, userId));
    }
    /** Everyone with the project open, with the bar they have focused. */
    peopleHere(projectId) {
        const people = this.selected.get(projectId);
        if (people === undefined)
            return [];
        const cutoff = Date.now() - this.presenceTimeoutSeconds * 1000;
        const result = [];
        for (const [userId, selected] of people.entries()) {
            const at = this.seen.get(key(projectId, userId));
            if (at !== undefined && at.getTime() >= cutoff)
                result.push({ userId, selected });
        }
        return result;
    }
    /** Drop people who stopped sending heartbeats. */
    sweep() {
        const cutoff = Date.now() - this.presenceTimeoutSeconds * 1000;
        for (const [k, at] of this.seen.entries()) {
            if (at.getTime() < cutoff) {
                const [projectId, userId] = splitKey(k);
                const people = this.selected.get(projectId);
                if (people !== undefined)
                    people.delete(userId);
                this.seen.delete(k);
            }
        }
    }
    publish(projectId, message) {
        const set = this.listeners.get(projectId);
        if (set === undefined)
            return;
        const data = `data: ${JSON.stringify(message)}\n\n`;
        for (const res of set)
            res.write(data);
    }
}
function key(projectId, userId) {
    return `${projectId}:${userId}`;
}
function splitKey(k) {
    const index = k.indexOf(':');
    return [k.slice(0, index), k.slice(index + 1)];
}
