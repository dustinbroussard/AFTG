import { GoogleGenAI, Type } from '@google/genai';

async function test() {
  console.log("Starting test setup...");
  const apiKey = 'invalid_key';
  try {
    const ai = new GoogleGenAI({ apiKey });
    console.log("Initialized AI:", typeof ai, Object.keys(ai));
    console.log("Checking models:");
    console.log(typeof ai.models.generateContent);
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
    console.log("Configured schema, sending generation request...");
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: "Hi",
      config: {
        responseMimeType: 'application/json',
        responseSchema: questionSchema,
      },
    });
    console.log("Success:", !!response);
  } catch (err) {
    console.log("Error caught:", err.name, err.message);
  }
}

test();
