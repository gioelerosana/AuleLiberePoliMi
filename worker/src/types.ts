import type {
  SearchRequest as HandlerSearchRequest,
  TelegramDependencies as HandlerDependencies,
  TelegramEnv,
  TelegramUpdate as HandlerUpdate
} from "./telegram";

/** Worker bindings plus the environment accepted by the Telegram module. */
export interface Env extends TelegramEnv {
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  WEBAPP_URL?: string;
}

export type Language = "it" | "en";
export type SearchRequest = HandlerSearchRequest;
export type TelegramUpdate = HandlerUpdate;
export type TelegramDependencies = HandlerDependencies;
