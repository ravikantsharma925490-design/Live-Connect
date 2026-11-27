export type TranslationKeys = {
  // Navigation & Menu
  'nav.messages': string;
  'nav.search': string;
  'nav.calls': string;
  'nav.family'?: string;
  'nav.callHistory': string;
  'nav.profile': string;
  'nav.menu': string;
  'nav.language': string;

  // Status & Presence
  'status.connected': string;
  'status.online': string;
  'status.offline': string;
  'status.activeNow': string;
  'status.joined': string;
  'status.allCaughtUp': string;
  'status.unread': string;
  'status.personalNotes': string;

  // Actions & Buttons
  'action.startChat': string;
  'action.audioCall': string;
  'action.videoCall': string;
  'action.block': string;
  'action.unblock': string;
  'action.blocked': string;
  'action.follow': string;
  'action.following': string;
  'action.followBack': string;
  'action.unfollow': string;
  'action.mutual': string;
  'action.editProfile': string;
  'action.saveChanges': string;
  'action.saving': string;
  'action.saved': string;
  'action.cancel': string;
  'action.close': string;
  'action.done': string;
  'action.clear': string;
  'action.clearAll': string;
  'action.refresh': string;
  'action.logOut': string;
  'action.confirmSignOut': string;
  'action.search': string;
  'action.delete': string;
  'action.mute': string;
  'action.unmute': string;
  'action.endCall': string;
  'action.accept': string;
  'action.decline': string;
  'action.tryAgain': string;
  'action.switchCamera': string;
  'action.selectLanguage': string;
  'action.allRegions': string;
  'action.newChat': string;
  'action.newCall': string;
  'action.startACall': string;
  'action.report': string;
  'action.reportUser': string;
  'action.viewProfile': string;
  'action.send': string;
  'action.sending': string;
  'action.markAllRead': string;
  'action.changePhoto': string;
  'action.uploadPhoto': string;
  'action.remove': string;
  'action.random': string;
  'action.callOtherDevice': string;

  // Screen Titles & Headers
  'title.messages': string;
  'title.callsAndContacts': string;
  'title.callHistory': string;
  'title.searchUser': string;
  'title.myProfile': string;
  'title.editProfile': string;
  'title.userProfile': string;
  'title.settings': string;
  'title.notifications': string;
  'title.permissions': string;
  'title.hardwareSettings': string;
  'title.blockedUsers': string;
  'title.helpCenter': string;
  'title.appLanguage': string;
  'title.darkMode': string;
  'title.accountStatus': string;
  'title.adminConsole': string;
  'title.dangerZone': string;
  'title.deleteAccount': string;
  'title.reportAccount': string;

  // Descriptions & Subtitles
  'desc.callsSubtitle': string;
  'desc.profileSubtitle': string;
  'desc.languageSubtitle': string;
  'desc.darkModeOn': string;
  'desc.darkModeOff': string;
  'desc.notificationsSub': string;
  'desc.permissionsSub': string;
  'desc.blockedUsersSub': string;
  'desc.helpCenterSub': string;
  'desc.searchPlaceholder': string;
  'desc.searchConversations': string;
  'desc.searchCalls': string;
  'desc.searchBlocked': string;
  'desc.searchLanguagePlaceholder': string;
  'desc.typeMessage': string;
  'desc.messageUser': string;
  'desc.addCaption': string;
  'desc.noMessages': string;
  'desc.noCalls': string;
  'desc.noUsersFound': string;
  'desc.selectConversation': string;
  'desc.selectConversationSub': string;
  'desc.findPeopleToChat': string;
  'desc.mutualFollowRequired': string;
  'desc.communicationBlocked': string;
  'desc.recordingVoiceNote': string;
  'desc.noNotifications': string;
  'desc.noBlockedAccounts': string;
  'desc.currently': string;
  'desc.languagesBadge': string;
  'desc.worldLanguagesAvailable': string;
  'desc.signOutConfirm': string;
  'desc.deleteConversationTitle': string;
  'desc.clearMessagesTitle': string;
  'desc.clearAllCallsTitle': string;

  // Labels & Categories
  'label.followers': string;
  'label.following': string;
  'label.chat': string;
  'label.call': string;
  'label.video': string;
  'label.info': string;
  'label.incomingAudioCall': string;
  'label.incomingVideoCall': string;
  'label.outgoingAudioCall': string;
  'label.outgoingVideoCall': string;
  'label.missedAudioCall': string;
  'label.missedVideoCall': string;
  'label.microphoneAccess': string;
  'label.cameraAccess': string;
  'label.pushNotifications': string;
  'label.all': string;
  'label.regionAsiaPacific': string;
  'label.regionEurope': string;
  'label.regionAmericas': string;
  'label.regionMiddleEast': string;
  'label.regionAfrica': string;
  'label.regionGlobal': string;
  'label.pinnedMessage': string;
  'label.stickers': string;

  // Auth & Account
  'auth.welcomeBack': string;
  'auth.createAccount': string;
  'auth.signIn': string;
  'auth.signUp': string;
  'auth.email': string;
  'auth.password': string;
  'auth.fullName': string;
  'auth.username': string;
  'auth.forgotPassword': string;
  'auth.sendReset': string;
  'auth.backToLogin': string;
  'auth.alreadyHaveAccount': string;
  'auth.dontHaveAccount': string;
  'auth.selectCountry': string;
  'auth.selectGender': string;
  'auth.bio': string;
  'auth.language': string;
  'auth.tagline': string;
  'auth.continueWithGoogle': string;
  'auth.agreePrefix': string;
  'auth.termsOfUse': string;
  'auth.and': string;
  'auth.privacyPolicy': string;
  'auth.googleInstantHint': string;
  'auth.mustAgreeTerms': string;
};

