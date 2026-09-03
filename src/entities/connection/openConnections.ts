import type { ConnectionProfile } from "../../generated/ipc-types";

/**
 * connectionId -> profile for connections opened in this app run.
 * In-memory only; a reload loses it and the workspace route redirects home.
 */
export const openConnections = new Map<string, ConnectionProfile>();
