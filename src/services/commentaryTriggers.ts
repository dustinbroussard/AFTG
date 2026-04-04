import type { Player } from '../types';

export interface HeckleEligibilityInput {
  commentaryEnabled: boolean;
  isSolo: boolean;
  hasGame: boolean;
  gameStatus: string | null;
  playersCount: number;
  currentPlayerCanAct: boolean;
  hasCurrentPlayer: boolean;
  hasOpponentPlayer: boolean;
}

export function evaluateHeckleEligibility(input: HeckleEligibilityInput) {
  if (!input.commentaryEnabled) {
    return { allowed: false, reason: 'commentary_disabled' } as const;
  }
  if (input.isSolo) {
    return { allowed: false, reason: 'solo_mode' } as const;
  }
  if (!input.hasGame) {
    return { allowed: false, reason: 'missing_game_or_user' } as const;
  }
  if (input.gameStatus !== 'active') {
    return { allowed: false, reason: `game_status_${input.gameStatus}` } as const;
  }
  if (input.playersCount < 2) {
    return { allowed: false, reason: 'not_multiplayer' } as const;
  }
  if (input.currentPlayerCanAct) {
    return { allowed: false, reason: 'current_player_can_act' } as const;
  }
  if (!input.hasCurrentPlayer || !input.hasOpponentPlayer) {
    return { allowed: false, reason: 'missing_player_context' } as const;
  }

  return { allowed: true, reason: 'eligible_waiting_state' } as const;
}

export function getOpponentTrophyGain(previousOpponent: Player | null | undefined, currentOpponent: Player | null | undefined) {
  if (!previousOpponent || !currentOpponent) {
    return null;
  }

  const previousCompleted = new Set(previousOpponent.completedCategories || []);
  return (currentOpponent.completedCategories || []).find((category) => !previousCompleted.has(category)) ?? null;
}
