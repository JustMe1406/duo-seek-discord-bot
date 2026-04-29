import {
  CategoryChannel,
  ChannelType,
  Client,
  GatewayIntentBits,
  Guild,
  PermissionsBitField
} from "discord.js";
import { logger } from "./utils/logger.js";

const requiredGuildPermissions = new PermissionsBitField([
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.Connect,
  PermissionsBitField.Flags.Speak
]);

export const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

export const getRequiredEnv = (key: string): string => {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const startBot = async (): Promise<void> => {
  const token = getRequiredEnv("DISCORD_TOKEN");

  client.once("ready", () => {
    logger.info("Discord bot ready", {
      bot_id: client.user?.id,
      bot_tag: client.user?.tag
    });
  });

  await client.login(token);
};

export const ensureBotReady = (): void => {
  if (!client.isReady() || !client.user) {
    throw new Error("Discord bot is not ready");
  }
};

export const getConfiguredGuild = async (): Promise<Guild> => {
  ensureBotReady();

  const guildId = getRequiredEnv("DISCORD_GUILD_ID");
  const guild = await client.guilds.fetch(guildId).catch(() => null);

  if (!guild) {
    throw new Error("Configured Discord guild was not found");
  }

  return guild;
};

export const getConfiguredCategory = async (guild: Guild): Promise<CategoryChannel> => {
  const categoryId = getRequiredEnv("DISCORD_CATEGORY_ID");
  const channel = await guild.channels.fetch(categoryId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildCategory) {
    throw new Error("Configured Discord category was not found");
  }

  return channel;
};

export const ensureBotGuildPermissions = async (guild: Guild): Promise<void> => {
  ensureBotReady();

  const me = await guild.members.fetchMe();

  if (!me.permissions.has(requiredGuildPermissions)) {
    throw new Error("Bot is missing required guild permissions");
  }
};
