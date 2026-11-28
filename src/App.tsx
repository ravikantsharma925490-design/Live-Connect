import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { SplashScreen } from '@/src/components/ui/SplashScreen';
import { useAuth } from '@/src/hooks/useAuth';
import { usePresence } from '@/src/hooks/usePresence';
import { useConversations } from '@/src/hooks/useConversations';
import { useCall } from '@/src/hooks/useCall';
import { useCallHistory } from '@/src/hooks/useCallHistory';
import { useSocialRelations } from '@/src/hooks/useSocialRelations';
import { useNotifications } from '@/src/hooks/useNotifications';
import { useFamilies } from '@/src/hooks/useFamilies';
import { useOfficialChat, OFFICIAL_CHAT_ID } from '@/src/hooks/useOfficialChat';
import { AuthPage } from '@/src/components/auth/AuthPage';
import { BottomNav, TabType } from '@/src/components/navigation/BottomNav';
import { SidebarNav } from '@/src/components/navigation/SidebarNav';
import { MobileHeader } from '@/src/components/navigation/MobileHeader';
import { MessagesTab } from '@/src/components/tabs/MessagesTab';
import { SearchTab } from '@/src/components/tabs/SearchTab';
import { CallsTab } from '@/src/components/tabs/CallsTab';
import { ProfileTab } from '@/src/components/tabs/ProfileTab';
import { FamilyTab } from '@/src/components/family/FamilyTab';
import { JoinFamilyModal } from '@/src/components/family/JoinFamilyModal';
import { UserSearchModal } from '@/src/components/chat/UserSearchModal';
import { ForwardMessageModal } from '@/src/components/chat/ForwardMessageModal';
import { IncomingCallModal } from '@/src/components/calls/IncomingCallModal';
import { AudioCallScreen } from '@/src/components/calls/AudioCallScreen';
import { VideoCallScreen } from '@/src/components/calls/VideoCallScreen';
import { ProfileModal } from '@/src/components/profile/ProfileModal';
import { SettingsModal } from '@/src/components/settings/SettingsModal';
import { BlockedUsersModal } from '@/src/components/settings/BlockedUsersModal';
import { NotificationModal } from '@/src/components/notifications/NotificationModal';
import { LanguageSelectorModal } from '@/src/components/language/LanguageSelectorModal';
import { Toast } from '@/src/components/ui/Toast';
import { PushBanner } from '@/src/components/ui/PushBanner';
import { TermsConditions } from '@/src/components/legal/TermsConditions';
import { PrivacyPolicy } from '@/src/components/legal/PrivacyPolicy';
import { DeleteAccountPage } from '@/src/components/legal/DeleteAccountPage';
import { OnboardingScreen } from '@/src/components/auth/OnboardingScreen';
import { BannedScreen } from '@/src/components/auth/BannedScreen';
import { AccountStatusModal } from '@/src/components/moderation/AccountStatusModal';
import { AccountRestoredModal } from '@/src/components/moderation/AccountRestoredModal';
import { ReportUserModal } from '@/src/components/moderation/ReportUserModal';
import { UnderMaintenanceScreen } from '@/src/components/moderation/UnderMaintenanceScreen';
import { WarningsBannerModal } from '@/src/components/moderation/WarningsBannerModal';
import { AdminRoot } from '@/src/components/admin/AdminRoot';
import { fetchAppConfigSnapshot, AppConfigSnapshot } from '@/src/lib/bannedWordsCheck';
import { isFirebaseSessionActive } from '@/src/lib/firebase/client';
import { sendMessageToFirestoreFs } from '@/src/lib/firebase/services';
import { getAuthHeaders } from '@/src/lib/authHeader';
import { isFamilyMembershipMuted } from '@/src/lib/family/constants';
import { Profile, Message, UserReportSource } from '@/src/types';

// Ensures the cinematic launch animation plays strictly once on cold app launch
let launchSplashCompleted = false;

