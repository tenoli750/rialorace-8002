import { Link } from "react-router";
import { useMemo, useState } from "react";
import { tokens } from "../data/tokens";
import { markets } from "../data/markets";
import { getTokenByLetter } from "../data/tokens";

export function ReplayMenu() {
  const [selectedRacers, setSelectedRacers] = useState<string[]>([]);
  const selectedRacerSet = useMemo(() => new Set(selectedRacers), [selectedRacers]);
  const visibleMarkets = useMemo(() => {
    if (!selectedRacers.length) return markets;
    return markets.filter((market) => selectedRacers.every((letter) => market.tokenLetters.includes(letter)));
  }, [selectedRacers]);

  const toggleRacer = (letter: string) => {
    setSelectedRacers((current) =>
      current.includes(letter) ? current.filter((value) => value !== letter) : [...current, letter]
    );
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      {/* Token Legend */}
      <section className="bg-white rounded-lg border border-[#fed7aa] p-6 mb-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg text-[#9a3412]">Racers</h2>
          {selectedRacers.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedRacers([])}
              className="rounded-md border border-[#fed7aa] bg-[#fff7ed] px-3 py-1.5 text-xs font-semibold text-[#9a3412] transition-colors hover:border-[#9a3412] hover:bg-[#ffedd5]"
            >
              Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {tokens.map((token) => (
            <button
              type="button"
              key={token.id}
              onClick={() => toggleRacer(token.letter)}
              aria-pressed={selectedRacerSet.has(token.letter)}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[#9a3412] hover:shadow-sm ${
                selectedRacerSet.has(token.letter)
                  ? "border-[#9a3412] bg-[#9a3412] text-white shadow-sm"
                  : "border-[#fed7aa] bg-[#fff7ed]"
              }`}
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white border border-[#fed7aa] flex items-center justify-center overflow-hidden">
                <img src={token.image} alt={`${token.symbol} animal`} className="w-full h-full object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className={selectedRacerSet.has(token.letter) ? "text-sm text-white truncate" : "text-sm text-[#9a3412] truncate"}>
                  {token.symbol}
                </div>
                <div className={selectedRacerSet.has(token.letter) ? "text-xs text-white/75 truncate" : "text-xs text-[#8a5a44] truncate"}>
                  {token.name}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Market Grid */}
      <section className="bg-white rounded-lg border border-[#fed7aa] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg text-[#9a3412]">Tracks</h2>
          </div>
          <span className="px-3 py-1 bg-[#ffedd5] text-xs text-[#9a3412] rounded-md">
            {visibleMarkets.length} Tracks
          </span>
        </div>

        <div id="marketGrid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {visibleMarkets.map((market) => (
            <Link
              key={market.id}
              to={`/market-replay.html?id=${market.id}`}
              className="grid min-h-[199px] content-start gap-3 rounded-lg border border-[#fdba74] bg-[#fff7ed] p-4 text-left no-underline transition-all hover:-translate-y-0.5 hover:border-[#9a3412] hover:shadow-sm"
            >
              <span className="text-base font-semibold text-[#9a3412]">{market.name}</span>
              <div className="grid grid-cols-2 gap-3">
                {market.tokenLetters.map((letter) => {
                  const token = getTokenByLetter(letter);
                  return (
                    <span
                      key={letter}
                      className="flex min-h-11 items-center gap-2 rounded-md border border-[#fed7aa] bg-white px-3 py-2 text-sm font-semibold text-[#9a3412]"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#fed7aa] bg-white">
                        <img src={token?.image} alt={`${token?.symbol} animal`} className="h-full w-full object-contain" />
                      </span>
                      <span>{token?.symbol}</span>
                    </span>
                  );
                })}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
