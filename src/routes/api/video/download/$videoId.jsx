import { createFileRoute } from "@tanstack/react-router";
import { requireUserRoute } from "@/lib/auth-middleware";
import { proxyStorageAsset } from "@/lib/storage-fns";

export const Route = createFileRoute("/api/video/download/$videoId")({
  server: {
    middleware: [requireUserRoute],
    handlers: {
      GET: async ({ params, request, context }) => {
        const entities = context.getBase44().asServiceRole.entities;
        const video = await entities.Video.get(params.videoId).catch(() => null);
        if (!video || video.status !== "published" || video.license_status !== "verified") {
          return Response.json({ error: "Video download unavailable." }, { status: 404 });
        }
        const events = await entities.DownloadEvent.filter(
          { user_id: context.user.id, video_id: video.id, status: "signed" },
          "-created_date", 10, 0,
        );
        const event = events.find(item => item.delivery_expires_at && new Date(item.delivery_expires_at).getTime() > Date.now());
        if (!event) return Response.json({ error: "Download authorisation expired or already used." }, { status: 403 });
        const consumed = await entities.DownloadEvent.updateMany({ id: event.id, status: "signed" }, { $set: { status: "delivered" } });
        if (!consumed?.updated) return Response.json({ error: "Download authorisation has already been used." }, { status: 403 });
        const watermarkApplied = !!event.watermark_applied;
        const objectKey = watermarkApplied ? video.watermarked_storage_key : video.storage_key;
        const connectionId = watermarkApplied ? video.watermarked_storage_connection_id : video.storage_connection_id;
        if (!objectKey) return Response.json({ error: "The requested video version is not ready." }, { status: 409 });
        try {
          return await proxyStorageAsset({ entities, connectionId, objectKey, request });
        } catch (error) {
          await entities.DownloadEvent.update(event.id, { status: "failed" }).catch(() => null);
          return Response.json({ error: error instanceof Error ? error.message : "Download failed." }, { status: 502 });
        }
      },
    },
  },
});
