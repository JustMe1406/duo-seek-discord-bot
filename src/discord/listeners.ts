import { Message, VoiceState } from "discord.js";
import { areMessageCommandsEnabled, client } from "../bot.js";
import { logger } from "../utils/logger.js";
import {
  extendSession,
  getSessionByTextChannelId,
  getSessionByVoiceChannelId,
  isSessionUser,
  markUserJoined,
  markUserLeft,
  SessionError
} from "./sessions.js";

const extensionCommandPattern = /^!extend\s+(30|60)$/;

const handleVoiceStateUpdate = async (oldState: VoiceState, newState: VoiceState): Promise<void> => {
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const previousSession = getSessionByVoiceChannelId(oldState.channelId);
    if (previousSession) {
      markUserLeft(previousSession, oldState.id);
    }
  }

  if (!newState.channelId || oldState.channelId === newState.channelId) {
    return;
  }

  const session = getSessionByVoiceChannelId(newState.channelId);

  if (!session || !isSessionUser(session, newState.id)) {
    return;
  }

  const members = newState.channel?.members;

  if (members?.has(session.user1_id)) {
    await markUserJoined(session, session.user1_id);
  }

  if (members?.has(session.user2_id)) {
    await markUserJoined(session, session.user2_id);
  }
};

const handleMessageCreate = async (message: Message): Promise<void> => {
  if (message.author.bot || !message.inGuild()) {
    return;
  }

  const match = message.content.trim().match(extensionCommandPattern);
  if (!match) {
    return;
  }

  const session = getSessionByTextChannelId(message.channelId);

  if (!session) {
    return;
  }

  if (!isSessionUser(session, message.author.id)) {
    await message.reply("Only players in this Duo session can extend it.");
    return;
  }

  try {
    const updatedSession = await extendSession(session.match_id, Number(match[1]));
    await message.reply(`Session extended. New expiry: ${updatedSession.expires_at}`);
  } catch (error) {
    const messageText =
      error instanceof SessionError ? error.message : "Could not extend this session right now.";
    await message.reply(messageText);
  }
};

export const registerDiscordSessionListeners = (): void => {
  client.on("voiceStateUpdate", (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState).catch((error: unknown) => {
      logger.error("Failed to process voice state update", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });

  if (areMessageCommandsEnabled()) {
    client.on("messageCreate", (message) => {
      handleMessageCreate(message).catch((error: unknown) => {
        logger.error("Failed to process Discord message command", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });
  }
};
