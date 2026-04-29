import "dotenv/config";
import { startBot } from "./bot.js";
import { registerDiscordSessionListeners } from "./discord/listeners.js";
import { cleanupStaleDuoChannelsOnBoot } from "./discord/sessions.js";
import { startServer } from "./server.js";
import { logger } from "./utils/logger.js";

const main = async (): Promise<void> => {
  registerDiscordSessionListeners();
  await startBot();
  await cleanupStaleDuoChannelsOnBoot();
  startServer();
};

main().catch((error: unknown) => {
  logger.error("Failed to start Duo Seek Discord bot", {
    error: error instanceof Error ? error.message : String(error)
  });

  process.exit(1);
});
