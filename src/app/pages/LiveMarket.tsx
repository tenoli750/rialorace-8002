import { useLocation, useParams, useSearchParams } from "react-router";
import { useState, useEffect, useRef } from "react";
import { getMarketById } from "../data/markets";
import { getTokenByLetter } from "../data/tokens";
import { useAuth } from "../contexts/AuthContext";
import {
  BetRow,
  ChatMessageRow,
  createBetRecord,
  createChatMessage,
  getOrCreateMarketRatioSnapshot,
  listBetsWithSession,
  listChatMessages,
  listCurrentRaceBets,
  supabase
} from "../lib/supabase";

type RaceState = "waiting" | "racing" | "finished";
type BetHistoryTab = "now" | "next" | "past" | "chat";
const RACE_INTERVAL_MS = 5 * 60 * 1000;

function getLegacyMarketUrl(marketId: string) {
  if (marketId === "market-01") {
    return "/legacy-race/market01-betting.html?id=market-01&embed=viewport";
  }
  if (marketId === "market-02") {
    return "/legacy-race/market02-betting.html?id=market-02&embed=viewport";
  }
  return `/legacy-race/market.html?id=${marketId}&embed=viewport`;
}

export function LiveMarket() {
  const { marketId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const fallbackMarketId = location.pathname.includes("market02") ? "market-02" : "market-01";
  const selectedMarketId = marketId ?? searchParams.get("id") ?? fallbackMarketId;
  const market = getMarketById(selectedMarketId);
  const { user, points, setPointsBalance, refreshSession } = useAuth();

  const [raceState, setRaceState] = useState<RaceState>("waiting");
  const [activeTab, setActiveTab] = useState<BetHistoryTab>("now");
  const [firstPick, setFirstPick] = useState<string | null>(null);
  const [secondPick, setSecondPick] = useState<string | null>(null);
  const [thirdPick, setThirdPick] = useState<string | null>(null);
  const [stake, setStake] = useState(100);
  const [standings, setStandings] = useState<string[]>([]);
  const [historyBets, setHistoryBets] = useState<BetRow[]>([]);
  const [historyStatus, setHistoryStatus] = useState("No bets");
  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStatus, setChatStatus] = useState("");
  const [betSlipStatus, setBetSlipStatus] = useState("");
  const [ratios, setRatios] = useState<Record<string, Record<string, number>>>({});
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const [consoleHeight, setConsoleHeight] = useState<number | null>(null);

  const tokens = market?.tokenLetters.map(letter => getTokenByLetter(letter)).filter(Boolean) || [];
  const nextRaceStartedAt = new Date(getNextRaceBoundary(Date.now())).toISOString();

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateConsoleHeight = () => {
      const nextHeight = Math.round(viewport.getBoundingClientRect().height);
      if (nextHeight > 0) {
        setConsoleHeight(nextHeight);
      }
    };

    updateConsoleHeight();
    const resizeObserver = new ResizeObserver(updateConsoleHeight);
    resizeObserver.observe(viewport);
    window.addEventListener("resize", updateConsoleHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateConsoleHeight);
    };
  }, [market?.id]);

  useEffect(() => {
    // Simulate race cycle
    const interval = setInterval(() => {
      setRaceState(prev => {
        if (prev === "waiting") {
          // Start race and set random standings
          const shuffled = [...(market?.tokenLetters || [])].sort(() => Math.random() - 0.5);
          setStandings(shuffled);
          return "racing";
        }
        if (prev === "racing") return "finished";
        // After finished, wait before restarting
        setTimeout(() => setRaceState("waiting"), 2000);
        return "finished";
      });
    }, 8000);

    return () => clearInterval(interval);
  }, [market]);

  useEffect(() => {
    if (!market) return;
    let cancelled = false;

    getOrCreateMarketRatioSnapshot(market.id, nextRaceStartedAt, tokens.map((token) => token!.symbol))
      .then((row) => {
        if (!cancelled) setRatios(row?.ratio_snapshot ?? {});
      })
      .catch(() => {
        if (!cancelled) setRatios({});
      });

    return () => {
      cancelled = true;
    };
  }, [market, nextRaceStartedAt]);

  useEffect(() => {
    if (!market || activeTab === "chat") return;
    let cancelled = false;

    async function loadBets() {
      if (!user) {
        setHistoryBets([]);
        setHistoryStatus("Login to view bets");
        return;
      }

      try {
        const rows =
          activeTab === "past"
            ? (await listBetsWithSession()).filter((bet) => bet.market_id === market.id)
            : await listCurrentRaceBets(
                market.id,
                activeTab === "next"
                  ? new Date(getNextRaceBoundary(Date.now())).toISOString()
                  : new Date(getCurrentRaceBoundary(Date.now())).toISOString()
              );
        if (cancelled) return;
        setHistoryBets(rows);
        setHistoryStatus(rows.length ? "" : "No bets");
      } catch (error) {
        if (!cancelled) {
          setHistoryBets([]);
          setHistoryStatus(error instanceof Error ? error.message : "Could not load bets.");
        }
      }
    }

    void loadBets();
    return () => {
      cancelled = true;
    };
  }, [activeTab, market, user]);

  useEffect(() => {
    if (!market || activeTab !== "chat") return;
    let cancelled = false;

    listChatMessages(market.id)
      .then((messages) => {
        if (!cancelled) setChatMessages(messages);
      })
      .catch(() => {
        if (!cancelled) setChatStatus("Chat could not be loaded.");
      });

    const channel = supabase
      .channel(`market-chat-8002:${market.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "market_chat_messages",
          filter: `market_id=eq.${market.id}`
        },
        (payload) => {
          setChatMessages((messages) => [...messages, payload.new as ChatMessageRow].slice(-50));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [activeTab, market]);

  useEffect(() => {
    if (activeTab !== "chat") return;
    const chatList = chatListRef.current;
    if (!chatList) return;

    requestAnimationFrame(() => {
      chatList.scrollTop = chatList.scrollHeight;
    });
  }, [activeTab, chatMessages.length]);

  const handlePlaceBet = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedPicks = [firstPick, secondPick, thirdPick];
    setBetSlipStatus("");
    if (!user) {
      setBetSlipStatus("Login to place bets.");
      return;
    }
    if (!selectedPicks.some(Boolean)) {
      setBetSlipStatus("Select at least one position.");
      return;
    }
    if (stake > points) {
      setBetSlipStatus("Insufficient points.");
      return;
    }
    try {
      const row = await createBetRecord({
        marketId: market.id,
        targetRaceStartedAt: nextRaceStartedAt,
        stake,
        placements: {
          first: tokenSymbolFromLetter(firstPick),
          second: tokenSymbolFromLetter(secondPick),
          third: tokenSymbolFromLetter(thirdPick)
        },
        ratios
      });
      if (Number.isFinite(Number(row?.points_balance))) {
        setPointsBalance(Number(row.points_balance));
      } else {
        await refreshSession();
      }
      const nextRows = await listCurrentRaceBets(market.id, nextRaceStartedAt);
      setHistoryBets(nextRows);
      setHistoryStatus(nextRows.length ? "" : "No bets");
      setActiveTab("next");
      setBetSlipStatus("Bet saved.");
    } catch (error) {
      setBetSlipStatus(error instanceof Error ? error.message : "Bet save failed.");
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = chatInput.trim();
    if (!message || !market) return;

    try {
      const row = await createChatMessage(market.id, message);
      if (row) {
        setChatMessages((messages) => [...messages, row].slice(-50));
      }
      setChatInput("");
      setChatStatus("");
    } catch (error) {
      setChatStatus(error instanceof Error ? error.message : "Message could not be sent.");
    }
  };

  if (!market) {
    return <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">Market not found</div>;
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      {/* Main Grid - Live Viewport + Sidebar */}
      <div className="grid grid-cols-1 items-start gap-6 mb-6 lg:grid-cols-4">
        {/* Live Race Viewport */}
        <section className="lg:col-span-3 bg-white rounded-lg border border-[#fed7aa] overflow-hidden">
          <div ref={viewportRef} className="aspect-video bg-[#ffedd5] relative">
            <iframe
              title={`${market.name} live Three.js race`}
              src={getLegacyMarketUrl(market.id)}
              className="absolute inset-0 w-full h-full border-0"
            />
          </div>
        </section>

        {/* Track Console Sidebar */}
        <aside
          className="flex h-[520px] min-h-0 flex-col overflow-hidden rounded-lg border border-[#fed7aa] bg-white"
          style={consoleHeight ? { height: `${consoleHeight}px` } : undefined}
        >
          <div className="shrink-0 p-4 border-b border-[#fed7aa]">
            <h2 className="text-sm text-[#9a3412]">Track Console</h2>
          </div>

          {/* Tabs */}
          <div className="flex shrink-0 border-b border-[#fed7aa]">
            {(["now", "next", "past", "chat"] as BetHistoryTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-3 py-2 text-xs capitalize transition-colors ${
                  activeTab === tab
                    ? "bg-[#9a3412] text-white"
                    : "text-[#8a5a44] hover:bg-[#fff7ed]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-hidden p-4">
            {activeTab === "chat" ? (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <div ref={chatListRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
                  {chatMessages.length ? chatMessages.map((entry) => (
                    <div className="text-xs" key={entry.id}>
                      <div className="text-[#8a5a44] mb-1">{entry.author_login_id} · {formatChatTime(entry.created_at)}</div>
                      <div className="text-[#9a3412]">{entry.message}</div>
                    </div>
                  )) : (
                    <div className="text-xs text-[#8a5a44]">No chat yet</div>
                  )}
                </div>
                <form onSubmit={handleSendChat} className="flex shrink-0 gap-2">
                  <input
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    maxLength={160}
                    placeholder={user ? "Write a message" : "Login to chat"}
                    disabled={!user}
                    className="min-w-0 flex-1 rounded border border-[#fed7aa] bg-[#fff7ed] px-2 py-2 text-xs text-[#9a3412] outline-none focus:border-[#9a3412]"
                  />
                  <button
                    type="submit"
                    disabled={!user || !chatInput.trim()}
                    className="rounded bg-[#9a3412] px-3 py-2 text-xs text-white disabled:opacity-50"
                  >
                    Send
                  </button>
                </form>
                {chatStatus && <div className="shrink-0 text-xs text-[#c62828]">{chatStatus}</div>}
              </div>
            ) : (
              <div className="h-full min-h-0 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {historyStatus ? (
                  <div className="text-xs text-[#8a5a44]">{historyStatus}</div>
                ) : historyBets.map((bet) => (
                  <div className="p-2 bg-[#fff7ed] rounded border border-[#fed7aa] text-xs" key={bet.bet_id}>
                    <div className="text-[#8a5a44] mb-1">{formatKstDate(bet.target_race_started_at)}</div>
                    <div className="text-[#9a3412]">{formatBetPicks(bet)}</div>
                    <div className="text-[#8a5a44] mt-1">Stake: {formatStakeWithPayout(bet)}</div>
                    <div className={`mt-1 ${getBetStatusClass(bet.status)}`}>
                      Status: {String(bet.status ?? "placed").toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Bet Slip */}
      <section className="bg-white rounded-lg border border-[#fed7aa] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <span className="text-xs text-[#8a5a44] uppercase tracking-wide">
              BET SLIP ({formatKstTime(nextRaceStartedAt)})
            </span>
            <h2 className="text-lg text-[#9a3412] mt-1">Choose first, second, third</h2>
          </div>
          <span className="px-3 py-1 bg-[#ffedd5] text-xs text-[#9a3412] rounded-md">
            {[firstPick, secondPick, thirdPick].filter(Boolean).length}/3 picks
          </span>
        </div>

        <form onSubmit={handlePlaceBet}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            {/* First Place */}
            <div>
              <div className="text-sm text-[#9a3412] mb-2">First Place</div>
              <div className="grid grid-cols-2 gap-2">
                {tokens.map((token) => (
                  <button
                    key={token!.id}
                    type="button"
                    onClick={() => setFirstPick((current) => current === token!.letter ? null : token!.letter)}
                    className={`p-2 rounded border text-sm transition-all ${
                      firstPick === token!.letter
                        ? "bg-[#9a3412] text-white border-[#9a3412]"
                        : "bg-[#fff7ed] text-[#9a3412] border-[#fed7aa] hover:border-[#9a3412]"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <img src={token!.image} alt="" className="w-6 h-6 rounded-full object-contain bg-white" />
                        <span className="truncate">{token!.symbol}</span>
                      </span>
                      <span className={firstPick === token!.letter ? "shrink-0 text-xs text-white/80" : "shrink-0 text-xs text-[#8a5a44]"}>
                        {formatRatio(getTokenRatio(ratios, "first", token!.symbol))}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Second Place */}
            <div>
              <div className="text-sm text-[#9a3412] mb-2">Second Place</div>
              <div className="grid grid-cols-2 gap-2">
                {tokens.map((token) => (
                  <button
                    key={token!.id}
                    type="button"
                    onClick={() => setSecondPick((current) => current === token!.letter ? null : token!.letter)}
                    className={`p-2 rounded border text-sm transition-all ${
                      secondPick === token!.letter
                        ? "bg-[#9a3412] text-white border-[#9a3412]"
                        : "bg-[#fff7ed] text-[#9a3412] border-[#fed7aa] hover:border-[#9a3412]"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <img src={token!.image} alt="" className="w-6 h-6 rounded-full object-contain bg-white" />
                        <span className="truncate">{token!.symbol}</span>
                      </span>
                      <span className={secondPick === token!.letter ? "shrink-0 text-xs text-white/80" : "shrink-0 text-xs text-[#8a5a44]"}>
                        {formatRatio(getTokenRatio(ratios, "second", token!.symbol))}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Third Place */}
            <div>
              <div className="text-sm text-[#9a3412] mb-2">Third Place</div>
              <div className="grid grid-cols-2 gap-2">
                {tokens.map((token) => (
                  <button
                    key={token!.id}
                    type="button"
                    onClick={() => setThirdPick((current) => current === token!.letter ? null : token!.letter)}
                    className={`p-2 rounded border text-sm transition-all ${
                      thirdPick === token!.letter
                        ? "bg-[#9a3412] text-white border-[#9a3412]"
                        : "bg-[#fff7ed] text-[#9a3412] border-[#fed7aa] hover:border-[#9a3412]"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <img src={token!.image} alt="" className="w-6 h-6 rounded-full object-contain bg-white" />
                        <span className="truncate">{token!.symbol}</span>
                      </span>
                      <span className={thirdPick === token!.letter ? "shrink-0 text-xs text-white/80" : "shrink-0 text-xs text-[#8a5a44]"}>
                        {formatRatio(getTokenRatio(ratios, "third", token!.symbol))}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm text-[#9a3412] block mb-2">Stake Points</label>
              <input
                type="number"
                min="10"
                step="10"
                value={stake}
                onChange={(e) => setStake(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#fff7ed] border border-[#fed7aa] rounded text-[#9a3412] focus:outline-none focus:border-[#9a3412]"
              />
            </div>

            <button
              type="submit"
              className="px-6 py-2 bg-[#9a3412] text-white rounded hover:bg-[#c2410c] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={![firstPick, secondPick, thirdPick].some(Boolean)}
            >
              Place Bet
            </button>
          </div>

          {([firstPick, secondPick, thirdPick].some(Boolean) || betSlipStatus) && (
            <div className="mt-4 p-3 bg-[#ffedd5] rounded text-sm text-[#9a3412]">
              {[firstPick, secondPick, thirdPick].some(Boolean)
                ? `${getBetTypeLabel([firstPick, secondPick, thirdPick])} bet. Potential win ${getPotentialWin(stake, ratios, firstPick, secondPick, thirdPick).toLocaleString()} pts.`
                : "Select a pick to see potential win."}
              {betSlipStatus && <span className="ml-2 font-semibold">{betSlipStatus}</span>}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}

function getCurrentRaceBoundary(timestampMs: number) {
  return Math.floor(timestampMs / RACE_INTERVAL_MS) * RACE_INTERVAL_MS;
}

function getNextRaceBoundary(timestampMs: number) {
  return Math.ceil(timestampMs / RACE_INTERVAL_MS) * RACE_INTERVAL_MS;
}

function tokenSymbolFromLetter(letter: string | null) {
  return letter ? getTokenByLetter(letter)?.symbol ?? null : null;
}

function formatBetPicks(row: BetRow) {
  return [
    row.first_pick ? `1st: ${row.first_pick}` : null,
    row.second_pick ? `2nd: ${row.second_pick}` : null,
    row.third_pick ? `3rd: ${row.third_pick}` : null
  ].filter(Boolean).join(", ") || "-";
}

function formatStakeWithPayout(row: BetRow) {
  const stake = Number(row.stake_points ?? 0);
  const payout = String(row.status ?? "").toLowerCase() === "won" ? Number(row.payout_points ?? 0) : 0;
  return `${stake.toLocaleString()} pts (${payout.toLocaleString()} pts)`;
}

function getBetStatusClass(status: string | null | undefined) {
  const normalizedStatus = String(status ?? "").toLowerCase();
  if (normalizedStatus === "won") return "text-[#15803d]";
  if (normalizedStatus === "lost") return "text-[#c62828]";
  return "text-[#9a3412]";
}

function formatKstDate(timestamp: string | null) {
  if (!timestamp) return "-";
  return `${new Intl.DateTimeFormat("en-GB", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul"
  }).format(new Date(timestamp))} KST`;
}

function formatKstTime(timestamp: string | null) {
  if (!timestamp) return "-";
  return `${new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul"
  }).format(new Date(timestamp))} KST`;
}

function formatChatTime(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function getBetTypeLabel(picks: Array<string | null>) {
  const count = picks.filter(Boolean).length;
  if (count >= 3) return "Triple";
  if (count === 2) return "Double";
  return "Single";
}

function getPotentialWin(
  stake: number,
  ratios: Record<string, Record<string, number>>,
  firstPick: string | null,
  secondPick: string | null,
  thirdPick: string | null
) {
  const first = tokenSymbolFromLetter(firstPick);
  const second = tokenSymbolFromLetter(secondPick);
  const third = tokenSymbolFromLetter(thirdPick);
  const multiplier =
    (first ? Number(ratios.first?.[first] ?? 1) : 1) *
    (second ? Number(ratios.second?.[second] ?? 1) : 1) *
    (third ? Number(ratios.third?.[third] ?? 1) : 1);
  return Math.round(Number(stake || 0) * multiplier);
}

function getTokenRatio(ratios: Record<string, Record<string, number>>, place: string, symbol: string) {
  return Number(ratios?.[place]?.[symbol] ?? 1);
}

function formatRatio(value: number) {
  return `${Number(value || 1).toFixed(2)}x`;
}
