import { useContext, useMemo, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { request } from 'graphql-request';
import {
  AdvancedSettings,
  AllTagCategoriesData,
  FeedSettings,
  FEED_SETTINGS_QUERY,
  TagCategory,
  getEmptyFeedSettings,
} from '../graphql/feedSettings';
import { storageWrapper as storage } from '../lib/storageWrapper';
import AuthContext from '../contexts/AuthContext';
import { apiUrl } from '../lib/config';
import { generateQueryKey } from '../lib/query';
import { LoggedUser } from '../lib/user';

export const getFeedSettingsQueryKey = (user?: LoggedUser): string[] => [
  user?.id,
  'feedSettings',
];

export type FeedSettingsReturnType = {
  tagsCategories: TagCategory[];
  feedSettings: FeedSettings;
  isLoading: boolean;
  hasAnyFilter?: boolean;
  advancedSettings: AdvancedSettings[];
  setAvoidRefresh: (value: boolean) => void;
};

let avoidRefresh = false;

export const LOCAL_FEED_SETTINGS_KEY = 'feedSettings:local';

export const updateLocalFeedSettings = (feedSettings: FeedSettings): void => {
  storage.setItem(LOCAL_FEED_SETTINGS_KEY, JSON.stringify(feedSettings));
};

export const getLocalFeedSettings = (): FeedSettings => {
  const value = storage.getItem(LOCAL_FEED_SETTINGS_KEY);
  if (!value) {
    return getEmptyFeedSettings();
  }

  const localFeedSettings = JSON.parse(
    storage.getItem(LOCAL_FEED_SETTINGS_KEY),
  ) as FeedSettings;

  return localFeedSettings;
};

export default function useFeedSettings(): FeedSettingsReturnType {
  const { user, loadedUserFromCache } = useContext(AuthContext);
  const client = useQueryClient();
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const filtersKey = getFeedSettingsQueryKey(user);
  const queryClient = useQueryClient();
  const setAvoidRefresh = (value: boolean) => {
    avoidRefresh = value;
  };

  const {
    data = {},
    isLoading,
    isFetched,
  } = useQuery<AllTagCategoriesData>(filtersKey, async () => {
    const req = await request(`${apiUrl}/graphql`, FEED_SETTINGS_QUERY, {
      loggedIn: !!user?.id,
    });

    return { ...data, ...req };
  });

  const { tagsCategories, feedSettings, advancedSettings } = data;

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    if (avoidRefresh) {
      return;
    }
    if (isFirstLoad) {
      setIsFirstLoad(false);
      return;
    }

    setTimeout(() => {
      queryClient.invalidateQueries(generateQueryKey('popular', user));
      queryClient.invalidateQueries(generateQueryKey('recent', user));
    }, 100);
  }, [tagsCategories, feedSettings, avoidRefresh]);

  useEffect(() => {
    const haveNotFetched = Object.keys(data).length === 0;
    const isEmpty = typeof data.feedSettings === 'undefined';
    if (!isEmpty || !isFetched || !loadedUserFromCache || haveNotFetched) {
      return;
    }

    if (user) {
      storage.removeItem(LOCAL_FEED_SETTINGS_KEY);
      return;
    }

    const localFeedSettings = getLocalFeedSettings();
    const queryData =
      client.getQueryData<AllTagCategoriesData>(filtersKey) || {};
    const updatedFeedSettings = {
      ...queryData,
      feedSettings: { ...localFeedSettings },
    };
    client.setQueryData<AllTagCategoriesData>(filtersKey, updatedFeedSettings);
    updateLocalFeedSettings(updatedFeedSettings.feedSettings);
  }, [isFetched, loadedUserFromCache, user]);

  const hasAnyFilter =
    feedSettings?.includeTags?.length > 0 ||
    feedSettings?.blockedTags?.length > 0 ||
    feedSettings?.excludeSources?.length > 0 ||
    feedSettings?.advancedSettings?.length > 0;

  return useMemo(() => {
    return {
      tagsCategories,
      feedSettings,
      isLoading,
      advancedSettings,
      hasAnyFilter,
      setAvoidRefresh,
    };
  }, [
    tagsCategories,
    feedSettings,
    isLoading,
    advancedSettings,
    hasAnyFilter,
    setAvoidRefresh,
  ]);
}
