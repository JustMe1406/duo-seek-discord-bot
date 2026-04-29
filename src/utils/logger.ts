type LogMeta = Record<string, unknown>;

const formatMeta = (meta?: LogMeta): string => {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  return ` ${JSON.stringify(meta)}`;
};

export const logger = {
  info(message: string, meta?: LogMeta): void {
    console.log(`[info] ${new Date().toISOString()} ${message}${formatMeta(meta)}`);
  },

  warn(message: string, meta?: LogMeta): void {
    console.warn(`[warn] ${new Date().toISOString()} ${message}${formatMeta(meta)}`);
  },

  error(message: string, meta?: LogMeta): void {
    console.error(`[error] ${new Date().toISOString()} ${message}${formatMeta(meta)}`);
  }
};
