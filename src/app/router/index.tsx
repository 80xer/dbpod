import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
import { AppShell } from "../shell/AppShell";

const rootRoute = createRootRoute({ component: AppShell });

const connectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("../../features/connections/ConnectionsPage"), "ConnectionsPage"),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("../../features/settings/SettingsPage"), "SettingsPage"),
});

// The path carries only an opaque connectionId — never SQL or credentials.
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspace/$connectionId",
  component: lazyRouteComponent(() => import("../shell/WorkspacePage"), "WorkspacePage"),
});

const routeTree = rootRoute.addChildren([connectionsRoute, settingsRoute, workspaceRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
