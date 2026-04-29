import { ChannelType, GuildBasedChannel, GuildTextBasedChannel, TextChannel, User, VoiceChannel } from "discord.js";
import { client, ensureBotGuildPermissions, getConfiguredCategory, getConfiguredGuild } from "../bot.js";
import { logger } from "../utils/logger.js";
import { buildTextPermissionOverwrites, buildVoicePermissionOverwrites } from "./permissions.js";
import {
  getSessionByMatchId,
  registerWaitingSession,
  SessionApiView,
  SessionError,
  toSessionApiView,
  WAITING_DURATION_MS
} from "./sessions.js";

export type CreateSessionInput = {
  user1Id: string;
  user2Id: string;
  matchId: string;
};

export type CreateSessionResult = SessionApiView;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validateMatchId = (matchId: string): void => {
  if (!uuidPattern.test(matchId)) {
    throw new SessionError("VALIDATION_ERROR", "match_id must be a valid UUID", 400);
  }
};

const cleanUsername = (username: string): string => {
  const cleaned = username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 18);

  return cleaned || "player";
};

const buildShortMatchId = (matchId: string): string => matchId.replace(/-/g, "").slice(0, 6);

const buildSessionChannelNames = (user1: User, user2: User, matchId: string): { voice: string; text: string } => {
  const base = `${cleanUsername(user1.username)}-${cleanUsername(user2.username)}-${buildShortMatchId(matchId)}`;
  const maxBaseLength = 76;
  const safeBase = base.length > maxBaseLength ? base.slice(0, maxBaseLength) : base;

  return {
    voice: `🎙️ duo-${safeBase}`,
    text: `💬 duo-${safeBase}`
  };
};

const buildChannelUrl = (guildId: string, channelId: string): string => {
  return `https://discord.com/channels/${guildId}/${channelId}`;
};

const deleteChannelIfExists = async (channel: GuildBasedChannel | null): Promise<void> => {
  if (!channel) {
    return;
  }

  await channel.delete("Duo Seek session creation rollback").catch((error: unknown) => {
    logger.warn("Session channel rollback skipped", {
      channel_id: channel.id,
      error: error instanceof Error ? error.message : String(error)
    });
  });
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

  if (getSessionByMatchId(matchId)) {
    throw new SessionError("DUPLICATE_SESSION", "A session already exists for this match_id", 409);
  }

  const guild = await getConfiguredGuild();
  await ensureBotGuildPermissions(guild);

  const category = await getConfiguredCategory(guild);
  const botId = client.user?.id;

  if (!botId) {
    throw new SessionError("BOT_NOT_READY", "Discord bot is not ready", 503);
  }

  let user1: User;
  let user2: User;

  try {
    const [member1, member2] = await Promise.all([guild.members.fetch(user1Id), guild.members.fetch(user2Id)]);
    user1 = member1.user;
    user2 = member2.user;
  } catch {
    throw new SessionError("INVALID_USER", "One or both Discord users are not members of the configured guild", 400);
  }

  let voiceChannel: VoiceChannel | null = null;
  let textChannel: TextChannel | null = null;

  try {
    const channelNames = buildSessionChannelNames(user1, user2, matchId);

    // Voice is created first so any partial failure can be rolled back before responding.
    voiceChannel = await guild.channels.create({
      name: channelNames.voice,
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
      name: channelNames.text,
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
      `🎮 Duo Session Started!\n⏱ Waiting for both players to join (${WAITING_DURATION_MS / 1000}s).\n\n🔗 Voice: ${buildChannelUrl(guild.id, voiceChannel.id)}\n💬 Chat: ${buildChannelUrl(guild.id, textChannel.id)}\n\nType !extend 30 or !extend 60 after the session starts.`
    );

    const session = registerWaitingSession({
      match_id: matchId,
      user1_id: user1Id,
      user2_id: user2Id,
      voice_channel_id: voiceChannel.id,
      text_channel_id: textChannel.id,
      voice_channel_name: voiceChannel.name,
      text_channel_name: textChannel.name,
      voice_join_url: buildChannelUrl(guild.id, voiceChannel.id),
      text_channel_url: buildChannelUrl(guild.id, textChannel.id)
    });

    return toSessionApiView(session);
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
