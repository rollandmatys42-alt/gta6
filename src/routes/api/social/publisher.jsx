import { createFileRoute } from "@tanstack/react-router";
import { requireUserRoute } from "@/lib/auth-middleware";

export const Route = createFileRoute("/api/social/publisher")({
  server: {
    middleware: [requireUserRoute],
    handlers: {
      POST: async ({ context }) => {
        if (context.user?.role !== "admin") {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        try {
          const result = await context.getBase44().functions.invoke("social-publisher", {});
          return Response.json(result ?? { success: true });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Social publishing failed." },
            { status: 500 },
          );
        }
      },
    },
  },
});
