import http from 'http';
import { onEvent } from '../lib/logging';

const sseClients = new Set<http.ServerResponse>();

/** Broadcast an SSE event to every connected client. */
export function broadcastSSE(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try { client.write(message); } catch { sseClients.delete(client); }
    }
}

export function addSSEClient(res: http.ServerResponse): void {
    sseClients.add(res);
}

export function removeSSEClient(res: http.ServerResponse): void {
    sseClients.delete(res);
}

// Wire emitEvent → SSE so every queue-processor event is also pushed to the web.
onEvent((type, data) => {
    broadcastSSE(type, { type, timestamp: Date.now(), ...data });
});
