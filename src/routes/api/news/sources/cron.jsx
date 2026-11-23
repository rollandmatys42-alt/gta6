import { createFileRoute } from "@tanstack/react-router";
import { secrets } from "base44:runtime";

const safeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const Route = createFileRoute("/api/news/sources/cron")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const expected = secrets.get("GTA_NEWS_SYNC_CRON_SECRET") || "";
        const header = request.headers.get("authorization") || "";
        const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (expected.length < 32 || !safeEqual(supplied, expected)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        try {
          const result = await context.getBase44().asServiceRole.functions.invoke(
            "gta-news-sync",
            { cronSecret: expected },
          );
          return Response.json(result ?? { success: true });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Scheduled GTA news ingestion failed." },
            { status: 500 },
          );
        }
      },
    },
  },
});
