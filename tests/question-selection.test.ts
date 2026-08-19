import test from 'node:test';
import assert from 'node:assert/strict';

import { selectUnseenQuestions } from '../src/services/questionRepository.ts';
import type { TriviaQuestion } from '../src/types.ts';

function question(id: string): TriviaQuestion {
  return {
    id,
    category: 'Science',
    difficulty: 'medium',
    question: `Question ${id}`,
    choices: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: 'Because science.',
    tags: [],
    status: 'approved',
    presentation: {},
    sourceType: 'manual',
  };
}

test('question selection never falls back to a seen question when the unseen pool is short', () => {
  const selected = selectUnseenQuestions(
    [question('already-seen'), question('fresh')],
    new Set(['already-seen']),
    3,
    'Science',
    'player-a,player-b'
  );

  assert.deepEqual(selected.map((entry) => entry.id), ['fresh']);
});

test('question selection returns only unseen questions for every player in the session', () => {
  const selected = selectUnseenQuestions(
    [question('seen-by-player-a'), question('seen-by-player-b'), question('fresh')],
    new Set(['seen-by-player-a', 'seen-by-player-b']),
    2,
    'Science',
    'player-a,player-b'
  );

  assert.deepEqual(selected.map((entry) => entry.id), ['fresh']);
});
