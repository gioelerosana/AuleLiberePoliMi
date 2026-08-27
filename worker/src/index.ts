import { ROOM_IDS_WITH_POWER } from "./data";
import { formatRoomMessages } from "./format";
import { searchFreeRooms } from "./polimi";
import { handleTelegramUpdate, validateTelegramSecret } from "./telegram";
import type {
  Env,
  SearchRequest,
  TelegramDependencies,
  TelegramUpdate
} from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SECRET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

type UpdateHandler = (
  update: TelegramUpdate,
  env: Env,
  dependencies: TelegramDependencies
) => Promise<void>;

interface RuntimeDependencies {
  handleUpdate: UpdateHandler;
  search: (request: SearchRequest) => Promise<string[]>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function parseDate(value: string): { day: number; month: number; year: number } {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    throw new Error("Invalid search date: expected dd/mm/yyyy");
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date");
  }

  return { day, month, year };
}

export async function searchAndFormat(request: SearchRequest): Promise<string[]> {
  const { day, month, year } = parseDate(request.date);
  const rooms = await searchFreeRooms({
    location: request.campus,
    day,
    month,
    year,
    startTime: request.startHour,
    endTime: request.endHour,
    roomsWithPower: ROOM_IDS_WITH_POWER
  });

  return formatRoomMessages(rooms, {
    untilLabel: request.lang === "it" ? "fino alle" : "free until"
  });
}

const productionDependencies: RuntimeDependencies = {
  handleUpdate: async (update, env, dependencies) => {
    await handleTelegramUpdate(update, env, dependencies);
  },
  search: searchAndFormat
};

export function createRequestHandler(
  dependencies: RuntimeDependencies = productionDependencies
): (request: Request, env: Env) => Promise<Response> {
  return async (request, env) => {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok" });
    }

    if (!env.BOT_TOKEN || !SECRET_PATTERN.test(env.WEBHOOK_SECRET)) {
      console.error("Worker secrets are missing or WEBHOOK_SECRET is not URL-safe");
      return json({ error: "service_not_configured" }, 503);
    }

    if (url.pathname !== "/telegram/webhook") {
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    if (!validateTelegramSecret(request, env.WEBHOOK_SECRET)) {
      return json({ error: "unauthorized" }, 401);
    }

    let update: TelegramUpdate;
    try {
      const body: unknown = await request.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("update_id" in body) ||
        !Number.isInteger((body as { update_id?: unknown }).update_id)
      ) {
        return json({ error: "invalid_update" }, 400);
      }
      update = body as TelegramUpdate;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    try {
      await dependencies.handleUpdate(update, env, {
        search: dependencies.search
      });
      return json({ ok: true });
    } catch (error) {
      console.error("Telegram update failed", update.update_id, error);
      // A non-2xx response asks Telegram to retry the update.
      return json({ error: "update_failed" }, 500);
    }
  };
}

const handleRequest = createRequestHandler();

export default {
  fetch(request: Request, env: Env, _context: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  }
} satisfies ExportedHandler<Env>;
