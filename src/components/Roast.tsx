import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Flag } from 'lucide-react';
import { getRandomQuestionFlagLine } from '../content/questionFlagCopy';
import { flagQuestion } from '../services/questionFlags';

interface RoastProps {
  explanation: string;
  isCorrect: boolean;
  questionId: string;
  userId?: string | null;
  gameId?: string | null;
  onClose: () => void;
}

export const Roast: React.FC<RoastProps> = ({ explanation, isCorrect, questionId, userId, gameId, onClose }) => {
  const [flagLine, setFlagLine] = useState(() => getRandomQuestionFlagLine());
  const [isFlagged, setIsFlagged] = useState(false);
  const [isSavingFlag, setIsSavingFlag] = useState(false);

  useEffect(() => {
    setFlagLine(getRandomQuestionFlagLine());
    setIsFlagged(false);
    setIsSavingFlag(false);
  }, [questionId]);

  const handleFlag = async () => {
    if (isFlagged || isSavingFlag) return;

    setIsSavingFlag(true);
    try {
      await flagQuestion({ questionId, userId, gameId });
      setIsFlagged(true);
    } catch (error) {
      console.error('[questionFlag] Failed to log flag:', error);
    } finally {
      setIsSavingFlag(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="roast-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="fixed inset-0 flex items-center justify-center z-50 p-6 theme-overlay backdrop-blur-sm pointer-events-auto"
      >
        <div className={`p-10 rounded-2xl border shadow-[0_8px_30px_rgb(0,0,0,0.25)] max-w-md w-full text-center transition-all duration-300 ease-in-out ${
          isCorrect ? 'bg-emerald-950/40 border-emerald-500/30' : 'bg-rose-950/40 border-rose-500/30'
        }`}>
          <h3 className={`text-4xl font-black uppercase tracking-tight mb-4 ${
            isCorrect ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {isCorrect ? 'Correct!' : 'Wrong!'}
          </h3>
          <p className="text-lg font-semibold leading-relaxed mb-3">
            {explanation}
          </p>
          <div className="mb-5 rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-left">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] theme-text-muted">Quality Control</p>
            <p className="text-sm leading-relaxed theme-text-secondary">
              {flagLine}
            </p>
            <label className="mt-3 inline-flex items-center gap-2 text-sm font-medium theme-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={isFlagged}
                disabled={isFlagged || isSavingFlag}
                onChange={handleFlag}
                className="h-4 w-4 rounded border-white/30 bg-transparent"
              />
              <span className="inline-flex items-center gap-2">
                <Flag className="h-4 w-4" />
                {isFlagged ? 'Flagged for review' : isSavingFlag ? 'Flagging...' : 'Flag this question'}
              </span>
            </label>
          </div>
          <button type="button"
            onClick={onClose}
            className={`w-full py-4 rounded-xl text-sm font-bold uppercase tracking-widest hover:scale-[1.02] transition-all duration-300 ease-in-out shadow-lg ${
              isCorrect ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 shadow-emerald-500/25' : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/25'
            }`}
          >
            Continue
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
