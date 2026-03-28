import { supabase } from '../lib/supabase';
import { TriviaQuestion, getPlayableCategories, isPlayableCategory } from '../types';

interface GetQuestionsForSessionParams {
  categories: string[];
  count: number;
  excludeQuestionIds?: string[];
  userId?: string;
}

const SEEN_QUESTIONS_TABLE = 'user_seen_questions';
const SEEN_QUESTIONS_USER_COLUMN = 'user_id';

const seenQuestionIdsCache = new Map<string, Promise<Set<string>>>();

function normalizeRequestedCategory(category: string) {
  return isPlayableCategory(category) ? category : getPlayableCategories()[0];
}

function toBankQuestion(question: any, createdAt = Date.now()): TriviaQuestion {
  const canonicalId = question.id || question.question_id;
  const distractors = Array.isArray(question.distractors)
    ? question.distractors.map((entry: unknown) => String(entry))
    : [];
  const normalizedChoices = Array.isArray(question.choices)
    ? question.choices
    : question.correct_answer
      ? [question.correct_answer, ...distractors]
      : [];
  const normalizedCorrectIndex = question.correctIndex
    ?? question.correct_index
    ?? (question.correct_answer ? normalizedChoices.indexOf(question.correct_answer) : 0);
  const normalizedStatus = question.status ?? question.validation_status ?? question.validationStatus ?? 'pending';
  const normalizedDifficulty = question.difficulty ?? question.difficulty_level ?? 'medium';
  const normalizedQuestionText = question.question ?? question.content ?? '';
  const normalizedPresentation = question.presentation || {
    questionStyled: question.questionStyled ?? question.question_styled,
    explanationStyled: question.explanationStyled ?? question.explanation_styled,
    hostLeadIn: question.hostLeadIn ?? question.host_lead_in,
  };

  return {
    id: canonicalId,
    category: question.category,
    subcategory: question.subcategory,
    difficulty: normalizedDifficulty,
    question: normalizedQuestionText,
    choices: normalizedChoices,
    correctIndex: normalizedCorrectIndex >= 0 ? normalizedCorrectIndex : 0,
    explanation: question.explanation,
    tags: question.tags || [],
    status: normalizedStatus,
    presentation: normalizedPresentation,
    sourceType: question.sourceType || question.source_type || 'manual',
    createdAt: question.createdAt || question.created_at || createdAt,
    metadata: {
      usedCount: question.usedCount ?? question.used_count ?? 0,
      used: question.used ?? false,
      validationStatus: question.validationStatus,
      verificationVerdict: question.verificationVerdict,
      ...question.metadata,
    },
  };
}

function dedupeById(questions: TriviaQuestion[]) {
  const seen = new Set<string>();

  return questions.filter((question) => {
    if (!question.id || seen.has(question.id)) return false;
    seen.add(question.id);
    return true;
  });
}

async function fetchApprovedQuestionsByCategory(category: string, excludeIds: Set<string>, count: number) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('category', category)
    .order('created_at', { ascending: false })
    .limit(Math.max(count * 5, 20));

  if (error) {
    console.error('Error fetching questions from Supabase:', error);
    return [];
  }

  return (data || [])
    .map((entry) => toBankQuestion(entry))
    .filter((question) => question.status === 'approved')
    .filter((question) => question.choices.length === 4)
    .filter((question) => !excludeIds.has(question.id));
}

async function loadSeenQuestionIds(userId?: string): Promise<Set<string>> {
  if (!userId) return new Set<string>();
  const cached = seenQuestionIdsCache.get(userId);
  if (cached) {
    const cachedIds = new Set(await cached);
    console.info(
      `[seenQuestions] Fetched seen question IDs from cache table=${SEEN_QUESTIONS_TABLE} user_id=${userId} count=${cachedIds.size}`
    );
    return cachedIds;
  }

  const loadPromise = (async () => {
    console.info(`[seenQuestions] Querying table=${SEEN_QUESTIONS_TABLE} user_id=${userId}`);
    const { data, error } = await supabase
      .from(SEEN_QUESTIONS_TABLE)
      .select('question_id')
      .eq(SEEN_QUESTIONS_USER_COLUMN, userId);

    if (error) {
      console.warn(
        `[seenQuestions] Failed querying table=${SEEN_QUESTIONS_TABLE} user_id=${userId}. Treating as no seen questions.`,
        error
      );
      return new Set<string>();
    }

    const seenIds = new Set((data || []).map((entry: { question_id: string }) => entry.question_id));
    console.info(
      `[seenQuestions] Fetched seen question IDs table=${SEEN_QUESTIONS_TABLE} user_id=${userId} count=${seenIds.size}`
    );
    return seenIds;
  })();

  seenQuestionIdsCache.set(userId, loadPromise);
  return new Set(await loadPromise);
}

