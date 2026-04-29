import { TextChannel } from "discord.js";
import { client } from "../bot.js";
import { logger } from "../utils/logger.js";

export const WAITING_DURATION_MS = 60 * 1000;
export const ACTIVE_DURATION_MS = 5 * 60 * 1000;
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
  joined_users: [...session.joined_users]
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
  input: Omit<DuoSession, "state" | "expires_at" | "joined_users" | "timeout">
): DuoSession => {
  if (sessionsByMatchId.has(input.match_id)) {
    throw new SessionError("DUPLICATE_SESSION", "A session already exists for this match_id", 409);
  }

  const session: DuoSession = {
    ...input,
    state: "waiting",
    expires_at: new Date(Date.now() + WAITING_DURATION_MS).toISOString(),
    joined_users: new Set<string>(),
    timeout: setTimeout(() => undefined, WAITING_DURATION_MS)
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

  if (session.state === "waiting") {
    session.joined_users.delete(userId);
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
  await textChannel?.send("Both players joined! Session started 🎮\nYou now have 5 minutes.");

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

  const durationMs = Math.max(new Date(session.expires_at).getTime() - Date.now(), 0) + duration * 60 * 1000;
  setSessionTimer(session, durationMs);

  const textChannel = await fetchTextChannel(session);
  await textChannel?.send(`Session extended by ${duration} minutes. New expiry: ${session.expires_at}`);

  logger.info("Duo session extended", {
    match_id: session.match_id,
    duration_minutes: duration,
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
