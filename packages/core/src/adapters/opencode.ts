import { AgentAdapter, InvokeOptions } from './types';
import { runCommand, runCommandStreaming } from '../invoke';
import { log } from '../logging';

/**
 * Extract displayable text from an OpenCode JSONL event.
 */
function extractEventText(json: any): string | null {
    if (json.type === 'text' && json.part?.text) {
        return json.part.text;
    }
    return null;
}

export const opencodeAdapter: AgentAdapter = {
    providers: ['opencode'],

    async invoke(opts: InvokeOptions): Promise<string> {
        const { agentId, message, workingDir, systemPrompt, model, shouldReset, envOverrides, onEvent } = opts;
        log('DEBUG', `Using OpenCode CLI (agent: ${agentId}, model: ${model})`);

        const continueConversation = !shouldReset;
        if (shouldReset) {
            log('INFO', `Resetting OpenCode conversation for agent: ${agentId}`);
        }

        // Pass system prompt via OPENCODE_CONFIG_CONTENT env var
        if (systemPrompt) {
            const configContent = JSON.stringify({
                agent: {
                    [agentId]: {
                        prompt: systemPrompt
                    }
                }
            });
            envOverrides.OPENCODE_CONFIG_CONTENT = configContent;
        }

        const args = ['run', '--format', 'json'];
        if (model) args.push('--model', model);
        if (systemPrompt) args.push('--agent', agentId);
        if (continueConversation) args.push('-c');
        args.push(message);

        let response = '';

        if (onEvent) {
            const { promise } = runCommandStreaming('opencode', args, (line) => {
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
            const output = await runCommand('opencode', args, workingDir, envOverrides);
            const lines = output.trim().split('\n');
            for (const line of lines) {
                try {
                    const json = JSON.parse(line);
                    if (json.type === 'text' && json.part?.text) {
                        response = json.part.text;
                    }
                } catch (e) {
                    // Ignore non-JSON lines
                }
            }
        }

        return response || 'Sorry, I could not generate a response from OpenCode.';
    },
};