export type TranslationDict = Partial<TranslationKeys>;

export const EN_DICT: TranslationKeys = {
  'nav.messages': 'Messages',
  'nav.search': 'Search ID',
  'nav.calls': 'Calls',
  'nav.family': 'Family',
  'nav.callHistory': 'Call History',
  'nav.profile': 'Profile',
  'nav.menu': 'Menu',
  'nav.language': 'Language',
  'status.connected': 'Connected & Live',
  'status.online': 'Online',
  'status.offline': 'Offline',
  'status.activeNow': 'Active Now',
  'status.joined': 'Joined',
  'status.allCaughtUp': 'All caught up',
  'status.unread': 'unread',
  'status.personalNotes': 'Message yourself (Personal notes)',
  'action.startChat': 'Start Chat',
  'action.audioCall': 'Audio Call',
  'action.videoCall': 'Video Call',
  'action.block': 'Block',
  'action.unblock': 'Unblock',
  'action.blocked': 'Blocked',
  'action.follow': 'Follow',
  'action.following': 'Following',
  'action.followBack': 'Follow Back',
  'action.unfollow': 'Unfollow',
  'action.mutual': 'Friends (Mutual)',
  'action.editProfile': 'Edit Profile',
  'action.saveChanges': 'Save Changes',
  'action.saving': 'Saving...',
  'action.saved': 'Saved!',
  'action.cancel': 'Cancel',
  'action.close': 'Close',
  'action.done': 'Done',
  'action.clear': 'Clear',
  'action.clearAll': 'Clear All',
  'action.refresh': 'Refresh',
  'action.logOut': 'Log Out',
  'action.confirmSignOut': 'Confirm Sign Out',
  'action.search': 'Search',
  'action.delete': 'Delete',
  'action.mute': 'Mute',
  'action.unmute': 'Unmute',
  'action.endCall': 'End Call',
  'action.accept': 'Accept',
  'action.decline': 'Decline',
  'action.tryAgain': 'Try Again',
  'action.switchCamera': 'Switch Camera',
  'action.selectLanguage': 'Select App Language',
  'action.allRegions': 'All Languages',
  'action.newChat': 'New Chat',
  'action.newCall': 'New Call',
  'action.startACall': 'Start a Call',
  'action.report': 'Report',
  'action.reportUser': 'Report User',
  'action.viewProfile': 'View Profile',
  'action.send': 'Send',
  'action.sending': 'Sending...',
  'action.markAllRead': 'Mark all read',
  'action.changePhoto': 'Change',
  'action.uploadPhoto': 'Upload Photo',
  'action.remove': 'Remove',
  'action.random': 'Random',
  'action.callOtherDevice': 'Call Other Device',
  'title.messages': 'Messages',
  'title.callsAndContacts': 'Calls & Contacts',
  'title.callHistory': 'Call History',
  'title.searchUser': 'Search Users',
  'title.myProfile': 'My Profile',
  'title.editProfile': 'Edit Your Profile',
  'title.userProfile': 'User Profile',
  'title.settings': 'Settings & Preferences',
  'title.notifications': 'Notifications',
  'title.permissions': 'Permissions',
  'title.hardwareSettings': 'Hardware & Account Settings',
  'title.blockedUsers': 'Blocked Accounts',
  'title.helpCenter': 'Help Center & Privacy',
  'title.appLanguage': 'App Language',
  'title.darkMode': 'Dark Mode Theme',
  'title.accountStatus': 'Account Status & Strikes',
  'title.adminConsole': 'Trust & Safety Admin Console',
  'title.dangerZone': 'Danger Zone',
  'title.deleteAccount': 'Delete Account',
  'title.reportAccount': 'Report User Account',
  'desc.callsSubtitle': 'Instant crystal-clear HD audio and video calls powered by WebRTC',
  'desc.profileSubtitle': 'Manage your profile, notifications, and device permissions',
  'desc.languageSubtitle': 'Choose your preferred language for the whole app',
  'desc.darkModeOn': 'Dark theme enabled',
  'desc.darkModeOff': 'Light theme enabled',
  'desc.notificationsSub': 'Call ringtones, message alert sounds, and push alerts',
  'desc.permissionsSub': 'Microphone & Camera switches and hardware test',
  'desc.blockedUsersSub': 'Manage and unblock restricted users',
  'desc.helpCenterSub': 'FAQ, guides, call assistance & contact support',
  'desc.searchPlaceholder': 'Type User ID or @username...',
  'desc.searchConversations': 'Search conversations...',
  'desc.searchCalls': 'Search calls...',
  'desc.searchBlocked': 'Search blocked accounts...',
  'desc.searchLanguagePlaceholder': 'Search by language, country, or native script...',
  'desc.typeMessage': 'Type a message...',
  'desc.messageUser': 'Message {name}...',
  'desc.addCaption': 'Add a caption...',
  'desc.noMessages': 'No conversations yet. Start a chat with friends!',
  'desc.noCalls': 'No calls yet',
  'desc.noUsersFound': 'No user found',
  'desc.selectConversation': 'Select a Conversation',
  'desc.selectConversationSub': 'Choose a conversation from the sidebar or start a new real-time chat, audio call, or video call.',
  'desc.findPeopleToChat': 'Find People to Chat',
  'desc.mutualFollowRequired': 'Mutual follow required to call & chat',
  'desc.communicationBlocked': 'Communication is blocked. You cannot send messages or make calls.',
  'desc.recordingVoiceNote': 'Recording Voice Note...',
  'desc.noNotifications': 'No notifications yet',
  'desc.noBlockedAccounts': 'No Blocked Accounts',
  'desc.currently': 'Currently:',
  'desc.languagesBadge': '{count}+ Languages',
  'desc.worldLanguagesAvailable': '106+ World Languages available',
  'desc.signOutConfirm': 'Are you sure you want to sign out?',
  'desc.deleteConversationTitle': 'Delete Conversation?',
  'desc.clearMessagesTitle': 'Clear All Messages?',
  'desc.clearAllCallsTitle': 'Clear All Calls?',
  'label.followers': 'Followers',
  'label.following': 'Following',
  'label.chat': 'Chat',
  'label.call': 'Call',
  'label.video': 'Video',
  'label.info': 'Info',
  'label.incomingAudioCall': 'Incoming Audio Call',
  'label.incomingVideoCall': 'Incoming Video Call',
  'label.outgoingAudioCall': 'Outgoing Audio Call',
  'label.outgoingVideoCall': 'Outgoing Video Call',
  'label.missedAudioCall': 'Missed Audio Call',
  'label.missedVideoCall': 'Missed Video Call',
  'label.microphoneAccess': 'Microphone Access',
  'label.cameraAccess': 'Camera Access',
  'label.pushNotifications': 'Push Notifications',
  'label.all': 'All',
  'label.regionAsiaPacific': 'Asia & Pacific',
  'label.regionEurope': 'Europe',
  'label.regionAmericas': 'Americas',
  'label.regionMiddleEast': 'Middle East',
  'label.regionAfrica': 'Africa',
  'label.regionGlobal': 'Global',
  'label.pinnedMessage': 'Pinned Message',
  'label.stickers': 'Expressive Stickers',
  'auth.welcomeBack': 'Welcome back to LiveConnect',
  'auth.createAccount': 'Create your LiveConnect account',
  'auth.signIn': 'Sign In',
  'auth.signUp': 'Sign Up',
  'auth.email': 'Email Address',
  'auth.password': 'Password',
  'auth.fullName': 'Display Name',
  'auth.username': 'Unique Username',
  'auth.forgotPassword': 'Forgot password?',
  'auth.sendReset': 'Send Reset Link',
  'auth.backToLogin': 'Back to Login',
  'auth.alreadyHaveAccount': 'Already have an account?',
  'auth.dontHaveAccount': "Don't have an account?",
  'auth.selectCountry': 'Select Country',
  'auth.selectGender': 'Select Gender',
  'auth.bio': 'Bio / Status',
  'auth.language': 'Language',
  'auth.tagline': 'Free, Secure & Real-time HD Messaging & Calling',
  'auth.continueWithGoogle': 'Continue with Google',
  'auth.agreePrefix': 'I agree to the',
  'auth.termsOfUse': 'Terms of Use',
  'auth.and': 'and',
  'auth.privacyPolicy': 'Privacy Policy',
  'auth.googleInstantHint': 'Sign in or create your account instantly with Google',
  'auth.mustAgreeTerms': 'Please agree to the Terms of Use and Privacy Policy to continue.',
};

export const EN_GB_DICT: TranslationKeys = {
  ...EN_DICT,
  'auth.tagline': 'Free, Secure & Real-Time HD Messaging & Calling',
  'desc.helpCenterSub': 'FAQs, guides, call assistance & contact support',
};
