import { ChannelType, TextChannel } from "discord.js";
import { client, getConfiguredCategory, getConfiguredGuild } from "../bot.js";
import { logger } from "../utils/logger.js";

export const WAITING_DURATION_MS = 60 * 1000;
export const ACTIVE_DURATION_MS = 5 * 60 * 1000;
export const LEAVE_GRACE_MS = 30 * 1000;
export const MAX_SESSION_EXTENSIONS = 2;
export const ALLOWED_EXTENSION_MINUTES = [30, 60] as const;

export type SessionState = "waiting" | "active";
export type ExtensionMinutes = (typeof ALLOWED_EXTENSION_MINUTES)[number];

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

export type DuoSession = {
  match_id: string;
  user1_id: string;
  user2_id: string;
  voice_channel_id: string;
  text_channel_id: string;
  voice_channel_name: string;
  text_channel_name: string;
  voice_join_url: string;
  text_channel_url: string;
  state: SessionState;
  expires_at: string;
  joined_users: Set<string>;
  timeout: NodeJS.Timeout;
  extension_count: number;
  leave_timeout: NodeJS.Timeout | null;
};

export type SessionApiView = {
  match_id: string;
  user1_id: string;
  user2_id: string;
  voice_channel_id: string;
  text_channel_id: string;
  voice_channel_name: string;
  text_channel_name: string;
  voice_join_url: string;
  text_channel_url: string;
  state: SessionState;
  expires_at: string;
  joined_users: string[];
  extension_count: number;
  max_extensions: number;
};

const sessionsByMatchId = new Map<string, DuoSession>();
const matchIdByVoiceChannelId = new Map<string, string>();
const matchIdByTextChannelId = new Map<string, string>();

export const toSessionApiView = (session: DuoSession): SessionApiView => ({
  match_id: session.match_id,
  user1_id: session.user1_id,
  user2_id: session.user2_id,
  voice_channel_id: session.voice_channel_id,
  text_channel_id: session.text_channel_id,
  voice_channel_name: session.voice_channel_name,
  text_channel_name: session.text_channel_name,
  voice_join_url: session.voice_join_url,
  text_channel_url: session.text_channel_url,
  state: session.state,
  expires_at: session.expires_at,
  joined_users: [...session.joined_users],
  extension_count: session.extension_count,
  max_extensions: MAX_SESSION_EXTENSIONS
});

export const getSessionByMatchId = (matchId: string): DuoSession | undefined => sessionsByMatchId.get(matchId);

export const getSessionByVoiceChannelId = (channelId: string): DuoSession | undefined => {
  const matchId = matchIdByVoiceChannelId.get(channelId);
  return matchId ? sessionsByMatchId.get(matchId) : undefined;
};

export const getSessionByTextChannelId = (channelId: string): DuoSession | undefined => {
  const matchId = matchIdByTextChannelId.get(channelId);
  return matchId ? sessionsByMatchId.get(matchId) : undefined;
};

export const isSessionUser = (session: DuoSession, userId: string): boolean => {
  return session.user1_id === userId || session.user2_id === userId;
};

const clearLeaveTimer = (session: DuoSession): void => {
  if (!session.leave_timeout) {
    return;
  }

  clearTimeout(session.leave_timeout);
  session.leave_timeout = null;
};

const setSessionTimer = (session: DuoSession, durationMs: number): void => {
  clearTimeout(session.timeout);
  session.expires_at = new Date(Date.now() + durationMs).toISOString();

  session.timeout = setTimeout(() => {
    void expireSession(session.match_id, "timer_expired");
  }, durationMs);

  session.timeout.unref();
};

const fetchTextChannel = async (session: DuoSession): Promise<TextChannel | null> => {
  const channel = await client.channels.fetch(session.text_channel_id).catch(() => null);
  return channel instanceof TextChannel ? channel : null;
};

const deleteChannelById = async (channelId: string, reason: string): Promise<void> => {
  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !("delete" in channel)) {
    return;
  }

  await channel.delete(reason).catch((error: unknown) => {
    logger.warn("Session channel cleanup skipped", {
      channel_id: channelId,
      error: error instanceof Error ? error.message : String(error)
    });
  });
};

export const registerWaitingSession = (
  input: Omit<
    DuoSession,
    "state" | "expires_at" | "joined_users" | "timeout" | "extension_count" | "leave_timeout"
  >
): DuoSession => {
  if (sessionsByMatchId.has(input.match_id)) {
    throw new SessionError("DUPLICATE_SESSION", "A session already exists for this match_id", 409);
  }

  const session: DuoSession = {
    ...input,
    state: "waiting",
    expires_at: new Date(Date.now() + WAITING_DURATION_MS).toISOString(),
    joined_users: new Set<string>(),
    timeout: setTimeout(() => undefined, WAITING_DURATION_MS),
    extension_count: 0,
    leave_timeout: null
  };

  setSessionTimer(session, WAITING_DURATION_MS);
  sessionsByMatchId.set(session.match_id, session);
  matchIdByVoiceChannelId.set(session.voice_channel_id, session.match_id);
  matchIdByTextChannelId.set(session.text_channel_id, session.match_id);

  logger.info("Duo session created", {
    match_id: session.match_id,
    user1_id: session.user1_id,
    user2_id: session.user2_id,
    voice_channel_id: session.voice_channel_id,
    text_channel_id: session.text_channel_id,
    expires_at: session.expires_at
  });

  return session;
};