function preferUnseenQuestions(
  questions: TriviaQuestion[],
  seenQuestionIds: Set<string>,
  count: number,
  category: string,
  userId?: string
) {
  if (seenQuestionIds.size === 0) {
    console.info(
      `[seenQuestions] table=${SEEN_QUESTIONS_TABLE} user_id=${userId ?? 'anonymous'} category=${category} unseen_found=${Math.min(questions.length, count)} fallback_triggered=false available_candidates=${questions.length}`
    );
    return questions.slice(0, count);
  }

  const unseen = questions.filter((question) => !seenQuestionIds.has(question.id));
  const fallbackTriggered = unseen.length < count;
  console.info(
    `[seenQuestions] table=${SEEN_QUESTIONS_TABLE} user_id=${userId ?? 'anonymous'} category=${category} unseen_found=${unseen.length} fallback_triggered=${fallbackTriggered} available_candidates=${questions.length}`
  );
  if (unseen.length >= count) {
    return unseen.slice(0, count);
  }

  const seenFallback = questions.filter((question) => seenQuestionIds.has(question.id));
  console.info(
    `[seenQuestions] table=${SEEN_QUESTIONS_TABLE} user_id=${userId ?? 'anonymous'} category=${category} fallback_pool=${seenFallback.length} selected_count=${Math.min(unseen.length + seenFallback.length, count)}`
  );
  return [...unseen, ...seenFallback].slice(0, count);
}

export async function getQuestionsForSession({
  categories,
  count,
  excludeQuestionIds = [],
  userId,
}: GetQuestionsForSessionParams): Promise<TriviaQuestion[]> {
  const uniqueCategories = [...new Set(categories.map(normalizeRequestedCategory))];
  const excludeIds = new Set(excludeQuestionIds);
  const seenQuestionIds = await loadSeenQuestionIds(userId);
  const selected: TriviaQuestion[] = [];

  for (const category of uniqueCategories) {
    const approved = preferUnseenQuestions(
      await fetchApprovedQuestionsByCategory(category, excludeIds, count),
      seenQuestionIds,
      count,
      category,
      userId
    );
    approved.forEach((question) => excludeIds.add(question.id));
    selected.push(...approved);
  }

  return dedupeById(selected);
}

export async function markQuestionSeen({
  userId,
  questionId,
}: {
  userId: string;
  questionId: string;
}) {
  console.info(
    `[seenQuestions] Marking question as seen table=${SEEN_QUESTIONS_TABLE} user_id=${userId} question_id=${questionId}`
  );
  const { error } = await supabase
    .from(SEEN_QUESTIONS_TABLE)
    .upsert(
      {
        [SEEN_QUESTIONS_USER_COLUMN]: userId,
        question_id: questionId,
      },
      { onConflict: `${SEEN_QUESTIONS_USER_COLUMN},question_id` }
    );

  if (error) {
    console.warn(
      `[seenQuestions] Failed writing table=${SEEN_QUESTIONS_TABLE} user_id=${userId} question_id=${questionId}. Keeping local cache updated.`,
      error
    );
  }

  const cachedSeenQuestionIds = seenQuestionIdsCache.get(userId) ?? Promise.resolve(new Set<string>());
  seenQuestionIdsCache.set(
    userId,
    cachedSeenQuestionIds.then((ids) => {
      const nextIds = new Set(ids);
      nextIds.add(questionId);
      console.info(
        `[seenQuestions] Updated local seen cache table=${SEEN_QUESTIONS_TABLE} user_id=${userId} count=${nextIds.size}`
      );
      return nextIds;
    })
  );
}
