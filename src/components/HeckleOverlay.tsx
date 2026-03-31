import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface HeckleOverlayProps {
  message: string | null;
  visible: boolean;
}

export const HeckleOverlay: React.FC<HeckleOverlayProps> = ({ message, visible }) => {
  if (!visible || !message) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={message}
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.992 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="w-full max-w-2xl mx-auto -mt-1 sm:-mt-2"
      >
        <div className="theme-panel-strong border rounded-2xl min-h-[8.25rem] sm:min-h-[9rem] px-6 py-6 sm:px-7 sm:py-6 shadow-[0_8px_30px_rgba(0,0,0,0.18),0_0_18px_rgba(217,70,239,0.08)]">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-400 mb-2.5">
            Commentary Booth
          </p>
          <p className="text-[1.05rem] sm:text-xl font-semibold leading-7 sm:leading-8 whitespace-pre-line">
            {message}
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
