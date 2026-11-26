import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/legacy")({
  beforeLoad: () => { throw redirect({ to: "/admin" }); },
});
