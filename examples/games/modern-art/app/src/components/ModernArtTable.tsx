import * as React from "react";
import { motion } from "framer-motion";

import {
  ARTISTS,
  type ArtistID,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
} from "@openturn/example-modern-art-game";

import { PaintingCard } from "./PaintingCard";
import { Tip, TipsProvider, useTipsToggle } from "./ui/tip";
import {
  amountInputTip,
  artistLaneTip,
  doubleOptionTip,
  fixedBuyTip,
  fixedPassTip,
  fixedSetTip,
  handPaintingTip,
  hammerTip,
  hiddenBidTip,
  lotHeaderTip,
  lotPaintingTip,
  moneyTip,
  offeredDotsTip,
  offerDoublePassTip,
  oneOfferBidTip,
  oneOfferPassTip,
  passOpenTip,
  phaseTip,
  playerRowTip,
  raiseTip,
  roundTip,
  tipsToggleTip,
} from "../lib/tutorialTips";

interface ModernArtTableProps {
  onFixedPrice: (amount: number) => void;
  onHiddenBid: (amount: number) => void;
  onOfferDouble: (cardID: string | null) => void;
  onOneOffer: (amount: number | null) => void;
  onOpenPass: () => void;
  onOpenRaise: (amount: number) => void;
  onPlayPainting: (cardID: string) => void;
  onRespondFixed: (accept: boolean) => void;
  view: ModernArtPlayerView;
}

const PLAYER_NAMES = ["North", "East", "South", "West", "Center"];

function playerName(id: ModernArtPlayerID): string {
  return PLAYER_NAMES[Number.parseInt(id, 10)] ?? `P${Number.parseInt(id, 10) + 1}`;
}

function artistValue(view: ModernArtPlayerView, artist: ArtistID): number {
  return view.valueTiles[artist].reduce((sum, tile) => sum + tile, 0);
}

