import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  HelpCircle,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  X,
  Wifi,
  Anchor,
  Users,
  Sparkles,
  RotateCcw,
  Share2,
} from 'lucide-react';
import { card, SETS } from './game/catalogue';
import {
  botAction,
  choices,
  complete,
  completed,
  payableAssets,
  rent,
  viewFor,
} from './game/engine';
import type { Action, PlayerView, PublicPlayer } from './game/types';
import {
  AVATARS,
  createRoom,
  fetchView,
  forgetSession,
  heartbeat,
  joinRoom,
  lastOnline,
  onlineReady,
  practice,
  readPractice,
  runBot,
  savedSession,
  sendAction,
  subscribe,
  type Session,
} from './services/session';
import { CoastArt } from './components/CoastArt';
import { CardFace } from './components/Card';

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const list = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,[tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''}`}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Rulebook({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="A quick trip around the rules" onClose={onClose} wide>
      <div className="rules">
        <p className="lead">Three complete colour sets. A little coastal cunning.</p>
        <ol>
          <li>
            <strong>Draw.</strong> Start with five cards. At the beginning of your turn, draw two —
            or five if your hand is empty.
          </li>
          <li>
            <strong>Play up to three cards.</strong> Collect properties, bank money or action cards,
            or play an action. You can finish early.
          </li>
          <li>
            <strong>Build your coast.</strong> Match colours to complete sets. Hardware needs four
            cards; utilities and the brown and dark blue groups need two; the other sets need three.
          </li>
          <li>
            <strong>Charge rent and make deals.</strong> A paired-colour rent card charges everyone;
            an any-colour rent card charges one opponent. Each rent booster uses another play.
          </li>
          <li>
            <strong>Pay your way.</strong> Choose cards from your bank or collection, never your
            hand. There’s no change. If you cannot cover the debt, pay all payable assets; having no
            assets does not eliminate you.
          </li>
          <li>
            <strong>Yeah, Nah!</strong> Block an action against you. The other player can block your
            block. Responding does not use a turn play.
          </li>
          <li>
            <strong>Finish.</strong> Discard down to seven cards. Win with three complete sets of
            different colours on your turn after pending actions resolve.
          </li>
        </ol>
        <h3>A few digital conventions</h3>
        <p>
          Wildcards can move on your turn without using a play. Each complete set needs at least one
          named property. Shacks and resorts work on coastal colour sets, with a shack needed before
          a resort. Buildings from broken sets move to your unassigned improvements; reattach them
          on your turn for free. Payment properties join a matching available group. You can
          rearrange wildcards afterwards on your turn.
        </p>
        <p>
          Payments and blocks resolve clockwise, one player at a time. Discarded cards form a
          discard pile, which is shuffled when the draw pile runs out. Empty draw and discard piles
          simply yield fewer cards. There are no response timers; a disconnected player’s seat waits
          for them.
        </p>
        <p className="muted">
          An independent fan project celebrating the NSW South Coast. Not affiliated with Hasbro.
          Original coastal artwork; no official card scans.
        </p>
      </div>
    </Modal>
  );
}
function label(a: Action, v: PlayerView): string {
  const me = v.players.find((p) => p.id === v.you)!;
  const target =
    'targetPlayerId' in a ? v.players.find((p) => p.id === a.targetPlayerId) : undefined;
  if (a.type === 'move')
    return `Move to ${SETS[a.color].name}${a.toGroupId ? ' · existing group' : ' · new group'}`;
  if (a.type === 'moveBuilding')
    return `Attach to ${SETS[me.groups.find((g) => g.id === a.toGroupId)!.color].name}`;
  if (a.type !== 'play') return a.type;
  if (a.mode === 'bank') return `Bank ${card(a.cardId).value}M`;
  if (a.mode === 'property')
    return `${SETS[a.color!].name} · ${a.groupId ? 'add to existing group' : 'start a new group'}`;
  const g = me.groups.find((g) => g.id === a.groupId);
  const otherGroup = target?.groups.find((g) => g.id === a.targetGroupId);
  return (
    [
      g ? SETS[g.color].name : '',
      target ? target.name : '',
      a.targetCardId ? card(a.targetCardId).name : otherGroup ? SETS[otherGroup.color].name : '',
      a.giveCardId ? `give ${card(a.giveCardId).name}` : '',
      card(a.cardId).effect === 'rent'
        ? `${g ? rent(g) * 2 ** (a.boostIds?.length ?? 0) : 0}M${target ? '' : ' from each opponent'}${a.boostIds?.length ? ` · ${a.boostIds.length} booster(s)` : ''}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ') || card(a.cardId).description
  );
}
function PlayerCollection({
  p,
  isYou = false,
  onInspect,
}: {
  p: PublicPlayer;
  isYou?: boolean;
  onInspect: (id: string) => void;
}) {
  return (
    <div className="collection">
      <div className="collection-heading">
        <h3>{isYou ? 'Your coast' : `${p.name}’s coast`}</h3>
        <span>{completed(p)} / 3 sets</span>
      </div>
      <div className="property-groups">
        {p.groups.map((g) => (
          <div
            className={`property-group ${complete(g) ? 'full-set' : ''}`}
            key={g.id}
            style={{ '--set-color': SETS[g.color].color } as any}
          >
            <div className="group-label">
              <strong>{SETS[g.color].name}</strong>
              <span>
                {g.cards.length}/{SETS[g.color].size} {complete(g) ? '✓' : ''}
              </span>
            </div>
            <div className="property-names">
              {g.cards.map((id) => (
                <button key={id} onClick={() => onInspect(id)}>
                  {card(id).name}
                  {card(id).kind === 'wild' ? ' ↔' : ''}
                </button>
              ))}
            </div>
            <div className="group-foot">
              <span>Rent {rent(g)}M</span>
              <span>
                {g.house && (
                  <button aria-label="Inspect Holiday Shack" onClick={() => onInspect(g.house!)}>
                    ⌂
                  </button>
                )}
                {g.hotel && (
                  <button aria-label="Inspect Coastal Resort" onClick={() => onInspect(g.hotel!)}>
                    ▥
                  </button>
                )}
              </span>
            </div>
          </div>
        ))}
        {!p.groups.length && (
          <div className="empty-coast">
            <Anchor size={23} />
            <p>{isYou ? 'Your coastal collection starts here.' : 'No properties collected yet.'}</p>
          </div>
        )}
      </div>
      <div className="bank-row">
        <strong>
          Bank <span>{p.bank.reduce((n, id) => n + card(id).value, 0)}M</span>
        </strong>
        <div>
          {p.bank.map((id) => (
            <button
              key={id}
              onClick={() => onInspect(id)}
              aria-label={`Inspect banked ${card(id).name}`}
            >
              {card(id).value}M
            </button>
          ))}
          {!p.bank.length && <span className="muted">Nothing banked yet</span>}
        </div>
      </div>
      {p.reserve.length > 0 && (
        <div className="bank-row">
          <strong>Unassigned improvements</strong>
          <div>
            {p.reserve.map((id) => (
              <button key={id} onClick={() => onInspect(id)}>
                {card(id).name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(() => savedSession());
  const [view, setView] = useState<PlayerView | null>(null);
  const [setup, setSetup] = useState<'practice' | 'friends' | null>(null);
  const [name, setName] = useState(() => localStorage.getItem('deal.name') || '');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [botCount, setBotCount] = useState(2);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [rules, setRules] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('connected');
  const [inspect, setInspect] = useState<string | null>(null);
  const [useMode, setUseMode] = useState<string>('');
  const [option, setOption] = useState(0);
  const [review, setReview] = useState(false);
  const [paid, setPaid] = useState<string[]>([]);
  const [discards, setDiscards] = useState<string[]>([]);
  const [sound, setSound] = useState(() => localStorage.getItem('deal.sound') !== 'off');
  const [dark, setDark] = useState(() => localStorage.getItem('deal.theme') === 'dark');
  const [toast, setToast] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const version = useRef(-1);
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('deal.theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    localStorage.setItem('deal.sound', sound ? 'on' : 'off');
  }, [sound]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const update = useCallback((v: PlayerView) => {
    if (v.version >= version.current) {
      version.current = v.version;
      setView(v);
    }
  }, []);
  useEffect(() => {
    if (!session) return;
    let live = true;
    const refresh = () =>
      fetchView(session)
        .then((v) => {
          if (live) {
            update(v);
            setError('');
            setStatus('connected');
          }
        })
        .catch((e) => {
          if (live) {
            setStatus('reconnecting');
            setError(e.message);
          }
        });
    void refresh();
    const unsub = subscribe(session, refresh, setStatus);
    const timer =
      session.mode === 'online'
        ? setInterval(() => {
            void heartbeat(session).catch(() => setStatus('reconnecting'));
            void refresh();
          }, 15000)
        : undefined;
    void heartbeat(session).catch(() => {});
    const onOnline = () => void refresh();
    window.addEventListener('online', onOnline);
    return () => {
      live = false;
      unsub();
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [session, update]);
  const chime = useCallback(() => {
    if (!sound) return;
    try {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume();
      const ctx = audioRef.current,
        o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(600, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.12);
      g.gain.setValueAtTime(0.025, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.22);
    } catch {
      /* audio is optional */
    }
  }, [sound]);
  const act = useCallback(
    async (a: Action) => {
      if (!session || !view || busy) return;
      setBusy(true);
      setError('');
      try {
        const v = await sendAction(session, view, a);
        if (v) update(v);
        else {
          forgetSession();
          setSession(null);
          setView(null);
          version.current = -1;
        }
        setInspect(null);
        setPaid([]);
        setDiscards([]);
        chime();
      } catch (e) {
        setError((e as Error).message);
        if (session.mode === 'online')
          void fetchView(session)
            .then(update)
            .catch(() => setStatus('reconnecting'));
      } finally {
        setBusy(false);
      }
    },
    [session, view, busy, update, chime],
  );
  useEffect(() => {
    if (!session || !view || session.mode !== 'local' || view.stage === 'finished') return;
    const state = readPractice()!;
    const id =
      view.stage === 'response' || view.stage === 'payment'
        ? view.pending?.responder
        : state.players[state.turn]?.id;
    const bot = state.players.find((p) => p.id === id && p.isBot);
    if (!bot) return;
    const timer = setTimeout(() => {
      try {
        const a = botAction(viewFor(readPractice()!, bot.id));
        if (a) update(runBot(session, bot.id, a));
      } catch (e) {
        setError(`Bot paused: ${(e as Error).message}`);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [session, view, update]);
  const openCard = (id: string) => {
    setInspect(id);
    setUseMode('');
    setOption(0);
    setReview(false);
  };
  const legal = useMemo(() => (view ? choices(view) : []), [view]);
  const cardOptions = legal.filter((a) => 'cardId' in a && a.cardId === inspect);
  const modes = [...new Set(cardOptions.map((a) => (a.type === 'play' ? a.mode : a.type)))];
  const filtered = cardOptions.filter((a) => (a.type === 'play' ? a.mode : a.type) === useMode);
  const selected = filtered[option];
  async function begin(kind: 'practice' | 'create' | 'join') {
    if (!name.trim()) {
      setError('Choose a name for your coastal adventure.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      localStorage.setItem('deal.name', name.trim());
      const s =
        kind === 'practice'
          ? practice(name.trim(), avatar, botCount)
          : kind === 'create'
            ? await createRoom(name.trim(), avatar)
            : await joinRoom(code, name.trim(), avatar);
      version.current = -1;
      setView(null);
      setSession(s);
      setSetup(null);
      const v = await fetchView(s);
      update(v);
      chime();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const leaveHome = async () => {
    if (session?.mode === 'online' && view && view.stage !== 'finished') {
      setBusy(true);
      try {
        if (view.stage === 'lobby') {
          await sendAction(session, view, {
            type: view.players.length === 1 ? 'endGame' : 'leave',
          });
          localStorage.removeItem('deal.last-online');
        } else if (view.hostId === view.you) await sendAction(session, view, { type: 'leave' });
      } catch {
        /* Keep the saved seat if no connected successor or connection is available. */
      } finally {
        setBusy(false);
      }
    }
    forgetSession();
    setSession(null);
    setView(null);
    version.current = -1;
    setInspect(null);
    setConfirmLeave(false);
    setError('');
  };
  const copy = async () => {
    if (!view) return;
    const link = new URL(location.href);
    link.search = '';
    link.searchParams.set('room', view.code);
    try {
      await navigator.clipboard.writeText(link.toString());
      setToast('Invitation link copied');
    } catch {
      setToast(`Room code: ${view.code}`);
    }
  };
  const me = view?.players.find((p) => p.id === view.you);
  const turn = view?.players[view.turn];
  const yourTurn = turn?.id === view?.you;
  const waitingFor = view?.pending
    ? view.players.find((p) => p.id === view.pending!.responder)
    : undefined;
  return (
    <div className="app">
      <header className="topbar">
        <button
          className="wordmark"
          onClick={() => (session ? setConfirmLeave(true) : setSetup(null))}
        >
          <span className="brand-icon">
            N<span>≈</span>
          </span>
          <span>
            Naroomopoly <b>DEAL</b>
          </span>
        </button>
        <div className="top-actions">
          <span className="coast-label">NSW SOUTH COAST EDITION</span>
          <button className="icon-btn" onClick={() => setRules(true)} aria-label="How to play">
            <HelpCircle size={20} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setSound(!sound)}
            aria-label={sound ? 'Mute sound' : 'Enable sound'}
          >
            {sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button
            className="icon-btn"
            onClick={() => setDark(!dark)}
            aria-label={dark ? 'Use light theme' : 'Use dark theme'}
          >
            {dark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}
      {!session && !setup && (
        <main className="landing">
          <div className="hero-copy">
            <div className="edition">
              <span /> A FAMILIAR GAME. A LOCAL TWIST.
            </div>
            <h1>
              A little
              <br />
              coastal <em>cunning.</em>
            </h1>
            <p>
              From Nelligen to Narooma, the coast is up for grabs. Collect your favourite places,
              make a cheeky deal, and be first to build three complete sets.
            </p>
            <div className="hero-buttons">
              <button className="primary" onClick={() => setSetup('friends')}>
                Play with Friends <ArrowRight size={18} />
              </button>
              <button className="secondary" onClick={() => setSetup('practice')}>
                Practice with Bots <Sparkles size={18} />
              </button>
            </div>
            <div className="hero-facts">
              <span>
                <Users size={16} /> 2–5 players
              </span>
              <span>◷ About 15–20 min</span>
              <span>⌁ No account needed</span>
            </div>
          </div>
          <div className="hero-art">
            <div className="art-stamp">
              BATEMANS BAY
              <br />
              <span>to</span> NAROOMA
            </div>
            <CoastArt className="landscape" />
            <div className="hero-card one">
              <CardFace id="c028" small />
            </div>
            <div className="hero-card two">
              <CardFace id="c022" small />
            </div>
            <div className="art-caption">YOUR FAVOURITE PLACES. A WHOLE NEW HAND.</div>
          </div>
          <section className="how-strip">
            <div>
              <span>01</span>
              <h3>Collect the coast</h3>
              <p>
                Beaches, villages, hardware runs.
                <br />
                Build three different colour sets.
              </p>
            </div>
            <div>
              <span>02</span>
              <h3>Make your move</h3>
              <p>
                Charge holiday rent, swap properties,
                <br />
                or pull off a coastal takeover.
              </p>
            </div>
            <div>
              <span>03</span>
              <h3>Keep it cheeky</h3>
              <p>
                Someone coming for your coast?
                <br />A well-timed “Yeah, Nah!” helps.
              </p>
            </div>
            <button className="text-button" onClick={() => setRules(true)}>
              Learn to play <ArrowRight size={17} />
            </button>
          </section>
          <footer>
            <span>Made for a different kind of coastal getaway.</span>
            <span>Independent fan project · Original South Coast artwork</span>
          </footer>
        </main>
      )}
      {!session && setup && (
        <main className="setup-page">
          <button
            className="text-button"
            onClick={() => {
              setSetup(null);
              setError('');
            }}
          >
            <ArrowLeft size={17} /> Back to the coast
          </button>
          <div className="setup-grid">
            <div>
              <div className="edition">PULL UP A CHAIR</div>
              <h1>
                {setup === 'practice' ? (
                  <>
                    A few local
                    <br />
                    <em>characters.</em>
                  </>
                ) : (
                  <>
                    Good mates.
                    <br />
                    <em>Great deals.</em>
                  </>
                )}
              </h1>
              <p>
                {setup === 'practice'
                  ? 'Find your feet against our coastal crew. No connection needed; your table saves as you play.'
                  : 'One room, one code, your favourite people. Everyone plays on their own phone or computer.'}
              </p>
              <CoastArt variant={1} className="setup-art" />
            </div>
            <form
              className="setup-card"
              onSubmit={(e) => {
                e.preventDefault();
                void begin(setup === 'practice' ? 'practice' : code ? 'join' : 'create');
              }}
            >
              <h2>{setup === 'practice' ? 'Meet you at the table' : 'Your place on the coast'}</h2>
              <label>
                Your name
                <input
                  autoFocus
                  maxLength={30}
                  placeholder="What should we call you?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label>Choose your character</label>
              <div className="avatars">
                {AVATARS.map((a) => (
                  <button
                    type="button"
                    aria-label={`Choose ${a}`}
                    aria-pressed={avatar === a}
                    className={avatar === a ? 'chosen' : ''}
                    key={a}
                    onClick={() => setAvatar(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
              {setup === 'practice' ? (
                <label>
                  Computer opponents
                  <select value={botCount} onChange={(e) => setBotCount(Number(e.target.value))}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'opponent' : 'opponents'}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    Joining friends? Enter their room code
                    <input
                      maxLength={5}
                      placeholder="Leave empty to create a room"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                    />
                  </label>
                  {!onlineReady && (
                    <div className="notice">
                      <Wifi size={18} />
                      <p>
                        Online rooms need a Supabase connection. You can play a complete practice
                        game now.
                      </p>
                    </div>
                  )}
                </>
              )}
              <button
                className="primary full"
                disabled={busy || (setup === 'friends' && !onlineReady)}
              >
                {busy
                  ? 'Getting your table ready…'
                  : setup === 'practice'
                    ? 'Let’s play'
                    : code
                      ? 'Join room'
                      : 'Create a private room'}
                <ArrowRight size={17} />
              </button>
              {setup === 'friends' && !onlineReady && (
                <button
                  type="button"
                  className="secondary full"
                  onClick={() => {
                    setSetup('practice');
                    setError('');
                  }}
                >
                  Practice with Bots
                </button>
              )}
              <p className="muted small">
                No sign-up. No downloads. Just a little coastal cunning.
              </p>
            </form>
          </div>
        </main>
      )}
      {session && !view && (
        <main className="loading">
          <Anchor size={40} />
          <h2>Returning to your table…</h2>
          <p>
            {status === 'reconnecting'
              ? 'Waiting for the connection. Your online table stays saved.'
              : 'Finding your place on the coast.'}
          </p>
          <button
            className="secondary"
            onClick={() =>
              void fetchView(session)
                .then(update)
                .catch((e) => setError(e.message))
            }
          >
            Try again
          </button>
          <button className="text-button" onClick={leaveHome}>
            Return home
          </button>
        </main>
      )}
      {session && view && view.stage === 'lobby' && (
        <main className="lobby">
          <div className="edition">THE COAST IS CALLING</div>
          <h1>
            Room for <em>your crew.</em>
          </h1>
          <p>Share this room code or copy an invitation. Two to five people can play.</p>
          <button className="room-code" onClick={() => void copy()}>
            {view.code}
            <Copy size={23} />
          </button>
          <div className="lobby-seats">
            {view.players.map((p) => (
              <div key={p.id}>
                <span>{p.avatar}</span>
                <strong>{p.name}</strong>
                <small>{p.id === view.hostId ? 'HOST' : 'READY'}</small>
              </div>
            ))}
            {view.players.length < 5 && (
              <div className="open-seat">
                <span>＋</span>
                <strong>Room for a mate</strong>
                <small>SHARE THE CODE</small>
              </div>
            )}
          </div>
          <div className="lobby-buttons">
            <button className="secondary" onClick={() => void copy()}>
              <Share2 size={17} /> Copy invitation
            </button>
            {view.hostId === view.you ? (
              <button
                className="primary"
                disabled={busy || view.players.length < 2}
                onClick={() => void act({ type: 'start' })}
              >
                Start the game <ArrowRight size={17} />
              </button>
            ) : (
              <p>Waiting for the host to start…</p>
            )}
          </div>
          <button className="text-button" onClick={() => setConfirmLeave(true)}>
            Leave room
          </button>
        </main>
      )}
      {session && view && me && view.stage !== 'lobby' && (
        <main className="table-page">
          <div className="table-meta">
            <div>
              <span className="edition">
                {session.mode === 'local' ? 'PRACTICE TABLE' : `PRIVATE TABLE · ${view.code}`}
              </span>
              <h1>
                Your slice of the <em>South Coast.</em>
              </h1>
            </div>
            <span className={`connection ${status === 'reconnecting' ? 'offline' : ''}`}>
              <i />
              {session.mode === 'local'
                ? 'Saved on this device'
                : status === 'connected'
                  ? 'Connected'
                  : 'Reconnecting…'}
            </span>
          </div>
          <div className="table-layout">
            <div className="play-area">
              <section className="opponents" aria-label="Opponents">
                {view.players
                  .filter((p) => p.id !== view.you)
                  .map((p) => (
                    <details
                      className={`opponent ${turn?.id === p.id ? 'active-player' : ''}`}
                      key={p.id}
                    >
                      <summary>
                        <span className="avatar">{p.avatar}</span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.isBot ? 'COASTAL CREW' : p.id === view.hostId ? 'HOST' : 'PLAYER'}
                            {turn?.id === p.id ? ' · THEIR TURN' : ''}
                          </small>
                        </span>
                        <span className="opponent-stats">
                          <b>{completed(p)} / 3</b>
                          <small>
                            {p.handCount} cards · {p.bank.reduce((n, id) => n + card(id).value, 0)}M
                          </small>
                        </span>
                      </summary>
                      <PlayerCollection p={p} onInspect={openCard} />
                    </details>
                  ))}
              </section>
              <section className="action-zone" aria-live="polite">
                <div className="deck-visual">
                  <div className="card-back">
                    <span>N</span>
                    <small>DEAL</small>
                    <i>≈</i>
                  </div>
                  <span>{view.deckCount} to draw</span>
                </div>
                <div className="turn-message">
                  <div className="edition">
                    {view.stage === 'finished'
                      ? 'COASTAL COLLECTION COMPLETE'
                      : waitingFor
                        ? 'A LITTLE BACK AND FORTH'
                        : yourTurn
                          ? 'YOUR TURN'
                          : 'ON THE COAST'}
                  </div>
                  <h2>
                    {view.stage === 'finished'
                      ? view.winner === view.you
                        ? 'You’ve collected the coast!'
                        : view.winner
                          ? `${view.players.find((p) => p.id === view.winner)?.name} wins!`
                          : 'This table has ended'
                      : waitingFor
                        ? `${waitingFor.name}${waitingFor.id === view.you ? ' — that’s you' : ''}`
                        : yourTurn
                          ? view.stage === 'draw'
                            ? 'A fresh hand of possibilities.'
                            : view.stage === 'discard'
                              ? 'A few too many souvenirs.'
                              : 'What’s your next move?'
                          : `${turn?.name} is making a move.`}
                  </h2>
                  <p>
                    {view.stage === 'finished'
                      ? view.endedReason ||
                        'Three complete sets. One very pleased coastal collector.'
                      : view.stage === 'response'
                        ? `${view.players.find((p) => p.id === view.pending!.actor)?.name} played ${view.pending?.effect === 'rent' ? 'Holiday Letting' : view.pending?.effect === 'debt' ? 'Shire Rates Notice' : view.pending?.effect === 'birthday' ? 'Oyster Festival Shout' : view.pending?.effect === 'takeSet' ? 'Coastal Takeover' : view.pending?.effect === 'swap' ? 'South Coast Property Swap' : 'Facebook Marketplace Find'}. ${view.pending?.blocked ? 'A block is waiting for a counter.' : 'Accept the action or play Yeah, Nah!'}${view.pending?.amount ? ` ${view.pending.amount}M due.` : ''}`
                        : view.stage === 'payment'
                          ? `Payment due: ${view.pending?.amount}M. The debtor chooses which assets to give.`
                          : view.stage === 'discard'
                            ? `Discard ${Math.max(0, view.hand.length - 7)} cards to finish your turn.`
                            : yourTurn
                              ? view.stage === 'draw'
                                ? 'Draw your cards, then make up to three plays.'
                                : `${3 - view.plays} ${3 - view.plays === 1 ? 'play' : 'plays'} remaining. Tap a card to explore your options.`
                              : 'Have a look at your cards while you wait.'}
                  </p>
                  <div className="turn-buttons">
                    {yourTurn && view.stage === 'draw' && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void act({ type: 'draw' })}
                      >
                        Draw {view.hand.length ? 2 : 5} cards <ArrowRight size={17} />
                      </button>
                    )}
                    {yourTurn && view.stage === 'play' && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void act({ type: 'endTurn' })}
                      >
                        End turn <Check size={17} />
                      </button>
                    )}
                    {view.stage === 'response' && waitingFor?.id === view.you && (
                      <>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => void act({ type: 'respond', block: false })}
                        >
                          {view.pending?.blocked ? 'Let the block stand' : 'Accept action'}
                        </button>
                        <button
                          className="secondary"
                          disabled={busy || !view.hand.some((id) => card(id).effect === 'no')}
                          onClick={() => void act({ type: 'respond', block: true })}
                        >
                          Yeah, Nah! {view.pending?.blocked ? '· counter' : ''}
                        </button>
                      </>
                    )}
                    {view.stage === 'finished' && (
                      <button className="primary" onClick={leaveHome}>
                        Back to the coast <RotateCcw size={17} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="discard-visual">
                  {view.discardTop ? (
                    <CardFace
                      id={view.discardTop}
                      small
                      onClick={() => openCard(view.discardTop!)}
                    />
                  ) : (
                    <div className="discard-empty">≈</div>
                  )}
                  <span>{view.discardCount} discarded</span>
                </div>
              </section>
              {view.stage === 'payment' && waitingFor?.id === view.you && (
                <section className="payment-panel">
                  <h3>Choose your payment</h3>
                  <p>
                    You owe {view.pending?.amount}M. Select bank cards or properties. No change is
                    given.
                  </p>
                  <div className="asset-options">
                    {payableAssets(me).map((id) => (
                      <label className={paid.includes(id) ? 'checked' : ''} key={id}>
                        <input
                          type="checkbox"
                          checked={paid.includes(id)}
                          onChange={() =>
                            setPaid((p) =>
                              p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
                            )
                          }
                        />
                        <span>
                          {card(id).name}
                          <small>{me.bank.includes(id) ? 'Banked money' : 'Collection'}</small>
                        </span>
                        <b>{card(id).value}M</b>
                      </label>
                    ))}
                  </div>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      paid.reduce((n, id) => n + card(id).value, 0) <
                        Math.min(
                          view.pending!.amount!,
                          payableAssets(me).reduce((n, id) => n + card(id).value, 0),
                        )
                    }
                    onClick={() => void act({ type: 'pay', cardIds: paid })}
                  >
                    Pay {paid.reduce((n, id) => n + card(id).value, 0)}M
                    {!payableAssets(me).length ? ' · no assets owed' : ''}
                  </button>
                </section>
              )}
              <section className="your-collection">
                <PlayerCollection p={me} isYou onInspect={openCard} />
              </section>
              <section className="hand-section">
                <div className="collection-heading">
                  <h3>
                    Your hand <span className="count">{view.hand.length}</span>
                  </h3>
                  <span>
                    {view.stage === 'discard'
                      ? 'Select cards to discard'
                      : 'Only you can see these cards'}
                  </span>
                </div>
                <div className="hand">
                  {view.hand.map((id) => (
                    <CardFace
                      id={id}
                      small
                      key={id}
                      selected={discards.includes(id)}
                      onClick={() =>
                        view.stage === 'discard' && yourTurn
                          ? setDiscards((d) =>
                              d.includes(id) ? d.filter((x) => x !== id) : [...d, id],
                            )
                          : openCard(id)
                      }
                    />
                  ))}
                  {!view.hand.length && (
                    <p className="muted">Travel light. You’ll draw five cards on your next turn.</p>
                  )}
                </div>
                {view.stage === 'discard' && yourTurn && (
                  <button
                    className="primary"
                    disabled={busy || discards.length !== view.hand.length - 7}
                    onClick={() => void act({ type: 'discard', cardIds: discards })}
                  >
                    Discard {discards.length} selected cards
                  </button>
                )}
              </section>
            </div>
            <aside className="table-sidebar">
              <div className="table-note">
                <span className="avatar">{me.avatar}</span>
                <h3>{me.name}’s getaway</h3>
                <p>
                  Three different complete sets.
                  <br />
                  That’s your ticket to the coast.
                </p>
                <div className="set-progress">
                  {[0, 1, 2].map((n) => (
                    <span className={completed(me) > n ? 'done' : ''} key={n}>
                      {completed(me) > n ? '✓' : n + 1}
                    </span>
                  ))}
                </div>
              </div>
              <section className="log">
                <h3>Along the coast</h3>
                <ol>
                  {[...view.events]
                    .reverse()
                    .slice(0, 15)
                    .map((e) => (
                      <li key={e.id}>{e.text}</li>
                    ))}
                </ol>
              </section>
              <button className="text-button" onClick={() => setRules(true)}>
                <HelpCircle size={16} /> Rules & card guide
              </button>
              <button className="text-button" onClick={() => setConfirmLeave(true)}>
                Leave table
              </button>
            </aside>
          </div>
        </main>
      )}
      {inspect && view && (
        <Modal title={card(inspect).name} onClose={() => setInspect(null)} wide>
          <div className="inspect-layout">
            <CardFace id={inspect} />
            <div className="inspect-actions">
              <div className="edition">
                {view.hand.includes(inspect)
                  ? 'IN YOUR HAND'
                  : me?.bank.includes(inspect)
                    ? 'BANKED AS MONEY'
                    : 'ON THE TABLE'}
              </div>
              <h3>{card(inspect).subtitle}</h3>
              <p>{card(inspect).description}</p>
              {card(inspect).colors && (
                <div className="rent-guide">
                  {card(inspect).colors!.map((c) => (
                    <div key={c}>
                      <i style={{ background: SETS[c].color }} />
                      <span>{SETS[c].name}</span>
                      <small>{SETS[c].rent.join(' / ')}M</small>
                    </div>
                  ))}
                </div>
              )}
              {cardOptions.length > 0 ? (
                <>
                  <div className="mode-buttons">
                    {modes.map((mode) => (
                      <button
                        key={mode}
                        className={useMode === mode ? 'primary' : 'secondary'}
                        onClick={() => {
                          setUseMode(mode);
                          setOption(0);
                          setReview(false);
                        }}
                      >
                        {mode === 'bank'
                          ? `Bank ${card(inspect).value}M`
                          : mode === 'property'
                            ? 'Collect property'
                            : mode === 'move'
                              ? 'Move wildcard'
                              : mode === 'moveBuilding'
                                ? 'Move building'
                                : 'Play action'}
                      </button>
                    ))}
                  </div>
                  {useMode && (
                    <>
                      <label>
                        Choose how to play
                        <select
                          value={option}
                          onChange={(e) => {
                            setOption(Number(e.target.value));
                            setReview(false);
                          }}
                        >
                          {filtered.map((a, i) => (
                            <option key={i} value={i}>
                              {label(a, view)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selected && (
                        <div className="move-preview">
                          <strong>{review ? 'Ready to make your move?' : 'Your move'}</strong>
                          <p>{label(selected, view)}</p>
                          <small>
                            {selected.type === 'move' || selected.type === 'moveBuilding'
                              ? 'Free rearrangement · uses no plays'
                              : `Uses ${selected.type === 'play' ? 1 + (selected.boostIds?.length ?? 0) : 0} of your remaining ${3 - view.plays} plays.`}
                          </small>
                        </div>
                      )}
                      <button
                        className="primary full"
                        disabled={busy || !selected}
                        onClick={() => (review ? void act(selected) : setReview(true))}
                      >
                        {review ? 'Confirm move' : 'Review move'}
                        <ArrowRight size={17} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div className="notice">
                  <p>
                    {view.stage === 'finished'
                      ? 'This game has ended.'
                      : me?.bank.includes(inspect)
                        ? 'A banked action is money for the rest of the game.'
                        : card(inspect).effect === 'no' && view.hand.includes(inspect)
                          ? 'Use Yeah, Nah! when an action is played against you.'
                          : yourTurn
                            ? 'No legal play for this card right now. Draw or resolve the current action first.'
                            : 'Keep this one in mind for your next turn.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
      {rules && <Rulebook onClose={() => setRules(false)} />}
      {confirmLeave && session && (
        <Modal title="Leave your coastal table?" onClose={() => setConfirmLeave(false)}>
          <p>
            {session.mode === 'local'
              ? 'Your practice game is saved on this device. Use Resume practice on the home screen to return.'
              : 'Your seat stays saved on this browser. Use Resume table to return. An online game waits for disconnected players.'}
          </p>
          <div className="leave-buttons">
            <button className="secondary" onClick={() => setConfirmLeave(false)}>
              Keep playing
            </button>
            <button className="primary" disabled={busy} onClick={() => void leaveHome()}>
              Return home
            </button>
            {view?.hostId === view?.you && view?.stage !== 'finished' && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  void act({ type: 'endGame' });
                  setConfirmLeave(false);
                }}
              >
                End game for everyone
              </button>
            )}
            {session.mode === 'online' &&
              view?.stage !== 'lobby' &&
              view?.stage !== 'finished' &&
              view?.hostId === view?.you && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    void act({ type: 'leave' });
                    setConfirmLeave(false);
                  }}
                >
                  Transfer host to a connected player
                </button>
              )}
          </div>
        </Modal>
      )}
      {!session && !setup && (
        <div className="resume-options">
          {readPractice() && readPractice()!.stage !== 'finished' && (
            <button
              className="resume-pill"
              onClick={() => {
                const s = readPractice()!;
                const p = s.players.find((p) => !p.isBot)!;
                const next: Session = { mode: 'local', gameId: s.id, playerId: p.id, code: s.code };
                localStorage.setItem('naroomopoly-deal.session.v1', JSON.stringify(next));
                version.current = -1;
                setSession(next);
              }}
            >
              Resume practice <ArrowRight size={16} />
            </button>
          )}
          {lastOnline() && (
            <button
              className="resume-pill"
              onClick={() => {
                const s = lastOnline()!;
                localStorage.setItem('naroomopoly-deal.session.v1', JSON.stringify(s));
                version.current = -1;
                setSession(s);
              }}
            >
              Resume online table <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          {toast}
        </div>
      )}
    </div>
  );
}
