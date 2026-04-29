# Duo Seek Discord Bot

Production-ready Discord bot for Duo Seek matchmaking sessions. The Next.js + Supabase backend calls this service after two users are matched, and the bot creates a private Discord text and voice session for them.

## Features

- Discord.js v14 bot client
- Express API endpoint for session creation
- Private text and voice channels inside a configured category
- Permission overwrites for only the two matched users and the bot
- Duplicate `match_id` protection while a session is active
- Automatic cleanup after 10 minutes
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
    permissions.ts
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
3. Invite the bot to your server with these permissions:
   - Manage Channels
   - View Channels
   - Send Messages
   - Read Message History
   - Connect
   - Speak
4. Copy the guild ID into `DISCORD_GUILD_ID`.
5. Create a category for Duo Seek sessions and copy its ID into `DISCORD_CATEGORY_ID`.

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
  "channel_ids": {
    "voice": "...",
    "text": "..."
  }
}
```

Error response:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "user1_id must be a valid Discord snowflake"
  }
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
```
