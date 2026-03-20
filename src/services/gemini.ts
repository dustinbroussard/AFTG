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

export async function generateQuestions(categories: string[], countPerCategory: number = 3): Promise<TriviaQuestion[]> {
  const prompt = `Generate ${countPerCategory} multiple choice trivia questions for each of the following categories: ${categories.join(", ")}. 
  The tone must be irreverent, sarcastic, and funny (like "You Don't Know Jack"). 
  Provide a smug/celebratory quip for the correct answer and a unique sarcastic roast for each wrong answer.
  Ensure the questions are interesting but not impossible.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: questionSchema as any
      }
    });

    const data = JSON.parse(response.text || '{"questions": []}');
    return data.questions.map((q: any, index: number) => ({
      ...q,
      id: `${Date.now()}-${index}`,
      used: false
    }));
  } catch (error) {
    console.warn("Primary AI failed, attempting OpenRouter fallback...", error);
    
    try {
      if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing");
      
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
      return (parsedData.questions || []).map((q: any, index: number) => ({
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
