import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';
import {
  CategoryPerformance,
  MatchupSummary,
  Player,
  PlayerProfile,
  PlayerStatsSummary,
  RecentCompletedGame,
  RecentPlayer,
  TriviaQuestion,
} from '../types';
import { omitUndefinedFields } from './firestoreData';

const DEFAULT_STATS: PlayerStatsSummary = {
  completedGames: 0,
  wins: 0,
  losses: 0,
  winPercentage: 0,
  categoryPerformance: {},
};

const getDefaultCategoryPerformance = (): CategoryPerformance => ({
  seen: 0,
  correct: 0,
  percentageCorrect: 0,
});

export async function ensurePlayerProfile(user: User) {
  const profileRef = doc(db, 'users', user.uid);
  const existingProfile = await getDoc(profileRef);
  const now = serverTimestamp();

  if (!existingProfile.exists()) {
    const newProfile: PlayerProfile = {
      userId: user.uid,
      displayName: user.displayName || 'Player',
      photoURL: user.photoURL || undefined,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      stats: DEFAULT_STATS,
    };
    await setDoc(profileRef, omitUndefinedFields(newProfile));
    return;
  }

  await setDoc(profileRef, omitUndefinedFields({
    userId: user.uid,
    displayName: user.displayName || existingProfile.data().displayName || 'Player',
    photoURL: user.photoURL || existingProfile.data().photoURL || undefined,
    updatedAt: now,
    lastSeenAt: now,
  }), { merge: true });
}

export function subscribePlayerProfile(
  uid: string,
  callback: (profile: PlayerProfile | null) => void,
  onError?: (error: unknown) => void
) {
  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => {
      callback(snapshot.exists() ? ({ ...snapshot.data(), userId: snapshot.id } as PlayerProfile) : null);
    },
    onError
  );
}

export function subscribeRecentPlayers(
  uid: string,
  callback: (players: RecentPlayer[]) => void,
  onError?: (error: unknown) => void
) {
  const recentPlayersQuery = query(
    collection(db, 'users', uid, 'recentPlayers'),
    orderBy('lastPlayedAt', 'desc'),
    limit(12)
  );

  return onSnapshot(
    recentPlayersQuery,
    (snapshot) => {
      callback(
        snapshot.docs
          .map((entry) => ({ ...entry.data(), uid: entry.id } as RecentPlayer))
          .filter((player) => !player.hidden)
      );
    },
    onError
  );
}

export function subscribeRecentCompletedGames(
  uid: string,
  callback: (games: RecentCompletedGame[]) => void,
  onError?: (error: unknown) => void
) {
  const historyQuery = query(
    collection(db, 'users', uid, 'gameHistory'),
    orderBy('completedAt', 'desc'),
    limit(5)
  );

  return onSnapshot(
    historyQuery,
    (snapshot) => {
      callback(snapshot.docs.map((entry) => ({ ...entry.data(), gameId: entry.id } as RecentCompletedGame)));
    },
    onError
  );
}

export async function loadMatchupHistory(uid: string, opponentUid: string) {
  const matchupRef = doc(db, 'users', uid, 'matchups', opponentUid);
  const recentGamesQuery = query(
    collection(db, 'users', uid, 'matchups', opponentUid, 'games'),
    orderBy('completedAt', 'desc'),
    limit(5)
  );

  const [matchupSnapshot, recentGamesSnapshot] = await Promise.all([
    getDoc(matchupRef),
    getDocs(recentGamesQuery),
  ]);

  return {
    summary: matchupSnapshot.exists()
      ? ({ ...matchupSnapshot.data(), opponentId: matchupSnapshot.id } as MatchupSummary)
      : null,
    games: recentGamesSnapshot.docs.map((entry) => ({ ...entry.data(), gameId: entry.id } as RecentCompletedGame)),
  };
}