export function ModernArtTable(props: ModernArtTableProps) {
  const [tipsEnabled, setTipsEnabled] = useTipsToggle();
  const { view } = props;
  const me = view.myPlayerID;
  const isActive = me !== null && view.activePlayers.includes(me);
  const [amount, setAmount] = React.useState(10);
  const lot = view.lot;
  const currentBid = lot?.highBid?.amount ?? 0;
  const minBid = currentBid + 1;
  const myMoney = view.myMoney ?? 0;

  React.useEffect(() => {
    setAmount(Math.min(Math.max(minBid, 10), Math.max(myMoney, minBid)));
  }, [minBid, myMoney, view.phase]);

  const lotCards = lot?.cards ?? [];
  const firstLotCard = lotCards[0] === undefined ? null : view.cards[lotCards[0]] ?? null;
  const doubleOptions = firstLotCard === null || me === null
    ? []
    : view.myHand.filter((cardID) => {
        const card = view.cards[cardID];
        return card?.artist === firstLotCard.artist && card.type !== "double";
      });

  return (
    <TipsProvider enabled={tipsEnabled}>
      <main className="modern-art-shell">
        <section className="topbar">
          <div>
            <Tip content={roundTip(view)}>
              <p className="eyebrow">Round {view.round} of 4</p>
            </Tip>
            <h1>Modern Art</h1>
          </div>
          <div className="status-strip">
            <Tip content={hammerTip(view)}>
              <span>Hammer: {playerName(view.hammer)}</span>
            </Tip>
            <Tip content={phaseTip(view)}>
              <span>{view.phase.replace(/([A-Z])/g, " $1")}</span>
            </Tip>
            <Tip content={moneyTip(view)}>
              <span>{me === null ? "Spectator" : `${playerName(me)} · $${view.myMoney ?? 0}`}</span>
            </Tip>
            <Tip content={tipsToggleTip(tipsEnabled)}>
              <button
                type="button"
                className={`tips-toggle ${tipsEnabled ? "on" : ""}`}
                onClick={() => setTipsEnabled(!tipsEnabled)}
                aria-pressed={tipsEnabled}
                title={tipsEnabled ? "Tutorial tips on — click to disable" : "Tutorial tips off — click to enable"}
              >
                <span className="dot" aria-hidden />
                Tips: {tipsEnabled ? "on" : "off"}
              </button>
            </Tip>
          </div>
        </section>

        <section className="table-grid">
          <aside className="market-board">
            <h2>Market</h2>
            <div className="artist-lanes">
              {ARTISTS.map((artist) => {
                const artistData = view.artists.find((item) => item.id === artist)!;
                return (
                  <div className="artist-lane" key={artist}>
                    <Tip content={artistLaneTip({ artist, view })}>
                      <div className="artist-title">
                        <span className="artist-swatch" style={{ background: artistData.color }} />
                        <strong>{artistData.name}</strong>
                      </div>
                    </Tip>
                    <Tip content={artistLaneTip({ artist, view })}>
                      <div className="value-tiles">
                        {view.valueTiles[artist].map((tile, index) => (
                          <span key={`${artist}-${index}`}>{tile}</span>
                        ))}
                        <em>${artistValue(view, artist)}</em>
                      </div>
                    </Tip>
                    <Tip content={offeredDotsTip({ artist, view })}>
                      <div className="offer-count">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <i className={index < view.offeredCounts[artist] ? "lit" : ""} key={index} />
                        ))}
                      </div>
                    </Tip>
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="auction-stage">
            <div className="stage-header">
              <Tip content={lotHeaderTip({ view })}>
                <div>
                  <p className="eyebrow">Current lot</p>
                  <h2>{lotCards.length === 0 ? "Awaiting a painting" : lotCards.map((id) => view.cards[id]?.title).join(" + ")}</h2>
                </div>
              </Tip>
              <Tip content={phaseTip(view)}>
                <div className={`turn-light ${isActive ? "hot" : ""}`}>
                  {isActive ? "Your decision" : view.activePlayers.map(playerName).join(", ") || "Resolving"}
                </div>
              </Tip>
            </div>

            <motion.div
              className="lot-cards"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28 }}
              key={lotCards.join(":") || "empty"}
            >
              {lotCards.length === 0 ? (
                <div className="empty-lot">The next curator chooses from hand.</div>
              ) : (
                lotCards.map((cardID) => {
                  const card = view.cards[cardID]!;
                  return (
                    <PaintingCard
                      card={card}
                      key={cardID}
                      selected
                      tip={lotPaintingTip({ card, view })}
                    />
                  );
                })
              )}
            </motion.div>

            <Controls
              amount={amount}
              doubleOptions={doubleOptions}
              isActive={isActive}
              minBid={minBid}
              myMoney={myMoney}
              onAmount={setAmount}
              {...props}
            />
          </section>

          <aside className="players-panel">
            <h2>Collectors</h2>
            <div className="player-list">
              {view.seatOrder.map((id) => {
                const player = view.players[id];
                const active = view.activePlayers.includes(id);
                return (
                  <Tip content={playerRowTip({ view, playerID: id })} key={id}>
                    <div className={`player-row ${active ? "active" : ""}`}>
                      <div>
                        <strong>{playerName(id)}</strong>
                        <span>{player.handCount} in hand · {player.gallery.length} owned</span>
                      </div>
                      <b>{player.money === null ? "$ ?" : `$${player.money}`}</b>
                    </div>
                  </Tip>
                );
              })}
            </div>
            {view.lastAction !== null && <p className="last-action">{view.lastAction.detail}</p>}
          </aside>
        </section>

        <section className="hand-rail">
          <div className="hand-title">
            <h2>Hand</h2>
            <span>{view.myHand.length} cards</span>
          </div>
          <div className="hand-scroll">
            {view.myHand.map((cardID) => {
              const card = view.cards[cardID]!;
              const canPlay = isActive && view.phase === "selectPainting";
              return (
                <PaintingCard
                  card={card}
                  disabled={!canPlay}
                  key={cardID}
                  onClick={() => props.onPlayPainting(cardID)}
                  tip={handPaintingTip({ card, view, canPlay })}
                />
              );
            })}
          </div>
        </section>

        {view.revealedMoney !== null && (
          <section className="final-reveal">
            <h2>{view.winners.includes(me as ModernArtPlayerID) ? "You won" : `${playerName(view.winners[0]!)} won`}</h2>
            <div>
              {view.seatOrder.map((id) => (
                <span key={id}>{playerName(id)} ${view.revealedMoney?.[id] ?? 0}</span>
              ))}
            </div>
          </section>
        )}

      </main>
    </TipsProvider>
  );
}

