/**
 * Temporary migration utility.
 *
 * This script is intentionally shipped as an example because the app package
 * has already been trimmed away from Firebase runtime dependencies.
 *
 * To run it in a one-off migration workspace:
 *   npm i firebase-admin @supabase/supabase-js
 *   export SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   export GOOGLE_APPLICATION_CREDENTIALS=...
 *   node scripts/migrate-firestore-to-supabase.example.mjs
 */

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ai-studio-applet-webapp-a549d';
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-5d62c22c-0318-44b3-a976-ecfe921b8e12';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value).toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value?._seconds) return new Date((value._seconds * 1000) + Math.round((value._nanoseconds || 0) / 1_000_000)).toISOString();
  return new Date(value).toISOString();
}

function mapQuestion(doc) {
  const choices = Array.isArray(doc.choices) ? doc.choices : [];
  const correctIndex = Number.isInteger(doc.correctIndex) ? doc.correctIndex : 0;
  const correctAnswer = choices[correctIndex] ?? '';
  const distractors = choices.filter((_, index) => index !== correctIndex);

  return {
    legacy_firestore_id: doc.id,
    content: doc.question,
    correct_answer: correctAnswer,
    distractors,
    category: doc.category,
    difficulty_level: doc.difficulty || 'medium',
    explanation: doc.explanation || '',
    question_styled: doc.questionStyled || null,
    explanation_styled: doc.explanationStyled || null,
    host_lead_in: doc.hostLeadIn || null,
    validation_status: doc.validationStatus || 'pending',
    verification_verdict: doc.verificationVerdict || null,
    verification_confidence: doc.verificationConfidence || null,
    verification_issues: doc.verificationIssues || [],
    verification_reason: doc.verificationReason || null,
    pipeline_version: doc.pipelineVersion ? String(doc.pipelineVersion) : null,
    source: doc.source || null,
    batch_id: doc.batchId || null,
    used_count: doc.usedCount || 0,
    created_at: toIso(doc.createdAt) || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function mapProfile(firebaseUid, userRecord, profileDoc) {
  const stats = profileDoc?.stats || {};
  return {
    firebase_uid: firebaseUid,
    display_name: userRecord.displayName || profileDoc?.displayName || 'Player',
    photo_url: userRecord.photoURL || profileDoc?.photoURL || null,
    completed_games: stats.completedGames || 0,
    wins: stats.wins || 0,
    losses: stats.losses || 0,
    total_questions_seen: stats.totalQuestionsSeen || 0,
    total_questions_correct: stats.totalQuestionsCorrect || 0,
    category_performance: stats.categoryPerformance || {},
    created_at: toIso(profileDoc?.createdAt) || new Date().toISOString(),
    updated_at: toIso(profileDoc?.updatedAt) || new Date().toISOString(),
    last_seen_at: toIso(profileDoc?.lastSeenAt) || new Date().toISOString(),
  };
}

async function ensureFirebase() {
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
        projectId: FIREBASE_PROJECT_ID,
      });
    } else {
      initializeApp({
        credential: applicationDefault(),
        projectId: FIREBASE_PROJECT_ID,
      });
    }
  }

  return {
    auth: getAuth(),
    db: getFirestore(undefined, FIRESTORE_DATABASE_ID),
  };
}

