import React from 'react';
import { motion } from 'motion/react';
import { TriviaQuestion, CATEGORY_COLORS, getHostLeadIn, getQuestionText } from '../types';
import { SafeRichText } from './SafeRichText';

interface QuestionCardProps {
  question: TriviaQuestion;
  onSelect: (index: number) => void;
  disabled?: boolean;
  selectedId?: number | null;
  correctId?: number | null;
  timerProgress?: number;
  timeRemaining?: number;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({ 
  question, 
  onSelect, 
  disabled,
  selectedId,
  correctId,
  timerProgress = 1,
  timeRemaining = 15,
}) => {
  const clampedProgress = Math.max(0, Math.min(1, timerProgress));
  const timerColor = clampedProgress <= 0.33 ? '#F43F5E' : '#06B6D4';
  const hostLeadIn = getHostLeadIn(question);
  const questionText = getQuestionText(question);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-h-[min(78dvh,50rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border p-4 shadow-xl transition-all duration-500 ease-in-out theme-panel-strong backdrop-blur-md hover:shadow-2xl sm:p-6 md:p-8"
    >
      <div className="mb-4 sm:mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[0.625rem] font-black uppercase tracking-[0.25em] theme-text-muted">
            Time Remaining
          </span>
          <span
            className="text-sm font-black tabular-nums transition-colors duration-300"
            style={{ color: timerColor }}
          >
            {timeRemaining}s
          </span>
        </div>
        <div className="h-2 rounded-full theme-soft-surface overflow-hidden">
          <motion.div
            animate={{ width: `${clampedProgress * 100}%`, backgroundColor: timerColor }}
            transition={{ duration: 0.25, ease: 'linear' }}
            className="h-full rounded-full"
          />
        </div>
      </div>

      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div 
          className="inline-block px-3 py-1.5 rounded-xl text-[0.6875rem] font-bold uppercase tracking-widest shadow-sm sm:px-4"
          style={{ backgroundColor: CATEGORY_COLORS[question.category] || '#fff', color: '#000' }}
        >
          {question.category}
        </div>
      </div>
      
      <div className="min-h-0 overflow-y-auto pr-1 custom-scrollbar">
        <SafeRichText
          as="p"
          className="mb-3 text-sm font-black uppercase tracking-[0.18em] theme-text-muted"
          html={hostLeadIn}
        />
        <SafeRichText
          as="h2"
          className="mb-5 text-xl font-black leading-tight sm:mb-7 sm:text-2xl md:text-3xl"
          html={questionText}
        />
      
        <div className="space-y-3 sm:space-y-4">
          {question.choices.map((choice, i) => {
            const isSelected = selectedId === i;
            const isCorrect = correctId === i;
            const isWrong = isSelected && correctId !== null && !isCorrect;
            
            let borderColor = 'theme-border';
            let bgColor = 'theme-soft-surface';
            let textColor = 'theme-text-secondary';
            
            if (isCorrect) {
              borderColor = 'border-emerald-500/50';
              bgColor = 'bg-emerald-500/20';
              textColor = 'text-emerald-400';
            } else if (isWrong) {
              borderColor = 'border-rose-500/50';
              bgColor = 'bg-rose-500/20';
              textColor = 'text-rose-400';
            } else if (isSelected) {
              borderColor = 'border-purple-500/50';
              bgColor = 'bg-purple-500/20';
              textColor = 'text-purple-400';
            }

            return (
              <motion.button type="button"
                key={i}
                whileHover={!disabled ? { scale: 1.01, backgroundColor: 'var(--app-hover)' } : {}}
                whileTap={!disabled ? { scale: 0.99 } : {}}
                onClick={() => !disabled && onSelect(i)}
                disabled={disabled}
                aria-pressed={isSelected}
                aria-label={`Answer ${String.fromCharCode(65 + i)}: ${choice}`}
                className={`group min-h-14 w-full rounded-xl border p-3 text-left transition-all duration-300 ease-in-out hover:shadow-md sm:min-h-16 sm:p-4 md:p-5 ${borderColor} ${bgColor}`}
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold shadow-inner transition-colors duration-300 theme-avatar-surface sm:h-9 sm:w-9 ${isSelected ? 'text-white' : 'theme-text-muted'}`}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className={`text-base font-medium leading-snug sm:text-lg ${textColor}`}>
                    {choice}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};
