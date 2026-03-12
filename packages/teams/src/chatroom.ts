export type GroupedChatroomResult = {
    messages: any[];
    messageIds: number[][];
};

export function groupChatroomMessages(messages: any[]): GroupedChatroomResult {
    const grouped: any[] = [];
    const messageIds: number[][] = [];
    let pendingChatroom: any[] = [];

    const flushChatroom = () => {
        if (pendingChatroom.length === 0) return;
        grouped.push(buildCombinedMessage(pendingChatroom));
        messageIds.push(pendingChatroom.map(m => m.id));
        pendingChatroom = [];
    };

    for (const msg of messages) {
        if (msg.channel === 'chatroom') {
            pendingChatroom.push(msg);
            continue;
        }
        flushChatroom();
        grouped.push(msg);
        messageIds.push([msg.id]);
    }
    flushChatroom();

    return { messages: grouped, messageIds };
}

function buildCombinedMessage(messages: any[]): any {
    const first = messages[0];
    const combinedMessage = messages.map(m => m.message).join('\n\n');

    return {
        ...first,
        message: combinedMessage,
        message_id: `chatroom_batch_${first.message_id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
}
