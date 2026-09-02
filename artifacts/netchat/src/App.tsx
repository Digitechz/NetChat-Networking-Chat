import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ArrowLeft, ArrowUpRight, Check, CheckCheck, ChevronLeft, LoaderCircle, LogOut, MessageCircle, Network, PanelLeft, Radio, RefreshCw, Search, Send, ShieldCheck, Signal, UserPlus, Users, X } from 'lucide-react';
import { useGetChatHistory, useGetCurrentUser, useListUsers, useLogin, useLogout, useRegister, getGetChatHistoryQueryKey, getGetCurrentUserQueryKey, getListUsersQueryKey } from '@workspace/api-client-react';
import type { Message, User } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import '@/index.css';

const queryClient = new QueryClient();
type SocketState = 'connected' | 'connecting' | 'reconnecting' | 'offline';
type IncomingEvent = { type: string; payload?: Record<string, unknown> };

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function timeLabel(value: string | null | undefined, withDate = false) {
  if (!value) return 'not seen yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return withDate
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function useNetworkSocket(
  user: User | undefined,
  onEvent: (event: IncomingEvent) => void,
) {
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  const [state, setState] = useState<SocketState>('connecting');
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!user) {
      setState('offline');
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const socketUrl = import.meta.env.VITE_WS_URL ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

    const connect = () => {
      if (cancelled) return;
      setState(attempts ? 'reconnecting' : 'connecting');
      try {
        const socket = new WebSocket(socketUrl);
        socketRef.current = socket;
        socket.onopen = () => {
          attempts = 0;
          setState('connected');
          socket.send(JSON.stringify({ type: 'LOGIN', payload: { userId: user.id, username: user.username } }));
        };
        socket.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data) as IncomingEvent;
            onEventRef.current(parsed);
          } catch {
            // Ignore malformed frames; the connection remains available.
          }
        };
        socket.onclose = () => {
          if (cancelled) return;
          onEventRef.current({ type: 'RECONNECTING', payload: { attempt: attempts + 1 } });
          setState('reconnecting');
          attempts += 1;
          retryRef.current = setTimeout(connect, Math.min(12000, 800 + attempts * 700));
        };
        socket.onerror = () => setState('reconnecting');
      } catch {
        setState('reconnecting');
        attempts += 1;
        retryRef.current = setTimeout(connect, 2000);
      }
    };
    connect();
    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [user]);

  const send = useCallback((type: string, payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }, []);
  return { state, send };
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-3 ${compact ? 'justify-center' : ''}`} data-testid="link-netchat-home">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e7795c] text-[#172733] shadow-[3px_3px_0_hsl(187_70%_34%)]">
        <span className="absolute left-[10px] top-[10px] h-2 w-2 rounded-full bg-[#172733]" />
        <span className="absolute right-[10px] top-[10px] h-2 w-2 rounded-full bg-[#172733]" />
        <span className="absolute bottom-[8px] h-[2px] w-4 rotate-[-12deg] bg-[#172733]" />
      </span>
      {!compact && <span className="font-['Space_Grotesk'] text-xl font-bold tracking-[-0.04em] text-white">NetChat<span className="text-[#e7795c]">.</span></span>}
    </Link>
  );
}

function Avatar({ user, size = 'md' }: { user: Pick<User, 'displayName' | 'online'>; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-8 w-8 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-14 w-14 text-base' };
  return (
    <span className={`relative flex shrink-0 items-center justify-center rounded-full bg-[#d9c8a7] font-['Space_Grotesk'] font-bold text-[#263848] ${sizes[size]} ${user.online ? 'status-ring' : ''}`} data-testid={`avatar-${user.displayName}`}>
      {initials(user.displayName)}
      {user.online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[hsl(var(--card))] bg-[#4cb782]" />}
    </span>
  );
}

function ConnectionPill({ state }: { state: SocketState }) {
  const labels: Record<SocketState, string> = { connected: 'socket online', connecting: 'opening socket', reconnecting: 'reconnecting', offline: 'socket offline' };
  const colors: Record<SocketState, string> = { connected: 'bg-[#4cb782]', connecting: 'bg-[#e7ad53]', reconnecting: 'bg-[#e7795c]', offline: 'bg-[#89939a]' };
  return (
    <div className="flex items-center gap-2 rounded-full border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent))] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.12em] text-[#c9d4d5]" data-testid="status-connection">
      <span className={`h-1.5 w-1.5 rounded-full ${colors[state]} ${state === 'connected' ? 'animate-pulse-dot' : ''}`} />
      {labels[state]}
    </div>
  );
}

function NetworkInfo({ me, socketState, activeUsers, lastMessageReceived }: { me: User; socketState: SocketState; activeUsers: number; lastMessageReceived: string | null }) {
  const host = typeof window === 'undefined' ? 'browser host' : window.location.hostname || 'localhost';
  return (
    <details className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-xs" data-testid="panel-network-info">
      <summary className="cursor-pointer list-none px-3 py-2.5 font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
        <span className="flex items-center justify-between"><span className="flex items-center gap-2"><Network className="h-3.5 w-3.5 text-[hsl(var(--primary))]" /> Network info</span><ArrowUpRight className="h-3 w-3" /></span>
      </summary>
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 border-t border-[hsl(var(--border))] px-3 py-3 font-mono text-[10px]">
        <span className="text-[hsl(var(--muted-foreground))]">connection</span><span className="font-semibold">{socketState}</span>
        <span className="text-[hsl(var(--muted-foreground))]">websocket</span><span className="font-semibold">/ws</span>
        <span className="text-[hsl(var(--muted-foreground))]">server</span><span className="font-semibold">{host}</span>
        <span className="text-[hsl(var(--muted-foreground))]">port</span><span className="font-semibold">8080</span>
        <span className="text-[hsl(var(--muted-foreground))]">current user</span><span className="font-semibold">#{me.id}</span>
        <span className="text-[hsl(var(--muted-foreground))]">active users</span><span className="font-semibold">{activeUsers}</span>
        <span className="text-[hsl(var(--muted-foreground))]">last received</span><span className="max-w-[130px] truncate text-right font-semibold">{lastMessageReceived ? timeLabel(lastMessageReceived, true) : 'none yet'}</span>
      </div>
    </details>
  );
}

function AuthEntry() {
  return (
    <main className="grain app-grid flex min-h-[100dvh] items-center justify-center overflow-hidden p-4">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_22px_80px_hsl(214_31%_18%_/_0.15)] md:grid-cols-[1.1fr_.9fr]">
        <div className="relative min-h-[500px] overflow-hidden bg-[#172733] p-8 text-[#f7f1e7] md:p-12">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border-[36px] border-[#e7795c]/20" />
          <div className="absolute -bottom-28 -left-14 h-64 w-64 rounded-full border-[42px] border-[#43a6ad]/20" />
          <Brand />
          <div className="relative mt-24 max-w-md animate-rise">
            <p className="mb-5 font-mono text-[11px] uppercase tracking-[.22em] text-[#83cbd0]">small networks, made visible</p>
            <h1 className="font-['Space_Grotesk'] text-5xl font-bold leading-[.98] tracking-[-.06em] md:text-6xl">Talk to the<br /><span className="text-[#e7795c]">next node.</span></h1>
            <p className="mt-7 max-w-sm text-sm leading-7 text-[#bdc9cb]">A clear, dependable place for campus conversations. See who is around, follow each message, and understand the network as it moves.</p>
          </div>
          <div className="absolute bottom-8 left-8 right-8 flex items-end justify-between border-t border-white/15 pt-5 font-mono text-[10px] uppercase tracking-[.12em] text-[#9eafb2] md:left-12 md:right-12">
            <span>netchat / v0.1</span><span className="flex items-center gap-2"><Signal className="h-3 w-3" /> local-first demo</span>
          </div>
        </div>
        <div className="flex min-h-[500px] flex-col justify-center p-8 md:p-12">
          <div className="mb-10">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--primary))]">connection desk</p>
            <h2 className="font-['Space_Grotesk'] text-3xl font-bold tracking-[-.04em]">Welcome to the network.</h2>
            <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Sign in to pick up your conversations.</p>
          </div>
          <div className="space-y-3">
            <Link href="/login" className="group flex w-full items-center justify-between rounded-xl bg-[hsl(var(--primary))] px-5 py-4 text-sm font-bold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5" data-testid="link-login-entry">
              Sign in <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
            <Link href="/register" className="flex w-full items-center justify-between rounded-xl border border-[hsl(var(--border))] px-5 py-4 text-sm font-bold transition-colors hover:bg-[hsl(var(--muted))]" data-testid="link-register-entry">
              Create an account <UserPlus className="h-4 w-4 text-[hsl(var(--primary))]" />
            </Link>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-3 border-t border-[hsl(var(--border))] pt-5 font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
            <span>01 / presence</span><span>02 / delivery</span><span>03 / clarity</span><span>04 / trust</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthScreen({ mode }: { mode: 'login' | 'register' }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ username: '', displayName: '', password: '' });
  const [formError, setFormError] = useState('');
  const login = useLogin();
  const register = useRegister();
  const isRegister = mode === 'register';
  const pending = login.isPending || register.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    const username = values.username.trim().toLowerCase();
    const displayName = values.displayName.trim();
    if (
      username.length < 3 ||
      username.length > 24 ||
      !/^[a-z0-9._]+$/.test(username) ||
      values.password.length < 8 ||
      values.password.length > 128 ||
      (isRegister && (displayName.length === 0 || displayName.length > 40))
    ) {
      setFormError(isRegister
        ? 'Use 3–24 characters for your username (letters, numbers, periods, or underscores), a display name up to 40 characters, and a password of 8–128 characters.'
        : 'Use 3–24 characters for your username (letters, numbers, periods, or underscores) and a password of 8–128 characters.');
      return;
    }
    const onSuccess = (result: { user: User }) => {
      queryClient.setQueryData(getGetCurrentUserQueryKey(), result.user);
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      setLocation('/');
    };
    if (isRegister) {
      register.mutate({ data: { username, displayName, password: values.password } }, { onSuccess, onError: (error) => setFormError(getErrorMessage(error, 'Registration could not be completed.')) });
    } else {
      login.mutate({ data: { username, password: values.password } }, { onSuccess, onError: (error) => setFormError(getErrorMessage(error, 'Those credentials did not connect.')) });
    }
  };

  return (
    <main className="grain app-grid flex min-h-[100dvh] items-center justify-center p-4">
      <section className="grid w-full max-w-4xl overflow-hidden rounded-[28px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_22px_80px_hsl(214_31%_18%_/_0.15)] md:grid-cols-[.82fr_1.18fr]">
        <div className="relative hidden min-h-[650px] overflow-hidden bg-[#172733] p-9 text-[#f7f1e7] md:block">
          <Brand />
          <div className="absolute bottom-10 left-9 right-9">
            <div className="mb-8 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-[.12em] text-[#a5b5b8]">
              <span className="border border-white/15 p-3">auth / {isRegister ? '02' : '01'}</span><span className="border border-white/15 p-3 text-[#83cbd0]">status / ready</span>
            </div>
            <p className="font-['Space_Grotesk'] text-3xl font-bold leading-tight tracking-[-.04em]">Your campus,<br /><span className="text-[#e7795c]">in signal.</span></p>
          </div>
        </div>
        <div className="p-8 md:p-14">
          <Link href="/" className="mb-12 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" data-testid="link-auth-back"><ArrowLeft className="h-3.5 w-3.5" /> back to entry</Link>
          <div className="mb-9">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[.2em] text-[hsl(var(--primary))]">{isRegister ? 'new node' : 'returning node'}</p>
            <h1 className="font-['Space_Grotesk'] text-4xl font-bold tracking-[-.05em]">{isRegister ? 'Join the network.' : 'Good to see you.'}</h1>
            <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">{isRegister ? 'Create a small, human profile for campus conversations.' : 'Enter your credentials to reopen your message routes.'}</p>
          </div>
          {formError && <div className="mb-5 rounded-xl border border-[#e7795c]/35 bg-[#e7795c]/10 px-4 py-3 text-xs leading-5 text-[#aa4d38]" data-testid="status-auth-error">{formError}</div>}
          <form className="space-y-5" onSubmit={submit}>
             <label className="block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">username</span><input data-testid="input-username" required maxLength={24} autoComplete="username" value={values.username} onChange={(event) => setValues({ ...values, username: event.target.value })} className="h-12 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.15)]" placeholder="maya.chen" /><span className="mt-2 block text-[11px] text-[hsl(var(--muted-foreground))]">3–24 characters · letters, numbers, periods, or underscores</span></label>
             {isRegister && <label className="block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">display name</span><input data-testid="input-display-name" required maxLength={40} autoComplete="name" value={values.displayName} onChange={(event) => setValues({ ...values, displayName: event.target.value })} className="h-12 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.15)]" placeholder="Maya Chen" /></label>}
             <label className="block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">password</span><input data-testid="input-password" required minLength={8} maxLength={128} type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} className="h-12 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.15)]" placeholder="••••••••" /></label>
            <button data-testid="button-submit-auth" disabled={pending} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65">{pending && <LoaderCircle className="h-4 w-4 animate-spin" />}{isRegister ? 'Create account' : 'Sign in'}<ArrowUpRight className="h-4 w-4" /></button>
          </form>
          <p className="mt-8 text-center text-sm text-[hsl(var(--muted-foreground))]">{isRegister ? 'Already connected?' : 'New to NetChat?'} <Link href={isRegister ? '/login' : '/register'} className="font-bold text-[hsl(var(--primary))] hover:underline" data-testid="link-switch-auth">{isRegister ? 'Sign in' : 'Create an account'}</Link></p>
        </div>
      </section>
    </main>
  );
}

