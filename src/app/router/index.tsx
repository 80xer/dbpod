import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppShell } from "../shell/AppShell";
import { WorkspacePage } from "../shell/WorkspacePage";
import { ConnectionsPage } from "../../features/connections/ConnectionsPage";

const rootRoute = createRootRoute({ component: AppShell });

const connectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ConnectionsPage,
});

// The path carries only an opaque connectionId — never SQL or credentials.
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspace/$connectionId",
  component: WorkspacePage,
});

const routeTree = rootRoute.addChildren([connectionsRoute, workspaceRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
