export type PlayerType = 'human' | 'ai';

export interface Player {
  id: string;
  name: string;
  avatar: string; // URL or emoji
  type: PlayerType;
  color: string;
  isHost?: boolean;
}

export interface GameRound {
  id: string;
  describerId: string;
  targetId: string;
  description: string;
  artistId: string;
  drawingUrl: string; // Data URL for canvas or AI image
  artistGuessId?: string; // The ID of the player the artist guessed
}

export type GamePhase = 'HOME' | 'LOBBY' | 'DESCRIBE' | 'GUESS_DRAW' | 'REVEAL';

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Player[];
  rounds: GameRound[];
  currentRoundIndex: number; // For reveal phase
}

// Events for BroadcastChannel
export type GameEvent = 
  | { type: 'JOIN_REQUEST'; payload: Player; roomCode: string }
  | { type: 'GAME_UPDATE'; payload: GameState; roomCode: string }
  | { type: 'SUBMIT_DESCRIPTION'; payload: { playerId: string; text: string }; roomCode: string }
  | { type: 'SUBMIT_DRAWING'; payload: { playerId: string; drawingUrl: string; guessId: string }; roomCode: string }
  | { type: 'START_GAME'; roomCode: string }
  | { type: 'RESET_GAME'; roomCode: string };
