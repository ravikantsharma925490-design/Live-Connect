import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { SplashScreen } from '@/src/components/ui/SplashScreen';
import { useAuth } from '@/src/hooks/useAuth';
import { usePresence } from '@/src/hooks/usePresence';
import { useConversations } from '@/src/hooks/useConversations';
import { useCall } from '@/src/hooks/useCall';
import { useCallHistory } from '@/src/hooks/useCallHistory';
import { useSocialRelations } from '@/src/hooks/useSocialRelations';
import { useNotifications } from '@/src/hooks/useNotifications';
import { AuthPage } from '@/src/components/auth/AuthPage';
import { BottomNav, TabType } from '@/src/components/navigation/BottomNav';
import { SidebarNav } from '@/src/components/navigation/SidebarNav';
import { MobileHeader } from '@/src/components/navigation/MobileHeader';
import { MessagesTab } from '@/src/components/tabs/MessagesTab';
import { SearchTab } from '@/src/components/tabs/SearchTab';
import { CallsTab } from '@/src/components/tabs/CallsTab';
import { ProfileTab } from '@/src/components/tabs/ProfileTab';
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
import { AdminModerationPanel } from '@/src/components/moderation/AdminModerationPanel';
import { Profile, Message } from '@/src/types';

// Ensures the cinematic launch animation plays strictly once on cold app launch
let launchSplashCompleted = false;

export default function App() {
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

  const isModeratorOrAdmin =
    user?.role === 'admin' ||
    user?.role === 'moderator' ||
    profile?.role === 'admin' ||
    profile?.role === 'moderator';

  const readyUserId =
    !authLoading && !profileCheckPending && user && profile && !needsOnboarding ? user.id : undefined;

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

  // Active Tab: 1. Messages (Default landing), 2. Search ID, 3. Calls, 4. Call History, 5. Profile
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
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [viewingProfile, setViewingProfile] = useState<Profile | null>(null);

  // Two-way visibility: exclude blocked peers from conversations, unread badge, search, and calls
  const visibleConversations = useMemo(() => {
    return conversations.filter((c) => !c.other_member?.id || !socialRelations.isBlocked(c.other_member.id));
  }, [conversations, socialRelations.isBlocked]);

  useEffect(() => {
    if (!activeConversationId) return;
    const activeConv = conversations.find((c) => c.id === activeConversationId);
    if (activeConv?.other_member?.id && socialRelations.isBlocked(activeConv.other_member.id)) {
      setActiveConversationId(null);
    }
  }, [activeConversationId, conversations, socialRelations.isBlocked, setActiveConversationId]);

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
    return visibleConversations.reduce((acc, c) => {
      const isActivelyViewingThisChat =
        typeof document !== 'undefined' &&
        !document.hidden &&
        activeTab === 'messages' &&
        c.id === activeConversationId;

      if (isActivelyViewingThisChat) return acc;
      return acc + (c.unread_count || 0);
    }, 0);
  }, [visibleConversations, activeConversationId, activeTab]);

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
      {/* 1. Desktop Left Navigation Rail (Shows exact 6 tabs in order) */}
      <SidebarNav
        activeTab={activeTab}
        onChangeTab={handleTabChange}
        currentUser={profile}
        unreadCount={totalUnreadCount}
        missedCallsCount={missedCallsCount}
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
            (activeTab === 'messages' && Boolean(activeConversationId))
          }
        />

        {/* Tab 1: Messages (💬) */}
        {activeTab === 'messages' && (
          <MessagesTab
            conversations={visibleConversations}
            activeConversationId={activeConversationId}
            loading={convLoading}
            currentUser={profile}
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
            onStartChat={async (targetId, targetProfile) => {
              setActiveTab('messages');
              const convId = await safeStartConversation(targetId, targetProfile);
              if (convId) {
                setActiveConversationId(convId);
              }
            }}
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
            onOpenAdminPanel={isModeratorOrAdmin ? () => setIsAdminPanelOpen(true) : undefined}
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
        hide={
          isCallActive ||
          (activeTab === 'messages' && Boolean(activeConversationId))
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
        onOpenAdminPanel={isModeratorOrAdmin ? () => setIsAdminPanelOpen(true) : undefined}
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

      {isModeratorOrAdmin && (
        <AdminModerationPanel
          isOpen={isAdminPanelOpen}
          onClose={() => setIsAdminPanelOpen(false)}
        />
      )}

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

