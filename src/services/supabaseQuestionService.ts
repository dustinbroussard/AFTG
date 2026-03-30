import { supabase } from '../lib/supabase';
import { TriviaQuestion } from '../types';

function mapQuestionToInsertRow(question: Partial<TriviaQuestion>) {
  const choices = Array.isArray(question.choices) ? question.choices.map((entry) => String(entry)) : [];
  const correctIndex = typeof question.correctIndex === 'number' ? question.correctIndex : 0;
  const correctAnswer = choices[correctIndex] ?? '';
  const distractors = choices.filter((_, index) => index !== correctIndex).slice(0, 3);

  return {
    category: question.category ?? 'History',
    content: question.question ?? '',
    correct_answer: correctAnswer,
    distractors,
    difficulty_level: question.difficulty ?? 'medium',
    explanation: question.explanation ?? '',
    question_styled: question.presentation?.questionStyled ?? null,
    explanation_styled: question.presentation?.explanationStyled ?? null,
    host_lead_in: question.presentation?.hostLeadIn ?? null,
    validation_status: question.status ?? 'pending',
    source: question.sourceType ?? 'ai',
  };
}

function mapQuestionRow(row: any): TriviaQuestion {
  const distractors = Array.isArray(row.distractors) ? row.distractors.map((entry: unknown) => String(entry)) : [];
  const choices = [row.correct_answer, ...distractors].filter((entry): entry is string => typeof entry === 'string');
  const correctIndex = Math.max(0, choices.indexOf(row.correct_answer));
  const nestedPresentation = row.presentation && typeof row.presentation === 'object' ? row.presentation : {};
  const stylingPresentation = row.styling && typeof row.styling === 'object' ? row.styling : {};
  const wrongAnswerQuips = [
    ...(Array.isArray(nestedPresentation.wrongAnswerQuips) ? nestedPresentation.wrongAnswerQuips : []),
    ...(Array.isArray(stylingPresentation.wrongAnswerQuips) ? stylingPresentation.wrongAnswerQuips : []),
    ...(Array.isArray(row.wrong_answer_quips) ? row.wrong_answer_quips : []),
  ]
    .map((entry: unknown) => String(entry).trim())
    .filter(Boolean);

  return {
    id: row.id,
    category: row.category,
    difficulty: row.difficulty_level,
    question: row.content,
    choices,
    correctIndex,
    explanation: row.explanation,
    tags: [],
    used: false,
    status: row.validation_status,
    presentation: {
      questionStyled: nestedPresentation.questionStyled ?? stylingPresentation.questionStyled ?? row.question_styled ?? undefined,
      explanationStyled: nestedPresentation.explanationStyled ?? stylingPresentation.explanationStyled ?? row.explanation_styled ?? undefined,
      hostLeadIn: nestedPresentation.hostLeadIn ?? stylingPresentation.hostLeadIn ?? row.host_lead_in ?? undefined,
      ...(wrongAnswerQuips.length > 0 ? { wrongAnswerQuips } : {}),
    },
    sourceType: row.source ?? 'manual',
    createdAt: row.created_at,
    metadata: {
      usedCount: row.used_count ?? 0,
      verificationVerdict: row.verification_verdict ?? null,
      verificationConfidence: row.verification_confidence ?? null,
      verificationReason: row.verification_reason ?? null,
      pipelineVersion: row.pipeline_version ?? null,
    },
  };
}

export async function importQuestionBatch(questions: Partial<TriviaQuestion>[]) {
  const formattedQuestions = questions.map(mapQuestionToInsertRow);

  const { data, error } = await supabase
    .from('questions')
    .insert(formattedQuestions)
    .select('*');

  if (error) {
    console.error('Error importing questions:', error);
    throw error;
  }

  return (data || []).map(mapQuestionRow);
}

export async function fetchQuestions(filters: {
  category?: string;
  difficulty?: string;
  status?: string;
}) {
  let query = supabase.from('questions').select('*');

  if (filters.category) query = query.eq('category', filters.category);
  if (filters.difficulty) query = query.eq('difficulty_level', filters.difficulty);
  if (filters.status) query = query.eq('validation_status', filters.status);

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching questions:', error);
    throw error;
  }

  return (data || []).map(mapQuestionRow);
}
