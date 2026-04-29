import { definePlugin } from "@openturn/plugins";

export const CHAT_PLUGIN_ID = "chat" as const;

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_DISPLAY_NAME_LENGTH = 40;
export const MAX_HISTORY = 200;

export interface ChatMessage {
  authorPlayerID: string;
  authorDisplayName: string;
  text: string;
}

export interface ChatSlice {
  messages: readonly ChatMessage[];
}

export interface ChatSendArgs {
  text: string;
  displayName: string;
}

/**
 * Server-authoritative chat plugin. State lives at `G.plugins.chat` once
 * composed via `withPlugins(baseDef, [chatPlugin])`. The `send` move is
 * dispatchable by every seated player regardless of whose turn it is — the
 * plugin runtime expands `activePlayers` and adds a per-base-move
 * `canPlayer = currentPlayer` shim so the host game's turn semantics still
 * hold for its own moves.
 */
export const chatPlugin = definePlugin({
  id: CHAT_PLUGIN_ID,
  setup: (): ChatSlice => ({ messages: [] }),
  moves: {
    send: {
      run({ G, args, player }) {
        const text = typeof args.text === "string" ? args.text.trim() : "";
        if (text.length === 0) {
          return { kind: "invalid", reason: "empty_message" };
        }

        const cappedText = text.slice(0, MAX_MESSAGE_LENGTH);
        const displayName = (typeof args.displayName === "string" ? args.displayName : "")
          .slice(0, MAX_DISPLAY_NAME_LENGTH)
          .trim();

        const next: ChatMessage = {
          authorPlayerID: player.id,
          authorDisplayName: displayName.length > 0 ? displayName : `Player ${player.id}`,
          text: cappedText,
        };

        const trimmedHistory = G.messages.length >= MAX_HISTORY
          ? G.messages.slice(G.messages.length - (MAX_HISTORY - 1))
          : G.messages;

        return {
          kind: "stay",
          patch: { messages: [...trimmedHistory, next] },
        };
      },
    } satisfies import("@openturn/plugins").PluginMoveDefinition<ChatSlice, ChatSendArgs>,
  },
});

export type ChatPluginEvent = "chat__send";
