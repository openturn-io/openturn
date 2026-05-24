import * as React from "react";
import { motion } from "framer-motion";

import {
  ARTISTS,
  type ArtistID,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
} from "@openturn/example-modern-art-game";

import { PaintingCard } from "./PaintingCard";

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
    <main className="modern-art-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Round {view.round} of 4</p>
          <h1>Modern Art</h1>
        </div>
        <div className="status-strip">
          <span>Hammer: {playerName(view.hammer)}</span>
          <span>{view.phase.replace(/([A-Z])/g, " $1")}</span>
          <span>{me === null ? "Spectator" : `${playerName(me)} · $${view.myMoney ?? 0}`}</span>
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
                  <div className="artist-title">
                    <span className="artist-swatch" style={{ background: artistData.color }} />
                    <strong>{artistData.name}</strong>
                  </div>
                  <div className="value-tiles">
                    {view.valueTiles[artist].map((tile, index) => (
                      <span key={`${artist}-${index}`}>{tile}</span>
                    ))}
                    <em>${artistValue(view, artist)}</em>
                  </div>
                  <div className="offer-count">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <i className={index < view.offeredCounts[artist] ? "lit" : ""} key={index} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="auction-stage">
          <div className="stage-header">
            <div>
              <p className="eyebrow">Current lot</p>
              <h2>{lotCards.length === 0 ? "Awaiting a painting" : lotCards.map((id) => view.cards[id]?.title).join(" + ")}</h2>
            </div>
            <div className={`turn-light ${isActive ? "hot" : ""}`}>
              {isActive ? "Your decision" : view.activePlayers.map(playerName).join(", ") || "Resolving"}
            </div>
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
              lotCards.map((cardID) => <PaintingCard card={view.cards[cardID]!} key={cardID} selected />)
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
                <div className={`player-row ${active ? "active" : ""}`} key={id}>
                  <div>
                    <strong>{playerName(id)}</strong>
                    <span>{player.handCount} in hand · {player.gallery.length} owned</span>
                  </div>
                  <b>{player.money === null ? "$ ?" : `$${player.money}`}</b>
                </div>
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
          {view.myHand.map((cardID) => (
            <PaintingCard
              card={view.cards[cardID]!}
              disabled={!isActive || view.phase !== "selectPainting"}
              key={cardID}
              onClick={() => props.onPlayPainting(cardID)}
            />
          ))}
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
          {doubleOptions.map((cardID) => (
            <PaintingCard
              card={view.cards[cardID]!}
              disabled={disabled}
              key={cardID}
              onClick={() => props.onOfferDouble(cardID)}
            />
          ))}
        </div>
        <button disabled={disabled} onClick={() => props.onOfferDouble(null)} type="button">Pass</button>
      </div>
    );
  }

  if (view.phase === "fixedPriceOffer") {
    return (
      <div className="auction-controls split">
        <button disabled={disabled} onClick={() => props.onRespondFixed(true)} type="button">Buy for ${view.lot?.fixedPrice ?? 0}</button>
        <button disabled={disabled} onClick={() => props.onRespondFixed(false)} type="button">Pass</button>
      </div>
    );
  }

  return (
    <div className="auction-controls">
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
      {view.phase === "openAuction" && (
        <div className="split">
          <button disabled={disabled || amount < minBid} onClick={() => props.onOpenRaise(amount)} type="button">Raise</button>
          <button disabled={disabled} onClick={props.onOpenPass} type="button">Pass</button>
        </div>
      )}
      {view.phase === "oneOfferAuction" && (
        <div className="split">
          <button disabled={disabled || amount < minBid} onClick={() => props.onOneOffer(amount)} type="button">Bid once</button>
          <button disabled={disabled} onClick={() => props.onOneOffer(null)} type="button">Pass</button>
        </div>
      )}
      {view.phase === "hiddenAuction" && (
        <button disabled={disabled} onClick={() => props.onHiddenBid(amount)} type="button">
          Submit sealed bid
        </button>
      )}
      {view.phase === "fixedPriceSet" && (
        <button disabled={disabled} onClick={() => props.onFixedPrice(amount)} type="button">
          Set fixed price
        </button>
      )}
    </div>
  );
}
