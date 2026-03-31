import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CATEGORY_COLORS } from '../types';

interface ManualCategoryPromptProps {
  categories: string[];
  source?: 'streak' | 'wheel';
  onPickCategory: (category: string) => void;
  onSpinWheel: () => void;
}

export const ManualCategoryPrompt: React.FC<ManualCategoryPromptProps> = ({
  categories,
  source = 'streak',
  onPickCategory,
  onSpinWheel,
}) => {
  const isWheelReward = source === 'wheel';

  return (
    <AnimatePresence>
      <motion.div
        key="manual-category-prompt"
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="mx-auto w-full max-w-2xl rounded-2xl border p-5 theme-panel-strong sm:p-8"
      >
        <p className="text-[0.625rem] font-black uppercase tracking-[0.28em] text-cyan-400 mb-3">
          {isWheelReward ? "Wheel's Choice" : "Player's Choice Unlocked"}
        </p>
        <h3 className="mb-2 text-2xl font-black sm:text-3xl">Pick your next move.</h3>
        <p className="theme-text-secondary text-sm sm:text-base mb-6">
          {isWheelReward
            ? 'The wheel landed on Player’s Choice. Pick any category or spin again.'
            : 'Two correct answers. Pick your next category or spin the wheel.'}
        </p>

        <div className="mb-6 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">
          {categories.map((category) => (
            <button type="button"
              key={category}
              onClick={() => onPickCategory(category)}
              aria-label={`Choose ${category} category`}
              className="min-h-14 rounded-xl border border-white/10 px-4 py-4 text-left font-black text-black shadow-md transition-all duration-300 hover:scale-[1.02]"
              style={{ backgroundColor: CATEGORY_COLORS[category] || '#fff' }}
            >
              {category}
            </button>
          ))}
        </div>

        <button type="button"
          onClick={onSpinWheel}
          aria-label="Spin the wheel instead of choosing a category"
          className="w-full py-4 rounded-xl theme-button text-sm font-bold uppercase tracking-widest transition-all duration-300 border theme-border"
        >
          Spin Wheel Instead
        </button>
      </motion.div>
    </AnimatePresence>
  );
};
