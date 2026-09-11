import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { openConnections, useOpenConnections } from "../../entities/connection/openConnections";
import { environmentStyles } from "../../entities/connection/environmentStyles";
import { preloadSnapshot } from "../../entities/workspace/persistence";
import type {
  AppError,
  ConnectionProfile,
  ConnectionTestResult,
  Environment,
  ProfileDraft,
  TlsMode,
} from "../../generated/ipc-types";
import { ipc } from "../../shared/ipc/invoke";

const inputCls =
  "w-full rounded border border-gray-300 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500";
const labelCls = "block text-xs font-medium text-gray-600 mb-0.5";

type FormValues = {
  name: string;
  environment: Environment;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  tlsMode: TlsMode;
  readOnly: boolean;
};

const defaults: FormValues = {
  name: "",
  environment: "local",
  host: "localhost",
  port: "5432",
  database: "",
  username: "",
  password: "",
  tlsMode: "verify-full",
  readOnly: false,
};

function toDraft(v: FormValues, existing: ConnectionProfile | null): ProfileDraft {
  const port = Number(v.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("포트는 1부터 65535 사이의 정수여야 합니다.");
  }
  return {
    id: existing?.id ?? null,
    name: v.name.trim(),
    environment: v.environment,
    color: existing?.color ?? null,
    host: v.host.trim(),
    port,
    database: v.database.trim(),
    username: v.username.trim(),
    tlsMode: v.tlsMode,
    readOnly: v.readOnly,
    queryTimeoutMs: existing?.queryTimeoutMs ?? 60_000,
    maxRows: existing?.maxRows ?? 500,
  };
}

function errText(e: unknown): string {
  const err = e as Partial<AppError>;
  return err?.message ? `${err.code ?? ""} ${err.message}` : String(e);
}

