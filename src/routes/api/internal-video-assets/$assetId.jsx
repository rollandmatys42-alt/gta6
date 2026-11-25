import { createFileRoute } from "@tanstack/react-router";
import { requireUserRoute } from "@/lib/auth-middleware";
import { proxyStorageAsset } from "@/lib/storage-fns";
import { streamGoogleDriveMedia } from "@/lib/google-drive-api";

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
        if (!asset || asset.status === "archived") {
          return Response.json({ error: "Internal video asset not found." }, { status: 404 });
        }
        try {
          if (asset.storage_provider === "google_drive" && asset.google_drive_file_id) {
            return await streamGoogleDriveMedia(context.getBase44(), asset.google_drive_file_id, request);
          }
          if (!String(asset.storage_key || "").startsWith("videos/internal-library/") || !asset.storage_connection_id) {
            return Response.json({ error: "Internal video asset storage is unavailable." }, { status: 404 });
          }
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
