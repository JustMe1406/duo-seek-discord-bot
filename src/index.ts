import "dotenv/config";
import { startBot } from "./bot.js";
import { startServer } from "./server.js";
import { logger } from "./utils/logger.js";

const main = async (): Promise<void> => {
  await startBot();
  startServer();
};

main().catch((error: unknown) => {
  logger.error("Failed to start Duo Seek Discord bot", {
    error: error instanceof Error ? error.message : String(error)
  });

  process.exit(1);
});
