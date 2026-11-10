type UserAuth = {
  conciergeInfo?: { enabled?: unknown; showOn?: unknown } | null;
  configuration?: { constants?: { ENABLE_CONCIERGE?: unknown } | null } | null;
};

/**
 * MI's own Concierge switch from `window.globalSettings.userAuth`. Newer cores expose `conciergeInfo`
 * (admins see it whenever it is enabled; everyone else needs `showOn`); older ones only
 * `configuration.constants.ENABLE_CONCIERGE`. When neither says no, the get-tools probe decides.
 */
export function isConciergeAllowed(isAdmin: boolean): boolean {
  const userAuth =
    typeof window === 'undefined'
      ? undefined
      : (window as unknown as { globalSettings?: { userAuth?: UserAuth | null } }).globalSettings?.userAuth;
  if (!userAuth) return true;

  const info = userAuth.conciergeInfo;
  if (info) {
    if (!info.enabled) return false;
    if (isAdmin) return true;

    return Boolean(info.showOn);
  }

  return userAuth.configuration?.constants?.ENABLE_CONCIERGE !== false;
}
