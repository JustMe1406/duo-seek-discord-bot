import express, { NextFunction, Request, Response } from "express";
import { createDiscordSession, validateMatchId } from "./discord/createSession.js";
import { isValidDiscordUserId } from "./discord/permissions.js";
import { extendSession, SessionError } from "./discord/sessions.js";
import { logger } from "./utils/logger.js";

type CreateSessionBody = {
  user1_id?: unknown;
  user2_id?: unknown;
  match_id?: unknown;
};

type ExtendSessionBody = {
  match_id?: unknown;
  duration?: unknown;
};

const validateCreateSessionBody = (body: CreateSessionBody): { user1Id: string; user2Id: string; matchId: string } => {
  if (!isValidDiscordUserId(body.user1_id)) {
    throw new SessionError("VALIDATION_ERROR", "user1_id must be a valid Discord snowflake", 400);
  }

  if (!isValidDiscordUserId(body.user2_id)) {
    throw new SessionError("VALIDATION_ERROR", "user2_id must be a valid Discord snowflake", 400);
  }

  if (typeof body.match_id !== "string" || body.match_id.trim().length === 0) {
    throw new SessionError("VALIDATION_ERROR", "match_id is required", 400);
  }

  return {
    user1Id: body.user1_id,
    user2Id: body.user2_id,
    matchId: body.match_id.trim()
  };
};

const validateExtendSessionBody = (body: ExtendSessionBody): { matchId: string; duration: number } => {
  if (typeof body.match_id !== "string" || body.match_id.trim().length === 0) {
    throw new SessionError("VALIDATION_ERROR", "match_id is required", 400);
  }

  const matchId = body.match_id.trim();
  validateMatchId(matchId);

  if (body.duration !== 30 && body.duration !== 60) {
    throw new SessionError("VALIDATION_ERROR", "duration must be 30 or 60 minutes", 400);
  }

  return {
    matchId,
    duration: body.duration
  };
};

export const createServer = (): express.Express => {
  const app = express();

  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ success: true });
  });

  app.post("/create-session", async (req: Request<object, object, CreateSessionBody>, res, next) => {
    try {
      const payload = validateCreateSessionBody(req.body);
      const channelIds = await createDiscordSession(payload);

      res.status(201).json({
        success: true,
        voice_channel_id: channelIds.voice_channel_id,
        text_channel_id: channelIds.text_channel_id,
        voice_join_url: channelIds.voice_join_url,
        text_channel_url: channelIds.text_channel_url,
        voice_channel_name: channelIds.voice_channel_name,
        text_channel_name: channelIds.text_channel_name,
        expires_at: channelIds.expires_at,
        state: channelIds.state,
        channel_ids: {
          voice: channelIds.voice_channel_id,
          text: channelIds.text_channel_id
        },
        session: channelIds
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/extend-session", async (req: Request<object, object, ExtendSessionBody>, res, next) => {
    try {
      const payload = validateExtendSessionBody(req.body);
      const session = await extendSession(payload.matchId, payload.duration);

      res.status(200).json({
        success: true,
        session
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SessionError) {
      logger.warn("API request failed", {
        code: error.code,
        message: error.message
      });

      res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message
        }
      });
      return;
    }

    logger.error("Unhandled API error", {
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error"
      }
    });
  });

  return app;
};

export const startServer = (): void => {
  const port = Number(process.env.PORT ?? 3000);
  const app = createServer();

  app.listen(port, () => {
    logger.info("HTTP server listening", { port });
  });
};
