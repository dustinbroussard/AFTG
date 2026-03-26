# Supabase Migration Roadmap

## 1. Current Firestore Model to Preserve

The current app uses these top-level Firestore structures:

- `users/{uid}`
  - profile metadata
  - `private/settings`
  - `recentPlayers`
  - `seenQuestions`
  - `gameHistory`
  - `matchups/{otherUid}/games`
  - `invites`
- `questions/{questionId}`
- `flaggedQuestions/{flagId}`
- `games/{gameId}`
  - `players`
  - `questions`
  - `messages`
  - inline `answers` map on the game document

Relevant source references:

- [`firebase-blueprint.json`](/home/dustin/A-F-cking-Trivia-Game/firebase-blueprint.json)
- [`firestore.rules`](/home/dustin/A-F-cking-Trivia-Game/firestore.rules)
- [`src/services/playerProfiles.ts`](/home/dustin/A-F-cking-Trivia-Game/src/services/playerProfiles.ts)
- [`src/services/invites.ts`](/home/dustin/A-F-cking-Trivia-Game/src/services/invites.ts)

## 2. Target PostgreSQL Schema

Use Supabase `auth.users` as the identity source of truth and map legacy Firebase UIDs in `public.profiles.firebase_uid`.

Core tables:

- `public.profiles`
  - one row per authenticated player
  - stores game-specific metadata and aggregate stats
- `public.user_settings`
  - replacement for `users/{uid}/private/settings`
- `public.questions`
  - canonical AI question bank
  - `content`, `correct_answer`, `distractors jsonb`, `category`, `difficulty_level`
  - plus legacy validation/styling fields already used by the app
- `public.question_flags`
  - replacement for `flaggedQuestions`
- `public.games`
  - top-level session state
- `public.game_players`
  - replacement for `games/{gameId}/players`
- `public.game_questions`
  - replacement for `games/{gameId}/questions`
- `public.game_answers`
  - normalized replacement for Firestore’s inline `answers.{questionId}.{uid}`
- `public.game_messages`
  - replacement for `games/{gameId}/messages`
- `public.game_invites`
  - replacement for `users/{uid}/invites`
- `public.seen_questions`
  - replacement for `users/{uid}/seenQuestions`
- `public.recent_player_edges`
  - replacement for `users/{uid}/recentPlayers`

Derived views:

- `public.profile_recent_completed_games`
- `public.profile_matchup_summaries`

DDL lives in [`supabase/schema.sql`](/home/dustin/A-F-cking-Trivia-Game/supabase/schema.sql).

## 3. Authentication Migration Strategy

### Google / OAuth accounts

Use Supabase Auth with Google enabled. Because Firebase UID values will not equal Supabase `auth.users.id`, preserve the old UID in `profiles.firebase_uid` and `auth_identity_migrations.firebase_uid`.

Recommended cutover:

1. Export Firebase Auth users.
2. Create matching Supabase auth users with Admin API.
3. Save the Firebase UID to `profiles.firebase_uid`.
4. On first Supabase login, resolve the player profile by `auth.uid()` and keep the old Firebase UID only as a legacy join key.

### Email/password accounts

Firebase password hashes are not portable into Supabase Auth in a practical way for this app. Use forced password reset:

1. Create the Supabase user account with a random temporary password.
2. Mark `requires_password_reset = true` in `auth_identity_migrations`.
3. Send Supabase password reset emails before traffic cutover.
4. Block gameplay until reset is completed if `requires_password_reset` is still true.

### User ID consistency rule

After cutover:

- canonical user identity: `auth.users.id`
- legacy lookup key: `profiles.firebase_uid`
- all relational foreign keys should reference `profiles.id`, not Firebase UID text

## 4. Migration Logic

### Order of operations

1. Provision schema and RLS in Supabase.
2. Migrate auth identities and profiles.
3. Migrate canonical questions.
4. Migrate games, players, questions, answers, and messages.
5. Migrate recent players, invites, and seen-question edges.
6. Switch reads to Supabase.
7. Enable dual-write.
8. Verify parity.
9. Remove Firebase.

### Transformation rules

#### Users

Firestore:

- `users/{uid}`
- `users/{uid}/private/settings`

Supabase:

- `profiles.id = auth.users.id`
- `profiles.firebase_uid = {uid}`
- `user_settings.profile_id = profiles.id`

