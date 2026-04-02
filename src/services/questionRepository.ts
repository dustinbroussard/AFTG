import { supabase } from '../lib/supabase';
import { TriviaQuestion, getPlayableCategories, isPlayableCategory } from '../types';

interface GetQuestionsForSessionParams {
  categories: string[];
  count: number;
  excludeQuestionIds?: string[];
  userId?: string;
  userIds?: string[];
}

const SEEN_QUESTIONS_TABLE = 'user_seen_questions';
const SEEN_QUESTIONS_USER_COLUMN = 'user_id';
const MIN_FETCH_CANDIDATES = 40;
const MAX_FETCH_CANDIDATES = 180;
const RANDOM_FETCH_WINDOWS = 3;

const seenQuestionIdsCache = new Map<string, Promise<Set<string>>>();

function normalizeRequestedCategory(category: string) {
  return isPlayableCategory(category) ? category : getPlayableCategories()[0];
}

function normalizePresentation(question: any): TriviaQuestion['presentation'] {
  const nestedPresentation = question.presentation && typeof question.presentation === 'object'
    ? question.presentation
    : {};
  const stylingPresentation = question.styling && typeof question.styling === 'object'
    ? question.styling
    : {};
  const wrongAnswerQuips = [
    ...(Array.isArray(nestedPresentation.wrongAnswerQuips) ? nestedPresentation.wrongAnswerQuips : []),
    ...(Array.isArray(stylingPresentation.wrongAnswerQuips) ? stylingPresentation.wrongAnswerQuips : []),
    ...(Array.isArray(question.wrongAnswerQuips) ? question.wrongAnswerQuips : []),
    ...(Array.isArray(question.wrong_answer_quips) ? question.wrong_answer_quips : []),
  ]
    .map((entry) => String(entry).trim())
    .filter(Boolean);

  return {
    questionStyled:
      nestedPresentation.questionStyled
      ?? stylingPresentation.questionStyled
      ?? question.questionStyled
      ?? question.question_styled
      ?? undefined,
    explanationStyled:
      nestedPresentation.explanationStyled
      ?? stylingPresentation.explanationStyled
      ?? question.explanationStyled
      ?? question.explanation_styled
      ?? undefined,
    hostLeadIn:
      nestedPresentation.hostLeadIn
      ?? stylingPresentation.hostLeadIn
      ?? question.hostLeadIn
      ?? question.host_lead_in
      ?? undefined,
    ...(wrongAnswerQuips.length > 0 ? { wrongAnswerQuips } : {}),
  };
}

export function mapQuestionRowToTriviaQuestion(question: any, createdAt = Date.now()): TriviaQuestion {
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
  const normalizedPresentation = normalizePresentation(question);

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

function shuffleQuestions<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function buildRandomOffsets(totalCount: number, windowSize: number) {
  const maxOffset = Math.max(0, totalCount - windowSize);
  const offsets = new Set<number>([0]);

  if (maxOffset <= 0) {
    return [0];
  }

  offsets.add(maxOffset);

  while (offsets.size < Math.min(RANDOM_FETCH_WINDOWS, totalCount)) {
    offsets.add(Math.floor(Math.random() * (maxOffset + 1)));
  }

  return shuffleQuestions([...offsets]);
}

async function fetchApprovedQuestionCount(category: string) {
  const { count, error } = await supabase
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('category', category)
    .eq('validation_status', 'approved');

  if (error) {
    console.error('Error counting questions from Supabase:', error);
    return null;
  }

  return count ?? 0;
}

async function fetchApprovedQuestionWindow(category: string, from: number, to: number) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('category', category)
    .eq('validation_status', 'approved')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('Error fetching questions from Supabase:', error);
    return [];
  }

  return data || [];
}

async function fetchApprovedQuestionsByCategory(category: string, excludeIds: Set<string>, count: number) {
  const requestedCandidateCount = Math.min(
    MAX_FETCH_CANDIDATES,
    Math.max(MIN_FETCH_CANDIDATES, count * 12)
  );

  const totalCount = await fetchApprovedQuestionCount(category);
  const fallbackRows = totalCount === null
    ? await fetchApprovedQuestionWindow(category, 0, requestedCandidateCount - 1)
    : [];

  const sourceRows = totalCount === null
    ? fallbackRows
    : await (async () => {
        if (totalCount === 0) return [];

        const windowSize = Math.min(totalCount, requestedCandidateCount);
        const offsets = buildRandomOffsets(totalCount, windowSize);
        const windows = await Promise.all(
          offsets.map((offset) => fetchApprovedQuestionWindow(category, offset, offset + windowSize - 1))
        );

        return windows.flat();
      })();

  return shuffleQuestions(
    dedupeById(
      sourceRows
        .map((entry) => mapQuestionRowToTriviaQuestion(entry))
        .filter((question) => question.choices.length === 4)
        .filter((question) => !excludeIds.has(question.id))
    )
  );
}

async function loadSeenQuestionIdsForUser(userId: string): Promise<Set<string>> {
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

async function loadSeenQuestionIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set<string>();

  const seenSets = await Promise.all(userIds.map((userId) => loadSeenQuestionIdsForUser(userId)));
  const merged = new Set<string>();

  seenSets.forEach((seenIds) => {
    seenIds.forEach((questionId) => merged.add(questionId));
  });

  return merged;
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
  userIds,
}: GetQuestionsForSessionParams): Promise<TriviaQuestion[]> {
  const uniqueCategories = [...new Set(categories.map(normalizeRequestedCategory))];
  const excludeIds = new Set(excludeQuestionIds);
  const normalizedUserIds = [...new Set((userIds ?? [userId]).filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))];
  const seenQuestionIds = await loadSeenQuestionIds(normalizedUserIds);
  const selected: TriviaQuestion[] = [];

  for (const category of uniqueCategories) {
    const approved = preferUnseenQuestions(
      await fetchApprovedQuestionsByCategory(category, excludeIds, count),
      seenQuestionIds,
      count,
      category,
      normalizedUserIds.join(',')
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