export async function removeRecentPlayer(uid: string, opponentUid: string) {
  await setDoc(
    doc(db, 'users', uid, 'recentPlayers', opponentUid),
    {
      hidden: true,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

function calculateWinPercentage(wins: number, completedGames: number) {
  if (completedGames === 0) return 0;
  return Math.round((wins / completedGames) * 100);
}

function mergeCategoryPerformance(
  existing: Record<string, CategoryPerformance>,
  category: string,
  isCorrect: boolean
) {
  const current = existing[category] || getDefaultCategoryPerformance();
  const seen = current.seen + 1;
  const correct = current.correct + (isCorrect ? 1 : 0);

  return {
    ...existing,
    [category]: {
      seen,
      correct,
      percentageCorrect: Math.round((correct / seen) * 100),
    },
  };
}

export async function recordCompletedGame({
  gameId,
  players,
  winnerId,
  finalScores,
  questions,
  status,
  completedAt,
}: {
  gameId: string;
  players: Player[];
  winnerId: string | null;
  finalScores: Record<string, number>;
  questions: TriviaQuestion[];
  status: 'completed';
  completedAt: number;
}) {
  const gameRef = doc(db, 'games', gameId);
  const categoriesUsed = Array.from(new Set(
    questions
      .filter((question) => question.used)
      .map((question) => question.category)
  ));
  const playerSummary = players.map((player) => ({
    uid: player.uid,
    displayName: player.name,
  }));

  await runTransaction(db, async (transaction) => {
    const gameSnapshot = await transaction.get(gameRef);
    if (!gameSnapshot.exists()) return;

    const gameData = gameSnapshot.data();
    if (gameData.statsRecordedAt) return;

    transaction.update(gameRef, {
      completedAt,
      finalScores,
      categoriesUsed,
      statsRecordedAt: completedAt,
      lastUpdated: serverTimestamp(),
    });

    for (const player of players) {
      const playerRef = doc(db, 'users', player.uid);
      const playerSnapshot = await transaction.get(playerRef);
      const playerProfile = playerSnapshot.exists()
        ? (playerSnapshot.data() as PlayerProfile)
        : {
            userId: player.uid,
            displayName: player.name,
            photoURL: player.avatarUrl,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastSeenAt: serverTimestamp(),
            stats: DEFAULT_STATS,
          };

      let nextStats: PlayerStatsSummary = {
        ...DEFAULT_STATS,
        ...playerProfile.stats,
        categoryPerformance: { ...(playerProfile.stats?.categoryPerformance || {}) },
      };
      nextStats.completedGames += 1;
      if (winnerId === player.uid) {
        nextStats.wins += 1;
      } else {
        nextStats.losses += 1;
      }

      for (const question of questions.filter((entry) => entry.used)) {
        const answer = gameData.answers?.[question.id]?.[player.uid];
        if (!answer) continue;
        nextStats.categoryPerformance = mergeCategoryPerformance(
          nextStats.categoryPerformance,
          question.category,
          !!answer.isCorrect
        );
      }

      nextStats.winPercentage = calculateWinPercentage(nextStats.wins, nextStats.completedGames);

      transaction.set(playerRef, omitUndefinedFields({
        userId: player.uid,
        displayName: player.name,
        photoURL: player.avatarUrl,
        createdAt: playerProfile.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        stats: nextStats,
      }), { merge: true });

      const userHistoryRef = doc(db, 'users', player.uid, 'gameHistory', gameId);
      const opponentIds = players.filter((entry) => entry.uid !== player.uid).map((entry) => entry.uid);
      const historyRecord: RecentCompletedGame = {
        gameId,
        players: playerSummary,
        winnerId,
        finalScores,
        categoriesUsed,
        completedAt,
        status,
        opponentIds,
      };
      transaction.set(userHistoryRef, historyRecord);

      for (const opponent of players.filter((entry) => entry.uid !== player.uid)) {
        const recentPlayerRef = doc(db, 'users', player.uid, 'recentPlayers', opponent.uid);
        transaction.set(recentPlayerRef, omitUndefinedFields({
          uid: opponent.uid,
          displayName: opponent.name,
          photoURL: opponent.avatarUrl,
          lastPlayedAt: completedAt,
          lastGameId: gameId,
          hidden: false,
          updatedAt: completedAt,
        }), { merge: true });

        const matchupRef = doc(db, 'users', player.uid, 'matchups', opponent.uid);
        const matchupSnapshot = await transaction.get(matchupRef);
        const currentMatchup = matchupSnapshot.exists()
          ? (matchupSnapshot.data() as MatchupSummary)
          : {
              opponentId: opponent.uid,
              opponentDisplayName: opponent.name,
              opponentPhotoURL: opponent.avatarUrl,
              wins: 0,
              losses: 0,
              totalGames: 0,
              lastPlayedAt: completedAt,
            };

        const didWin = winnerId === player.uid;
        const nextMatchup: MatchupSummary = {
          opponentId: opponent.uid,
          opponentDisplayName: opponent.name,
          opponentPhotoURL: opponent.avatarUrl,
          wins: currentMatchup.wins + (didWin ? 1 : 0),
          losses: currentMatchup.losses + (didWin ? 0 : 1),
          totalGames: currentMatchup.totalGames + 1,
          lastPlayedAt: completedAt,
        };
        transaction.set(matchupRef, nextMatchup, { merge: true });
        transaction.set(doc(db, 'users', player.uid, 'matchups', opponent.uid, 'games', gameId), historyRecord);
      }
    }
  });
}
