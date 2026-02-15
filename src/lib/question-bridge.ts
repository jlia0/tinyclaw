import fs from 'fs';
import path from 'path';
import { QuestionData, AnswerData } from './types';
import { QUEUE_QUESTIONS, QUEUE_ANSWERS } from './config';
import { log } from './logging';

// Ensure queue directories exist
[QUEUE_QUESTIONS, QUEUE_ANSWERS].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

/**
 * System prompt instructing Claude to output questions in a parseable format
 * instead of using the (disabled) AskUserQuestion tool.
 */
export const QUESTION_PROMPT = `MANDATORY: You are communicating through a messaging app (Telegram). You CANNOT ask questions as plain text — the user cannot type free-form answers easily. When you need to ask the user ANY clarifying question, you MUST use this structured format so the system can render interactive buttons:

[QUESTION]{"question":"Your question here","options":[{"label":"Option 1","description":"Brief description"},{"label":"Option 2","description":"Brief description"}],"multiSelect":false}[/QUESTION]

Rules:
- NEVER ask questions as plain text. ALWAYS use the [QUESTION] tag format above.
- Provide 2-4 concrete options the user can tap. Include an option for "other" if the list isn't exhaustive.
- Set "multiSelect":true if the user can pick more than one.
- Ask ONE question at a time. After outputting a [QUESTION] block, STOP and wait for the user's response.
- You may include a brief sentence of context before the [QUESTION] tag, but nothing after it.
- Do NOT answer the question yourself or assume what the user wants.`;

interface ParsedQuestion {
    question: string;
    options: { label: string; description?: string }[];
    multiSelect: boolean;
}

/**
 * Parse [QUESTION]{json}[/QUESTION] blocks from Claude's response text.
 * Treats model output as untrusted — any parse failure returns empty array.
 */
export function parseQuestions(text: string): ParsedQuestion[] {
    const questions: ParsedQuestion[] = [];
    const regex = /\[QUESTION\]([\s\S]*?)\[\/QUESTION\]/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        try {
            const json = JSON.parse(match[1].trim());

            // Validate required fields
            if (
                typeof json.question !== 'string' ||
                !Array.isArray(json.options) ||
                json.options.length === 0
            ) {
                log('WARN', `Invalid question structure, skipping: ${match[1].substring(0, 100)}`);
                continue;
            }

            // Validate each option has a label
            const validOptions = json.options.filter(
                (o: any) => typeof o?.label === 'string' && o.label.trim().length > 0
            );
            if (validOptions.length === 0) {
                log('WARN', `No valid options in question, skipping`);
                continue;
            }

            questions.push({
                question: json.question,
                options: validOptions.map((o: any) => ({
                    label: o.label,
                    description: typeof o.description === 'string' ? o.description : undefined,
                })),
                multiSelect: !!json.multiSelect,
            });
        } catch (e) {
            log('WARN', `Failed to parse question JSON: ${(e as Error).message}`);
            // Continue — other questions in the response might be valid
        }
    }

    return questions;
}

/**
 * Strip [QUESTION]...[/QUESTION] tags from response text,
 * preserving any text before/between tags.
 */
export function stripQuestionTags(text: string): string {
    return text.replace(/\[QUESTION\][\s\S]*?\[\/QUESTION\]/g, '').trim();
}

/**
 * Write a question to the questions queue for the channel client to pick up.
 */
export function emitQuestion(question: QuestionData): void {
    const filename = `${question.channel}_${question.questionId}.json`;
    const filepath = path.join(QUEUE_QUESTIONS, filename);
    fs.writeFileSync(filepath, JSON.stringify(question, null, 2));
    log('INFO', `Emitted question ${question.questionId} to ${filename}`);
}

/**
 * Poll for an answer file in the answers queue.
 * Returns the answer data or null on timeout.
 *
 * @param questionId - The question ID to wait for
 * @param timeoutMs - Max wait time (default 5 minutes)
 * @param intervalMs - Poll interval (default 500ms)
 */
export function pollForAnswer(
    questionId: string,
    timeoutMs: number = 5 * 60 * 1000,
    intervalMs: number = 500
): Promise<AnswerData | null> {
    const answerFile = path.join(QUEUE_ANSWERS, `answer_${questionId}.json`);
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve) => {
        const check = () => {
            if (Date.now() > deadline) {
                log('WARN', `Answer poll timed out for question ${questionId}`);
                resolve(null);
                return;
            }

            if (fs.existsSync(answerFile)) {
                try {
                    const data: AnswerData = JSON.parse(fs.readFileSync(answerFile, 'utf8'));
                    // Clean up the answer file after reading
                    try { fs.unlinkSync(answerFile); } catch {}
                    log('INFO', `Received answer for question ${questionId}: ${data.answer}`);
                    resolve(data);
                    return;
                } catch (e) {
                    // Malformed answer file — delete to prevent infinite retry
                    try { fs.unlinkSync(answerFile); } catch {}
                    log('WARN', `Malformed answer file for ${questionId}, deleted: ${(e as Error).message}`);
                    resolve(null);
                    return;
                }
            }

            setTimeout(check, intervalMs);
        };

        check();
    });
}

/**
 * Write an answer file with exclusive-create semantics (wx flag).
 * Returns true if written, false if answer already exists (duplicate tap).
 */
export function writeAnswer(questionId: string, answer: string): boolean {
    const answerFile = path.join(QUEUE_ANSWERS, `answer_${questionId}.json`);

    // Ensure directory exists
    if (!fs.existsSync(QUEUE_ANSWERS)) {
        fs.mkdirSync(QUEUE_ANSWERS, { recursive: true });
    }

    const data: AnswerData = {
        questionId,
        answer,
        answeredAt: Date.now(),
    };

    try {
        fs.writeFileSync(answerFile, JSON.stringify(data, null, 2), { flag: 'wx' });
        return true;
    } catch (e: any) {
        if (e.code === 'EEXIST') {
            log('WARN', `Answer already exists for question ${questionId} (duplicate tap)`);
            return false;
        }
        throw e;
    }
}