function SkeletonWorkspace() {
  return <div className="flex min-h-[100dvh] animate-pulse bg-[hsl(var(--background))]"><div className="hidden w-64 bg-[#172733] md:block" /><div className="w-full p-7"><div className="h-8 w-48 rounded bg-[hsl(var(--muted))]" /><div className="mt-8 h-[70vh] rounded-3xl bg-[hsl(var(--muted))]" /></div></div>;
}

function EmptyConversation() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[26px] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"><Network className="h-8 w-8" /></div>
      <h2 className="font-['Space_Grotesk'] text-2xl font-bold tracking-[-.04em]">Choose a route.</h2>
      <p className="mt-3 max-w-xs text-sm leading-6 text-[hsl(var(--muted-foreground))]">Select a person from your network to open a direct, one-to-one channel.</p>
      <div className="mt-7 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]"><span className="h-1.5 w-1.5 rounded-full bg-[#e7ad53]" /> waiting for selection</div>
    </div>
  );
}

function UserList({ me, users, selectedId, onSelect, loading, error, search, onSearch, onLogout, socketState, activeUsers, lastMessageReceived }: { me: User; users: User[]; selectedId?: number; onSelect: (user: User) => void; loading: boolean; error: unknown; search: string; onSearch: (value: string) => void; onLogout: () => void; socketState: SocketState; activeUsers: number; lastMessageReceived: string | null }) {
  const filtered = useMemo(() => users.filter((user) => `${user.displayName} ${user.username}`.toLowerCase().includes(search.toLowerCase())), [users, search]);
  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))] md:w-[310px]">
      <div className="border-b border-[hsl(var(--border))] p-5">
        <div className="mb-5 flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]">directory</p><h2 className="mt-1 font-['Space_Grotesk'] text-2xl font-bold tracking-[-.05em]">People</h2></div><div className="flex items-center gap-2"><span className="rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]" data-testid="text-user-count">{users.length.toString().padStart(2, '0')} nodes</span><button onClick={onLogout} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] md:hidden" data-testid="button-logout-mobile"><LogOut className="h-4 w-4" /></button></div></div>
        <label className="relative block"><Search className="absolute left-3 top-3 h-4 w-4 text-[hsl(var(--muted-foreground))]" /><input data-testid="input-user-search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Find a classmate..." className="h-10 w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-10 pr-3 text-xs outline-none focus:border-[hsl(var(--primary))]" /></label>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
        {loading && <div className="space-y-2 p-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-[68px] animate-pulse rounded-xl bg-[hsl(var(--muted))]" />)}</div>}
         {Boolean(error) && !loading && <div className="m-2 rounded-xl border border-[#e7795c]/30 bg-[#e7795c]/10 p-4 text-xs leading-5 text-[#aa4d38]" data-testid="status-users-error">Directory unavailable. The socket may still recover presence.</div>}
        {!loading && !error && filtered.length === 0 && <div className="p-7 text-center"><Users className="mx-auto mb-3 h-6 w-6 text-[hsl(var(--muted-foreground))]" /><p className="text-sm font-semibold">No matching nodes</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Try a name or username.</p></div>}
        {!loading && filtered.map((user) => <button key={user.id} data-testid={`button-user-${user.id}`} onClick={() => onSelect(user)} className={`group flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${selectedId === user.id ? 'bg-[hsl(var(--secondary))]' : 'hover:bg-[hsl(var(--muted))]'}`}><Avatar user={user} size="md" /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold">{user.displayName}</span>{user.online && <span className="font-mono text-[9px] uppercase tracking-[.08em] text-[#3d9870]">live</span>}</span><span className="mt-1 block truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">@{user.username}</span></span><ChevronLeft className={`h-4 w-4 rotate-180 text-[hsl(var(--muted-foreground))] transition-opacity ${selectedId === user.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} /></button>)}
      </div>
       <div className="border-t border-[hsl(var(--border))] p-4"><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]"><Radio className="h-3.5 w-3.5 text-[#4cb782]" /> presence refreshed live</div><NetworkInfo me={me} socketState={socketState} activeUsers={activeUsers} lastMessageReceived={lastMessageReceived} /></div>
    </aside>
  );
}

function MessageStatus({ status }: { status: string }) {
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-[#4cb782]" />;
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />;
  return <Check className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />;
}

function ChatPanel({ me, selected, socketState, sendSocket, onBack, remoteTyping, incomingMessage }: { me: User; selected: User; socketState: SocketState; sendSocket: (type: string, payload: Record<string, unknown>) => boolean; onBack: () => void; remoteTyping: boolean; incomingMessage: Message | null }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const { data: history, isLoading, isError } = useGetChatHistory(selected.id, { query: { enabled: Boolean(selected.id), queryKey: getGetChatHistoryQueryKey(selected.id) } });
  const messages = useMemo(() => {
    const known = history ?? [];
    const additions = localMessages.filter((local) => !known.some((remote) => remote.id === local.id));
    return [...known, ...additions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [history, localMessages]);
  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    const optimistic: Message = { id: Date.now(), senderId: me.id, receiverId: selected.id, message: text, timestamp: new Date().toISOString(), status: 'sent' };
    setLocalMessages((current) => [...current, optimistic]);
    setDraft('');
    sendSocket('SEND_MESSAGE', { receiverId: selected.id, message: text });
  };
  const onDraft = (value: string) => {
    setDraft(value);
    if (value.length > 0 && !typing) { setTyping(true); sendSocket('TYPING_START', { receiverId: selected.id }); }
    if (!value.length && typing) { setTyping(false); sendSocket('TYPING_STOP', { receiverId: selected.id }); }
  };
  useEffect(() => {
    setLocalMessages([]);
    setDraft('');
    setTyping(false);
    queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey(selected.id) });
  }, [selected.id, queryClient]);
  useEffect(() => {
    if (!incomingMessage) return;
    const belongsToRoute = incomingMessage.senderId === selected.id || incomingMessage.receiverId === selected.id;
    if (!belongsToRoute) return;
    if (incomingMessage.senderId === me.id) {
      setLocalMessages((current) => current.filter((local) => !(local.message === incomingMessage.message && local.receiverId === incomingMessage.receiverId)));
    }
    queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey(selected.id) });
  }, [incomingMessage, me.id, queryClient, selected.id]);
  useEffect(() => {
    const incoming = messages.filter((message) => message.senderId === selected.id);
    const latest = incoming[incoming.length - 1];
    if (latest) sendSocket('MESSAGE_READ', { messageId: latest.id, senderId: selected.id });
  }, [messages, selected.id, sendSocket]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[hsl(var(--background))]">
      <header className="flex min-h-[81px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 md:px-7">
        <div className="flex min-w-0 items-center gap-3"><button onClick={onBack} className="rounded-lg p-2 hover:bg-[hsl(var(--muted))] md:hidden" data-testid="button-back-directory"><ChevronLeft className="h-5 w-5" /></button><Avatar user={selected} size="md" /><div className="min-w-0"><h2 className="truncate font-['Space_Grotesk'] text-lg font-bold tracking-[-.03em]" data-testid="text-selected-user">{selected.displayName}</h2><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]"><span className={`h-1.5 w-1.5 rounded-full ${selected.online ? 'bg-[#4cb782]' : 'bg-[#9ca5a7]'}`} />{selected.online ? 'online now' : `last seen ${timeLabel(selected.lastSeen)}`}</p></div></div>
        <div className="hidden items-center gap-3 sm:flex"><div className="text-right font-mono text-[10px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]"><span className="block text-[hsl(var(--foreground))]">direct channel</span><span>encrypted transport</span></div><ShieldCheck className="h-5 w-5 text-[hsl(var(--primary))]" /></div>
      </header>
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] px-4 py-2.5 md:px-7"><span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.11em] text-[hsl(var(--muted-foreground))]"><span className={`h-1.5 w-1.5 rounded-full ${socketState === 'connected' ? 'bg-[#4cb782]' : 'bg-[#e7ad53]'}`} /> relay / {socketState}</span><span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">route #{me.id.toString(16)}—{selected.id.toString(16)}</span></div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-7 md:px-10">
        {isLoading && <div className="mx-auto max-w-2xl space-y-4">{[1, 2, 3].map((item) => <div key={item} className={`h-16 w-2/3 animate-pulse rounded-2xl bg-[hsl(var(--muted))] ${item === 2 ? 'ml-auto' : ''}`} />)}</div>}
        {isError && <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-[#e7795c]/30 bg-[#e7795c]/10 p-7 text-center text-[#aa4d38]" data-testid="status-history-error"><RefreshCw className="mb-3 h-5 w-5" /><p className="text-sm font-bold">This route is quiet.</p><p className="mt-1 text-xs leading-5">Message history could not be loaded. New messages will retry through the live relay.</p></div>}
        {!isLoading && !isError && messages.length === 0 && <div className="mx-auto mt-16 max-w-xs text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><MessageCircle className="h-5 w-5" /></div><p className="font-['Space_Grotesk'] font-bold">First contact</p><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Start a direct message with {selected.displayName.split(' ')[0]}.</p></div>}
        <div className="mx-auto flex max-w-2xl flex-col gap-3">{messages.map((message, index) => { const mine = message.senderId === me.id; const showDate = index === 0 || new Date(message.timestamp).toDateString() !== new Date(messages[index - 1]?.timestamp).toDateString(); return <div key={`${message.id}-${index}`} className="animate-rise">{showDate && <div className="my-5 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]"><span className="h-px flex-1 bg-[hsl(var(--border))]" />{new Date(message.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}<span className="h-px flex-1 bg-[hsl(var(--border))]" /></div>}<div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 ${mine ? 'rounded-br-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'rounded-bl-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}><p className="whitespace-pre-wrap text-sm leading-6" data-testid={`text-message-${message.id}`}>{message.message}</p><div className={`mt-2 flex items-center justify-end gap-1.5 font-mono text-[9px] ${mine ? 'text-[hsl(var(--primary-foreground)/.7)]' : 'text-[hsl(var(--muted-foreground))]'}`}><span>{timeLabel(message.timestamp)}</span>{mine && <MessageStatus status={message.status} />}</div></div></div></div> })}</div>
      </div>
      <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 md:p-6"><div className="mx-auto max-w-2xl">{remoteTyping && <p className="mb-2 font-mono text-[10px] uppercase tracking-[.12em] text-[hsl(var(--primary))]" data-testid="status-typing">{selected.displayName.split(' ')[0]} is typing...</p>}<div className="flex items-end gap-3 rounded-2xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-2 focus-within:border-[hsl(var(--primary))]"><textarea data-testid="input-message" value={draft} onChange={(event) => onDraft(event.target.value)} onBlur={() => { if (typing) { setTyping(false); sendSocket('TYPING_STOP', { receiverId: selected.id }); } }} rows={1} placeholder={`Message ${selected.displayName.split(' ')[0]}...`} className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none" /><button data-testid="button-send-message" onClick={sendMessage} disabled={!draft.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5 disabled:opacity-40"><Send className="h-4 w-4" /></button></div><p className="mt-2 text-center font-mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">enter to send · shift + enter for a new line</p></div></div>
    </section>
  );
}

function Workspace({ me }: { me: User }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [selected, setSelected] = useState<User | undefined>();
  const [search, setSearch] = useState('');
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [remoteTypingId, setRemoteTypingId] = useState<number | null>(null);
  const [incomingMessage, setIncomingMessage] = useState<Message | null>(null);
  const [activeUsers, setActiveUsers] = useState(0);
  const [lastMessageReceived, setLastMessageReceived] = useState<string | null>(null);
  const logout = useLogout();
  const usersQuery = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: Boolean(me.id), refetchInterval: 30000 } });
  const selectedFromQuery = usersQuery.data?.find((user) => user.id === selected?.id);
  const activeUser = selectedFromQuery ?? selected;
  const handleEvent = useCallback((event: IncomingEvent) => {
    const payload = event.payload ?? {};
    if (event.type === 'LOGIN') setActiveUsers(Number(payload.activeUsers ?? 0));
    if (event.type === 'USER_ONLINE' || event.type === 'USER_OFFLINE') {
      const userId = Number(payload.userId);
      queryClient.setQueryData<User[]>(getListUsersQueryKey(), (current) => current?.map((user) => user.id === userId ? { ...user, online: event.type === 'USER_ONLINE' } : user));
    }
    if (event.type === 'RECEIVE_MESSAGE' || event.type === 'MESSAGE_DELIVERED' || event.type === 'MESSAGE_READ') {
      const otherId = Number(payload.senderId ?? payload.userId ?? payload.receiverId);
      if (otherId) queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey(otherId) });
    }
    if (event.type === 'RECEIVE_MESSAGE' && typeof payload.message === 'string') {
      setIncomingMessage(payload as unknown as Message);
      setLastMessageReceived(new Date().toISOString());
    }
    if (event.type === 'TYPING_START') setRemoteTypingId(Number(payload.userId ?? payload.senderId));
    if (event.type === 'TYPING_STOP') setRemoteTypingId(null);
  }, [queryClient]);
  const { state: socketState, send: sendSocket } = useNetworkSocket(me, handleEvent);
  const logoutUser = () => logout.mutate(undefined, { onSuccess: () => { queryClient.setQueryData(getGetCurrentUserQueryKey(), undefined); queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); setLocation('/'); } });

  return (
    <main className="grain flex min-h-[100dvh] bg-[hsl(var(--background))]">
      <aside className="hidden w-64 shrink-0 flex-col bg-[#172733] px-5 py-6 text-[#e8eee9] md:flex">
        <Brand />
        <div className="mt-12"><p className="mb-3 font-mono text-[10px] uppercase tracking-[.2em] text-[#7abec4]">workspace</p><div className="flex items-center gap-3 rounded-xl bg-[#263848] px-3 py-3 text-sm font-bold"><MessageCircle className="h-4 w-4 text-[#e7795c]" />Messages<span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#e7795c]" /></div></div>
        <div className="mt-auto">
          <ConnectionPill state={socketState} />
          <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-5"><Avatar user={me} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{me.displayName}</p><p className="truncate font-mono text-[9px] text-[#9eafb2]">@{me.username}</p></div><button onClick={logoutUser} disabled={logout.isPending} className="rounded-lg p-2 text-[#9eafb2] hover:bg-white/10 hover:text-white" data-testid="button-logout"><LogOut className="h-4 w-4" /></button></div>
        </div>
      </aside>
      <div className={`flex min-w-0 flex-1 ${activeUser && !directoryOpen ? 'directory-hidden-mobile' : ''}`}>
        <div className={`flex min-w-0 flex-1 md:flex ${activeUser && !directoryOpen ? 'hidden md:flex' : 'flex'}`}><UserList me={me} users={usersQuery.data ?? []} selectedId={activeUser?.id} onSelect={(user) => { setSelected(user); setDirectoryOpen(false); }} loading={usersQuery.isLoading} error={usersQuery.error} search={search} onSearch={setSearch} onLogout={logoutUser} socketState={socketState} activeUsers={activeUsers} lastMessageReceived={lastMessageReceived} /></div>
        <div className={`min-w-0 flex-1 ${activeUser ? (directoryOpen ? 'hidden md:flex' : 'flex') : 'hidden md:flex'}`}>{activeUser ? <ChatPanel me={me} selected={activeUser} socketState={socketState} sendSocket={sendSocket} onBack={() => setDirectoryOpen(true)} remoteTyping={remoteTypingId === activeUser.id} incomingMessage={incomingMessage} /> : <EmptyConversation />}</div>
      </div>
      <div className="fixed bottom-4 right-4 md:hidden"><button onClick={() => setDirectoryOpen(!directoryOpen)} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#172733] text-[#f7f1e7] shadow-lg" data-testid="button-toggle-directory">{directoryOpen ? <X className="h-5 w-5" /> : <PanelLeft className="h-5 w-5" />}</button></div>
    </main>
  );
}

function Home() {
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  if (current.isLoading) return <SkeletonWorkspace />;
  if (!current.data) return <AuthEntry />;
  return <Workspace me={current.data} />;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route path="/login"><AuthScreen mode="login" /></Route><Route path="/register"><AuthScreen mode="register" /></Route><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;