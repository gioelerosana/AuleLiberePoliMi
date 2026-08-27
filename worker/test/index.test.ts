import { describe, expect, it, vi } from "vitest";
import { createRequestHandler } from "../src/index";
import type { Env, TelegramUpdate } from "../src/types";

const env: Env = {
  BOT_TOKEN: "test-token",
  WEBHOOK_SECRET: "0123456789abcdef"
};

function makeHandler() {
  const handleUpdate = vi.fn(async () => undefined);
  const search = vi.fn(async () => ["room"]);
  return {
    handleUpdate,
    search,
    fetch: createRequestHandler({ handleUpdate, search })
  };
}

describe("Cloudflare Worker router", () => {
  it("serves a public health endpoint", async () => {
    const { fetch } = makeHandler();
    const response = await fetch(new Request("https://example.test/health"), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("does not expose the webhook on the wrong path", async () => {
    const { fetch, handleUpdate } = makeHandler();
    const response = await fetch(
      new Request("https://example.test/webhook/wrong", {
        method: "POST",
        body: JSON.stringify({ update_id: 1 })
      }),
      env
    );

    expect(response.status).toBe(404);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("awaits a valid Telegram update", async () => {
    const { fetch, handleUpdate, search } = makeHandler();
    const update: TelegramUpdate = {
      update_id: 42,
      message: { message_id: 1, chat: { id: 7 }, text: "/start" }
    };
    const response = await fetch(
      new Request("https://example.test/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": env.WEBHOOK_SECRET
        },
        body: JSON.stringify(update)
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledWith(update, env, { search });
  });

  it("requires Telegram's secret-token header", async () => {
    const { fetch, handleUpdate } = makeHandler();
    const response = await fetch(
      new Request("https://example.test/telegram/webhook", {
        method: "POST",
        body: JSON.stringify({ update_id: 2 })
      }),
      env
    );

    expect(response.status).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without invoking the bot", async () => {
    const { fetch, handleUpdate } = makeHandler();
    const response = await fetch(
      new Request("https://example.test/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": env.WEBHOOK_SECRET },
        body: "{"
      }),
      env
    );

    expect(response.status).toBe(400);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 so Telegram can retry failed updates", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handleUpdate = vi.fn(async () => {
      throw new Error("Telegram unavailable");
    });
    const fetch = createRequestHandler({
      handleUpdate,
      search: vi.fn(async () => [])
    });
    const response = await fetch(
      new Request("https://example.test/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": env.WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 9 })
      }),
      env
    );

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
