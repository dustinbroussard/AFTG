import { useState, useCallback, useEffect, useRef } from 'react';
import { GameState, Player, ChatMessage, GameInvite, PlayerProfile, RecentPlayer, RecentCompletedGame, LoadStatus } from '../types';
import { 
  subscribeToGame as subscribeToGameService, 
  subscribeToMessages as subscribeToMessagesService,
  getGameById,
  updateGame as updateGameService,
  mapPostgresGameToState
} from '../services/gameService';
import { subscribeToIncomingInvites } from '../services/inviteService';
import { 
  subscribePlayerProfile, 
  subscribeRecentPlayers, 
  subscribeRecentCompletedGames 
} from '../services/playerProfiles';

export function useGameStore(user: any | null) {
  const [game, setGame] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [recentPlayers, setRecentPlayers] = useState<RecentPlayer[]>([]);
  const [recentCompletedGames, setRecentCompletedGames] = useState<RecentCompletedGame[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<GameInvite[]>([]);
  const [hasResolvedProfile, setHasResolvedProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [recentPlayersStatus, setRecentPlayersStatus] = useState<LoadStatus>('loading');
  const [recentPlayersError, setRecentPlayersError] = useState<string | null>(null);
  const [recentGamesStatus, setRecentGamesStatus] = useState<LoadStatus>('loading');
  const [recentGamesError, setRecentGamesError] = useState<string | null>(null);
  const [invitesStatus, setInvitesStatus] = useState<LoadStatus>('loading');
  const [invitesError, setInvitesError] = useState<string | null>(null);

  // Subscriptions
  useEffect(() => {
    if (!game?.id) {
      setPlayers([]);
      setMessages([]);
      return;
    }

    const unsubscribeGame = subscribeToGameService(game.id, (updatedGame) => {
      setGame(updatedGame);
      setPlayers(updatedGame.players || []);
    });

    const unsubscribeMessages = subscribeToMessagesService(game.id, (msgs) => {
      setMessages(msgs);
    });

    return () => {
      unsubscribeGame();
      unsubscribeMessages();
    };
  }, [game?.id]);

  useEffect(() => {
    if (!user?.id) {
      setPlayerProfile(null);
      setRecentPlayers([]);
      setRecentCompletedGames([]);
      setIncomingInvites([]);
      setHasResolvedProfile(true);
      setProfileError(null);
      setRecentPlayersStatus('empty');
      setRecentPlayersError(null);
      setRecentGamesStatus('empty');
      setRecentGamesError(null);
      setInvitesStatus('empty');
      setInvitesError(null);
      return;
    }

    setHasResolvedProfile(false);
    setProfileError(null);
    setRecentPlayersStatus('loading');
    setRecentPlayersError(null);
    setRecentGamesStatus('loading');
    setRecentGamesError(null);
    setInvitesStatus('loading');
    setInvitesError(null);
    const unsubscribeProfile = subscribePlayerProfile(user.id, (profile) => {
      setPlayerProfile(profile);
      setHasResolvedProfile(true);
      setProfileError(null);
    }, (error) => {
      console.error(error);
      setProfileError('Failed to load your profile.');
      setHasResolvedProfile(true); // Treat as resolved even if error occurred, to avoid blocked state
    });
    const unsubscribeRecentPlayers = subscribeRecentPlayers(user.id, (players) => {
      setRecentPlayers(players);
      setRecentPlayersStatus(players.length === 0 ? 'empty' : 'success');
      setRecentPlayersError(null);
    }, (error) => {
      console.error(error);
      setRecentPlayersStatus('error');
      setRecentPlayersError('Failed to load recent players.');
    });
    const unsubscribeRecentGames = subscribeRecentCompletedGames(user.id, (games) => {
      setRecentCompletedGames(games);
      setRecentGamesStatus(games.length === 0 ? 'empty' : 'success');
      setRecentGamesError(null);
    }, (error) => {
      console.error(error);
      setRecentGamesStatus('error');
      setRecentGamesError('Failed to load recent games.');
    });
    const unsubscribeInvites = subscribeToIncomingInvites(user.id, (invites) => {
      setIncomingInvites(invites);
      setInvitesStatus(invites.length === 0 ? 'empty' : 'success');
      setInvitesError(null);
    }, (error) => {
      console.error(error);
      setInvitesStatus('error');
      setInvitesError('Failed to load invites.');
    });

    return () => {
      unsubscribeProfile();
      unsubscribeRecentPlayers();
      unsubscribeRecentGames();
      unsubscribeInvites();
    };
  }, [user?.id]);

  return {
    game,
    setGame,
    players,
    setPlayers,
    messages,
    setMessages,
    playerProfile,
    setPlayerProfile,
    recentPlayers,
    recentCompletedGames,
    incomingInvites,
    hasResolvedProfile,
    profileError,
    recentPlayersStatus,
    recentPlayersError,
    recentGamesStatus,
    recentGamesError,
    invitesStatus,
    invitesError,
  };
}
