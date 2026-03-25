import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { TriviaQuestion, getPlayableCategories, isPlayableCategory } from '../types';
import { omitUndefinedFields } from './firestoreData';
import { generateQuestions, getQuestionGenerationStatus } from './gemini';
import { QUESTION_COLLECTION, SEEN_QUESTIONS_COLLECTION } from './questionCollections';
import { validateGeneratedQuestions } from './questionValidation';
import { isQuestionApprovedForStorage } from './questionVerification';

interface GetQuestionsForSessionParams {
  categories: string[];
  count: number;
  excludeQuestionIds?: string[];
  userId?: string;
}

const generationLocks = new Map<string, Promise<TriviaQuestion[]>>();

function normalizeRequestedCategory(category: string) {
  return isPlayableCategory(category) ? category : getPlayableCategories()[0];
}

function toBankQuestion(question: TriviaQuestion, createdAt = Date.now()): TriviaQuestion {
  const canonicalId = question.questionId || question.id;
  const explanation = question.explanation || question.correctQuip || '';

  return omitUndefinedFields({
    ...question,
    id: canonicalId,
    questionId: canonicalId,
    category: question.category,
    difficulty: question.difficulty || 'medium',
    correctIndex: Number.isInteger(question.correctIndex) ? question.correctIndex : question.answerIndex,
    answerIndex: question.answerIndex,
    explanation,
    validationStatus: question.validationStatus || 'pending',
    verificationVerdict: question.verificationVerdict,
    verificationConfidence: question.verificationConfidence,
    verificationIssues: question.verificationIssues || [],
    verificationReason: question.verificationReason,
    pipelineVersion: question.pipelineVersion,
    questionStyled: question.questionStyled,
    explanationStyled: question.explanationStyled,
    hostLeadIn: question.hostLeadIn,
    source: question.source,
    batchId: question.batchId,
    createdAt: question.createdAt || createdAt,
    usedCount: question.usedCount ?? 0,
    used: question.used ?? false,
  });
}