async function ensureSupabaseUser(supabase, userRecord, profileDoc) {
  const email = userRecord.email || profileDoc?.email || null;
  const provider = userRecord.providerData?.[0]?.providerId || null;
  const requiresPasswordReset = provider === 'password';

  if (!email) {
    throw new Error(`Cannot migrate Firebase user ${userRecord.uid}: no email address.`);
  }

  const { data: authUser, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      legacy_firebase_uid: userRecord.uid,
      display_name: userRecord.displayName || profileDoc?.displayName || 'Player',
    },
    password: requiresPasswordReset ? crypto.randomUUID() : undefined,
  });

  if (error && !/already been registered/i.test(error.message)) {
    throw error;
  }

  let profileId = authUser?.user?.id;

  if (!profileId) {
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;
    profileId = existingUsers.users.find((entry) => entry.email?.toLowerCase() === email.toLowerCase())?.id;
  }

  if (!profileId) {
    throw new Error(`Unable to resolve Supabase auth user for Firebase user ${userRecord.uid}.`);
  }

  const profile = {
    id: profileId,
    ...mapProfile(userRecord.uid, userRecord, profileDoc),
  };

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert(profile, { onConflict: 'id' });
  if (profileError) throw profileError;

  const { error: identityError } = await supabase
    .from('auth_identity_migrations')
    .upsert({
      firebase_uid: userRecord.uid,
      profile_id: profileId,
      email,
      provider,
      requires_password_reset: requiresPasswordReset,
      migrated_at: new Date().toISOString(),
    }, { onConflict: 'firebase_uid' });
  if (identityError) throw identityError;

  if (profileDoc?.private?.settings) {
    const { error: settingsError } = await supabase
      .from('user_settings')
      .upsert({
        profile_id: profileId,
        theme_mode: profileDoc.private.settings.themeMode || 'dark',
        sound_enabled: profileDoc.private.settings.soundEnabled ?? true,
        music_enabled: profileDoc.private.settings.musicEnabled ?? true,
        sfx_enabled: profileDoc.private.settings.sfxEnabled ?? true,
        commentary_enabled: profileDoc.private.settings.commentaryEnabled ?? true,
        updated_at: toIso(profileDoc.private.settings.updatedAt) || new Date().toISOString(),
      }, { onConflict: 'profile_id' });
    if (settingsError) throw settingsError;
  }

  return profileId;
}

async function migrateUsers(db, auth, supabase) {
  const userDocs = await db.collection('users').get();
  const userDocMap = new Map(userDocs.docs.map((entry) => [entry.id, entry.data()]));
  const firebaseUsers = await listAllFirebaseUsers(auth);
  const userIds = [...new Set([...userDocMap.keys(), ...firebaseUsers.map((user) => user.uid)])];
  const profileMap = new Map();
  const authUserMap = new Map(firebaseUsers.map((user) => [user.uid, user]));

  for (const uid of userIds) {
    const userRecord = authUserMap.get(uid);
    if (!userRecord) continue;

    const profileDoc = userDocMap.get(uid) || {};
    profileDoc.private = {
      settings: (await db.doc(`users/${uid}/private/settings`).get()).data() || null,
    };

    const profileId = await ensureSupabaseUser(supabase, userRecord, profileDoc);
    profileMap.set(uid, profileId);
  }

  return profileMap;
}

async function migrateQuestions(db, supabase) {
  const snapshot = await db.collection('questions').get();
  const payload = snapshot.docs.map((entry) => mapQuestion({ id: entry.id, ...entry.data() }));
  const { error } = await supabase.from('questions').upsert(payload, { onConflict: 'legacy_firestore_id' });
  if (error) throw error;
}

async function loadQuestionIdMap(supabase) {
  const { data, error } = await supabase.from('questions').select('id, legacy_firestore_id');
  if (error) throw error;
  return new Map((data || []).map((entry) => [entry.legacy_firestore_id, entry.id]));
}

async function loadGameIdMap(supabase) {
  const { data, error } = await supabase.from('games').select('id, legacy_firestore_id');
  if (error) throw error;
  return new Map((data || []).map((entry) => [entry.legacy_firestore_id, entry.id]));
}

