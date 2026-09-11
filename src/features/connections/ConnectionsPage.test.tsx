// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionOpenResponse, ConnectionProfile } from "../../generated/ipc-types";
import { useOpenConnections } from "../../entities/connection/openConnections";
import { ipc } from "../../shared/ipc/invoke";
import { ConnectionsPage } from "./ConnectionsPage";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../entities/workspace/persistence", () => ({ preloadSnapshot: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../entities/connection/openConnections", () => ({ openConnections: { set: vi.fn() }, useOpenConnections: vi.fn(() => []) }));
vi.mock("../../shared/ipc/invoke", () => ({
  ipc: { profileList: vi.fn(), profileReorder: vi.fn(), profileSave: vi.fn(), profileDelete: vi.fn(), connectionTest: vi.fn(), connectionOpen: vi.fn() },
}));

const profile: ConnectionProfile = {
  id: "profile-1", name: "Local PostgreSQL", environment: "dev", color: "#123456",
  host: "localhost", port: 5433, database: "dbpod", username: "tester", tlsMode: "insecure",
  readOnly: true, queryTimeoutMs: 12345, maxRows: 876, hasStoredCredential: false,
};
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useOpenConnections).mockReturnValue([]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.mocked(ipc.profileList).mockResolvedValue([profile]);
  vi.mocked(ipc.profileReorder).mockReset().mockResolvedValue(undefined);
  vi.mocked(ipc.profileSave).mockResolvedValue({ profileId: profile.id });
  vi.mocked(ipc.connectionOpen).mockResolvedValue({ connectionId: "connection-1", profileId: profile.id, database: profile.database, serverVersion: "18" });
  // jsdom does not implement the native modal lifecycle.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; fireEvent(this, new Event("close")); };
});
afterEach(() => { cleanup(); client.clear(); });

function mount() {
  render(<QueryClientProvider client={client}><ConnectionsPage /></QueryClientProvider>);
}