function dedupeById(questions: TriviaQuestion[]) {
  const seen = new Set<string>();

  return questions.filter((question) => {
    const id = question.questionId || question.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function fetchApprovedQuestionsByCategory(category: string, excludeIds: Set<string>, count: number) {
  const bankRef = collection(db, QUESTION_COLLECTION);
  const bankQuery = query(
    bankRef,
    where('category', '==', category),
    where('validationStatus', '==', 'approved'),
    orderBy('usedCount', 'asc'),
    orderBy('createdAt', 'asc'),
    limit(Math.max(count * 5, 20))
  );

  const snapshot = await getDocs(bankQuery);
  const approved = snapshot.docs
    .map((entry) => toBankQuestion({ ...entry.data(), id: entry.id } as TriviaQuestion))
    .filter((question) => !excludeIds.has(question.id));

  return approved;
}

async function loadSeenQuestionIds(userId?: string) {
  if (!userId) return new Set<string>();

  const snapshot = await getDocs(collection(db, 'users', userId, SEEN_QUESTIONS_COLLECTION));
  return new Set(snapshot.docs.map((entry) => entry.id));
}

function preferUnseenQuestions(questions: TriviaQuestion[], seenQuestionIds: Set<string>, count: number) {
  if (seenQuestionIds.size === 0) {
    return questions.slice(0, count);
  }

  const unseen = questions.filter((question) => !seenQuestionIds.has(question.id));
  if (unseen.length >= count) {
    return unseen.slice(0, count);
  }

  const seenFallback = questions.filter((question) => seenQuestionIds.has(question.id));
  return [...unseen, ...seenFallback].slice(0, count);
}

async function storeQuestionsInBank(questions: TriviaQuestion[]) {
  for (const question of questions) {
    const canonical = toBankQuestion(question);
    await setDoc(doc(db, QUESTION_COLLECTION, canonical.id), canonical, { merge: true });
  }
}

function logRejectedQuestions(rejected: Array<{ question: TriviaQuestion; reason: string }>) {
  if (!import.meta.env.DEV || rejected.length === 0) return;

  rejected.forEach(({ question, reason }) => {
    console.warn(`[questionValidation] Rejected "${question.question || question.id}": ${reason}`);
  });
}

function logStorageRejectedQuestions(rejected: TriviaQuestion[]) {
  if (!import.meta.env.DEV || rejected.length === 0) return;

  rejected.forEach((question) => {
    console.warn(
      `[questionVerification] Rejected "${question.question || question.id}": ${question.verificationReason || 'verification did not pass with high confidence'}`
    );
  });
}

function logInventory(message: string) {
  if (!import.meta.env.DEV) return;
  console.warn(`[questionInventory] ${message}`);
}

function getBucketKey(category: string, difficulty?: 'easy' | 'medium' | 'hard') {
  return `${category}::${difficulty || 'mixed'}`;
}

function formatBucket(category: string, difficulty?: 'easy' | 'medium' | 'hard') {
  return `${category}/${difficulty || 'mixed'}`;
}

/**
 * Runs the full generation pipeline for a bucket.
 * This should ideally be called from a maintenance task or background process.
 */
async function generateApprovedQuestionsForBucket({
  category,
  count,
  difficulty,
  existingQuestions = [],
}: {
  category: string;
  count: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  existingQuestions?: Array<Pick<TriviaQuestion, 'category' | 'question'>>;
}) {
  const bucketKey = getBucketKey(category, difficulty);
  const inFlight = generationLocks.get(bucketKey);

  if (inFlight) {
    logInventory(`generation skipped: bucket locked ${formatBucket(category, difficulty)}`);
    return inFlight;
  }

  const status = getQuestionGenerationStatus();
  if (!status.canAttemptAny) {
    logInventory(`generation skipped: AI cooldown active ${formatBucket(category, difficulty)}`);
    return [];
  }

  const generationPromise = (async () => {
    // Stage 1: Generation (handled by API handler)
    const generated = await generateQuestions([category], count, existingQuestions, difficulty);

    // Initial normalization
    const normalizedGenerated = generated
      .map((question) => toBankQuestion({ 
        ...question, 
        category, 
        ...(difficulty ? { difficulty } : {}),
        validationStatus: 'pending',
        source: 'gemini-2.0-flash',
      }))
      .filter((question) => question.category === category)
      .filter((question) => !difficulty || question.difficulty === difficulty);

    // Stage 2: Verification and Styling are now handled server-side in the API pipeline
    // This frontend call currently assumes the API returns styled, verified questions.
    // We will save them with 'approved' status if they pass verification checks.

    const { approved: structurallyValid, rejected } = validateGeneratedQuestions(normalizedGenerated);
    
    // Check verification status from the payload
    const approved = structurallyValid.filter(isQuestionApprovedForStorage);
    const verificationRejected = structurallyValid.filter((question) => !isQuestionApprovedForStorage(question));

    logRejectedQuestions(rejected);
    logStorageRejectedQuestions(verificationRejected);

    if (approved.length > 0) {
      // Save passing questions to the bank as 'approved'
      await storeQuestionsInBank(approved.map((question) => ({
        ...question,
        validationStatus: 'approved',
      })));

      logInventory(`Added ${approved.length} approved questions to ${formatBucket(category, difficulty)}`);
    } else if (!getQuestionGenerationStatus().canAttemptAny) {
      logInventory(getQuestionGenerationStatus().message || `generation failed: both providers unavailable`);
    }

    return approved;
  })();

  generationLocks.set(bucketKey, generationPromise);

  try {
    return await generationPromise;
  } finally {
    generationLocks.delete(bucketKey);
  }
}

async function fetchApprovedQuestionsByCategoryAndDifficulty(
  category: string,
  difficulty: 'easy' | 'medium' | 'hard'
) {
  const bankRef = collection(db, QUESTION_COLLECTION);
  const bankQuery = query(
    bankRef,
    where('category', '==', category),
    where('difficulty', '==', difficulty),
    where('validationStatus', '==', 'approved')
  );

  return getDocs(bankQuery);
}

/**
 * Checks inventory for a category/difficulty and replenishes if low.
 * This is non-blocking and safe for background execution.
 */
export async function ensureQuestionInventory({
  category,
  difficulty,
  minimumApproved,
  replenishBatchSize,
}: {
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  minimumApproved: number;
  replenishBatchSize: number;
}): Promise<void> {
  if (!isPlayableCategory(category)) return;

  const bucketKey = getBucketKey(category, difficulty);
  if (generationLocks.has(bucketKey)) {
    logInventory(`generation skipped: bucket locked ${formatBucket(category, difficulty)}`);
    return;
  }

  const snapshot = await fetchApprovedQuestionsByCategoryAndDifficulty(category, difficulty);
  if (snapshot.size >= minimumApproved) return;

  logInventory(`Low inventory ${formatBucket(category, difficulty)}: ${snapshot.size}/${minimumApproved}`);
  
  const status = getQuestionGenerationStatus();
  if (!status.canAttemptAny) {
    logInventory(`generation skipped: AI cooldown active ${formatBucket(category, difficulty)}`);
    return;
  }

  logInventory(`Replenishing ${formatBucket(category, difficulty)} with ${replenishBatchSize} questions`);
  // This is intentionally not awaited in a way that blocks game UI, 
  // but we call it here. In a true background setup, this might be triggered by a worker.
  generateApprovedQuestionsForBucket({
    category,
    count: replenishBatchSize,
    difficulty,
  }).catch(err => {
    console.error(`[questionInventory] Replenishment failed for ${formatBucket(category, difficulty)}:`, err);
  });
}

/**
 * Serves questions for a game session.
 * Strictly uses approved questions from the bank.
 */
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
      count
    );
    approved.forEach((question) => excludeIds.add(question.id));
    selected.push(...approved);
  }

  // Deduplicate and return. We NO LONGER generate JIT if questions are missing.
  // The UI should handle cases where fewer questions are returned if the bank is critically low.
  return dedupeById(selected);
}


export async function markQuestionSeen({
  userId,
  questionId,
  gameId,
}: {
  userId: string;
  questionId: string;
  gameId?: string;
}) {
  await setDoc(
    doc(db, 'users', userId, SEEN_QUESTIONS_COLLECTION, questionId),
    {
      questionId,
      seenAt: serverTimestamp(),
      ...(gameId ? { gameId } : {}),
    },
    { merge: true }
  );
}
