import React, { useState, useEffect, useRef } from 'react';
import { Player, GameRound, GameState, GamePhase, GameEvent } from './types';
import { Button } from './components/Button';
import { DrawingCanvas } from './components/DrawingCanvas';
import { generateAiDescription, generateAiDrawing, generateAiGuess } from './services/geminiService';
import { COLORS, AVATARS, AI_NAMES } from './constants';

// --- UTILS ---
const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();
const generateId = () => Math.random().toString(36).substring(2, 9);

const App: React.FC = () => {
  // Local User State
  const [playerName, setPlayerName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [lobbyCodeInput, setLobbyCodeInput] = useState('');
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  
  // Game State (Synced)
  const [gameState, setGameState] = useState<GameState>({
    roomCode: '',
    phase: 'HOME',
    players: [],
    rounds: [],
    currentRoundIndex: 0,
  });

  // Action Inputs
  const [descriptionInput, setDescriptionInput] = useState('');
  const [guessInput, setGuessInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Networking
  const channelRef = useRef<BroadcastChannel | null>(null);

  // --- NETWORKING LOGIC ---
  useEffect(() => {
    // Join the universal channel
    const channel = new BroadcastChannel('sketch_identify_game');
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const data = event.data as GameEvent;
      
      // Filter by room code if we are in a room
      if (gameState.roomCode && data.roomCode !== gameState.roomCode) return;

      // CLIENT LOGIC: Receive Game Updates
      if (data.type === 'GAME_UPDATE') {
        setGameState(data.payload);
        // Reset loading states when phase changes
        setIsLoading(false); 
      }

      // HOST LOGIC: Receive Actions
      if (isHost) {
        handleHostEvents(data);
      }
    };

    return () => {
      channel.close();
    };
  }, [gameState.roomCode, isHost, gameState.players, gameState.rounds]);

  // --- HOST ONLY HANDLERS ---
  const handleHostEvents = async (event: GameEvent) => {
    if (!isHost) return;

    if (event.type === 'JOIN_REQUEST') {
       // Check if player already exists
       if (gameState.players.some(p => p.id === event.payload.id)) return;
       
       const newPlayers = [...gameState.players, event.payload];
       const newState = { ...gameState, players: newPlayers };
       setGameState(newState);
       broadcastState(newState);
    }
    
    if (event.type === 'SUBMIT_DESCRIPTION') {
       const { playerId, text } = event.payload;
       // Find the round where this player is the describer
       const roundIndex = gameState.rounds.findIndex(r => r.describerId === playerId);
       if (roundIndex === -1) return;

       const newRounds = [...gameState.rounds];
       newRounds[roundIndex].description = text;

       const newState = { ...gameState, rounds: newRounds };
       setGameState(newState);
       broadcastState(newState);

       // Check if all human descriptions are in
       const allHumansDone = newState.rounds
         .filter(r => {
             const p = newState.players.find(pl => pl.id === r.describerId);
             return p?.type === 'human';
         })
         .every(r => r.description);

       if (allHumansDone) {
          await processPhaseGuessDraw(newState);
       }
    }

    if (event.type === 'SUBMIT_DRAWING') {
        const { playerId, drawingUrl, guessId } = event.payload;
        // Find round where this player is artist
        const roundIndex = gameState.rounds.findIndex(r => r.artistId === playerId);
        if (roundIndex === -1) return;

        const newRounds = [...gameState.rounds];
        newRounds[roundIndex].drawingUrl = drawingUrl;
        newRounds[roundIndex].artistGuessId = guessId;

        const newState = { ...gameState, rounds: newRounds };
        setGameState(newState);
        broadcastState(newState);

        // Check if all human drawings are done
        const allHumansDone = newState.rounds
          .filter(r => {
              const p = newState.players.find(pl => pl.id === r.artistId);
              return p?.type === 'human';
          })
          .every(r => r.drawingUrl);

        if (allHumansDone) {
            await processPhaseReveal(newState);
        }
    }
  };

  const broadcastState = (state: GameState) => {
    channelRef.current?.postMessage({
      type: 'GAME_UPDATE',
      payload: state,
      roomCode: state.roomCode
    });
  };

  // --- ACTIONS ---

  const createLobby = () => {
    if (!playerName.trim()) return;
    const roomCode = generateRoomCode();
    const hostPlayer: Player = {
      id: generateId(),
      name: playerName,
      avatar: selectedAvatar,
      type: 'human',
      color: COLORS[0],
      isHost: true
    };
    
    setMyPlayerId(hostPlayer.id);
    setIsHost(true);
    
    const newState: GameState = {
        roomCode,
        phase: 'LOBBY',
        players: [hostPlayer],
        rounds: [],
        currentRoundIndex: 0
    };
    
    setGameState(newState);
    // Broadcast isn't needed yet as no one is listening, but good practice
    broadcastState(newState);
  };

  const joinLobby = () => {
    if (!playerName.trim() || !lobbyCodeInput.trim()) return;
    const pid = generateId();
    setMyPlayerId(pid);
    setIsHost(false);
    
    // Optimistic set code to listen
    setGameState(prev => ({ ...prev, roomCode: lobbyCodeInput.toUpperCase(), phase: 'LOBBY' })); // Temporary phase until update

    // Send Join Request
    channelRef.current?.postMessage({
        type: 'JOIN_REQUEST',
        payload: {
            id: pid,
            name: playerName,
            avatar: selectedAvatar,
            type: 'human',
            color: COLORS[Math.floor(Math.random() * COLORS.length)]
        },
        roomCode: lobbyCodeInput.toUpperCase()
    });
  };

  const addAiPlayer = () => {
    if (!isHost) return;
    const idx = gameState.players.length;
    if (idx >= 8) return;

    const aiPlayer: Player = {
        id: `ai-${generateId()}`,
        name: AI_NAMES[idx % AI_NAMES.length],
        avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
        type: 'ai',
        color: COLORS[idx % COLORS.length]
    };

    const newState = {
        ...gameState,
        players: [...gameState.players, aiPlayer]
    };
    setGameState(newState);
    broadcastState(newState);
  };

  // --- GAME FLOW (HOST) ---

  const startGame = async () => {
    if (!isHost) return;
    if (gameState.players.length < 2) {
        setError("Need at least 2 players!");
        return;
    }
    setIsLoading(true);

    // 1. Assign Targets (Circular)
    // P0 describes P1, P1 describes P2... Last describes P0
    const players = gameState.players;
    const rounds: GameRound[] = players.map((p, i) => {
        const target = players[(i + 1) % players.length];
        return {
            id: generateId(),
            describerId: p.id,
            targetId: target.id,
            description: '',
            artistId: '', // Assigned later
            drawingUrl: '',
        };
    });

    const newState: GameState = {
        ...gameState,
        phase: 'DESCRIBE',
        rounds
    };
    
    setGameState(newState);
    broadcastState(newState);
    setIsLoading(false);

    // TRIGGER AI DESCRIBERS
    const aiPlayers = players.filter(p => p.type === 'ai');
    for (const ai of aiPlayers) {
        const round = rounds.find(r => r.describerId === ai.id);
        if (round) {
            const target = players.find(p => p.id === round.targetId);
            if (target) {
                // Async generate but don't block UI
                generateAiDescription(ai, target).then(desc => {
                     channelRef.current?.postMessage({
                         type: 'SUBMIT_DESCRIPTION',
                         payload: { playerId: ai.id, text: desc },
                         roomCode: newState.roomCode
                     });
                });
            }
        }
    }
  };

  const processPhaseGuessDraw = async (currentState: GameState) => {
      setIsLoading(true);
      // Assign Artists
      // We shuffle the rounds to distribute descriptions randomly
      // Constraint: Artist != Describer AND Artist != Target (if possible)
      
      const rounds = [...currentState.rounds];
      const players = currentState.players;
      
      // Simple shift for assignment to ensure randomness but deterministic
      // If we shift by 2, Artist is (Describer + 2).
      // P0 wrote about P1. P2 draws it.
      
      // In a 2 player game:
      // P0 wrote P1. P0 draws it? (Self loop).
      // If players.length == 2, P0 draws P1's description (about P0).
      
      const shift = Math.max(1, Math.floor(players.length / 2)); 
      
      const updatedRounds = rounds.map((r, i) => {
          const artistIndex = (players.findIndex(p => p.id === r.describerId) + shift) % players.length;
          return {
              ...r,
              artistId: players[artistIndex].id
          };
      });

      const newState: GameState = {
          ...currentState,
          rounds: updatedRounds,
          phase: 'GUESS_DRAW'
      };
      
      setGameState(newState);
      broadcastState(newState);
      setIsLoading(false);

      // TRIGGER AI ARTISTS & GUESSERS
      updatedRounds.forEach(round => {
          const artist = players.find(p => p.id === round.artistId);
          if (artist && artist.type === 'ai') {
              // 1. Guess
              generateAiGuess(artist, round.description, players).then(guessId => {
                 // 2. Draw
                 generateAiDrawing(artist, round.description).then(drawingUrl => {
                     channelRef.current?.postMessage({
                         type: 'SUBMIT_DRAWING',
                         payload: { playerId: artist.id, drawingUrl, guessId },
                         roomCode: newState.roomCode
                     });
                 });
              });
          }
      });
  };

  const processPhaseReveal = async (currentState: GameState) => {
      const newState: GameState = {
          ...currentState,
          phase: 'REVEAL',
          currentRoundIndex: 0
      };
      setGameState(newState);
      broadcastState(newState);
  };

  // --- CLIENT ACTIONS ---

  const submitDescription = () => {
    if (!descriptionInput) return;
    setIsLoading(true);
    channelRef.current?.postMessage({
        type: 'SUBMIT_DESCRIPTION',
        payload: { playerId: myPlayerId, text: descriptionInput },
        roomCode: gameState.roomCode
    });
  };

  const submitDrawing = (url: string) => {
    if (!guessInput) {
        setError("You must select who you think this describes!");
        return;
    }
    setIsLoading(true);
    channelRef.current?.postMessage({
        type: 'SUBMIT_DRAWING',
        payload: { playerId: myPlayerId, drawingUrl: url, guessId: guessInput },
        roomCode: gameState.roomCode
    });
  };

  // --- RENDERERS ---

  if (gameState.phase === 'HOME') {
    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-8 font-sans flex items-center justify-center">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-2xl border-4 border-indigo-100">
            <h1 className="text-4xl font-black text-center text-indigo-900 mb-2">Sketch<span className="text-indigo-500">Identify</span></h1>
            <p className="text-center text-gray-500 mb-8">Multiplayer Party Game</p>
            
            <div className="space-y-6">
                <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">PICK AN AVATAR</label>
                <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
                    {AVATARS.slice(0, 8).map(av => (
                    <button
                        key={av}
                        onClick={() => setSelectedAvatar(av)}
                        className={`text-3xl p-3 rounded-2xl transition-all ${selectedAvatar === av ? 'bg-indigo-100 scale-110 border-2 border-indigo-500' : 'bg-gray-50 hover:bg-gray-100'}`}
                    >
                        {av}
                    </button>
                    ))}
                </div>
                </div>

                <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">YOUR NAME</label>
                <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="w-full text-xl font-bold p-4 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:outline-none bg-gray-50"
                    placeholder="Enter nickname..."
                    maxLength={12}
                />
                </div>

                <div className="pt-4 border-t border-gray-100">
                   <Button onClick={createLobby} className="w-full mb-4 text-lg" disabled={!playerName}>
                       CREATE NEW LOBBY
                   </Button>
                   
                   <div className="flex gap-2">
                       <input 
                         placeholder="LOBBY CODE" 
                         className="flex-1 bg-gray-100 rounded-xl px-4 font-mono uppercase font-bold border-2 border-transparent focus:border-indigo-500 outline-none"
                         value={lobbyCodeInput}
                         onChange={e => setLobbyCodeInput(e.target.value)}
                         maxLength={4}
                       />
                       <Button onClick={joinLobby} variant="secondary" disabled={!playerName || lobbyCodeInput.length < 4}>
                           JOIN
                       </Button>
                   </div>
                </div>
            </div>
        </div>
        </div>
    );
  }

  if (gameState.phase === 'LOBBY') {
      return (
        <div className="min-h-screen bg-indigo-600 p-8 font-sans">
            <div className="max-w-4xl mx-auto bg-white rounded-3xl p-8 shadow-2xl min-h-[60vh] flex flex-col">
                <div className="flex justify-between items-start mb-8 border-b-2 border-gray-100 pb-6">
                    <div>
                        <h2 className="text-3xl font-black text-indigo-900">Lobby</h2>
                        <p className="text-gray-500">Waiting for players...</p>
                    </div>
                    <div className="text-right">
                        <p className="text-sm font-bold text-gray-400">ROOM CODE</p>
                        <p className="text-4xl font-black font-mono tracking-widest text-indigo-500 select-all">{gameState.roomCode}</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 flex-1 content-start">
                    {gameState.players.map(p => (
                        <div key={p.id} className={`${p.id === myPlayerId ? 'bg-indigo-50 border-indigo-500' : 'bg-gray-50 border-transparent'} border-2 rounded-2xl p-4 flex flex-col items-center animate-fade-in`}>
                            <div className="text-4xl mb-2">{p.avatar}</div>
                            <div className="font-bold text-gray-800 text-center truncate w-full">{p.name}</div>
                            {p.isHost && <span className="text-[10px] uppercase font-bold bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full mt-1">HOST</span>}
                            {p.type === 'ai' && <span className="text-[10px] uppercase font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full mt-1">BOT</span>}
                        </div>
                    ))}
                    {isHost && gameState.players.length < 8 && (
                        <button onClick={addAiPlayer} className="border-2 border-dashed border-gray-300 rounded-2xl p-4 flex flex-col items-center justify-center text-gray-400 hover:bg-gray-50 hover:border-gray-400 transition-colors">
                            <span className="text-2xl mb-1">+</span>
                            <span className="font-bold text-sm">ADD BOT</span>
                        </button>
                    )}
                </div>

                {isHost ? (
                    <Button onClick={startGame} className="w-full text-xl py-4" disabled={gameState.players.length < 2}>
                        START GAME
                    </Button>
                ) : (
                    <div className="text-center text-gray-400 font-bold animate-pulse">
                        Waiting for host to start...
                    </div>
                )}
            </div>
        </div>
      );
  }

  // GAME PHASES
  const myRound = gameState.phase === 'DESCRIBE' 
      ? gameState.rounds.find(r => r.describerId === myPlayerId)
      : gameState.phase === 'GUESS_DRAW'
      ? gameState.rounds.find(r => r.artistId === myPlayerId)
      : null;

  // Wait screen if I am done but others aren't
  if ((gameState.phase === 'DESCRIBE' && myRound?.description && !isLoading) ||
      (gameState.phase === 'GUESS_DRAW' && myRound?.drawingUrl && !isLoading)) {
      return (
        <div className="min-h-screen bg-indigo-500 flex items-center justify-center p-4">
             <div className="bg-white p-8 rounded-2xl text-center shadow-xl">
                 <div className="text-6xl mb-4">⏳</div>
                 <h2 className="text-2xl font-bold mb-2">Waiting for others...</h2>
                 <p className="text-gray-500">You're too fast!</p>
             </div>
        </div>
      );
  }

  if (gameState.phase === 'DESCRIBE') {
      const target = gameState.players.find(p => p.id === myRound?.targetId);
      if (!target) return <div>Error: No target found</div>;

      return (
        <div className="min-h-screen bg-indigo-100 p-4 md:p-8 flex items-center justify-center">
            <div className="max-w-2xl w-full">
            <div className="bg-white p-8 rounded-3xl shadow-lg border-b-8 border-indigo-200 text-center mb-6">
              <span className="inline-block px-4 py-1 bg-indigo-100 text-indigo-700 rounded-full font-bold text-sm mb-4">PHASE 1: DESCRIBE</span>
              <div className="text-6xl mb-4 animate-bounce mt-4">{target.avatar}</div>
              <h3 className="text-3xl font-black text-gray-900 mb-2">{target.name}</h3>
              <p className="text-gray-500">Describe them visually without using their name.</p>
            </div>

            <textarea
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              className="w-full h-32 p-4 rounded-2xl border-4 border-white shadow-lg focus:border-indigo-500 focus:outline-none text-xl resize-none mb-4"
              placeholder={`e.g., "A happy creature wearing sunglasses..."`}
              maxLength={100}
            />

            <Button 
              onClick={submitDescription} 
              className="w-full text-xl py-4 shadow-xl"
              isLoading={isLoading}
              disabled={!descriptionInput}
            >
              SUBMIT DESCRIPTION
            </Button>
            </div>
        </div>
      );
  }

  if (gameState.phase === 'GUESS_DRAW') {
      if (!myRound) return <div>Loading...</div>;

      return (
        <div className="min-h-screen bg-yellow-50 p-4 md:p-8">
            <div className="max-w-4xl mx-auto">
                 {/* Guessing Section */}
                 <div className="bg-white p-6 rounded-2xl shadow-sm mb-4 border-l-8 border-yellow-400">
                     <p className="text-xs font-bold text-gray-400 uppercase mb-2">STEP 1: READ & GUESS</p>
                     <p className="text-2xl font-bold text-gray-800 mb-6">"{myRound.description}"</p>
                     
                     <div className="flex flex-col md:flex-row items-center gap-4">
                        <label className="font-bold text-sm text-gray-600 whitespace-nowrap">WHO IS THIS?</label>
                        <div className="flex gap-2 overflow-x-auto w-full pb-2 scrollbar-hide">
                            {gameState.players.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => setGuessInput(p.id)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-full border-2 transition-all shrink-0 ${guessInput === p.id ? 'bg-yellow-100 border-yellow-500 ring-2 ring-yellow-200' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
                                >
                                    <span className="text-xl">{p.avatar}</span>
                                    <span className="font-bold text-sm">{p.name}</span>
                                </button>
                            ))}
                        </div>
                     </div>
                 </div>

                 {/* Drawing Section */}
                 <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                     <div className="bg-gray-50 p-4 border-b">
                         <p className="text-xs font-bold text-gray-400 uppercase">STEP 2: DRAW THE DESCRIPTION</p>
                     </div>
                     <DrawingCanvas 
                        targetDescription={myRound.description}
                        onSave={submitDrawing}
                     />
                 </div>
                 {error && <p className="text-red-500 text-center font-bold mt-4 bg-white p-2 rounded-lg inline-block w-full">{error}</p>}
            </div>
        </div>
      );
  }

  if (gameState.phase === 'REVEAL') {
    const round = gameState.rounds[gameState.currentRoundIndex];
    const describer = gameState.players.find(p => p.id === round.describerId);
    const target = gameState.players.find(p => p.id === round.targetId);
    const artist = gameState.players.find(p => p.id === round.artistId);
    const guessedPlayer = gameState.players.find(p => p.id === round.artistGuessId);
    
    const isCorrectGuess = guessedPlayer?.id === target?.id;

    return (
      <div className="min-h-screen bg-gray-900 p-4 md:p-8 flex items-center justify-center">
      <div className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden">
         <div className="bg-gray-800 p-4 flex justify-between items-center text-white">
            <span className="font-bold text-gray-400">ROUND {gameState.currentRoundIndex + 1} / {gameState.rounds.length}</span>
            {isHost && (
                <div className="text-xs bg-indigo-600 px-2 py-1 rounded">YOU ARE HOST</div>
            )}
         </div>

         <div className="p-4 md:p-8 space-y-6">
            
            {/* The Chain Visualized */}
            <div className="flex flex-col md:flex-row gap-4 items-stretch justify-center mb-8">
                {/* 1. Describer Card */}
                <div className="flex-1 bg-gray-50 rounded-xl p-4 border-2 border-dashed border-gray-200">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{describer?.avatar}</span>
                        <span className="font-bold text-xs text-gray-500 uppercase">{describer?.name} WROTE</span>
                    </div>
                    <p className="font-medium text-lg leading-tight">"{round.description}"</p>
                </div>

                {/* Arrow */}
                <div className="hidden md:flex items-center text-gray-300">➜</div>

                {/* 2. Artist Card */}
                <div className="flex-1 bg-indigo-50 rounded-xl p-4 border-2 border-indigo-100 relative overflow-hidden">
                    <div className="flex items-center gap-2 mb-2 relative z-10">
                        <span className="text-2xl">{artist?.avatar}</span>
                        <span className="font-bold text-xs text-indigo-400 uppercase">{artist?.name} DREW & GUESSED</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 bg-white/50 p-2 rounded-lg">
                        <span className="text-sm text-gray-500">Guessed:</span>
                        <span className="text-xl">{guessedPlayer?.avatar}</span>
                        <span className="font-bold">{guessedPlayer?.name}</span>
                        {isCorrectGuess ? (
                            <span className="ml-auto bg-green-500 text-white text-xs font-bold px-2 py-1 rounded-full">CORRECT!</span>
                        ) : (
                            <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">WRONG</span>
                        )}
                    </div>
                </div>
            </div>

            {/* The Reveal */}
            <div className="relative border-4 border-gray-900 rounded-2xl bg-white overflow-hidden text-center">
                 <img src={round.drawingUrl} className="w-full max-h-[400px] object-contain bg-white" alt="Masterpiece" />
                 
                 <div className="bg-gray-900 text-white p-4">
                     <p className="text-sm font-bold text-gray-400 uppercase mb-1">THE REAL SUBJECT WAS</p>
                     <div className="flex items-center justify-center gap-3">
                         <span className="text-5xl">{target?.avatar}</span>
                         <span className="text-4xl font-black">{target?.name}</span>
                     </div>
                 </div>
            </div>

         </div>

         {isHost && (
             <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end">
                {gameState.currentRoundIndex < gameState.rounds.length - 1 ? (
                    <Button onClick={() => {
                        const newState = { ...gameState, currentRoundIndex: gameState.currentRoundIndex + 1 };
                        setGameState(newState);
                        broadcastState(newState);
                    }}>
                        NEXT REVEAL →
                    </Button>
                ) : (
                    <Button onClick={() => {
                         const newState: GameState = {
                             ...gameState,
                             phase: 'LOBBY',
                             rounds: [],
                             currentRoundIndex: 0
                         };
                         setGameState(newState);
                         broadcastState(newState);
                    }} variant="secondary">
                        BACK TO LOBBY ↺
                    </Button>
                )}
             </div>
         )}
         {!isHost && (
             <div className="p-4 bg-gray-50 text-center text-gray-400 font-bold text-sm">
                 Waiting for host...
             </div>
         )}
      </div>
      </div>
    );
  }

  return <div>Loading...</div>;
};

export default App;
