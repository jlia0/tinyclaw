/**
 * Lightweight SSE client using Node's built-in http module.
 * Connects to the local API server's event stream and dispatches events.
 * Auto-reconnects on disconnect.
 */

import http from 'http';

export interface SSEClientOptions {
    port: number;
    path?: string;
    /** Called for each SSE event */
    onEvent: (eventType: string, data: Record<string, unknown>) => void;
    /** Called when connected / reconnected */
    onConnect?: () => void;
    /** Delay before reconnect in ms (default 5000) */
    reconnectDelay?: number;
}

export function createSSEClient(options: SSEClientOptions): { close: () => void } {
    const {
        port,
        path = '/api/events/stream',
        onEvent,
        onConnect,
        reconnectDelay = 5000,
    } = options;

    let closed = false;
    let currentReq: http.ClientRequest | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect(): void {
        if (closed) return;

        const req = http.get({ hostname: 'localhost', port, path }, (res: http.IncomingMessage) => {
            if (res.statusCode !== 200) {
                res.resume();
                scheduleReconnect();
                return;
            }

            onConnect?.();

            let buffer = '';
            let currentEvent = '';
            let currentData = '';

            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
                buffer += chunk;
                const lines = buffer.split('\n');
                // Keep incomplete last line in buffer
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEvent = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        currentData = line.slice(6);
                    } else if (line === '') {
                        // Empty line = end of event
                        if (currentEvent && currentData) {
                            try {
                                const parsed = JSON.parse(currentData);
                                onEvent(currentEvent, parsed);
                            } catch {
                                // ignore malformed data
                            }
                        }
                        currentEvent = '';
                        currentData = '';
                    }
                }
            });

            res.on('end', () => {
                scheduleReconnect();
            });

            res.on('error', () => {
                scheduleReconnect();
            });
        });

        req.on('error', () => {
            scheduleReconnect();
        });

        currentReq = req;
    }

    function scheduleReconnect(): void {
        if (closed) return;
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, reconnectDelay);
    }

    function close(): void {
        closed = true;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (currentReq) {
            currentReq.destroy();
            currentReq = null;
        }
    }

    connect();
    return { close };
}
