import type { RecentAiQuestionContext } from './heckles.js';
import { MODERN_HOST_PERSONA } from './hostPersona.js';

export type TrashTalkEvent = 'OPPONENT_TROPHY' | 'PLAYER_FALLING_BEHIND' | 'MATCH_LOSS';

export interface TrashTalkGenerationContext {
  event: TrashTalkEvent;
  playerName: string;
  opponentName: string;
  playerScore: number;
  opponentScore: number;
  scoreDelta: number;
  playerTrophies: number;
  opponentTrophies: number;
  latestCategory?: string;
  outcomeSummary: string;
  recentQuestionHistory?: RecentAiQuestionContext[];
  isSolo: boolean;
}

export function buildTrashTalkPrompt(context: TrashTalkGenerationContext) {
  return `Write one short trivia trash-talk line for a dramatic in-game overlay.
It should feel clever, surgically specific, and a little dangerous in the way good live television is dangerous.

Context:
- Event: ${context.event}
- Player being addressed: ${context.playerName}
- Opponent: ${context.opponentName}
- Points score: ${context.playerName} ${context.playerScore}, ${context.opponentName} ${context.opponentScore}
- Score delta: ${context.scoreDelta}
- Trophies: ${context.playerName} ${context.playerTrophies}, ${context.opponentName} ${context.opponentTrophies}
- Latest category swing: ${context.latestCategory || 'Unknown'}
- Outcome summary: ${context.outcomeSummary}
- Match rules:
  - There are exactly 6 trophies total, one per category.
  - First to 6 trophies wins the entire match.
  - Trophy counts cannot exceed 6.
  - Points and trophies are not the same thing.
  - Do not invent a trophy scoreline, points total, or match result that is not explicitly supplied.
- Last two resolved questions:
${context.recentQuestionHistory?.length
  ? context.recentQuestionHistory
      .map((item, index) => `  ${index + 1}. "${item.question}" | category: ${item.category} | player answer: "${item.playerAnswer}" | correct answer: "${item.correctAnswer}" | result: ${item.result}`)
      .join('\n')
  : '  None recorded'}

Rules:
${MODERN_HOST_PERSONA}

Tone:
- Highbrow, smug, impatient, professionally condescending
- Witty, sarcastic, funny
- Adult-oriented; mild profanity is allowed when it sharpens the sting
- Smart, not sloppy
- Sophisticated, original, and visibly tailored to the moment
- Funny because it notices something true, not because it shouts
- Confident enough to be brief

- Return only the trash-talk line
- One to two sentences max
- Sound sharp, witty, smug, and playful
- Make it feel handcrafted to this exact moment
- Use the supplied specifics when available; anchor the line in the actual miss, category swing, score, or recent answer history
- Favor one incisive observation, one elegant comparison, or one nasty little reversal
- If there is a category-specific angle available, use it
- If the player is behind, make the line acknowledge the scoreboard pressure rather than speaking in generic swagger
- If you mention the state of the match, use the exact supplied points and trophies
- Do not claim the match is over unless the event is MATCH_LOSS
- Never imply an impossible trophy score such as "9-0"
- Avoid generic sports-announcer filler or insults that could fit any match
- Prefer one precise observation over broad swagger
- Avoid cliches like "you got cooked," "skill issue," "that's embarrassing," or any obvious meme phrasing
- Make it read like a large on-screen sting card, not a sidebar caption
- No slurs
- No hate content
- No threats
- No sexual content
- No self-harm content
- No meta commentary
`;
}
