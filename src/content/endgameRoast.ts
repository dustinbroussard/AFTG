import type { RecentAiQuestionContext } from './heckles.js';
import { MODERN_HOST_PERSONA } from './hostPersona.js';

export interface EndgameRoastGenerationContext {
  winnerName: string;
  loserName: string;
  winnerScore: number;
  loserScore: number;
  winnerTrophies: number;
  loserTrophies: number;
  winnerRecentQuestionHistory?: RecentAiQuestionContext[];
  loserRecentQuestionHistory?: RecentAiQuestionContext[];
  isSolo: boolean;
}

export interface EndgameRoastResult {
  loserRoast: string;
  winnerCompliment: string;
}

const TOTAL_TROPHIES_IN_MATCH = 6;

export function getFallbackEndgameMessage(context: Pick<EndgameRoastGenerationContext, 'winnerName' | 'loserName'>, isWinnerView: boolean) {
  if (isWinnerView) {
    return `You collected all ${TOTAL_TROPHIES_IN_MATCH} trophies. ${context.loserName} was kind enough to witness it.`;
  }

  return `${context.winnerName} took all ${TOTAL_TROPHIES_IN_MATCH} trophies and left you with the postgame debris.`;
}

export function getFallbackEndgameRoast(context: Pick<EndgameRoastGenerationContext, 'winnerName' | 'loserName'>): EndgameRoastResult {
  return {
    loserRoast: `${context.loserName}, the scoreboard closed the argument a while ago. You were just there for the paperwork.`,
    winnerCompliment: `${context.winnerName}, annoyingly solid work. Try not to make dominance look that routine next time.`,
  };
}

export function buildEndgameRoastPrompt(context: EndgameRoastGenerationContext) {
  return `You write the final post-game sendoff for a multiplayer trivia match. Speak as a smug, witty, slightly mean game show host delivering one last verdict.
The comedy should feel earned by the match details: smart, memorable, and specific enough that the players could not swap names and reuse it.

Return ONLY valid JSON.
Do not include markdown.
Do not include commentary outside the JSON.

Return this exact shape:
{
  "loserRoast": string,
  "winnerCompliment": string
}

Context:
- Winner: ${context.winnerName}
- Loser: ${context.loserName}
- Final points score: ${context.winnerName} ${context.winnerScore}, ${context.loserName} ${context.loserScore}
- Final trophy count: ${context.winnerName} ${context.winnerTrophies}, ${context.loserName} ${context.loserTrophies}
- Match rules:
  - There are exactly ${TOTAL_TROPHIES_IN_MATCH} trophies in a full match, one per category.
  - The first player to capture all ${TOTAL_TROPHIES_IN_MATCH} trophies wins the match.
  - Trophy counts cannot exceed ${TOTAL_TROPHIES_IN_MATCH}.
  - Points and trophies are different numbers. Points are the running trivia score; trophies are captured categories.
  - Do not invent any alternate scoreline, trophy total, or win state that is not explicitly provided here.
  - Because this match is over, the winner should have ${TOTAL_TROPHIES_IN_MATCH} trophies.
- ${context.winnerName}'s last two resolved questions:
${context.winnerRecentQuestionHistory?.length
    ? context.winnerRecentQuestionHistory
        .map((item, index) => `  ${index + 1}. "${item.question}" | category: ${item.category} | difficulty: ${item.difficulty} | player answer: "${item.playerAnswer}" | correct answer: "${item.correctAnswer}" | result: ${item.result}`)
        .join('\n')
    : '  None recorded'}
- ${context.loserName}'s last two resolved questions:
${context.loserRecentQuestionHistory?.length
    ? context.loserRecentQuestionHistory
        .map((item, index) => `  ${index + 1}. "${item.question}" | category: ${item.category} | difficulty: ${item.difficulty} | player answer: "${item.playerAnswer}" | correct answer: "${item.correctAnswer}" | result: ${item.result}`)
        .join('\n')
    : '  None recorded'}

Rules:
${MODERN_HOST_PERSONA}

Tone:
- Highbrow, smug, impatient, professionally condescending
- Witty, sarcastic, funny
- Adult-oriented; mild profanity is allowed when it sharpens the sting
- Smart, not sloppy
- Sophisticated, original, and tailored to the actual path this match took
- Funny because it is observant, not because it is loud
- Write one playful, smug tease that is addressed to the loser only
- Write one half-hearted, backhanded compliment that is addressed to the winner only
- Return only the JSON object
- Each line must be 1 to 2 sentences max
- Keep each line under 32 words
- Sound specific to this exact match, not generic
- Use concrete details from the score, trophies, question topics, wrong answers, correct answers, or recent outcomes whenever possible
- Let the loser line sting because it recognizes the nature of the collapse, not merely the fact of losing
- Let the winner line sound like reluctant praise from someone annoyed that competence has forced their hand
- If there is a strong contrast between the players' recent answers, exploit it
- If you mention the match state, describe it using the exact supplied points and trophies
- Never imply a trophy score such as "9-0" or any other impossible total
- Avoid bland victory-language, generic consolation, or boilerplate roast phrasing
- Keep it sharp, adult, and funny, but not hateful
- No slurs
- No hate content
- No threats
- No sexual content
- No self-harm content
- No meta commentary`;
}
