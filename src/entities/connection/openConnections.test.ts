import { afterEach, expect, test } from "vitest";
import { openConnections } from "./openConnections";
import type { ConnectionProfile } from "../../generated/ipc-types";

const profile = (id: string): ConnectionProfile => ({
  id, name: id.toUpperCase(), environment: "dev", color: null, host: "localhost", port: 5432,
  database: "dbpod", username: "tester", tlsMode: "insecure", readOnly: false,
  queryTimeoutMs: 1000, maxRows: 100, hasStoredCredential: false,
});
const ids = () => openConnections.entries().map(([, p]) => p.id);

afterEach(() => {
  for (const [id] of openConnections.entries()) openConnections.delete(id);
  openConnections.setOrder([]);
});

test("entries follow the home list order, not the order the connections were opened", () => {
  openConnections.setOrder(["c", "a", "b"]);
  for (const id of ["a", "b", "c"]) openConnections.set(`conn-${id}`, profile(id));
  expect(ids()).toEqual(["c", "a", "b"]);

  // A drag on the home list reorders the rail without reopening anything.
  openConnections.setOrder(["b", "c", "a"]);
  expect(ids()).toEqual(["b", "c", "a"]);
});

test("a profile the home list has not named yet sorts last in the order it was opened", () => {
  openConnections.setOrder(["b"]);
  for (const id of ["a", "b", "c"]) openConnections.set(`conn-${id}`, profile(id));
  expect(ids()).toEqual(["b", "a", "c"]);
});

test("an unchanged order keeps the snapshot identity so useSyncExternalStore does not loop", () => {
  openConnections.set("conn-a", profile("a"));
  openConnections.setOrder(["a"]);
  const snapshot = openConnections.entries();
  openConnections.setOrder(["a"]);
  expect(openConnections.entries()).toBe(snapshot);
});