interface ControlsProps extends ModernArtTableProps {
  amount: number;
  doubleOptions: readonly string[];
  isActive: boolean;
  minBid: number;
  myMoney: number;
  onAmount: (amount: number) => void;
}

function Controls(props: ControlsProps) {
  const { amount, doubleOptions, isActive, minBid, myMoney, onAmount, view } = props;
  const disabled = !isActive;
  const clampAmount = (value: number) => onAmount(Math.min(myMoney, Math.max(0, value)));

  if (view.phase === "selectPainting") {
    return <div className="auction-controls passive">Choose a painting from your hand.</div>;
  }

  if (view.phase === "doubleOffer") {
    return (
      <div className="auction-controls">
        <div className="double-options">
          {doubleOptions.map((cardID) => {
            const card = view.cards[cardID]!;
            return (
              <PaintingCard
                card={card}
                disabled={disabled}
                key={cardID}
                onClick={() => props.onOfferDouble(cardID)}
                tip={doubleOptionTip({ card, view })}
              />
            );
          })}
        </div>
        <Tip content={offerDoublePassTip(view)}>
          <button disabled={disabled} onClick={() => props.onOfferDouble(null)} type="button">Pass</button>
        </Tip>
      </div>
    );
  }

  if (view.phase === "fixedPriceOffer") {
    return (
      <div className="auction-controls split">
        <Tip content={fixedBuyTip(view)}>
          <button disabled={disabled} onClick={() => props.onRespondFixed(true)} type="button">Buy for ${view.lot?.fixedPrice ?? 0}</button>
        </Tip>
        <Tip content={fixedPassTip(view)}>
          <button disabled={disabled} onClick={() => props.onRespondFixed(false)} type="button">Pass</button>
        </Tip>
      </div>
    );
  }

  return (
    <div className="auction-controls">
      <Tip content={amountInputTip({ view, amount, minBid, myMoney })}>
        <div className="money-input">
          <button disabled={disabled} onClick={() => clampAmount(amount - 5)} type="button">-5</button>
          <input
            disabled={disabled}
            min={view.phase === "fixedPriceSet" || view.phase === "hiddenAuction" ? 0 : minBid}
            max={myMoney}
            onChange={(event) => clampAmount(Number(event.target.value))}
            type="number"
            value={amount}
          />
          <button disabled={disabled} onClick={() => clampAmount(amount + 5)} type="button">+5</button>
        </div>
      </Tip>
      {view.phase === "openAuction" && (
        <div className="split">
          <Tip content={raiseTip({ view, amount, minBid, myMoney, disabled: disabled || amount < minBid })}>
            <button disabled={disabled || amount < minBid} onClick={() => props.onOpenRaise(amount)} type="button">Raise</button>
          </Tip>
          <Tip content={passOpenTip(view)}>
            <button disabled={disabled} onClick={props.onOpenPass} type="button">Pass</button>
          </Tip>
        </div>
      )}
      {view.phase === "oneOfferAuction" && (
        <div className="split">
          <Tip content={oneOfferBidTip({ view, amount, minBid, myMoney, disabled: disabled || amount < minBid })}>
            <button disabled={disabled || amount < minBid} onClick={() => props.onOneOffer(amount)} type="button">Bid once</button>
          </Tip>
          <Tip content={oneOfferPassTip(view)}>
            <button disabled={disabled} onClick={() => props.onOneOffer(null)} type="button">Pass</button>
          </Tip>
        </div>
      )}
      {view.phase === "hiddenAuction" && (
        <Tip content={hiddenBidTip({ view, amount, minBid, myMoney, disabled })}>
          <button disabled={disabled} onClick={() => props.onHiddenBid(amount)} type="button">
            Submit sealed bid
          </button>
        </Tip>
      )}
      {view.phase === "fixedPriceSet" && (
        <Tip content={fixedSetTip({ view, amount, minBid, myMoney, disabled })}>
          <button disabled={disabled} onClick={() => props.onFixedPrice(amount)} type="button">
            Set fixed price
          </button>
        </Tip>
      )}
    </div>
  );
}
