# Access Control Guide

TinyClaw does not currently have built-in access control. Anyone who can DM your bot can use it. Since agents run with `--dangerously-skip-permissions`, this is an open door to arbitrary code execution.

This guide explains how to add user-level and group-level access control to each channel client.

---

## 1. Settings Schema

Add `allowed_users` and `allowed_groups` to each channel in `~/.tinyclaw/settings.json`:

```json
{
  "channels": {
    "telegram": {
      "bot_token": "...",
      "allowed_users": ["123456789", "987654321"],
      "allowed_groups": ["-1001234567890"]
    },
    "whatsapp": {
      "bot_token": "...",
      "allowed_users": ["6591234567@c.us", "6289876543@c.us"],
      "allowed_groups": ["120363xxx@g.us"]
    },
    "discord": {
      "bot_token": "...",
      "allowed_users": ["108234567890123456"],
      "allowed_groups": ["998877665544332211"]
    }
  }
}
```

**Rule**: Empty array or missing field = allow everyone (backwards compatible, opt-in).

---

## 2. How to Find User/Group IDs

### Telegram

- **User ID**: Message your bot, then check the log at `~/.tinyclaw/logs/telegram.log`. The `senderId` is logged for every message. Or use the `@userinfobot` on Telegram.
- **Group ID**: Add the bot to a group, send a message, and check the log. Group IDs are negative numbers (e.g. `-1001234567890`).

### WhatsApp

- **User ID**: Check `~/.tinyclaw/logs/whatsapp.log` after someone messages the bot. The `senderId` (format: `6591234567@c.us`) is logged on every message. It is also `message.from` in the code.
- **Group ID**: Add the bot to a group, send a message, and check the log. Group IDs end with `@g.us`.

### Discord

- **User ID**: Enable Developer Mode in Discord settings, then right-click a user and "Copy User ID".
- **Server/Guild ID**: Right-click the server name and "Copy Server ID". Use this as the group ID.

---

## 3. Code Changes Per Channel

### Shared Pattern

Each channel client needs two things:

1. A function to load the allowlist from settings
2. A guard at the top of the message handler

The logic is identical across all three channels:

```typescript
// Load access control lists from settings
function loadAccessControl(): { allowedUsers: string[], allowedGroups: string[] } {
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        const channelConfig = settings.channels?.CHANNEL_NAME || {};
        return {
            allowedUsers: channelConfig.allowed_users || [],
            allowedGroups: channelConfig.allowed_groups || [],
        };
    } catch {
        return { allowedUsers: [], allowedGroups: [] };
    }
}

// Check if a user/group is allowed
function isAllowed(userId: string, groupId?: string): boolean {
    const { allowedUsers, allowedGroups } = loadAccessControl();

    // No allowlist configured = allow everyone
    if (allowedUsers.length === 0 && allowedGroups.length === 0) {
        return true;
    }

    // Check user allowlist
    if (allowedUsers.length > 0 && allowedUsers.includes(userId)) {
        return true;
    }

    // Check group allowlist
    if (groupId && allowedGroups.length > 0 && allowedGroups.includes(groupId)) {
        return true;
    }

    return false;
}
```

---

### Telegram (`src/telegram-client.ts`)

Replace `CHANNEL_NAME` with `telegram` in the helper above, then add the guard right after the private chat check (line ~239):

```typescript
// existing: skip group/channel messages
if (msg.chat.type !== 'private') {
    return;
}

// --- ADD ACCESS CONTROL HERE ---
const telegramUserId = msg.from ? msg.from.id.toString() : msg.chat.id.toString();
if (!isAllowed(telegramUserId)) {
    log('INFO', `Blocked message from unauthorized user: ${telegramUserId}`);
    return;
}
```

**To also support allowed groups**, remove the `msg.chat.type !== 'private'` early return, and pass the group ID:

```typescript
const telegramUserId = msg.from ? msg.from.id.toString() : '';
const telegramGroupId = msg.chat.type !== 'private' ? msg.chat.id.toString() : undefined;

if (!isAllowed(telegramUserId, telegramGroupId)) {
    log('INFO', `Blocked message from unauthorized user/group: ${telegramUserId} / ${telegramGroupId}`);
    return;
}
```

This way, messages from allowed groups are also accepted (e.g. a shared team chat).

---

### WhatsApp (`src/whatsapp-client.ts`)

Replace `CHANNEL_NAME` with `whatsapp`, then add the guard right after the group check (line ~220):

```typescript
// existing: skip group messages
if (chat.isGroup) {
    return;
}

// --- ADD ACCESS CONTROL HERE ---
const whatsappUserId = message.from; // e.g. "6591234567@c.us"
if (!isAllowed(whatsappUserId)) {
    log('INFO', `Blocked message from unauthorized user: ${whatsappUserId}`);
    return;
}
```

**To also support allowed groups**, remove the `chat.isGroup` early return, and pass the group ID:

```typescript
const whatsappUserId = message.from;    // e.g. "6591234567@c.us"
const whatsappGroupId = chat.isGroup ? (message as any).from ?? chat.id._serialized : undefined;
// For groups, message.from is the group ID like "120363xxx@g.us"
// The actual sender in a group is message.author

if (!isAllowed(whatsappUserId, whatsappGroupId)) {
    log('INFO', `Blocked message from unauthorized user/group: ${whatsappUserId} / ${whatsappGroupId}`);
    return;
}
```

**Note on WhatsApp groups**: In group messages, `message.from` is the group JID and `message.author` is the individual sender. To allowlist by group, use `chat.id._serialized` as the group ID. To also restrict which users within an allowed group can talk, check both:

```typescript
if (chat.isGroup) {
    const groupId = chat.id._serialized;
    const authorId = message.author; // individual sender within group
    if (!isAllowed(authorId || '', groupId)) return;
} else {
    if (!isAllowed(message.from)) return;
}
```

---

### Discord (`src/discord-client.ts`)

Replace `CHANNEL_NAME` with `discord`, then add the guard right after the guild check (line ~209):

```typescript
// existing: skip non-DM messages
if (message.guild) {
    return;
}

// --- ADD ACCESS CONTROL HERE ---
const discordUserId = message.author.id;
if (!isAllowed(discordUserId)) {
    log('INFO', `Blocked message from unauthorized user: ${discordUserId}`);
    return;
}
```

**To also support allowed servers/guilds**, remove the `message.guild` early return and pass the guild ID:

```typescript
const discordUserId = message.author.id;
const discordGuildId = message.guild ? message.guild.id : undefined;

if (!isAllowed(discordUserId, discordGuildId)) {
    log('INFO', `Blocked message from unauthorized user/guild: ${discordUserId} / ${discordGuildId}`);
    return;
}
```

---

## 4. Admin CLI Commands

Add these to `tinyclaw.sh` for convenience:

```bash
# Add an allowed user to a channel
# Usage: tinyclaw allow <channel> <user_id>
tinyclaw_allow() {
    local channel="$1"
    local user_id="$2"
    local tmp_file="$SETTINGS_FILE.tmp"

    jq --arg ch "$channel" --arg uid "$user_id" \
        '.channels[$ch].allowed_users = ((.channels[$ch].allowed_users // []) + [$uid] | unique)' \
        "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    echo "Allowed user $user_id on $channel"
}

# Remove an allowed user
# Usage: tinyclaw deny <channel> <user_id>
tinyclaw_deny() {
    local channel="$1"
    local user_id="$2"
    local tmp_file="$SETTINGS_FILE.tmp"

    jq --arg ch "$channel" --arg uid "$user_id" \
        '.channels[$ch].allowed_users = [.channels[$ch].allowed_users[]? | select(. != $uid)]' \
        "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    echo "Removed user $user_id from $channel"
}

# Add an allowed group to a channel
# Usage: tinyclaw allow-group <channel> <group_id>
tinyclaw_allow_group() {
    local channel="$1"
    local group_id="$2"
    local tmp_file="$SETTINGS_FILE.tmp"

    jq --arg ch "$channel" --arg gid "$group_id" \
        '.channels[$ch].allowed_groups = ((.channels[$ch].allowed_groups // []) + [$gid] | unique)' \
        "$SETTINGS_FILE" > "$tmp_file" && mv "$tmp_file" "$SETTINGS_FILE"

    echo "Allowed group $group_id on $channel"
}

# List all allowed users/groups
# Usage: tinyclaw allowed
tinyclaw_allowed() {
    for channel in telegram whatsapp discord; do
        echo "=== $channel ==="
        echo "  Users:  $(jq -r ".channels.$channel.allowed_users // [] | join(\", \")" "$SETTINGS_FILE")"
        echo "  Groups: $(jq -r ".channels.$channel.allowed_groups // [] | join(\", \")" "$SETTINGS_FILE")"
        echo ""
    done
}
```

**Usage:**

```bash
tinyclaw allow telegram 123456789
tinyclaw allow whatsapp "6591234567@c.us"
tinyclaw allow-group telegram "-1001234567890"
tinyclaw allowed
tinyclaw deny telegram 123456789
```

No restart needed -- the allowlist is read from `settings.json` on every incoming message.

---

## 5. Optional: Unauthorized Reply

Instead of silently dropping messages, you can send a short reply:

```typescript
if (!isAllowed(userId, groupId)) {
    log('INFO', `Blocked unauthorized: ${userId}`);
    // Optionally reply (remove if you prefer silent drop)
    await reply('You are not authorized to use this bot.');
    return;
}
```

Silent drop is more secure (doesn't confirm the bot exists). Reply is more user-friendly.

---

## 6. Summary

| Step | What | Where |
|------|-------|-------|
| 1 | Add `allowed_users` / `allowed_groups` arrays | `~/.tinyclaw/settings.json` under each channel |
| 2 | Add `loadAccessControl()` + `isAllowed()` helpers | Each `src/*-client.ts` |
| 3 | Add guard after existing chat-type filters | Each message handler, ~5 lines of code |
| 4 | Add CLI commands for managing allowlists | `tinyclaw.sh` |

Total: ~20 lines of new code per channel client. No new dependencies. No restart required for allowlist changes.