export default function App() {
  const isAdminPath =
    typeof window !== 'undefined' &&
    (window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/'));

  if (isAdminPath) {
    return <AdminRoot />;
  }

  return <LiveConnectApp />;
}

function LiveConnectApp() {
  const {
    user,
    profile,
    loading: authLoading,
    authError,
    setAuthError,
    signInWithGoogle,
    signOut,
    needsOnboarding,
    onboardingUser,
    profileCheckPending,
    bannedUntilDate,
    suspensionInfo,
    restoredNoticePending,
    acknowledgeRestored,
    completeOnboarding,
    updateProfile,
    refreshProfile,
  } = useAuth();

  const readyUserId =
    !authLoading && !profileCheckPending && user && profile && !needsOnboarding ? user.id : undefined;

  const [appConfig, setAppConfig] = useState<AppConfigSnapshot | null>(null);

  const refreshAppConfig = useCallback(async () => {
    const snap = await fetchAppConfigSnapshot(Boolean(readyUserId));
    if (!snap) return;
    if (snap.forceLogout && readyUserId) {
      await signOut();
      return;
    }
    setAppConfig(snap);
  }, [readyUserId, signOut]);

  useEffect(() => {
    void refreshAppConfig();
    const timer = setInterval(() => void refreshAppConfig(), 45_000);
    const onFocus = () => void refreshAppConfig();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshAppConfig]);

  const { isUserOnline, getUserLastSeen } = usePresence(readyUserId);

  const activeUserProfile = useMemo<Profile | null>(() => {
    if (profile) return profile;
    if (user) {
      const email = user.email || '';
      const baseName = email.split('@')[0] || 'user';
      return {
        id: user.id,
        username: user.user_metadata?.username || baseName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase(),
        display_name: user.user_metadata?.display_name || user.user_metadata?.full_name || baseName,
        avatar_url: user.user_metadata?.avatar_url || null,
        bio: 'Hey there! I am using LiveConnect.',
        is_online: true,
        last_seen: new Date().toISOString(),
        created_at: user.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    return null;
  }, [profile, user]);

  const readyProfile = readyUserId ? activeUserProfile : null;

  // Social Relations (Follow, Follow-Back, Mutual, Block/Unblock)
  const socialRelations = useSocialRelations(readyProfile);

  // Real-time In-App Notifications (excluding blocked actors)
  const {
    notifications,
    unreadCount: unreadNotificationsCount,
    markAsRead: markNotificationAsRead,
    markAllAsRead: markAllNotificationsAsRead,
    deleteNotification,
  } = useNotifications(readyUserId, socialRelations.isBlocked);

  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  // Family Groups State & Realtime Hook
  const {
    memberships: familyMemberships,
    invites: familyInvites,
    activeFamilyId,
    setActiveFamilyId,
    familyBadgeCount: rawFamilyBadgeCount,
    loading: familiesLoading,
    refreshFamilies,
    createNewFamily,
    respondInvite: respondFamilyInvite,
    joinByInviteCode,
  } = useFamilies(readyProfile);

  // Detect ?joinFamily=<code> URL invite link parameter
  const [urlJoinFamilyCode, setUrlJoinFamilyCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('joinFamily')?.trim() || null;
  });

  // Active Tab: 1. Messages, 2. Search ID, 3. Calls, 4. Family, 5. Profile
  const [activeTab, setActiveTab] = useState<TabType>('messages');

  const {
    conversations,
    loading: convLoading,
    activeConversationId,
    setActiveConversationId,
    fetchConversations,
    searchUsers,
    startConversation,
    deleteConversation,
    markConversationAsRead,
  } = useConversations(readyUserId, activeTab, readyProfile);

  const officialChat = useOfficialChat(readyUserId);

  const {
    incomingCall,
    activeCallState,
    connectionState,
    callError,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    startCall,
    acceptCall,
    rejectCall,
    cancelCall,
    endCall,
    toggleMicrophone,
    toggleCamera,
    switchCamera,
    clearCallError,
  } = useCall(readyProfile);

  const {
    history: callHistory,
    loading: historyLoading,
    missedCount: missedCallsCount,
    refetch: refetchCallHistory,
    deleteCall,
    clearAllHistory,
    markHistoryAsViewed,
  } = useCallHistory(readyUserId);

  // Modals state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<any>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);
  const [isAccountStatusOpen, setIsAccountStatusOpen] = useState(false);
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null);
  const [reportingTarget, setReportingTarget] = useState<{
    user: Profile;
    source: UserReportSource;
    conversationId?: string | null;
    reportedMessage?: import('@/src/types').ReportedMessageContext | null;
  } | null>(null);

  // Two-way visibility: exclude blocked peers from conversations, unread badge, search, and calls
  const visibleConversations = useMemo(() => {
    return conversations.filter((c) => !c.other_member?.id || !socialRelations.isBlocked(c.other_member.id));
  }, [conversations, socialRelations.isBlocked]);

  useEffect(() => {
    if (!activeConversationId) return;
    if (activeConversationId === OFFICIAL_CHAT_ID) {
      if (!officialChat.loading && !officialChat.isVisible) {
        setActiveConversationId(null);
      }
      return;
    }
    const activeConv = conversations.find((c) => c.id === activeConversationId);
    if (activeConv?.other_member?.id && socialRelations.isBlocked(activeConv.other_member.id)) {
      setActiveConversationId(null);
    }
  }, [
    activeConversationId,
    conversations,
    socialRelations.isBlocked,
    setActiveConversationId,
    officialChat.loading,
    officialChat.isVisible,
  ]);

  const filteredSearchUsers = useCallback(
    async (queryText: string) => {
      const results = await searchUsers(queryText);
      return results.filter((u) => !socialRelations.isBlocked(u.id));
    },
    [searchUsers, socialRelations.isBlocked]
  );

  const safeStartConversation = useCallback(
    async (targetId: string, targetProfile?: Profile) => {
      if (socialRelations.isBlocked(targetId)) return null;
      return startConversation(targetId, targetProfile);
    },
    [startConversation, socialRelations.isBlocked]
  );

  const safeStartCall = useCallback(
    (peer: Profile, callType: 'audio' | 'video') => {
      if (peer?.id && socialRelations.isBlocked(peer.id)) return;
      startCall(peer, callType);
    },
    [startCall, socialRelations.isBlocked]
  );

  // Calculate total unread messages count (active open chat messages are only excluded if currently viewing messages tab)
  const totalUnreadCount = useMemo(() => {
    const dmUnread = visibleConversations.reduce((acc, c) => {
      const isActivelyViewingThisChat =
        typeof document !== 'undefined' &&
        !document.hidden &&
        activeTab === 'messages' &&
        c.id === activeConversationId;

      if (isActivelyViewingThisChat) return acc;
      return acc + (c.unread_count || 0);
    }, 0);

    const isActivelyViewingOfficial =
      typeof document !== 'undefined' &&
      !document.hidden &&
      activeTab === 'messages' &&
      activeConversationId === OFFICIAL_CHAT_ID;

    const officialUnread =
      officialChat.isVisible && !isActivelyViewingOfficial ? officialChat.unreadCount : 0;

    return dmUnread + officialUnread;
  }, [
    visibleConversations,
    activeConversationId,
    activeTab,
    officialChat.isVisible,
    officialChat.unreadCount,
  ]);

  const adjustedFamilyBadgeCount = useMemo(() => {
    if (!activeFamilyId || activeTab !== 'family') return rawFamilyBadgeCount;
    const isHidden = typeof document !== 'undefined' && document.hidden;
    if (isHidden) return rawFamilyBadgeCount;
    const openMem = familyMemberships.find((m) => m.familyId === activeFamilyId);
    if (!openMem || openMem.status !== 'active' || isFamilyMembershipMuted(openMem)) {
      return rawFamilyBadgeCount;
    }
    return Math.max(0, rawFamilyBadgeCount - (openMem.unreadCount || 0));
  }, [rawFamilyBadgeCount, activeFamilyId, activeTab, familyMemberships]);

  const handleShareInviteToDm = useCallback(
    async (conversationId: string, inviteText: string) => {
      if (!readyProfile) return;
      const targetConv = visibleConversations.find((c) => c.id === conversationId);
      if (!targetConv || !targetConv.other_member?.id) {
        throw new Error('Conversation not found.');
      }
      if (isFirebaseSessionActive(readyProfile.id)) {
        await sendMessageToFirestoreFs({
          conversationId: targetConv.id,
          content: inviteText,
          senderProfile: readyProfile,
          receiverId: targetConv.other_member.id,
          receiverProfile: targetConv.other_member,
        });
      } else {
        const authHeaders = await getAuthHeaders();
        const res = await fetch('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            message: {
              id: `fshare-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              conversation_id: targetConv.id,
              sender_id: readyProfile.id,
              content: inviteText,
              created_at: new Date().toISOString(),
            },
            recipientId: targetConv.other_member.id,
            senderProfile: readyProfile,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || 'Could not share invite link.');
        }
      }
      fetchConversations();
    },
    [readyProfile, visibleConversations, fetchConversations]
  );

  // Sync browser path simulation for routing consistency
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;

      if (path === '/app/messages' || path === '/app' || path === '/' || path === '') {
        setActiveTab('messages');
      } else if (path === '/app/search') {
        setActiveTab('search');
      } else if (path === '/app/calls' || path === '/app/call-history') {
        setActiveTab('calls');
        markHistoryAsViewed();
      } else if (path === '/app/family') {
        setActiveTab('family');
      } else if (path === '/app/profile' || path.startsWith('/app/help') || path === '/app/subscription') {
        setActiveTab('profile');
      }
    }
  }, [markHistoryAsViewed]);

  const handleTabChange = (tab: TabType) => {
    const nextTab = tab === 'call-history' ? 'calls' : tab;
    setActiveTab(nextTab);
    if (nextTab === 'calls') {
      markHistoryAsViewed();
    }
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const targetRoute = nextTab === 'messages' ? '/app' : `/app/${nextTab}`;
      window.history.pushState({}, '', targetRoute);
    }
  };

  // Splash screen state: 0-2600ms 5-phase sequence + 400ms fade-out (3000ms total), only on cold launch
  const [minSplashDone, setMinSplashDone] = useState(() => launchSplashCompleted);
  const [splashExiting, setSplashExiting] = useState(false);
  const [splashMounted, setSplashMounted] = useState(() => !launchSplashCompleted);

  useEffect(() => {
    if (launchSplashCompleted) return;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const timer = setTimeout(() => {
      setMinSplashDone(true);
    }, prefersReduced ? 600 : 2600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!splashMounted) return;
    if (minSplashDone && !authLoading && !profileCheckPending) {
      setSplashExiting(true);
    }
  }, [minSplashDone, authLoading, profileCheckPending, splashMounted]);

  useEffect(() => {
    if (!splashExiting) return;
    const unmountTimer = setTimeout(() => {
      launchSplashCompleted = true;
      setSplashMounted(false);
    }, 400);
    return () => clearTimeout(unmountTimer);
  }, [splashExiting]);

  const renderContent = () => {
    if (authLoading || profileCheckPending) {
      return null;
    }

    if (suspensionInfo || (bannedUntilDate && new Date(bannedUntilDate).getTime() > Date.now())) {
      return (
        <BannedScreen
          status={suspensionInfo?.status || 'suspended'}
          bannedUntil={suspensionInfo?.banUntil || bannedUntilDate}
          banReason={suspensionInfo?.banReason}
          ruleLabel={suspensionInfo?.ruleLabel}
          scheduledDeletionAt={suspensionInfo?.scheduledDeletionAt}
          strikeCount={suspensionInfo?.strikeCount}
          appealToken={suspensionInfo?.appealToken}
          onSignOut={signOut}
        />
      );
    }

  // Public standalone view of Terms, Privacy & Delete Account Policy
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname;
    if (pathname === '/app/help/delete-account' || pathname === '/delete-account') {
      return (
        <div className="h-screen-safe w-screen bg-neutral-950 text-white overflow-hidden">
          <DeleteAccountPage
            onBack={() => {
              window.history.pushState({}, '', '/app');
              window.location.href = '/';
            }}
          />
        </div>
      );
    }
  }

  // Maintenance mode gate for non-admin users
  const isStaffMember =
    (appConfig?.adminRole && appConfig.adminRole !== 'none') ||
    (profile?.admin_role && profile.admin_role !== 'none') ||
    (user?.admin_role && user.admin_role !== 'none');

  if (appConfig?.maintenanceMode && !isStaffMember) {
    return (
      <UnderMaintenanceScreen
        message={appConfig.maintenanceMessage}
        onRetry={refreshAppConfig}
        onSignOut={user ? signOut : undefined}
      />
    );
  }

  // Unauthenticated view (Support public standalone view of Terms & Privacy for App Store / Play Store Review)
  if (!user || (!profile && !needsOnboarding)) {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      if (pathname === '/app/help/terms' || pathname === '/terms') {
        return (
          <div className="h-screen-safe w-screen bg-neutral-950 text-white overflow-hidden">
            <TermsConditions
              onBack={() => {
                window.history.pushState({}, '', '/app');
                window.location.href = '/';
              }}
            />
          </div>
        );
      }
      if (pathname === '/app/help/privacy' || pathname === '/privacy') {
        return (
          <div className="h-screen-safe w-screen bg-neutral-950 text-white overflow-hidden">
            <PrivacyPolicy
              onBack={() => {
                window.history.pushState({}, '', '/app');
                window.location.href = '/';
              }}
            />
          </div>
        );
      }
    }

    return (
      <>
        <AuthPage
          onGoogleSignIn={signInWithGoogle}
          authError={authError}
          clearError={() => setAuthError(null)}
        />
        <LanguageSelectorModal />
        {callError && (
          <Toast
            title="Notice"
            message={callError}
            type="error"
            onClose={clearCallError}
          />
        )}
      </>
    );
  }

  // Onboarding view for brand-new users (Google OAuth / missing profile)
  if (needsOnboarding && (onboardingUser || user)) {
    const activeUser = onboardingUser || user;
    const prefillName =
      activeUser?.user_metadata?.full_name ||
      activeUser?.user_metadata?.name ||
      activeUser?.user_metadata?.display_name ||
      activeUser?.email?.split('@')[0] ||
      '';
    const prefillAvatar =
      activeUser?.user_metadata?.avatar_url ||
      activeUser?.user_metadata?.picture ||
      '';
    const prefillEmail = activeUser?.email || '';

    return (
      <OnboardingScreen
        prefillName={prefillName}
        prefillAvatar={prefillAvatar}
        prefillEmail={prefillEmail}
        onComplete={completeOnboarding}
      />
    );
  }

  const isCallActive = Boolean(activeCallState || incomingCall);

  return (
    <div className="h-screen-safe w-screen flex flex-col md:flex-row bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 overflow-hidden font-sans">
      {/* 1. Desktop Left Navigation Rail */}
      <SidebarNav
        activeTab={activeTab}
        onChangeTab={handleTabChange}
        currentUser={profile}
        unreadCount={totalUnreadCount}
        missedCallsCount={missedCallsCount}
        familyBadgeCount={adjustedFamilyBadgeCount}
        unreadNotificationsCount={unreadNotificationsCount}
        onOpenNotifications={() => setIsNotificationOpen(true)}
        onSignOut={signOut}
      />

      {/* 2. Main Tab View Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <MobileHeader
          unreadNotificationsCount={unreadNotificationsCount}
          onOpenNotifications={() => setIsNotificationOpen(true)}
          hide={
            isCallActive ||
            (activeTab === 'messages' && Boolean(activeConversationId)) ||
            (activeTab === 'family' && Boolean(activeFamilyId))
          }
        />

        {/* Tab 1: Messages (💬) */}
        {activeTab === 'messages' && (
          <MessagesTab
            conversations={visibleConversations}
            activeConversationId={activeConversationId}
            loading={convLoading}
            currentUser={profile}
            officialChat={{
              messages: officialChat.messages,
              lastMessage: officialChat.lastMessage,
              unreadCount: officialChat.unreadCount,
              isVisible: officialChat.isVisible,
              loading: officialChat.loading,
              onMarkAsRead: officialChat.markAsRead,
              onDeleteMessageForMe: officialChat.deleteMessageForMe,
              onClearChatForMe: officialChat.clearChatForMe,
            }}
            onSelectConversation={(id) => setActiveConversationId(id)}
            onOpenSearch={() => setIsSearchOpen(true)}
            onOpenForwardModal={(m) => setForwardingMessage(m)}
            onStartCall={safeStartCall}
            onOpenProfileView={(p) => {
              setViewingProfile(p);
              setIsProfileOpen(true);
            }}
            onDeleteConversation={deleteConversation}
            isUserOnline={isUserOnline}
            getUserLastSeen={getUserLastSeen}
            getRelationStatus={socialRelations.getRelationStatus}
            onFollow={socialRelations.followUser}
            onUnblock={socialRelations.unblockUser}
            onReportUser={(peer, conversationId, reportedMessage) => {
              setReportingTarget({
                user: peer,
                source: 'chat',
                conversationId,
                reportedMessage: reportedMessage || null,
              });
            }}
          />
        )}

        {/* Tab 2: Search ID / Find Users (🔎) */}
        {activeTab === 'search' && (
          <SearchTab
            currentUser={profile}
            onSearchUsers={filteredSearchUsers}
            onStartChat={async (targetId, targetProfile) => {
              setActiveTab('messages');
              const convId = await safeStartConversation(targetId, targetProfile);
              if (convId) {
                setActiveConversationId(convId);
              }
            }}
            onStartCall={safeStartCall}
            onViewProfile={(p) => {
              setViewingProfile(p);
              setIsProfileOpen(true);
            }}
            isUserOnline={isUserOnline}
            getRelationStatus={socialRelations.getRelationStatus}
            getFollowStatus={socialRelations.getFollowStatus}
            onFollow={socialRelations.followUser}
            onUnfollow={socialRelations.unfollowUser}
            onReportUser={(peer) => {
              setReportingTarget({ user: peer, source: 'search' });
            }}
          />
        )}

        {/* Tab 3: Unified Calls & Call History (📞 / 🕘) */}
        {(activeTab === 'calls' || (activeTab as any) === 'call-history') && (
          <CallsTab
            currentUser={profile}
            conversations={visibleConversations}
            onStartCall={safeStartCall}
            onOpenProfileView={(p) => {
              setViewingProfile(p);
              setIsProfileOpen(true);
            }}
            isUserOnline={isUserOnline}
            onOpenSearchModal={() => setIsSearchOpen(true)}
            isBlocked={socialRelations.isBlocked}
            history={callHistory}
            historyLoading={historyLoading}
            onRefreshHistory={refetchCallHistory}
            onDeleteCall={deleteCall}
            onClearAllHistory={clearAllHistory}
            onMarkHistoryAsViewed={markHistoryAsViewed}
            missedCallsCount={missedCallsCount}
            onReportUser={(peer) => {
              setReportingTarget({ user: peer, source: 'call' });
            }}
            onStartChat={async (targetId, targetProfile) => {
              setActiveTab('messages');
              const convId = await safeStartConversation(targetId, targetProfile);
              if (convId) {
                setActiveConversationId(convId);
              }
            }}
          />
        )}

        {/* Tab 4: Family Groups (👨‍👩‍👧‍👦) */}
        {activeTab === 'family' && (
          <FamilyTab
            currentUser={profile}
            memberships={familyMemberships}
            invites={familyInvites}
            activeFamilyId={activeFamilyId}
            loading={familiesLoading}
            dmConversations={visibleConversations}
            onSelectFamily={(fid) => setActiveFamilyId(fid)}
            onCreateFamily={createNewFamily}
            onRespondInvite={respondFamilyInvite}
            onJoinByCode={joinByInviteCode}
            onSearchUsers={filteredSearchUsers}
            onShareInviteToDm={handleShareInviteToDm}
            onRefreshFamilies={refreshFamilies}
          />
        )}

        {/* Tab 5: Profile (👤) */}
        {activeTab === 'profile' && (
          <ProfileTab
            currentUser={profile}
            blockedUserIds={socialRelations.blockedByMeSet}
            onUnblockUser={socialRelations.unblockUser}
            onEditProfile={() => {
              setViewingProfile(null);
              setIsProfileOpen(true);
            }}
            onOpenSettingsModal={() => setIsSettingsOpen(true)}
            onOpenAccountStatus={() => setIsAccountStatusOpen(true)}
            onOpenNotifications={() => setIsNotificationOpen(true)}
            unreadNotificationsCount={unreadNotificationsCount}
            onSignOut={signOut}
            followersCount={socialRelations.followersCount}
            followingCount={socialRelations.followingCount}
            fetchFollowers={socialRelations.fetchFollowersList}
            fetchFollowing={socialRelations.fetchFollowingList}
            getFollowStatus={socialRelations.getFollowStatus}
            onFollow={socialRelations.followUser}
            onUnfollow={socialRelations.unfollowUser}
            onSelectUser={(u) => {
              setViewingProfile(u);
              setIsProfileOpen(true);
            }}
          />
        )}
      </main>

      {/* 3. Mobile Bottom Navigation Bar (Tabs) */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={handleTabChange}
        unreadCount={totalUnreadCount}
        missedCallsCount={missedCallsCount}
        familyBadgeCount={adjustedFamilyBadgeCount}
        hide={
          isCallActive ||
          (activeTab === 'messages' && Boolean(activeConversationId)) ||
          (activeTab === 'family' && Boolean(activeFamilyId))
        }
      />

      {/* 4. Realtime Incoming Call Modal */}
      <IncomingCallModal
        incomingCall={incomingCall}
        onAccept={acceptCall}
        onReject={rejectCall}
        onOpenProfile={(p) => {
          setViewingProfile(p);
          setIsProfileOpen(true);
        }}
      />

      {/* 5. Active Call Screens */}
      {activeCallState && activeCallState.call.call_type === 'audio' && (
        <AudioCallScreen
          activeCallState={activeCallState}
          callState={activeCallState}
          connectionState={connectionState}
          remoteAudioRef={remoteAudioRef}
          onToggleMicrophone={toggleMicrophone}
          onToggleMic={toggleMicrophone}
          onEndCall={endCall}
        />
      )}

      {activeCallState && activeCallState.call.call_type === 'video' && (
        <VideoCallScreen
          activeCallState={activeCallState}
          callState={activeCallState}
          connectionState={connectionState}
          localVideoRef={localVideoRef}
          remoteVideoRef={remoteVideoRef}
          remoteAudioRef={remoteAudioRef}
          onToggleMicrophone={toggleMicrophone}
          onToggleMic={toggleMicrophone}
          onToggleCamera={toggleCamera}
          onSwitchCamera={switchCamera}
          onEndCall={endCall}
        />
      )}

      {/* 6. Modals */}
      <NotificationModal
        isOpen={isNotificationOpen}
        onClose={() => setIsNotificationOpen(false)}
        notifications={notifications}
        unreadCount={unreadNotificationsCount}
        onMarkAsRead={markNotificationAsRead}
        onMarkAllAsRead={markAllNotificationsAsRead}
        onDeleteNotification={deleteNotification}
        onSelectUser={(u) => {
          setIsNotificationOpen(false);
          setViewingProfile(u);
          setIsProfileOpen(true);
        }}
        onOpenChat={async (userId, actorProfile) => {
          setIsNotificationOpen(false);
          setActiveTab('messages');
          const convId = await safeStartConversation(userId, actorProfile);
          if (convId) {
            setActiveConversationId(convId);
          }
        }}
        onOpenOfficialChat={() => {
          setIsNotificationOpen(false);
          handleTabChange('messages');
          setActiveConversationId(OFFICIAL_CHAT_ID);
        }}
        onOpenFamily={(familyId) => {
          setIsNotificationOpen(false);
          handleTabChange('family');
          if (familyId) {
            setActiveFamilyId(familyId);
          }
        }}
        onRespondFamilyInvite={respondFamilyInvite}
      />

      {/* Deep-Link ?joinFamily=<code> Invite Confirmation Modal */}
      <JoinFamilyModal
        isOpen={Boolean(urlJoinFamilyCode && readyProfile)}
        currentUser={profile}
        initialInviteCode={urlJoinFamilyCode}
        onClose={() => {
          setUrlJoinFamilyCode(null);
          if (typeof window !== 'undefined' && window.history?.replaceState) {
            const url = new URL(window.location.href);
            url.searchParams.delete('joinFamily');
            window.history.replaceState({}, '', url.toString());
          }
        }}
        onConfirmJoin={joinByInviteCode}
        onOpenFamily={(fid) => {
          handleTabChange('family');
          setActiveFamilyId(fid);
        }}
      />

      <UserSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectUser={async (targetUserId, targetUserProfile) => {
          setIsSearchOpen(false);
          setActiveTab('messages');
          const convId = await safeStartConversation(targetUserId, targetUserProfile);
          if (convId) {
            setActiveConversationId(convId);
          }
        }}
        onStartCall={(targetUser, type) => {
          setIsSearchOpen(false);
          safeStartCall(targetUser, type);
        }}
        onSearch={filteredSearchUsers}
        isUserOnline={isUserOnline}
      />

      <ProfileModal
        isOpen={isProfileOpen}
        currentUser={profile}
        viewingProfile={viewingProfile}
        onClose={() => {
          setIsProfileOpen(false);
          setViewingProfile(null);
        }}
        onUpdateProfile={async (updates) => {
          return await updateProfile(updates);
        }}
        onStartChat={async (targetId, targetProfile) => {
          setIsProfileOpen(false);
          setViewingProfile(null);
          setActiveTab('messages');
          const convId = await safeStartConversation(targetId, targetProfile);
          if (convId) {
            setActiveConversationId(convId);
          }
        }}
        onStartAudioCall={(peer) => {
          setIsProfileOpen(false);
          setViewingProfile(null);
          safeStartCall(peer, 'audio');
        }}
        onStartVideoCall={(peer) => {
          setIsProfileOpen(false);
          setViewingProfile(null);
          safeStartCall(peer, 'video');
        }}
        relationStatus={
          viewingProfile
            ? socialRelations.getRelationStatus(viewingProfile.id)
            : profile
            ? socialRelations.getRelationStatus(profile.id)
            : undefined
        }
        getFollowStatus={socialRelations.getFollowStatus}
        onFollow={socialRelations.followUser}
        onUnfollow={socialRelations.unfollowUser}
        fetchFollowers={socialRelations.fetchFollowersList}
        fetchFollowing={socialRelations.fetchFollowingList}
        followersCount={
          viewingProfile
            ? socialRelations.getFollowersCount(viewingProfile.id)
            : socialRelations.followersCount
        }
        followingCount={
          viewingProfile
            ? socialRelations.getFollowingCount(viewingProfile.id)
            : socialRelations.followingCount
        }
        onSelectUser={(u) => {
          setViewingProfile(u);
        }}
        isUserOnline={isUserOnline}
        onBlock={socialRelations.blockUser}
        onUnblock={socialRelations.unblockUser}
        onReportUser={(peer) => {
          setReportingTarget({ user: peer, source: 'profile' });
        }}
      />

      <ReportUserModal
        isOpen={Boolean(reportingTarget)}
        currentUserId={profile?.id}
        targetUser={reportingTarget?.user || null}
        source={reportingTarget?.source || 'profile'}
        conversationId={reportingTarget?.conversationId || null}
        reportedMessage={reportingTarget?.reportedMessage || null}
        isAlreadyBlocked={
          reportingTarget?.user?.id
            ? socialRelations.isBlocked(reportingTarget.user.id)
            : false
        }
        onBlockUser={socialRelations.blockUser}
        onClose={() => setReportingTarget(null)}
      />

      <ForwardMessageModal
        isOpen={Boolean(forwardingMessage)}
        onClose={() => setForwardingMessage(null)}
        messageToForward={forwardingMessage}
        conversations={visibleConversations}
        currentUser={profile}
        onForwardSuccess={() => {
          setForwardingMessage(null);
          fetchConversations();
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentUser={profile}
        onSignOut={signOut}
        blockedCount={socialRelations.blockedByMeSet.size}
        onOpenBlockedUsers={() => setIsBlockedModalOpen(true)}
        onOpenAccountStatus={() => setIsAccountStatusOpen(true)}
      />

      <BlockedUsersModal
        isOpen={isBlockedModalOpen}
        onClose={() => setIsBlockedModalOpen(false)}
        blockedUserIds={socialRelations.blockedByMeSet}
        onUnblock={socialRelations.unblockUser}
        currentUserId={profile?.id}
      />

      <AccountStatusModal
        isOpen={isAccountStatusOpen}
        onClose={() => setIsAccountStatusOpen(false)}
        onSignOut={signOut}
      />

      <WarningsBannerModal
        warnings={appConfig?.unreadWarnings || []}
        onAcknowledged={refreshAppConfig}
      />

      <AccountRestoredModal
        isOpen={restoredNoticePending}
        strikeCount={profile?.strike_count || user?.strike_count || 0}
        onContinue={acknowledgeRestored}
      />

      <LanguageSelectorModal />

      {/* Global Call Error Toast */}
      {callError && (
        <Toast
          title="Call Notice"
          message={callError}
          type="error"
          onClose={clearCallError}
        />
      )}

      {/* PWA / Notification Prompt */}
      <PushBanner />
    </div>
    );
  };

  return (
    <>
      {renderContent()}
      {splashMounted && <SplashScreen isExiting={splashExiting} />}
    </>
  );
}

