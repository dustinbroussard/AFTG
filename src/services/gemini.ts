import { GoogleGenAI, Type } from "@google/genai";
import { TriviaQuestion } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const questionSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          question: { type: Type.STRING },
          choices: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          answerIndex: { type: Type.INTEGER },
          correctQuip: { type: Type.STRING },
          wrongAnswerQuips: {
            type: Type.OBJECT,
            properties: {
              "0": { type: Type.STRING },
              "1": { type: Type.STRING },
              "2": { type: Type.STRING },
              "3": { type: Type.STRING }
            }
          }
        },
        required: ["category", "question", "choices", "answerIndex", "correctQuip", "wrongAnswerQuips"]
      }
    }
  }
};

type ExistingQuestion = Pick<TriviaQuestion, 'category' | 'question'>;

const QUESTION_LENSES = [
  'obscure-but-fair connections',
  'unexpected comparisons',
  'cause-and-effect trivia',
  'timeline-based clues',
  'famous failures and near misses',
  'counterintuitive facts',
  'cultural crossovers',
  'deep-cut but solvable references',
];

const QUESTION_STYLES = [
  'mostly clue-driven prompts',
  'mostly scenario-based prompts',
  'mostly direct factual prompts',
  'mostly comparative prompts',
  'mostly short setup with sharp punchline prompts',
];

const DIFFICULTY_SHAPES = [
  'lean slightly mainstream',
  'lean slightly niche',
  'mix one obvious anchor with less obvious context',
  'favor answers that require recognition over pure recall',
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length > 2);
}

function similarityScore(a: string, b: string) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));

  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.min(aTokens.size, bTokens.size);
}

function isTooSimilar(candidate: ExistingQuestion, existing: ExistingQuestion) {
  if (candidate.category !== existing.category) return false;

  const candidateNormalized = normalizeText(candidate.question);
  const existingNormalized = normalizeText(existing.question);

  if (!candidateNormalized || !existingNormalized) return true;
  if (candidateNormalized === existingNormalized) return true;
  if (candidateNormalized.includes(existingNormalized) || existingNormalized.includes(candidateNormalized)) return true;

  return similarityScore(candidate.question, existing.question) >= 0.7;
}

function isValidQuestionShape(question: any) {
  if (!question || typeof question.question !== 'string' || typeof question.category !== 'string') return false;
  if (!Array.isArray(question.choices) || question.choices.length !== 4) return false;
  if (!Number.isInteger(question.answerIndex) || question.answerIndex < 0 || question.answerIndex > 3) return false;

  const normalizedChoices = question.choices.map((choice: string) => normalizeText(choice));
  if (normalizedChoices.some((choice: string) => !choice)) return false;
  if (new Set(normalizedChoices).size !== 4) return false;

  return true;
}

function buildQuestionPrompt(categories: string[], countPerCategory: number, existingQuestions: ExistingQuestion[]) {
  const seed = Math.random().toString(36).slice(2, 10);
  const lens = QUESTION_LENSES[Math.floor(Math.random() * QUESTION_LENSES.length)];
  const style = QUESTION_STYLES[Math.floor(Math.random() * QUESTION_STYLES.length)];
  const difficultyShape = DIFFICULTY_SHAPES[Math.floor(Math.random() * DIFFICULTY_SHAPES.length)];
  const recentQuestionsByCategory = categories
    .map(category => {
      const recent = existingQuestions
        .filter(item => item.category === category)
        .slice(-8)
        .map(item => `- ${item.question}`);

      return recent.length > 0
        ? `${category} recent questions to avoid:\n${recent.join('\n')}`
        : `${category} recent questions to avoid:\n- None recorded`;
    })
    .join('\n\n');

  const requestedCount = countPerCategory + 2;

  return `Generate ${requestedCount} multiple choice trivia questions for these categories: ${categories.join(", ")}.

Return questions that feel fresh, varied, and unpredictable.
Variation seed for this batch: ${seed}
Creative steering for this batch:
- Emphasize ${lens}.
- Use ${style}.
- Difficulty shape: ${difficultyShape}.

Hard constraints:
- Do not repeat or closely paraphrase any avoided question.
- Avoid the most obvious trivia chestnuts, meme facts, and overused beginner prompts.
- Spread questions across different subtopics, eras, people, places, and formats.
- Vary the question style: some direct, some scenario-based, some clue-driven, some comparative.
- Keep difficulty in the fun middle: surprising but still answerable.
- Exactly 4 distinct answer choices per question.
- Wrong choices must be plausible enough to create tension, not joke throwaways.
- Provide a smug/celebratory quip for the correct answer and a unique sarcastic roast for each wrong answer.
- Tone: irreverent, sarcastic, funny, like "You Don't Know Jack".

Avoided recent questions:
${recentQuestionsByCategory}`;
}