export const markUserJoined = async (session: DuoSession, userId: string): Promise<void> => {
  if (!isSessionUser(session, userId)) {
    return;
  }

  session.joined_users.add(userId);
  clearLeaveTimer(session);

  logger.info("Duo session user joined voice", {
    match_id: session.match_id,
    user_id: userId,
    joined_count: session.joined_users.size
  });

  if (session.state === "waiting" && session.joined_users.has(session.user1_id) && session.joined_users.has(session.user2_id)) {
    await startActiveSession(session);
  }
};

export const markUserLeft = (session: DuoSession, userId: string): void => {
  if (!isSessionUser(session, userId)) {
    return;
  }

  session.joined_users.delete(userId);

  if (session.state === "active") {
    clearLeaveTimer(session);
    session.leave_timeout = setTimeout(() => {
      void expireSession(session.match_id, "user_left_voice");
    }, LEAVE_GRACE_MS);
    session.leave_timeout.unref();
  }

  logger.info("Duo session user left voice", {
    match_id: session.match_id,
    user_id: userId,
    state: session.state
  });
};

export const startActiveSession = async (session: DuoSession): Promise<void> => {
  if (session.state === "active") {
    return;
  }

  session.state = "active";
  setSessionTimer(session, ACTIVE_DURATION_MS);

  const textChannel = await fetchTextChannel(session);
  await textChannel?.send("✅ Both players joined!\n⏱ Session started (5 min).");

  logger.info("Duo session started", {
    match_id: session.match_id,
    expires_at: session.expires_at
  });
};

export const extendSession = async (matchId: string, duration: number): Promise<SessionApiView> => {
  if (!ALLOWED_EXTENSION_MINUTES.includes(duration as ExtensionMinutes)) {
    throw new SessionError("VALIDATION_ERROR", "duration must be 30 or 60 minutes", 400);
  }

  const session = sessionsByMatchId.get(matchId);

  if (!session) {
    throw new SessionError("SESSION_NOT_FOUND", "Session was not found or has already expired", 404);
  }

  if (session.state !== "active") {
    throw new SessionError("SESSION_NOT_ACTIVE", "Only active sessions can be extended", 409);
  }

  if (session.extension_count >= MAX_SESSION_EXTENSIONS) {
    throw new SessionError("EXTENSION_LIMIT_REACHED", "This session has already used its 2 extensions", 409);
  }

  const durationMs = Math.max(new Date(session.expires_at).getTime() - Date.now(), 0) + duration * 60 * 1000;
  setSessionTimer(session, durationMs);
  session.extension_count += 1;

  const textChannel = await fetchTextChannel(session);
  await textChannel?.send(
    `⏱ Session extended by ${duration} minutes (${session.extension_count}/${MAX_SESSION_EXTENSIONS}).\nNew expiry: ${session.expires_at}`
  );

  logger.info("Duo session extended", {
    match_id: session.match_id,
    duration_minutes: duration,
    extension_count: session.extension_count,
    expires_at: session.expires_at
  });

  return toSessionApiView(session);
};

export const expireSession = async (matchId: string, reason: string): Promise<void> => {
  const session = sessionsByMatchId.get(matchId);

  if (!session) {
    return;
  }

  clearTimeout(session.timeout);
  clearLeaveTimer(session);
  sessionsByMatchId.delete(matchId);
  matchIdByVoiceChannelId.delete(session.voice_channel_id);
  matchIdByTextChannelId.delete(session.text_channel_id);

  logger.info("Duo session expired", {
    match_id: session.match_id,
    reason,
    state: session.state,
    joined_users: [...session.joined_users]
  });

  await Promise.all([
    deleteChannelById(session.voice_channel_id, `Duo Seek session cleanup: ${reason}`),
    deleteChannelById(session.text_channel_id, `Duo Seek session cleanup: ${reason}`)
  ]);
};

export const endSession = async (matchId: string, reason = "manual_end"): Promise<void> => {
  const session = sessionsByMatchId.get(matchId);

  if (!session) {
    throw new SessionError("SESSION_NOT_FOUND", "Session was not found or has already expired", 404);
  }

  await expireSession(matchId, reason);
};

export const cleanupStaleDuoChannelsOnBoot = async (): Promise<void> => {
  const guild = await getConfiguredGuild();
  const category = await getConfiguredCategory(guild);
  const channels = await guild.channels.fetch();
  const staleChannels = channels.filter((channel) => {
    if (!channel || channel.parentId !== category.id) {
      return false;
    }

    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildText) {
      return false;
    }

    return channel.name.startsWith("duo-") || channel.name.includes("duo-");
  });

  if (staleChannels.size === 0) {
    logger.info("No stale Duo channels found on boot");
    return;
  }

  logger.warn("Deleting stale Duo channels on boot", {
    count: staleChannels.size,
    channel_ids: staleChannels.map((channel) => channel?.id)
  });

  await Promise.all(
    staleChannels.map((channel) =>
      channel ? deleteChannelById(channel.id, "Duo Seek stale session cleanup on bot boot") : Promise.resolve()
    )
  );
};
