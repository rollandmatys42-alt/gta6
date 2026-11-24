import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { createClient } from "@base44/sdk";

const authClient = createClient({ appId: "6b02e11e6786e710c26cc578" });

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: async () => {
    try {
      await authClient.auth.me();
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) throw redirect({ to: "/login" });
      throw error;
    }
  },
  component: () => <Outlet />,
});
