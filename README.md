# Duo Seek Discord Bot

Production-ready Discord bot for Duo Seek matchmaking sessions. The Next.js + Supabase backend calls this service after two users accept a match, and the bot creates a private Discord text and voice session for them.

## Features

- Discord.js v14 bot client
- Express API for session creation and extension
- Private text and voice channels inside a configured category
- Clean channel names with player usernames and short match IDs
- Website-ready Discord join links
- Waiting timer: users have 60 seconds to join voice
- Voice join detection through `voiceStateUpdate`
- Active session timer: 5 minutes after both users join
- Session extensions from the website or Discord text channel
- Automatic cleanup with safe channel deletion
- Duplicate `match_id` protection while a session is active
- Typed request validation and structured error responses
- Railway-ready build/start scripts

## Project Structure

```text
src/
  index.ts
  bot.ts
  server.ts
  discord/
    createSession.ts
    listeners.ts
    permissions.ts
    sessions.ts
  utils/
    logger.ts
```

## Environment Variables

Create `.env` from `.env.example` and fill in the values:

```env
DISCORD_TOKEN=
DISCORD_GUILD_ID=
DISCORD_CATEGORY_ID=
PORT=3000
```

## Discord Setup

1. Create an application in the Discord Developer Portal.
2. Add a bot user and copy its token into `DISCORD_TOKEN`.
3. Enable the privileged `Message Content Intent`, required for `!extend 30` and `!extend 60`.
4. Invite the bot to your server with these permissions:
   - Manage Channels
   - View Channels
   - Send Messages
   - Read Message History
   - Connect
   - Speak
5. Copy the guild ID into `DISCORD_GUILD_ID`.
6. Create a category for Duo Seek sessions and copy its ID into `DISCORD_CATEGORY_ID`.

## Session Lifecycle

1. Backend calls `POST /create-session`.
2. Bot creates:
   - Voice: `🎙️ duo-{user1}-{user2}-{shortId}`
   - Text: `💬 duo-{user1}-{user2}-{shortId}`
3. Session starts in `waiting` state and expires after 60 seconds if both users do not join voice.
4. When both matched users are present in the voice channel, the session becomes `active`.
5. Active sessions expire after 5 minutes unless extended.
6. Expiry deletes both Discord channels and removes the session from memory.

Session state is currently in memory. If the bot restarts, active sessions are not restored; the bot logs this warning on startup.

## API

### `POST /create-session`

Request:

```json
{
  "user1_id": "discord_user_id",
  "user2_id": "discord_user_id",
  "match_id": "uuid"
}
```

Success response:

```json
{
  "success": true,
  "voice_channel_id": "123",
  "text_channel_id": "456",
  "voice_join_url": "https://discord.com/channels/guild/123",
  "text_channel_url": "https://discord.com/channels/guild/456",
  "voice_channel_name": "🎙️ duo-playerone-playertwo-ab12cd",
  "text_channel_name": "💬 duo-playerone-playertwo-ab12cd",
  "expires_at": "2026-04-30T12:01:00.000Z",
  "state": "waiting",
  "channel_ids": {
    "voice": "123",
    "text": "456"
  },
  "session": {
    "match_id": "ab12cd34-0000-4000-9000-000000000000",
    "user1_id": "111111111111111111",
    "user2_id": "222222222222222222",
    "voice_channel_id": "123",
    "text_channel_id": "456",
    "voice_channel_name": "🎙️ duo-playerone-playertwo-ab12cd",
    "text_channel_name": "💬 duo-playerone-playertwo-ab12cd",
    "voice_join_url": "https://discord.com/channels/guild/123",
    "text_channel_url": "https://discord.com/channels/guild/456",
    "state": "waiting",
    "expires_at": "2026-04-30T12:01:00.000Z",
    "joined_users": []
  }
}
```

### `POST /extend-session`

Request:

```json
{
  "match_id": "ab12cd34-0000-4000-9000-000000000000",
  "duration": 30
}
```

`duration` must be `30` or `60` minutes, and the session must already be `active`.

Success response:

```json
{
  "success": true,
  "session": {
    "match_id": "ab12cd34-0000-4000-9000-000000000000",
    "state": "active",
    "expires_at": "2026-04-30T12:35:00.000Z"
  }
}
```

Error response:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "duration must be 30 or 60 minutes"
  }
}
```

## Discord Commands

Inside the session text channel, either matched player can run:

```text
!extend 30
!extend 60
```

The bot rejects commands from users who are not part of that Duo session.

## Backend Integration Example

```ts
type DuoSessionResponse = {
  success: true;
  voice_channel_id: string;
  text_channel_id: string;
  voice_join_url: string;
  text_channel_url: string;
  expires_at: string;
  state: "waiting" | "active";
};

export async function createDiscordSession(match: {
  matchId: string;
  user1DiscordId: string;
  user2DiscordId: string;
}): Promise<DuoSessionResponse> {
  const response = await fetch(`${process.env.DISCORD_BOT_URL}/create-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      match_id: match.matchId,
      user1_id: match.user1DiscordId,
      user2_id: match.user2DiscordId
    })
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error?.message ?? "Failed to create Discord session");
  }

  return data;
}
```

## Local Development

```bash
npm install
npm run build
npm run dev
```

## Railway Deployment

1. Create a new Railway project from this repository.
2. Set environment variables in Railway:
   - `DISCORD_TOKEN`
   - `DISCORD_GUILD_ID`
   - `DISCORD_CATEGORY_ID`
   - `PORT` can be omitted because Railway injects one automatically.
3. Railway will install dependencies and run:

```bash
npm run build
npm start
```

4. Configure the backend service to call:

```http
POST https://your-railway-service.up.railway.app/create-session
POST https://your-railway-service.up.railway.app/extend-session
```
