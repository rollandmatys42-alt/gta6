import { createFileRoute } from "@tanstack/react-router";
import { requireUserRoute } from "@/lib/auth-middleware";
import { proxyStorageAsset } from "@/lib/storage-fns";

export const Route = createFileRoute("/api/internal-video-assets/$assetId")({
  server: {
    middleware: [requireUserRoute],
    handlers: {
      GET: async ({ params, request, context }) => {
        if (context.user?.role !== "admin") {
          return Response.json({ error: "Administrator access required." }, { status: 403 });
        }
        const entities = context.getBase44().asServiceRole.entities;
        const asset = await entities.InternalVideoAsset.get(params.assetId).catch(() => null);
        if (!asset || asset.status === "archived" || !String(asset.storage_key || "").startsWith("videos/internal-library/")) {
          return Response.json({ error: "Internal video asset not found." }, { status: 404 });
        }
        try {
          return await proxyStorageAsset({
            entities,
            connectionId: asset.storage_connection_id,
            objectKey: asset.storage_key,
            request,
          });
        } catch {
          return Response.json({ error: "The private video asset could not be retrieved." }, { status: 502 });
        }
      },
    },
  },
});
