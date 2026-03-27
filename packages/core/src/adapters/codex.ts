import { AgentAdapter, InvokeOptions } from './types';
import { runCommand, runCommandStreaming } from '../invoke';
import { log } from '../logging';

/**
 * Extract displayable text from a Codex JSONL event.
 */
function extractEventText(json: any): string | null {
    if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
        return json.item.text || null;
    }
    return null;
}

export const codexAdapter: AgentAdapter = {
    providers: ['openai'],

    async invoke(opts: InvokeOptions): Promise<string> {
        const { agentId, message, workingDir, systemPrompt, model, shouldReset, envOverrides, onEvent } = opts;
        log('DEBUG', `Using Codex CLI (agent: ${agentId})`);

        const args = ['exec'];
        if (shouldReset) {
            log('INFO', `Resetting Codex conversation for agent: ${agentId}`);
        } else {
            args.push('resume', '--last');
        }
        if (model) args.push('--model', model);
        if (systemPrompt) args.push('-c', `developer_instructions=${systemPrompt}`);
        args.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

        let response = '';

        if (onEvent) {
            const { promise } = runCommandStreaming('codex', args, (line) => {
                try {
                    const json = JSON.parse(line);
                    const text = extractEventText(json);
                    if (text) {
                        response = text;
                        onEvent(text);
                    }
                } catch (e) {
                    // Ignore non-JSON lines
                }
            }, workingDir, envOverrides, agentId);
            await promise;
        } else {
            const output = await runCommand('codex', args, workingDir, envOverrides);
            const lines = output.trim().split('\n');
            for (const line of lines) {
                try {
                    const json = JSON.parse(line);
                    if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                        response = json.item.text;
                    }
                } catch (e) {
                    // Ignore non-JSON lines
                }
            }
        }

        return response || 'Sorry, I could not generate a response from Codex.';
    },
};
