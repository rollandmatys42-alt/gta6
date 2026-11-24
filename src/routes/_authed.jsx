import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { createClient } from "@base44/sdk";

const authClient = createClient({ appId: "6b02e11e6786e710c26cc578" });

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: async () => {
    // Use the SDK's explicit boolean check here. Calling auth.me() from a route
    // guard can enter the SDK's hosted-login redirect path before our custom
    // /login page has mounted, which breaks preview navigation.
    const authenticated = await authClient.auth.isAuthenticated();
    if (!authenticated) throw redirect({ to: "/login" });
  },
  component: () => <Outlet />,
});
