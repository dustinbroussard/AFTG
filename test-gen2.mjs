import { GoogleGenAI } from '@google/genai';

async function test() {
  const apiKey = 'invalid_key';
  const ai = new GoogleGenAI({ apiKey });
  
  // mock response
  const response = {
    text: "some text"
  };
  console.log(typeof response.text);
}

test();