#### Questions

Firestore question shape stores `choices[]` and `correctIndex`.

Supabase stores:

- `content = question`
- `correct_answer = choices[correctIndex]`
- `distractors = choices without correctIndex`
- `difficulty_level = difficulty`

Duplicate prevention happens at the database layer with a generated `question_hash` unique index.

#### Game sessions

Firestore embedded/subcollection state becomes normalized:

- `games/{gameId}` -> `games`
- `games/{gameId}/players` -> `game_players`
- `games/{gameId}/questions` -> `game_questions`
- `games.answers` map -> `game_answers`
- `games/{gameId}/messages` -> `game_messages`

### Migration utility

Example script:

- [`scripts/migrate-firestore-to-supabase.example.mjs`](/home/dustin/A-F-cking-Trivia-Game/scripts/migrate-firestore-to-supabase.example.mjs)

It performs:

- Firebase Auth export + profile lookup
- Supabase auth user creation
- profile/settings upsert
- question upsert
- game/session normalization
- recent-player and seen-question edge migration

## 5. AI Pipeline Integration

The current AI pipeline writes question documents to Firestore and later reads them back during sessions. The Supabase replacement should write directly into `public.questions`.

Recommended insert pattern:

```ts
const { data, error } = await supabase
  .from('questions')
  .upsert(payload, { onConflict: 'question_hash', ignoreDuplicates: true })
  .select('id, question_hash');
```

Validation flow should remain:

1. generate
2. structural validation
3. verification
4. styling
5. insert into `questions`

Enforcement moves from application-only validation to application + database:

- `jsonb_array_length(distractors) = 3`
- unique `question_hash`
- enum-backed `difficulty_level`
- enum-backed `validation_status`

## 6. Real-Time Replacement for Firestore Listeners

Use Supabase Realtime on:

- `games`
- `game_players`
- `game_questions`
- `game_answers`
- `game_messages`
- `game_invites`

Recommended channel breakdown:

- lobby status: `games:id=eq.<game_id>`
- roster/scoreboard: `game_players:game_id=eq.<game_id>`
- answer resolution: `game_answers`
- chat: `game_messages`
- invite inbox: `game_invites:to_profile_id=eq.<profile_id>`

The schema file already adds these tables to `supabase_realtime`.

## 7. Performance Plan

Question retrieval needs to stay fast during active sessions.

Indexes included in the SQL:

- `questions(category, difficulty_level, validation_status, used_count, created_at)`
- unique `questions(question_hash)`
- waiting-game join-code uniqueness
- `game_players(profile_id, joined_at desc)`
- `game_questions(game_id, used, ordinal)`
- `game_messages(game_id, created_at desc)`
- `recent_player_edges(owner_profile_id, last_played_at desc)`

Additional operational advice:

- cache question IDs already seen per player in memory during a session
- use RPC or a single SQL query to fetch unseen approved questions by category
- avoid rebuilding `gameHistory` duplicates; use relational queries/views

## 8. Security Model: Firestore Rules to RLS

Firestore rules today are broad for games and strict for per-user subcollections. Supabase should be stricter.

Mapping:

- `users/{uid}` owner-only -> `profiles`, `user_settings`, `recent_player_edges`, `seen_questions` RLS with `auth.uid() = profile_id`
- `games/*` authenticated read/write -> participant-based RLS using `game_players`
- `questions/*` authenticated read/write -> authenticated read, service-role write
- `invites` -> sender insert, sender/recipient read, sender/recipient update

This is implemented in [`supabase/schema.sql`](/home/dustin/A-F-cking-Trivia-Game/supabase/schema.sql).

## 9. Safe-Delete Decommissioning Strategy

### Audit phase

Scan for:

- `firebase-admin`
- `firebase/app`
- `firebase/auth`
- `firebase/firestore`
- `firebase-functions`

Map each call site to one of:

- Supabase Auth
- Supabase PostgREST / client SDK
- Supabase Realtime
- SQL view / RPC

### Redundancy phase

Introduce a repository boundary:

