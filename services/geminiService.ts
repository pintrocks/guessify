import { GoogleGenAI } from "@google/genai";
import { Player } from "../types";

// Initialize Gemini Client
let aiInstance: GoogleGenAI | null = null;

const getAiClient = (): GoogleGenAI => {
  if (aiInstance) return aiInstance;

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("VITE_GEMINI_API_KEY is not set. AI features will likely fail.");
  }

  aiInstance = new GoogleGenAI({ apiKey: apiKey || 'dummy-key-to-prevent-crash' });
  return aiInstance;
};

/**
 * Generates a description of a target player as if it were written by a specific persona.
 */
export const generateAiDescription = async (
  describer: Player,
  target: Player
): Promise<string> => {
  try {
    const ai = getAiClient();
    const prompt = `
      You are playing a party game where you have to describe people.
      You are: ${describer.name}, a funny and casual character.
      Your target is: ${target.name} (Avatar: ${target.avatar}).
      Visually describe ${target.name} in one short, quirky sentence. 
      Focus on physical traits or clothing based on their avatar emoji/icon. 
      Do not include their name in the description.
      Keep it under 15 words.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text?.trim() || `A mysterious person who looks like ${target.avatar}`;
  } catch (error) {
    console.error("Error generating description:", error);
    return "A cool looking person.";
  }
};

/**
 * AI attempts to guess who the description is about.
 */
export const generateAiGuess = async (
  guesser: Player,
  description: string,
  candidates: Player[]
): Promise<string> => {
  try {
    const ai = getAiClient();
    const candidateList = candidates.map(c => `- ID: ${c.id}, Name: ${c.name}, Avatar: ${c.avatar}`).join('\n');
    const prompt = `
      You are playing a guessing game.
      Description: "${description}"
      
      Candidates:
      ${candidateList}
      
      Who fits the description best? Return ONLY the ID of the person.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const text = response.text?.trim() || '';
    // Find a matching ID in the text
    const matched = candidates.find(c => text.includes(c.id));
    return matched ? matched.id : candidates[0].id;
  } catch (error) {
    console.error("Error generating guess:", error);
    return candidates[0].id;
  }
}

/**
 * Generates an image based on a description.
 */
export const generateAiDrawing = async (
  artist: Player,
  description: string
): Promise<string> => {
  try {
    // We use the 'gemini-3-pro-image-preview' for better image generation if available,
    // or fallback to 'gemini-2.5-flash-image'.
    const ai = getAiClient();
    
    const prompt = `
      A crude, hand-drawn style digital sketch of: ${description}. 
      White background, simple lines, black ink, like a Pictionary drawing.
      Drawn by a novice artist.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image', 
      contents: {
        parts: [{ text: prompt }]
      },
    });

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        }
      }
    }
    
    throw new Error("No image data found in response");

  } catch (error) {
    console.error("Error generating image:", error);
    return `https://placehold.co/400x400/png?text=AI+Drawing+Failed`;
  }
};