export function ConnectionsPage() {
  const activeConnections = useOpenConnections();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useEffect(() => {
    void preloadSnapshot();
  }, []);
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: ipc.profileList });
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [message, setMessage] = useState<string>("");
  const [editing, setEditing] = useState<ConnectionProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [passwordProfile, setPasswordProfile] = useState<ConnectionProfile | null>(null);
  const passwordDialog = useRef<HTMLDialogElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (passwordProfile) {
      passwordDialog.current?.showModal();
      passwordInput.current?.focus();
    } else if (passwordDialog.current?.open) {
      passwordDialog.current.close();
    }
  }, [passwordProfile]);

  const dismissPassword = () => {
    if (passwordInput.current) passwordInput.current.value = "";
    setPasswordProfile(null);
  };

  const form = useForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      setSaving(true);
      try {
        const draft = toDraft(value, editing);
        const password = value.password;
        form.setFieldValue("password", "");
        await ipc.profileSave({
          profile: draft,
          secret: password
            ? { mode: "replace", password }
            : { mode: editing ? "keep-existing" : "prompt-each-time" },
        });
        form.reset(defaults);
        setEditing(null);
        setMessage(password || editing?.hasStoredCredential
          ? "프로필 저장됨. 비밀번호는 OS Keychain에 보관됩니다."
          : "프로필 저장됨. 연결할 때 비밀번호를 입력할 수 있습니다.");
        void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      } catch (e) {
        setMessage(`저장 실패: ${errText(e)}`);
      } finally {
        setSaving(false);
      }
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const v = form.state.values;
      return ipc.connectionTest({
        profileId: null,
        draft: toDraft(v, editing),
        password: v.password || null,
      });
    },
    onSuccess: (r) => {
      setTestResult(r);
      setMessage("");
    },
    onError: (e) => {
      setTestResult(null);
      setMessage(`연결 테스트 실패: ${errText(e)}`);
    },
  });

  // One-time passwords stay out of React Query's mutation cache and form state.
  const connectProfile = async (profileId: string, password: string | null) => {
    setConnecting(true);
    setMessage("");
    try {
      await preloadSnapshot();
      const r = await ipc.connectionOpen({ profileId, password });
      const profile = profiles.data?.find((p) => p.id === r.profileId);
      if (profile) openConnections.set(r.connectionId, { ...profile, database: r.database });
      void navigate({ to: "/workspace/$connectionId", params: { connectionId: r.connectionId } });
    } catch (e) {
      setMessage(`연결 실패: ${errText(e)}`);
    } finally {
      password = null;
      setConnecting(false);
    }
  };

  const remove = useMutation({
    mutationFn: (profileId: string) => ipc.profileDelete(profileId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["profiles"] }),
    onError: (e) => setMessage(`삭제 실패: ${errText(e)}`),
  });

  const reorder = useMutation({
    mutationFn: (ordered: ConnectionProfile[]) => ipc.profileReorder(ordered.map((p) => p.id)),
    onMutate: async (ordered) => {
      await queryClient.cancelQueries({ queryKey: ["profiles"] });
      const previous = queryClient.getQueryData<ConnectionProfile[]>(["profiles"]);
      queryClient.setQueryData(["profiles"], ordered);
      setMessage("");
      return previous;
    },
    onSuccess: () => setMessage("연결 순서를 저장했습니다."),
    onError: (e, _ordered, previous) => {
      if (previous) queryClient.setQueryData(["profiles"], previous);
      setMessage(`순서 저장 실패: ${errText(e)}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });
  const orderBusy = saving || remove.isPending || reorder.isPending;
  const profileCount = profiles.data?.length ?? 0;
  const moveProfile = (id: string, to: number) => {
    if (orderBusy || !profiles.data) return;
    const from = profiles.data.findIndex((p) => p.id === id);
    if (from < 0 || from === to || to < 0 || to >= profiles.data.length) return;
    const ordered = [...profiles.data];
    ordered.splice(to, 0, ordered.splice(from, 1)[0]);
    reorder.mutate(ordered);
  };
  const endDrag = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 md:flex-row">
      <section className="md:w-1/2">
        <h2 className="mb-3 text-sm font-semibold">저장된 연결</h2>
        {profiles.isPending && <p role="status" className="text-sm text-gray-500">연결 프로필 불러오는 중…</p>}
        {profiles.isError && <p role="alert" className="text-sm text-red-700">프로필을 불러오지 못했습니다: {errText(profiles.error)} <button type="button" className="underline" onClick={() => void profiles.refetch()}>다시 시도</button></p>}
        {profiles.data?.length === 0 && (
          <p className="text-sm text-gray-500">저장된 연결이 없습니다. 오른쪽에서 새 프로필을 만드세요.</p>
        )}
        {profileCount > 1 && (
          <p id="profile-order-help" className="mb-2 text-xs text-gray-500">손잡이를 드래그하거나 선택 후 ↑/↓ 키로 순서를 바꾸세요.</p>
        )}
        <ul aria-label="저장된 연결" aria-busy={reorder.isPending} className="flex flex-col gap-2">
          {profiles.data?.map((p, index) => (
            <li
              key={p.id}
              className={`rounded border p-3 ${dropTargetId === p.id ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-gray-200"} ${draggingId === p.id ? "opacity-50" : ""}`}
              onDragOver={(e) => {
                if (!draggingId || orderBusy) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTargetId(draggingId === p.id ? null : p.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTargetId(null);
              }}
              onDrop={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                moveProfile(draggingId, index);
                endDrag();
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${environmentStyles[p.environment].badge}`}>
                    {p.environment}
                  </span>
                  {p.readOnly && (
                    <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                      읽기 전용
                    </span>
                  )}
                  {p.tlsMode === "insecure" && (
                    <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                      TLS 미검증
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`${p.name} 순서 변경`}
                  aria-describedby={profileCount > 1 ? "profile-order-help" : undefined}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  aria-disabled={orderBusy || profileCount < 2}
                  title="드래그 또는 ↑/↓ 키로 순서 변경"
                  className="ml-2 shrink-0 cursor-grab select-none rounded px-2 text-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-blue-500 active:cursor-grabbing aria-disabled:cursor-default aria-disabled:opacity-40"
                  draggable={!orderBusy && profileCount > 1}
                  onDragStart={(e) => {
                    if (orderBusy || profileCount < 2) { e.preventDefault(); return; }
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", p.id);
                    e.dataTransfer.setDragImage(e.currentTarget.closest("li")!, 16, 16);
                    setDraggingId(p.id);
                  }}
                  onDragEnd={endDrag}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                    e.preventDefault();
                    moveProfile(p.id, index + (e.key === "ArrowUp" ? -1 : 1));
                  }}
                >
                  <span aria-hidden="true">⠿</span>
                </button>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {p.username}@{p.host}:{p.port}/{p.database}
                {!p.hasStoredCredential && " · 비밀번호 미저장"}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={connecting}
                  onClick={() => p.hasStoredCredential
                    ? void connectProfile(p.id, null)
                    : setPasswordProfile(p)}
                >
                  연결
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                  disabled={saving || activeConnections.some(([, open]) => open.id === p.id)}
                  title="열린 연결은 종료 후 편집할 수 있습니다"
                  onClick={() => {
                    setEditing(p);
                    form.reset({
                      name: p.name, environment: p.environment, host: p.host, port: String(p.port),
                      database: p.database, username: p.username, password: "", tlsMode: p.tlsMode, readOnly: p.readOnly,
                    }, { keepDefaultValues: true });
                    setTestResult(null);
                    setMessage("");
                  }}
                >
                  편집
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                  disabled={orderBusy}
                  onClick={() => {
                    if (window.confirm(`'${p.name}' 프로필과 저장된 자격 증명을 삭제할까요?`))
                      remove.mutate(p.id);
                  }}
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="md:w-1/2">
        <h2 className="mb-3 text-sm font-semibold">{editing ? "연결 프로필 편집" : "새 연결 프로필"}</h2>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <fieldset disabled={orderBusy} className="contents">
          <form.Field name="name">
            {(f) => (
              <div>
                <label className={labelCls} htmlFor="f-name">이름</label>
                <input
                  id="f-name"
                  className={inputCls}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  required
                />
              </div>
            )}
          </form.Field>
          <div className="grid grid-cols-3 gap-2">
            <form.Field name="host">
              {(f) => (
                <div className="col-span-2">
                  <label className={labelCls} htmlFor="f-host">호스트</label>
                  <input
                    id="f-host"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value)}
                    required
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="port">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-port">포트</label>
                  <input
                    id="f-port"
                    className={inputCls}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65535}
                    step={1}
                    required
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <form.Field name="database">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-db">데이터베이스</label>
                  <input
                    id="f-db"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value)}
                    required
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="username">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-user">사용자</label>
                  <input
                    id="f-user"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value)}
                    required
                  />
                </div>
              )}
            </form.Field>
          </div>
          <form.Field name="password">
            {(f) => (
              <div>
                <label className={labelCls} htmlFor="f-pw">비밀번호 (OS Keychain에 저장)</label>
                <input
                  id="f-pw"
                  type="password"
                  autoComplete="off"
                  className={inputCls}
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                />
                {editing?.hasStoredCredential && <p className="mt-1 text-xs text-gray-500">비워 두면 저장된 비밀번호를 유지합니다.</p>}
              </div>
            )}
          </form.Field>
          <div className="grid grid-cols-2 gap-2">
            <form.Field name="tlsMode">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-tls">TLS</label>
                  <select
                    id="f-tls"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value as TlsMode)}
                  >
                    <option value="verify-full">verify-full (기본)</option>
                    <option value="verify-ca">verify-ca</option>
                    <option value="insecure">insecure (검증 없음)</option>
                  </select>
                  {f.state.value === "insecure" && (
                    <p className="mt-1 text-xs text-red-600">
                      경고: 서버 인증서를 검증하지 않습니다. 로컬 개발 전용.
                    </p>
                  )}
                </div>
              )}
            </form.Field>
            <form.Field name="environment">
              {(f) => (
                <div>
                  <label className={labelCls} htmlFor="f-env">환경</label>
                  <select
                    id="f-env"
                    className={inputCls}
                    value={f.state.value}
                    onChange={(e) => f.handleChange(e.target.value as Environment)}
                  >
                    <option value="local">local</option>
                    <option value="dev">dev</option>
                    <option value="stage">stage</option>
                    <option value="prod">prod</option>
                  </select>
                </div>
              )}
            </form.Field>
          </div>
          <form.Field name="readOnly">
            {(f) => (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.state.value}
                  onChange={(e) => f.handleChange(e.target.checked)}
                />
                읽기 전용 연결
              </label>
            )}
          </form.Field>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? "테스트 중…" : "연결 테스트"}
            </button>
            <button
              type="submit"
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              저장
            </button>
            {editing && <button type="button" className="rounded border border-gray-300 px-3 py-1.5 text-sm" onClick={() => {
              form.reset(defaults);
              setEditing(null);
              setTestResult(null);
              setMessage("");
            }}>편집 취소</button>}
          </div>
          </fieldset>
        </form>
        {testResult && (
          <div className="mt-3 rounded border border-green-200 bg-green-50 p-2 text-xs text-green-800">
            연결 성공 · {testResult.serverVersion.split(" on ")[0]} · {testResult.latencyMs}ms ·{" "}
            {testResult.currentUser}@{testResult.database}
            {testResult.isSuperuser && " · superuser (운영 DB에서는 권장하지 않음)"}
          </div>
        )}
        {message && <p role="status" className="mt-3 text-xs text-gray-600">{message}</p>}
      </section>
      <dialog ref={passwordDialog} aria-labelledby="connect-password-title" onCancel={dismissPassword} onClose={dismissPassword} className="m-auto w-80 rounded border border-gray-300 p-5 shadow-xl backdrop:bg-black/30">
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!passwordProfile || connecting) return;
          const profileId = passwordProfile.id;
          const password = passwordInput.current?.value ?? "";
          dismissPassword();
          void connectProfile(profileId, password);
        }} className="flex flex-col gap-3">
          <h2 id="connect-password-title" className="font-semibold">{passwordProfile?.name} 연결</h2>
          <label htmlFor="connect-password" className={labelCls}>이번 연결의 비밀번호</label>
          <input ref={passwordInput} id="connect-password" type="password" autoComplete="off" className={inputCls} />
          <p className="text-xs text-gray-500">저장하지 않습니다. 비밀번호 없이 연결하려면 비워 두세요.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded border px-3 py-1 text-sm" onClick={dismissPassword}>취소</button>
            <button type="submit" disabled={connecting} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">연결 시작</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