```ts
export interface BackendService {
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  ensurePlayerProfile(): Promise<void>;
  subscribePlayerProfile(uid: string, cb: (profile: PlayerProfile | null) => void): () => void;
  subscribeRecentPlayers(uid: string, cb: (players: RecentPlayer[]) => void): () => void;
  createGame(input: CreateGameInput): Promise<GameState>;
  joinGame(code: string, avatarUrl: string): Promise<GameState>;
  recordAnswer(input: RecordAnswerInput): Promise<void>;
}
```

Implementation plan:

1. rename direct Firebase calls into a `FirebaseBackendService`
2. add `SupabaseBackendService`
3. route by feature flag:
   - `VITE_BACKEND_PROVIDER=firebase|supabase|dual`
4. in `dual` mode:
   - reads come from Supabase shadow dashboards and test paths only
   - writes go to both backends
   - compare row/document counts and critical fields

### Cleanup phase

Delete Firebase only after all of these are true:

- Supabase auth sign-in is live in production
- lobby/game/invite/chat subscriptions use Supabase Realtime
- question generation writes only to Supabase
- migration parity checks pass
- dual-write diff reports are clean for a full release cycle

Then remove:

- Firebase app initialization
- Firestore listeners
- Firebase auth helpers
- Firebase Functions deployment config
- `firebase-applet-config.json`
- Firestore rules/indexes files
- any `google-services.json` / Firebase config payloads if present in deployment targets

## 10. Code-Level Implementation Guide

### Supabase service pattern

Keep UI components unaware of the backend choice.

```ts
export function createBackendService(provider: 'firebase' | 'supabase' | 'dual'): BackendService {
  switch (provider) {
    case 'supabase':
      return new SupabaseBackendService();
    case 'dual':
      return new DualWriteBackendService(
        new FirebaseBackendService(),
        new SupabaseBackendService(),
      );
    default:
      return new FirebaseBackendService();
  }
}
```

### Question insert example

```ts
const distractors = question.choices.filter((_, index) => index !== question.correctIndex);

await supabase.from('questions').upsert({
  content: question.question,
  correct_answer: question.choices[question.correctIndex],
  distractors,
  category: question.category,
  difficulty_level: question.difficulty,
  explanation: question.explanation,
  question_styled: question.questionStyled ?? null,
  explanation_styled: question.explanationStyled ?? null,
  host_lead_in: question.hostLeadIn ?? null,
  validation_status: question.validationStatus,
}, {
  onConflict: 'question_hash',
  ignoreDuplicates: true,
});
```

### Realtime lobby subscription example

```ts
const channel = supabase
  .channel(`game:${gameId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'games',
    filter: `id=eq.${gameId}`,
  }, handleGameUpdate)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'game_players',
    filter: `game_id=eq.${gameId}`,
  }, handlePlayersUpdate)
  .subscribe();
```

### Answer-write example

```ts
await supabase.from('game_answers').upsert({
  game_question_id,
  profile_id: user.id,
  answer_index: resolvedIndex,
  submitted_at: new Date().toISOString(),
  is_correct,
  source,
}, {
  onConflict: 'game_question_id,profile_id',
});
```

## 11. Verification Checklist

### Schema and auth

- [ ] every Firebase Auth user has a row in `auth_identity_migrations`
- [ ] every migrated auth user has a `profiles` row
- [ ] `profiles.firebase_uid` is unique for all migrated accounts
- [ ] password users are marked for reset or have completed reset

### Questions

- [ ] Firestore `questions` count matches Supabase `questions` count after dedupe rules are applied
- [ ] duplicate question text is blocked by `question_hash`
- [ ] question retrieval by category/difficulty is under acceptable latency during load test

### Games and realtime

- [ ] waiting lobby creation works in Supabase only mode
- [ ] join by code works against `games.join_code`
- [ ] game player roster updates arrive through Realtime
- [ ] question reveal and answer resolution arrive through Realtime
- [ ] chat messages persist and stream correctly

### User features

- [ ] invites work end-to-end
- [ ] recent players list matches Firestore data
- [ ] seen questions suppress repeats
- [ ] player stats and matchup summaries match expected historical totals

### Safe delete

- [ ] no runtime imports remain from `firebase/*`
- [ ] no runtime imports remain from `firebase-admin/*`
- [ ] no Firebase env vars are required by production
- [ ] no Firebase listeners or init paths execute in the built app
- [ ] dual-write diff reports show no critical mismatches for one full release cycle
