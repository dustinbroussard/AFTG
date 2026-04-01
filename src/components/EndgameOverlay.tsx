import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, RefreshCcw, Trophy } from 'lucide-react';

interface EndgameOverlayProps {
  isOpen: boolean;
  isWinner: boolean;
  winnerName: string;
  loserName: string;
  winnerScore: number;
  loserScore: number;
  winnerTrophies: number;
  loserTrophies: number;
  trophyTarget: number;
  message: string;
  isGeneratingMessage: boolean;
  canPlayAgain: boolean;
  isStartingGame: boolean;
  onPlayAgain: () => void;
}

export const EndgameOverlay: React.FC<EndgameOverlayProps> = ({
  isOpen,
  isWinner,
  winnerName,
  loserName,
  winnerScore,
  loserScore,
  winnerTrophies,
  loserTrophies,
  trophyTarget,
  message,
  isGeneratingMessage,
  canPlayAgain,
  isStartingGame,
  onPlayAgain,
}) => {
  const accentClass = isWinner ? 'text-emerald-300' : 'text-rose-300';
  const trophyGlowClass = isWinner
    ? 'text-yellow-300 drop-shadow-[0_0_26px_rgba(250,204,21,0.42)]'
    : 'text-amber-200 drop-shadow-[0_0_22px_rgba(251,191,36,0.28)]';
  const shellClass = isWinner
    ? 'theme-panel-strong border-emerald-400/28 ring-1 ring-emerald-300/12'
    : 'bg-rose-950/45 border-rose-500/35 ring-1 ring-rose-300/12';
  const messageClass = isWinner
    ? 'border-emerald-400/18 bg-emerald-500/10'
    : 'border-rose-400/18 bg-rose-500/10';
  const buttonClass = isWinner
    ? 'bg-white text-black hover:scale-[1.02] shadow-[0_8px_30px_rgba(255,255,255,0.15)]'
    : 'bg-rose-400 text-rose-950 hover:scale-[1.02] shadow-[0_8px_30px_rgba(244,63,94,0.2)]';
  const summary = `${winnerName} ${winnerTrophies}/${trophyTarget} trophies, ${winnerScore} points. ${loserName} ${loserTrophies}/${trophyTarget}, ${loserScore} points.`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="endgame-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[58] flex items-center justify-center p-4 sm:p-6"
        >
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 theme-overlay"
            initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 0.7, backdropFilter: 'blur(6px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="endgame-overlay-title"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="relative z-10 w-full max-w-xl"
          >
            <div className={`rounded-[2rem] border px-6 py-7 text-center backdrop-blur-xl shadow-[0_18px_48px_rgba(0,0,0,0.34)] sm:px-8 sm:py-9 ${shellClass}`}>
              <p className={`mb-4 text-[0.625rem] font-black uppercase tracking-[0.28em] ${accentClass}`}>
                {isWinner ? 'Victory Lap' : 'Closing Remarks'}
              </p>

              <Trophy className={`mx-auto mb-5 h-20 w-20 sm:h-24 sm:w-24 ${trophyGlowClass}`} />

              <h2 id="endgame-overlay-title" className="text-4xl font-black uppercase tracking-tight">
                Game Over
              </h2>
              <p className="mt-2 text-lg font-semibold theme-text-muted sm:text-xl">
                {isWinner ? `You took all ${trophyTarget} trophies.` : `${winnerName} got to all ${trophyTarget} trophies first.`}
              </p>

              <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] theme-text-muted sm:text-sm">
                {summary}
              </p>

              <div className={`mt-6 rounded-2xl border px-5 py-5 text-left shadow-[0_12px_30px_rgba(0,0,0,0.2)] ${messageClass}`}>
                {isGeneratingMessage ? (
                  <p className="text-center text-sm font-bold uppercase tracking-[0.2em] theme-text-muted">
                    Preparing one last cheap shot...
                  </p>
                ) : (
                  <p className="text-[1.08rem] font-semibold leading-7 text-white sm:text-[1.18rem] sm:leading-8">
                    {message}
                  </p>
                )}
              </div>

              <div className="mt-7">
                {canPlayAgain ? (
                  <button
                    type="button"
                    onClick={onPlayAgain}
                    disabled={isStartingGame}
                    className={`mx-auto flex items-center justify-center gap-3 rounded-xl px-8 py-4 text-lg font-bold transition-all duration-300 ease-in-out disabled:opacity-50 ${buttonClass}`}
                  >
                    {isStartingGame ? <Loader2 className="h-6 w-6 animate-spin" /> : <RefreshCcw className="h-6 w-6" />}
                    Play Again
                  </button>
                ) : (
                  <p className="font-bold uppercase tracking-widest theme-text-muted">
                    Waiting for host to play again...
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
