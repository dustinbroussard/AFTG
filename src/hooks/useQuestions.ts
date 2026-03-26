import { useState, useCallback, useRef } from 'react';
import { TriviaQuestion } from '../types';
import { getQuestionsForSession, markQuestionSeen } from '../services/questionRepository';

export function useQuestions(user: any | null, gameId?: string) {
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<TriviaQuestion | null>(null);
  const [isFetchingQuestions, setIsFetchingQuestions] = useState(false);
  const activeQuestionIdRef = useRef<string | null>(null);

  const fetchQuestions = useCallback(async (categories: string[], countPerCategory: number) => {
    setIsFetchingQuestions(true);
    try {
      const q = await getQuestionsForSession({ categories, count: countPerCategory });
      setQuestions(q);
      return q;
    } catch (err) {
      console.error('[fetchQuestions] Failed:', err);
      throw err;
    } finally {
      setIsFetchingQuestions(false);
    }
  }, []);

  const markSeen = useCallback(async (questionId: string) => {
    if (!user?.id) return;
    try {
      await markQuestionSeen({
        userId: user.id,
        questionId,
        gameId,
      });
    } catch (err) {
      console.error('[seenQuestions] Failed:', err);
    }
  }, [user?.id, gameId]);

  return {
    questions,
    setQuestions,
    currentQuestion,
    setCurrentQuestion,
    isFetchingQuestions,
    setIsFetchingQuestions,
    fetchQuestions,
    markSeen,
    activeQuestionIdRef,
  };
}
