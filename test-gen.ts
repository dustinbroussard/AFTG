import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  
  const questionSchema = {
    type: Type.OBJECT,
    properties: {
      questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            difficulty: { type: Type.STRING },
            question: { type: Type.STRING },
            choices: { type: Type.ARRAY, items: { type: Type.STRING } },
            correctIndex: { type: Type.INTEGER },
            explanation: { type: Type.STRING }
          },
          required: ["category", "difficulty", "question", "choices", "correctIndex", "explanation"]
        }
      }
    }
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: "Generate 1 trivia question about Science.",
      config: {
        responseMimeType: 'application/json',
        responseSchema: questionSchema,
      },
    });
    console.log("Success:", response.text);
  } catch (err: any) {
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Error cause:", err.cause);
    console.error(err);
  }
}

test();
