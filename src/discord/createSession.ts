import {
  ChannelType,
  GuildBasedChannel,
  GuildTextBasedChannel,
  TextChannel,
  VoiceChannel
} from "discord.js";
import { client, getConfiguredCategory, getConfiguredGuild, ensureBotGuildPermissions } from "../bot.js";
import { logger } from "../utils/logger.js";
import {
  buildTextPermissionOverwrites,
  buildVoicePermissionOverwrites,
  resolveUser
} from "./permissions.js";

const SESSION_DURATION_MINUTES = 10;
const SESSION_DURATION_MS = SESSION_DURATION_MINUTES * 60 * 1000;

const activeSessions = new Map<string, NodeJS.Timeout>();

export class SessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export type CreateSessionInput = {
  user1Id: string;
  user2Id: string;
  matchId: string;
};

export type CreateSessionResult = {
  voice: string;
  text: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validateMatchId = (matchId: string): void => {
  if (!uuidPattern.test(matchId)) {
    throw new SessionError("VALIDATION_ERROR", "match_id must be a valid UUID", 400);
  }
};

const deleteChannelIfExists = async (channel: GuildBasedChannel | null): Promise<void> => {
  if (!channel) {
    return;
  }

  await channel.delete("Duo Seek session cleanup").catch((error: unknown) => {
    logger.warn("Session channel cleanup skipped", {
      channel_id: channel.id,
      error: error instanceof Error ? error.message : String(error)
    });
  });
};

const scheduleCleanup = (matchId: string, voiceChannel: VoiceChannel, textChannel: TextChannel): void => {
  const timeout = setTimeout(async () => {
    logger.info("Cleaning up expired Duo session", {
      match_id: matchId,
      voice_channel_id: voiceChannel.id,
      text_channel_id: textChannel.id
    });

    await Promise.all([deleteChannelIfExists(voiceChannel), deleteChannelIfExists(textChannel)]);
    activeSessions.delete(matchId);
  }, SESSION_DURATION_MS);

  timeout.unref();
  activeSessions.set(matchId, timeout);
};

export const createDiscordSession = async ({
  user1Id,
  user2Id,
  matchId
}: CreateSessionInput): Promise<CreateSessionResult> => {
  validateMatchId(matchId);

  if (user1Id === user2Id) {
    throw new SessionError("VALIDATION_ERROR", "user1_id and user2_id must be different users", 400);
  }

  if (activeSessions.has(matchId)) {
    throw new SessionError("DUPLICATE_SESSION", "A session already exists for this match_id", 409);
  }

  const guild = await getConfiguredGuild();
  await ensureBotGuildPermissions(guild);

  const category = await getConfiguredCategory(guild);
  const botId = client.user?.id;

  if (!botId) {
    throw new SessionError("BOT_NOT_READY", "Discord bot is not ready", 503);
  }

  try {
    await Promise.all([resolveUser(client, user1Id), resolveUser(client, user2Id)]);
  } catch {
    throw new SessionError("INVALID_USER", "One or both Discord user IDs could not be resolved", 400);
  }

  let voiceChannel: VoiceChannel | null = null;
  let textChannel: TextChannel | null = null;

  try {
    // Create voice first, then text, so partial failures can be cleaned up deterministically.
    voiceChannel = await guild.channels.create({
      name: `duo-${matchId}`,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: buildVoicePermissionOverwrites({
        guildId: guild.id,
        user1Id,
        user2Id,
        botId
      })
    });

    textChannel = await guild.channels.create({
      name: `duo-${matchId}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: buildTextPermissionOverwrites({
        guildId: guild.id,
        user1Id,
        user2Id,
        botId
      })
    });

    await (textChannel as GuildTextBasedChannel).send(
      `🎮 Duo session started!\nYou have ${SESSION_DURATION_MINUTES} minutes to play.\n\nUse this channel to communicate.`
    );

    scheduleCleanup(matchId, voiceChannel, textChannel);

    logger.info("Duo session created", {
      match_id: matchId,
      user1_id: user1Id,
      user2_id: user2Id,
      voice_channel_id: voiceChannel.id,
      text_channel_id: textChannel.id
    });

    return {
      voice: voiceChannel.id,
      text: textChannel.id
    };
  } catch (error) {
    await Promise.all([deleteChannelIfExists(voiceChannel), deleteChannelIfExists(textChannel)]);

    logger.error("Failed to create Duo session", {
      match_id: matchId,
      user1_id: user1Id,
      user2_id: user2Id,
      error: error instanceof Error ? error.message : String(error)
    });

    if (error instanceof SessionError) {
      throw error;
    }

    throw new SessionError("CHANNEL_CREATION_FAILED", "Failed to create Discord session channels", 500);
  }
};
