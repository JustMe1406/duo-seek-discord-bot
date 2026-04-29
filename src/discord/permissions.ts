import { Client, OverwriteResolvable, PermissionsBitField } from "discord.js";

type SessionPermissionsInput = {
  guildId: string;
  user1Id: string;
  user2Id: string;
  botId: string;
};

export const userSnowflakePattern = /^\d{17,20}$/;

export const buildTextPermissionOverwrites = ({
  guildId,
  user1Id,
  user2Id,
  botId
}: SessionPermissionsInput): OverwriteResolvable[] => [
  {
    id: guildId,
    deny: [PermissionsBitField.Flags.ViewChannel]
  },
  {
    id: user1Id,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory
    ]
  },
  {
    id: user2Id,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory
    ]
  },
  {
    id: botId,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
      PermissionsBitField.Flags.ManageChannels
    ]
  }
];

export const buildVoicePermissionOverwrites = ({
  guildId,
  user1Id,
  user2Id,
  botId
}: SessionPermissionsInput): OverwriteResolvable[] => [
  {
    id: guildId,
    deny: [PermissionsBitField.Flags.ViewChannel]
  },
  {
    id: user1Id,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.Connect,
      PermissionsBitField.Flags.Speak
    ]
  },
  {
    id: user2Id,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.Connect,
      PermissionsBitField.Flags.Speak
    ]
  },
  {
    id: botId,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.Connect,
      PermissionsBitField.Flags.Speak,
      PermissionsBitField.Flags.ManageChannels
    ]
  }
];

export const isValidDiscordUserId = (value: unknown): value is string => {
  return typeof value === "string" && userSnowflakePattern.test(value);
};

export const resolveUser = async (client: Client, userId: string): Promise<void> => {
  await client.users.fetch(userId);
};