async function listAllFirebaseUsers(auth) {
  const users = [];
  let nextPageToken;

  do {
    const page = await auth.listUsers(1000, nextPageToken);
    users.push(...page.users);
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  return users;
}

async function migrateGames(db, supabase, profileMap, questionIdMap) {
  const gamesSnapshot = await db.collection('games').get();

  for (const gameDoc of gamesSnapshot.docs) {
    const game = gameDoc.data();
    const hostProfileId = profileMap.get(game.hostId);
    const currentTurnProfileId = profileMap.get(game.currentTurn);
    const winnerProfileId = profileMap.get(game.winnerId);

    const { data: insertedGame, error: gameError } = await supabase
      .from('games')
      .upsert({
        legacy_firestore_id: gameDoc.id,
        join_code: game.code,
        status: game.status || 'waiting',
        host_profile_id: hostProfileId,
        current_turn_profile_id: currentTurnProfileId || null,
        winner_profile_id: winnerProfileId || null,
        current_question_category: game.currentQuestionCategory || null,
        current_question_index: game.currentQuestionIndex ?? null,
        current_question_started_at: toIso(game.currentQuestionStartedAt),
        completed_at: toIso(game.completedAt),
        categories_used: game.categoriesUsed || [],
        final_scores: game.finalScores || {},
        stats_recorded_at: toIso(game.statsRecordedAt),
        created_at: toIso(game.createdAt) || new Date().toISOString(),
        last_updated_at: toIso(game.lastUpdated) || new Date().toISOString(),
      }, { onConflict: 'legacy_firestore_id' })
      .select('id')
      .single();
    if (gameError) throw gameError;

    const gameId = insertedGame.id;

    const [playersSnapshot, questionsSnapshot, messagesSnapshot] = await Promise.all([
      db.collection(`games/${gameDoc.id}/players`).get(),
      db.collection(`games/${gameDoc.id}/questions`).get(),
      db.collection(`games/${gameDoc.id}/messages`).get(),
    ]);

    const playerRows = playersSnapshot.docs
      .map((entry) => {
        const player = entry.data();
        const profileId = profileMap.get(entry.id);
        if (!profileId) return null;

        return {
          game_id: gameId,
          profile_id: profileId,
          display_name_snapshot: player.name || 'Player',
          avatar_url_snapshot: player.avatarUrl || null,
          score: player.score || 0,
          streak: player.streak || 0,
          completed_categories: player.completedCategories || [],
          last_active_at: toIso(player.lastActive),
          last_resumed_at: toIso(player.lastResumedAt),
        };
      })
      .filter(Boolean);

    if (playerRows.length > 0) {
      const { error: playersError } = await supabase
        .from('game_players')
        .upsert(playerRows, { onConflict: 'game_id,profile_id' });
      if (playersError) throw playersError;
    }

    const questionRows = questionsSnapshot.docs.map((entry, ordinal) => {
      const question = entry.data();
      return {
        legacy_firestore_id: entry.id,
        game_id: gameId,
        question_id: questionIdMap.get(question.questionId || question.id) || null,
        ordinal,
        category: question.category,
        difficulty_level: question.difficulty || 'medium',
        content: question.question,
        choices: question.choices || [],
        correct_index: question.correctIndex || 0,
        explanation: question.explanation || '',
        question_styled: question.questionStyled || null,
        explanation_styled: question.explanationStyled || null,
        host_lead_in: question.hostLeadIn || null,
        used: Boolean(question.used),
        created_at: toIso(question.createdAt) || new Date().toISOString(),
      };
    });

    let insertedGameQuestions = [];
    if (questionRows.length > 0) {
      const { data, error: gameQuestionsError } = await supabase
        .from('game_questions')
        .upsert(questionRows, { onConflict: 'game_id,ordinal' })
        .select('id, legacy_firestore_id');
      if (gameQuestionsError) throw gameQuestionsError;
      insertedGameQuestions = data || [];
    }

    const gameQuestionIdMap = new Map(insertedGameQuestions.map((entry) => [entry.legacy_firestore_id, entry.id]));

    const answerRows = [];
    for (const [questionId, answers] of Object.entries(game.answers || {})) {
      for (const [firebaseUid, answer] of Object.entries(answers || {})) {
        const profileId = profileMap.get(firebaseUid);
        const gameQuestionId = gameQuestionIdMap.get(questionId);
        if (!profileId || !gameQuestionId) continue;

        answerRows.push({
          game_question_id: gameQuestionId,
          profile_id: profileId,
          answer_index: answer.answerIndex ?? -1,
          submitted_at: toIso(answer.submittedAt) || new Date().toISOString(),
          is_correct: Boolean(answer.isCorrect),
          source: answer.source || 'answer',
        });
      }
    }

    if (answerRows.length > 0) {
      const { error: answersError } = await supabase
        .from('game_answers')
        .upsert(answerRows, { onConflict: 'game_question_id,profile_id' });
      if (answersError) throw answersError;
    }

    const messageRows = messagesSnapshot.docs.map((entry) => {
      const message = entry.data();
      return {
        id: crypto.randomUUID(),
        game_id: gameId,
        profile_id: profileMap.get(message.uid) || null,
        display_name_snapshot: message.name || 'Player',
        avatar_url_snapshot: message.avatarUrl || null,
        body: message.text || '',
        created_at: toIso(message.timestamp) || new Date().toISOString(),
      };
    });

    if (messageRows.length > 0) {
      const { error: messagesError } = await supabase.from('game_messages').insert(messageRows);
      if (messagesError) throw messagesError;
    }
  }
}

async function migrateRecentPlayersAndInvites(db, supabase, profileMap, gameIdMap) {
  for (const [firebaseUid, profileId] of profileMap.entries()) {
    const [recentPlayersSnapshot, invitesSnapshot, seenQuestionsSnapshot] = await Promise.all([
      db.collection(`users/${firebaseUid}/recentPlayers`).get(),
      db.collection(`users/${firebaseUid}/invites`).get(),
      db.collection(`users/${firebaseUid}/seenQuestions`).get(),
    ]);

    const recentRows = recentPlayersSnapshot.docs.map((entry) => ({
      owner_profile_id: profileId,
      opponent_profile_id: profileMap.get(entry.id),
      last_played_at: toIso(entry.data().lastPlayedAt) || new Date().toISOString(),
      last_game_id: gameIdMap.get(entry.data().lastGameId) || null,
      hidden: Boolean(entry.data().hidden),
      updated_at: toIso(entry.data().updatedAt) || new Date().toISOString(),
    })).filter((row) => row.opponent_profile_id);

    if (recentRows.length > 0) {
      const { error } = await supabase
        .from('recent_player_edges')
        .upsert(recentRows, { onConflict: 'owner_profile_id,opponent_profile_id' });
      if (error) throw error;
    }

    const inviteRows = invitesSnapshot.docs.map((entry) => ({
      id: crypto.randomUUID(),
      from_profile_id: profileMap.get(entry.data().fromUid),
      to_profile_id: profileId,
      game_id: gameIdMap.get(entry.data().gameId),
      status: entry.data().status || 'pending',
      created_at: toIso(entry.data().createdAt) || new Date().toISOString(),
    })).filter((row) => row.from_profile_id && row.game_id);

    if (inviteRows.length > 0) {
      const { error } = await supabase.from('game_invites').insert(inviteRows);
      if (error) throw error;
    }

    const seenQuestionLegacyIds = seenQuestionsSnapshot.docs.map((entry) => entry.id);
    if (seenQuestionLegacyIds.length > 0) {
      const { data: questions, error: questionLookupError } = await supabase
        .from('questions')
        .select('id, legacy_firestore_id')
        .in('legacy_firestore_id', seenQuestionLegacyIds);
      if (questionLookupError) throw questionLookupError;

      const seenRows = (questions || []).map((entry) => ({
        profile_id: profileId,
        question_id: entry.id,
      }));

      if (seenRows.length > 0) {
        const { error } = await supabase
          .from('seen_questions')
          .upsert(seenRows, { onConflict: 'profile_id,question_id' });
        if (error) throw error;
      }
    }
  }
}

async function main() {
  const { auth, db } = await ensureFirebase();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const profileMap = await migrateUsers(db, auth, supabase);
  await migrateQuestions(db, supabase);
  const questionIdMap = await loadQuestionIdMap(supabase);
  await migrateGames(db, supabase, profileMap, questionIdMap);
  const gameIdMap = await loadGameIdMap(supabase);
  await migrateRecentPlayersAndInvites(db, supabase, profileMap, gameIdMap);

  console.log(JSON.stringify({
    migratedUsers: profileMap.size,
    migratedQuestions: questionIdMap.size,
  }, null, 2));
}

main().catch((error) => {
  console.error('[migrate-firestore-to-supabase] Failed:', error);
  process.exitCode = 1;
});
