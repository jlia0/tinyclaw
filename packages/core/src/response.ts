import fs from 'fs';
import path from 'path';
import { FILES_DIR } from './config';
import { log, emitEvent } from './logging';
import { runOutgoingHooks } from './plugins';
import { enqueueResponse } from './queues';

export const LONG_RESPONSE_THRESHOLD = 4000;

/**
 * If a response exceeds the threshold, save full text as a .md file
 * and return a truncated preview with the file attached.
 */
export function handleLongResponse(
    response: string,
    existingFiles: string[]
): { message: string; files: string[] } {
    if (response.length <= LONG_RESPONSE_THRESHOLD) {
        return { message: response, files: existingFiles };
    }

    // Save full response as a .md file
    const filename = `response_${Date.now()}.md`;
    const filePath = path.join(FILES_DIR, filename);
    fs.writeFileSync(filePath, response);
    log('INFO', `Long response (${response.length} chars) saved to ${filename}`);

    // Truncate to preview
    const preview = response.substring(0, LONG_RESPONSE_THRESHOLD) + '\n\n_(Full response attached as file)_';

    return { message: preview, files: [...existingFiles, filePath] };
}

/**
 * Collect files from a response text.
 */
export function collectFiles(response: string, fileSet: Set<string>): void {
    const fileRegex = /\[send_file:\s*([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = fileRegex.exec(response)) !== null) {
        const filePath = match[1].trim();
        if (fs.existsSync(filePath)) fileSet.add(filePath);
    }
}

/**
 * Shared pipeline for processing and enqueuing a response.
 * Used by both direct responses and streamed team responses.
 *
 * Pipeline: transform? → collectFiles + strip tags → runOutgoingHooks → handleLongResponse → enqueueResponse → emitEvent
 */
export async function streamResponse(response: string, options: {
    channel: string;
    sender: string;
    senderId?: string;
    messageId: string;
    originalMessage: string;
    agentId: string;
    transform?: (text: string) => string;
}): Promise<void> {
    let finalResponse = response.trim();

    if (options.transform) {
        finalResponse = options.transform(finalResponse);
    }

    const outboundFilesSet = new Set<string>();
    collectFiles(finalResponse, outboundFilesSet);
    const outboundFiles = Array.from(outboundFilesSet);
    if (outboundFiles.length > 0) {
        finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
    }

    const { text: hookedResponse, metadata } = await runOutgoingHooks(finalResponse, {
        channel: options.channel, sender: options.sender, messageId: options.messageId, originalMessage: options.originalMessage,
    });
    const { message: responseMessage, files: allFiles } = handleLongResponse(hookedResponse, outboundFiles);

    enqueueResponse({
        channel: options.channel,
        sender: options.sender,
        senderId: options.senderId,
        message: responseMessage,
        originalMessage: options.originalMessage,
        messageId: options.messageId,
        agent: options.agentId,
        files: allFiles.length > 0 ? allFiles : undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    log('INFO', `@${options.agentId} responded:\n${finalResponse}`);
    emitEvent('message:done', { channel: options.channel, sender: options.sender, agentId: options.agentId, responseLength: finalResponse.length, responseText: finalResponse, messageId: options.messageId });
}
