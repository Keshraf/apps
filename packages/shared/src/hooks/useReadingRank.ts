import { useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import request from 'graphql-request';
import { isThisISOWeek, isToday } from 'date-fns';
import { LoggedUser } from '../lib/user';
import AuthContext from '../contexts/AuthContext';
import { MY_READING_RANK_QUERY, MyRankData } from '../graphql/users';
import { apiUrl } from '../lib/config';
import usePersistentState from './usePersistentState';
import AlertContext, { MAX_DATE } from '../contexts/AlertContext';

export const getRankQueryKey = (user?: LoggedUser): string[] => [
  user?.id ?? 'anonymous',
  'rank',
];

type ReturnType = {
  isLoading: boolean;
  rank: number;
  rankLastWeek: number;
  nextRank: number;
  progress: number;
  levelUp: boolean;
  shouldShowRankModal: boolean;
  confirmLevelUp: (neverShowRankModal: boolean) => Promise<void>;
  reads: number;
};

const defaultRank: MyRankData = {
  rank: {
    progressThisWeek: 0,
    currentRank: 0,
    readToday: false,
    rankLastWeek: 0,
  },
  reads: 0,
};

const checkShouldShowRankModal = (
  rankLastSeen: Date,
  lastReadTime: Date,
  loadedAlerts: boolean,
  neverShowRankModal?: boolean,
) => {
  if (neverShowRankModal !== null && neverShowRankModal !== undefined) {
    return !neverShowRankModal;
  }

  if (loadedAlerts && !rankLastSeen) {
    return true;
  }

  if (!rankLastSeen) {
    return false;
  }

  return new Date(rankLastSeen) < new Date(lastReadTime);
};

export default function useReadingRank(): ReturnType {
  const { alerts, loadedAlerts, updateAlerts } = useContext(AlertContext);
  const { user, tokenRefreshed } = useContext(AuthContext);
  const [levelUp, setLevelUp] = useState(false);
  const queryClient = useQueryClient();

  const [cachedRank, setCachedRank, loadedCache] = usePersistentState<
    MyRankData & { userId: string; neverShowRankModal?: boolean }
  >('rank', null);
  const neverShowRankModal = cachedRank?.neverShowRankModal;
  const queryKey = getRankQueryKey(user);
  const { data: remoteRank } = useQuery<MyRankData>(
    queryKey,
    () =>
      request(`${apiUrl}/graphql`, MY_READING_RANK_QUERY, {
        id: user.id,
        timezone: user.timezone,
      }),
    {
      enabled: !!user && tokenRefreshed,
      refetchOnWindowFocus: false,
    },
  );

  const cacheRank = (
    rank: MyRankData = remoteRank,
    newNeverShowRankModal = neverShowRankModal,
  ) =>
    setCachedRank({
      rank: rank.rank,
      reads: rank.reads,
      userId: user?.id,
      neverShowRankModal: newNeverShowRankModal,
    });

  const shouldShowRankModal = checkShouldShowRankModal(
    alerts?.rankLastSeen,
    cachedRank?.rank?.lastReadTime || remoteRank?.rank?.lastReadTime,
    loadedAlerts,
    neverShowRankModal,
  );

  const updateShownProgress = async () => {
    if (document.visibilityState === 'hidden') {
      document.addEventListener(
        'visibilitychange',
        () => setTimeout(updateShownProgress, 1000),
        { once: true },
      );
    } else if (cachedRank?.rank.currentRank === remoteRank?.rank.currentRank) {
      await cacheRank();
    } else {
      setLevelUp(true);
    }
  };

  // Let the rank update and then show progress animation, slight delay so the user won't miss it
  const displayProgress = () => setTimeout(updateShownProgress, 300);

  useEffect(() => {
    if (remoteRank && loadedCache) {
      if (
        !cachedRank ||
        remoteRank.rank.progressThisWeek < cachedRank.rank.progressThisWeek
      ) {
        /* if there is no cache value or it is not the most updated let's set the cache */
        cacheRank();
      } else if (cachedRank && !cachedRank.rank.rankLastWeek) {
        /*
          else if the cache value has data but missing some properties rankLastWeek, let's re-set it
          with that, this can mean the user is on their first week, which should see the progress animation
        */
        cacheRank();
        displayProgress();
      } else {
        /* else - the cache has pre-existing value so we just need to check if we should display the progress */
        displayProgress();
      }
    }
  }, [remoteRank, loadedCache]);

  // For anonymous users
  useEffect(() => {
    if (loadedCache && tokenRefreshed) {
      if (cachedRank?.userId !== user?.id) {
        // Reset cache on user change
        if (remoteRank) {
          cacheRank();
        } else if (user) {
          setCachedRank(null);
        } else {
          cacheRank(defaultRank);
        }
      } else if (!user) {
        // Check anonymous progress
        let rank = cachedRank ?? defaultRank;
        if (rank.rank.lastReadTime) {
          if (!isThisISOWeek(rank.rank.lastReadTime)) {
            rank = defaultRank;
          } else if (rank.rank.readToday && !isToday(rank.rank.lastReadTime)) {
            rank.rank.readToday = false;
          }
        }
        queryClient.setQueryData<MyRankData>(queryKey, rank);
      }
    }
  }, [user, tokenRefreshed, loadedCache]);

  return {
    isLoading: !cachedRank,
    rankLastWeek: cachedRank?.rank.rankLastWeek,
    rank: cachedRank?.rank.currentRank,
    nextRank: remoteRank?.rank.currentRank,
    progress: cachedRank?.rank.progressThisWeek,
    reads: remoteRank?.reads,
    levelUp,
    shouldShowRankModal,
    confirmLevelUp: (newNeverShowRankModal) => {
      setLevelUp(false);
      if (user) {
        const lastSeen = newNeverShowRankModal ? MAX_DATE : new Date();
        updateAlerts({ rankLastSeen: lastSeen });
        return cacheRank(remoteRank);
      }
      // Limit anonymous users to rank zero
      const rank = queryClient.setQueryData<MyRankData>(
        queryKey,
        (currentRank) => ({
          rank: { ...currentRank.rank, currentRank: 0 },
          reads: currentRank?.reads,
        }),
      );
      return cacheRank(rank, newNeverShowRankModal);
    },
  };
}
