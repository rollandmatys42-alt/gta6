import { createFileRoute } from "@tanstack/react-router";
import { proxyStorageAsset } from "@/lib/storage-fns";

export const Route = createFileRoute("/api/video/preview/$videoId")({
  server: {
    handlers: {
      GET: async ({ params, request, context }) => {
        try {
          const entities = context.getBase44().asServiceRole.entities;
          const video = await entities.Video.get(params.videoId).catch(() => null);
          if (!video || video.status !== "published" || video.license_status !== "verified" || !video.watermarked_storage_key) {
            return Response.json({ error: "Video preview unavailable." }, { status: 404 });
          }
          return await proxyStorageAsset({
            entities,
            connectionId: video.watermarked_storage_connection_id,
            objectKey: video.watermarked_storage_key,
            request,
          });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Preview unavailable." }, { status: 502 });
        }
      },
    },
  },
});
