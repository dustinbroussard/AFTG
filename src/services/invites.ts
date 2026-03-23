import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { GameInvite, RecentPlayer } from '../types';

export async function sendInvite(
  fromUser: { uid: string; displayName: string; photoURL?: string },
  toUser: { uid: string },
  gameId: string
) {
  const inviteRef = doc(collection(db, 'users', toUser.uid, 'invites'));
  const invite: Omit<GameInvite, 'id'> = {
    fromUid: fromUser.uid,
    fromDisplayName: fromUser.displayName,
    fromPhotoURL: fromUser.photoURL,
    toUid: toUser.uid,
    gameId,
    status: 'pending',
    createdAt: Date.now(),
  };

  await setDoc(inviteRef, invite);
  return inviteRef.id;
}

export async function acceptInvite(inviteId: string, uid: string) {
  await updateDoc(doc(db, 'users', uid, 'invites', inviteId), {
    status: 'accepted',
  });
}

export async function declineInvite(inviteId: string, uid: string) {
  await updateDoc(doc(db, 'users', uid, 'invites', inviteId), {
    status: 'declined',
  });
}

export async function expireInvite(inviteId: string, uid: string) {
  await updateDoc(doc(db, 'users', uid, 'invites', inviteId), {
    status: 'expired',
  });
}

export function subscribeToIncomingInvites(
  uid: string,
  callback: (invites: GameInvite[]) => void,
  onError?: (error: unknown) => void
) {
  const invitesRef = collection(db, 'users', uid, 'invites');
  const invitesQuery = query(
    invitesRef,
    orderBy('createdAt', 'desc'),
    limit(10)
  );

  return onSnapshot(
    invitesQuery,
    (snapshot) => {
      callback(
        snapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() } as GameInvite))
          .filter((invite) => invite.status === 'pending')
      );
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function loadRecentPlayers(uid: string) {
  const recentPlayersRef = collection(db, 'users', uid, 'recentPlayers');
  const recentPlayersQuery = query(
    recentPlayersRef,
    orderBy('lastPlayedAt', 'desc'),
    limit(8)
  );

  const snapshot = await getDocs(recentPlayersQuery);
  return snapshot.docs.map((entry) => ({ ...entry.data(), uid: entry.id } as RecentPlayer));
}