function dedupeQuestions(
  generatedQuestions: any[],
  existingQuestions: ExistingQuestion[],
  countPerCategory: number
): TriviaQuestion[] {
  const accepted: TriviaQuestion[] = [];
  const seen: ExistingQuestion[] = [...existingQuestions];
  const counts = new Map<string, number>();

  for (const question of generatedQuestions) {
    if (!isValidQuestionShape(question)) continue;

    const candidate = {
      category: question.category,
      question: question.question,
    };

    if (seen.some(existing => isTooSimilar(candidate, existing))) continue;

    const currentCount = counts.get(question.category) ?? 0;
    if (currentCount >= countPerCategory) continue;

    counts.set(question.category, currentCount + 1);
    seen.push(candidate);

    accepted.push({
      ...question,
      id: '',
      used: false,
    });
  }

  return accepted;
}

async function requestQuestions(prompt: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: questionSchema as any
    }
  });

  return JSON.parse(response.text || '{"questions": []}');
}

export async function generateQuestions(
  categories: string[],
  countPerCategory: number = 3,
  existingQuestions: ExistingQuestion[] = []
): Promise<TriviaQuestion[]> {
  let accepted: TriviaQuestion[] = [];
  let avoidanceList = [...existingQuestions];

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prompt = buildQuestionPrompt(categories, countPerCategory, avoidanceList);
      const data = await requestQuestions(prompt);
      const deduped = dedupeQuestions(data.questions || [], avoidanceList, countPerCategory);

      accepted = [...accepted, ...deduped].filter((question, index, array) => {
        return array.findIndex(other =>
          other.category === question.category &&
          normalizeText(other.question) === normalizeText(question.question)
        ) === index;
      });

      avoidanceList = [...avoidanceList, ...accepted.map(({ category, question }) => ({ category, question }))];

      const hasEnough = categories.every(category =>
        accepted.filter(question => question.category === category).length >= countPerCategory
      );

      if (hasEnough) break;
    }

    return accepted.map((q, index) => ({
      ...q,
      id: `${Date.now()}-${index}`,
      used: false
    }));
  } catch (error) {
    console.warn("Primary AI failed, attempting OpenRouter fallback...", error);
    
    try {
      if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing");

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const prompt = buildQuestionPrompt(categories, countPerCategory, avoidanceList);
        const fallbackPrompt = prompt + `\n\nCRITICAL: You MUST return ONLY valid JSON matching this structure without any markdown fencing or extra text: {"questions": [{"category": "string", "question": "string", "choices": ["string", "string", "string", "string"], "answerIndex": 0, "correctQuip": "string", "wrongAnswerQuips": {"0": "string", "1": "string", "2": "string", "3": "string"}}]}`;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.href,
            "X-Title": "AFTG Trivia"
          },
          body: JSON.stringify({
            model: "openrouter/free",
            messages: [{ role: "user", content: fallbackPrompt }]
          })
        });

        if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);

        const data = await response.json();
        let content = data.choices?.[0]?.message?.content || '{"questions": []}';

        // Strip markdown codeblocks if openrouter models ignore instructions
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();

        const parsedData = JSON.parse(content);
        const deduped = dedupeQuestions(parsedData.questions || [], avoidanceList, countPerCategory);

        accepted = [...accepted, ...deduped].filter((question, index, array) => {
          return array.findIndex(other =>
            other.category === question.category &&
            normalizeText(other.question) === normalizeText(question.question)
          ) === index;
        });

        avoidanceList = [...avoidanceList, ...accepted.map(({ category, question }) => ({ category, question }))];

        const hasEnough = categories.every(category =>
          accepted.filter(question => question.category === category).length >= countPerCategory
        );

        if (hasEnough) break;
      }

      return accepted.map((q, index) => ({
        ...q,
        id: `or-${Date.now()}-${index}`,
        used: false
      }));
    } catch (fallbackError) {
      console.error("Fallback OpenRouter failed:", fallbackError);
      return [];
    }
  }
}

export async function generateRoast(
  category: string,
  question: string,
  answer: string,
  isCorrect: boolean,
  playerName: string,
  streak: number,
  score: number,
  completedCategories: string[]
): Promise<string> {
  const prompt = `You are a smug, sarcastic trivia host (like "You Don't Know Jack"). 
  Player "${playerName}" just answered a question in the "${category}" category.
  Question: "${question}"
  Their answer was: "${answer}"
  Result: ${isCorrect ? "CORRECT" : "WRONG"}
  Current Streak: ${streak}
  Total Score: ${score}
  Categories they've already completed: ${completedCategories.length > 0 ? completedCategories.join(', ') : 'None yet'}

  Generate a short (1-2 sentence) roast or celebratory quip. 
  If they were correct, be begrudgingly impressed or smugly supportive. 
  If they were wrong, be hilariously insulting. Reference their failure, the specific category, their past performance (completed categories), or their pathetic score/streak.
  Keep it irreverent, highly context-aware, and funny.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return response.text || (isCorrect ? "Fine, you got it. Don't let it go to your head." : "Wow, that was impressively stupid.");
  } catch (error) {
    console.warn("Primary AI failed for roasting, attempting OpenRouter fallback...", error);
    
    try {
      if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing");
      
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.href,
          "X-Title": "AFTG Trivia"
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
      
      const data = await response.json();
      return data.choices?.[0]?.message?.content || (isCorrect ? "Correct." : "Dead wrong.");
    } catch (fallbackError) {
      console.error("Error generating fallback roast:", fallbackError);
      return isCorrect ? "Correct!" : "Wrong!";
    }
  }
}
