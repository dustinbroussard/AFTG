import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ResultCard } from './ResultCard';

interface HeckleOverlayProps {
  message: string | null;
  visible: boolean;
}

export const HeckleOverlay: React.FC<HeckleOverlayProps> = ({ message, visible }) => {
  const displayMessage = message?.trim() || 'Couldn’t format commentary.';
  if (!visible) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={displayMessage}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[55] flex items-center justify-center p-6 pointer-events-none"
      >
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 theme-overlay"
          initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          animate={{ opacity: 0.56, backdropFilter: 'blur(3px)' }}
          exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        />
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.965 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-2xl"
        >
          <ResultCard
            variant="commentary"
            label="Commentary Booth"
            title="Heckle"
            className="w-full"
            body={
              <p className="mx-auto max-w-[20ch] whitespace-pre-line text-balance">
                {displayMessage}
              </p>
            }
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