describe("ConnectionsPage", () => {
  it("drags saved connections in both directions, persists the order and restores it on remount", async () => {
    let saved = [profile, { ...profile, id: "profile-2", name: "Second" }, { ...profile, id: "profile-3", name: "Third" }];
    vi.mocked(ipc.profileList).mockImplementation(async () => saved);
    vi.mocked(ipc.profileReorder).mockImplementation(async (ids) => {
      saved = ids.map((id) => saved.find((p) => p.id === id)!);
    });
    mount();
    const handle = await screen.findByRole("button", { name: `${profile.name} 순서 변경` });
    const list = screen.getByRole("list", { name: "저장된 연결" });
    const order = () => within(list).getAllByRole("button", { name: /순서 변경$/ }).map((b) => b.getAttribute("aria-label"));
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "", dropEffect: "" };
    const dragTo = (target: string) => {
      fireEvent.dragStart(handle, { dataTransfer });
      const card = screen.getByRole("button", { name: `${target} 순서 변경` }).closest("li")!;
      fireEvent.dragOver(card, { dataTransfer });
      fireEvent.drop(card, { dataTransfer });
      fireEvent.dragEnd(handle, { dataTransfer });
    };
    dragTo("Third");
    await waitFor(() => expect(ipc.profileReorder).toHaveBeenCalledWith(["profile-2", "profile-3", profile.id]));
    await waitFor(() => expect(list.getAttribute("aria-busy")).toBe("false"));
    expect(order()).toEqual(["Second 순서 변경", "Third 순서 변경", `${profile.name} 순서 변경`]);
    dragTo("Second");
    await waitFor(() => expect(ipc.profileReorder).toHaveBeenLastCalledWith([profile.id, "profile-2", "profile-3"]));
    await waitFor(() => expect(list.getAttribute("aria-busy")).toBe("false"));
    expect(order()).toEqual([`${profile.name} 순서 변경`, "Second 순서 변경", "Third 순서 변경"]);
    dragTo("Second");
    await waitFor(() => expect(ipc.profileReorder).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(list.getAttribute("aria-busy")).toBe("false"));
    expect(order()).toEqual(["Second 순서 변경", `${profile.name} 순서 변경`, "Third 순서 변경"]);
    cleanup(); client.clear(); mount();
    await screen.findByText("Second");
    expect(within(screen.getByRole("list")).getAllByRole("listitem")[0].textContent).toContain("Second");
  });

  it("supports keyboard reordering, ignores no-op drops and rolls back failed saves", async () => {
    vi.mocked(ipc.profileList).mockResolvedValue([profile, { ...profile, id: "profile-2", name: "Second" }]);
    let fail!: (error: Error) => void;
    vi.mocked(ipc.profileReorder).mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    mount();
    const handle = await screen.findByRole("button", { name: `${profile.name} 순서 변경` });
    const list = screen.getByRole("list", { name: "저장된 연결" });
    const first = () => within(list).getAllByRole("listitem")[0];
    // Boundary keys, external drops and dropping on itself must not write anything.
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.drop(first());
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn() };
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.drop(first(), { dataTransfer });
    fireEvent.dragEnd(handle, { dataTransfer });
    expect(ipc.profileReorder).not.toHaveBeenCalled();

    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    await waitFor(() => expect(first().textContent).toContain("Second"));
    expect(document.activeElement).toBe(handle);
    expect(handle.getAttribute("draggable")).toBe("false");
    expect((screen.getByRole("button", { name: "저장" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect((screen.getAllByRole("button", { name: "삭제" })[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(ipc.profileReorder).toHaveBeenCalledTimes(1);
    fail(new Error("disk unavailable"));
    await screen.findByText(/순서 저장 실패.*disk unavailable/);
    await waitFor(() => expect(first().textContent).toContain(profile.name));
    expect(document.activeElement).toBe(handle);
    expect(ipc.profileSave).not.toHaveBeenCalled();
  });

  it("prompts privately for unstored credentials, clears them and permits passwordless connections", async () => {
    let finish!: (value: ConnectionOpenResponse) => void;
    vi.mocked(ipc.connectionOpen).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "연결" }));
    const password = screen.getByLabelText("이번 연결의 비밀번호") as HTMLInputElement;
    expect(password.type).toBe("password");
    fireEvent.change(password, { target: { value: "one-time-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "연결 시작" }));
    expect(password.value).toBe("");
    await waitFor(() => expect(ipc.connectionOpen).toHaveBeenCalledWith({ profileId: profile.id, password: "one-time-secret" }));
    finish({ connectionId: "connection-1", profileId: profile.id, database: profile.database, serverVersion: "18" });
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(client.getMutationCache().getAll()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    expect(password.value).toBe("");
    fireEvent.change(password, { target: { value: "cancelled-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(password.value).toBe("");
    expect(ipc.connectionOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    fireEvent.click(screen.getByRole("button", { name: "연결 시작" }));
    await waitFor(() => expect(ipc.connectionOpen).toHaveBeenLastCalledWith({ profileId: profile.id, password: "" }));
  });

  it("keeps stored credentials and unexposed profile settings when editing", async () => {
    vi.mocked(ipc.profileList).mockResolvedValue([{ ...profile, hasStoredCredential: true }]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "편집" }));
    expect((screen.getByLabelText("포트") as HTMLInputElement).value).toBe("5433");
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const { hasStoredCredential: _, ...draft } = profile;
    await waitFor(() => expect(ipc.profileSave).toHaveBeenCalledWith({
      profile: { ...draft, name: "Renamed" }, secret: { mode: "keep-existing" },
    }));
    expect((screen.getByLabelText("비밀번호 (OS Keychain에 저장)") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    await waitFor(() => expect(ipc.connectionOpen).toHaveBeenCalledWith({ profileId: profile.id, password: null }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("requires disconnecting before editing a live profile", async () => {
    vi.mocked(useOpenConnections).mockReturnValue([["connection-1", profile]]);
    mount();
    const edit = await screen.findByRole("button", { name: "편집" });
    expect((edit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(edit); expect(screen.queryByText("연결 프로필 편집")).toBeNull();
  });

  it("rejects invalid ports without replacing them with 5432", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "편집" }));
    const port = screen.getByLabelText("포트") as HTMLInputElement;
    expect([port.type, port.min, port.max]).toEqual(["number", "1", "65535"]);
    fireEvent.change(port, { target: { value: "65536" } });
    expect(port.checkValidity()).toBe(false);
    fireEvent.submit(port.form!);
    await screen.findByText(/포트는 1부터 65535/);
    expect(ipc.profileSave).not.toHaveBeenCalled();
  });

  it("shows profile loading and failures with a retry action", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(ipc.profileList).mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    mount();
    expect(screen.getByRole("status").textContent).toContain("불러오는 중");
    fail(new Error("disk unavailable"));
    expect((await screen.findByRole("alert")).textContent).toContain("disk unavailable");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText(profile.name);
  });
});
