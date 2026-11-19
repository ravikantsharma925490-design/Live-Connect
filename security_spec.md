# LiveConnect Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **PII Isolation**: User email addresses, phone numbers, moderation roles, and ban timestamps live exclusively in `/users/{userId}/private/info` and are NEVER stored in `/public_profiles/{userId}`.
2. **Identity Integrity**: No user may create a profile, follow, block, message, call, notification, or report impersonating another `request.auth.uid`.
3. **Username Uniqueness**: `/usernames/{usernameLower}` claims must match `request.auth.uid` and strictly validate `^[a-z0-9_]+$` (`3..32` chars).
4. **Master Gate Membership**: Messages, typing indicators, and group mutations require synchronous `exists(/conversations/{conversationId}/members/{uid})` verification. Removing a member revokes send/update access immediately.
5. **Block Enforcement**: Creating a direct conversation member or call targeting a user who has blocked (or been blocked by) the caller is denied at the rule layer.
6. **Privilege Escalation Prevention**: Users creating `/users/{userId}/private/info` MUST set `role: 'user'` and cannot alter `role` or `bannedUntil`.
7. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps MUST equal `request.time`.
8. **Terminal State Locking**: Once `/calls/{callId}` enters a terminal status (`ended`, `rejected`, `cancelled`, `missed`, `failed`), no further non-admin updates are permitted.
9. **Zero-Cost List Queries**: Every `allow list` rule evaluates `resource.data` or path `{userId}` directly without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return `PERMISSION_DENIED`)
1. **Unauthenticated Profile Read**: Anonymous client tries `getDoc('/public_profiles/u1')`.
2. **Ghost Field / Shadow Create**: Authenticated user creates `/public_profiles/{uid}` with extra field `isVerified: true`.
3. **Privilege Escalation**: Authenticated user creates `/users/{uid}/private/info` with `role: 'admin'`.
4. **PII Blanket Read**: Authenticated user A tries `getDoc('/users/userB/private/info')`.
5. **Identity Spoofing in Follow**: User A tries creating `/follows/userB_userC` with `followerId: 'userB'`.
6. **Self-Follow**: User A tries creating `/follows/userA_userA`.
7. **ID Poisoning**: User A tries writing `/problem_reports/` with a 500-char or invalid-character ID (`../admin`).
8. **Impersonated Message Send**: User A writes `/users/userB/inbox/conv1/messages/m1` with `senderId: 'userB'`.
9. **Removed-Member Message Injection**: Ex-member attempts to create a message in `/users/userB/inbox/group1/messages/m2` after removal from `/conversations/group1/members`.
10. **Client Timestamp Forgery**: User A creates `/problem_reports/r1` with a backdated `createdAt` instead of `request.time`.
11. **Terminal Call Re-opening**: User tries updating `/calls/c1` from `status: 'ended'` back to `status: 'connected'`.
12. **Blanket Collection Scrape**: User A runs unconstrained `getDocs(collection(db, 'follows'))` without filtering `followerId == uid` or `followingId == uid`.
