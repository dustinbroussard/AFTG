import { supabase } from '../lib/supabase';

interface FlagQuestionParams {
  questionId: string;
  userId?: string | null;
  gameId?: string | null;
}

export async function flagQuestion({ questionId, userId, gameId }: FlagQuestionParams) {
  const { error } = await supabase.rpc('flag_question', {
    p_question_id: questionId,
    p_reason: null,
    p_details: {
      ...(userId ? { userId } : {}),
      ...(gameId ? { gameId } : {}),
    },
  });
  if (error) throw error;
}