import { GoogleGenAI, Type } from "@google/genai";
import { Note, NoteType, AIAnalysisResult } from "../types";

const getAI = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API Key not found in process.env.API_KEY");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Analyzes a raw note to extract a title, tags, and category.
 */
export const analyzeNote = async (content: string): Promise<AIAnalysisResult | null> => {
  const ai = getAI();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Analyze the following note content. Classify it as a NOTE, TASK, or IDEA. 
      Generate a short, punchy title (max 5 words). 
      Generate up to 3 relevant tags.
      
      Content: "${content}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            type: { type: Type.STRING, enum: ["NOTE", "TASK", "IDEA"] },
          },
          required: ["title", "tags", "type"],
        },
      },
    });

    const text = response.text;
    if (!text) return null;
    
    const result = JSON.parse(text);
    
    // Map string to enum safely
    let noteType = NoteType.NOTE;
    if (result.type === 'TASK') noteType = NoteType.TASK;
    if (result.type === 'IDEA') noteType = NoteType.IDEA;

    return {
      title: result.title,
      tags: result.tags,
      type: noteType,
    };
  } catch (error) {
    console.error("Error analyzing note:", error);
    return null;
  }
};

/**
 * Takes a brain dump and splits it into multiple distinct notes/tasks
 */
export const processBatchEntry = async (content: string): Promise<AIAnalysisResult[]> => {
  const ai = getAI();
  if (!ai) return [];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are an expert organizer. The user has provided a "brain dump" of text.
      Split this text into distinct, atomic items (Tasks, Ideas, or Notes).
      
      For EACH item, provide a title, tags, and type.
      
      Input Text: "${content}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              content: { type: Type.STRING, description: "The extracted content for this specific item" },
              title: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              type: { type: Type.STRING, enum: ["NOTE", "TASK", "IDEA"] },
            },
            required: ["content", "title", "tags", "type"],
          }
        },
      },
    });

    const text = response.text;
    if (!text) return [];
    
    const results = JSON.parse(text);
    
    return results.map((r: any) => {
        let noteType = NoteType.NOTE;
        if (r.type === 'TASK') noteType = NoteType.TASK;
        if (r.type === 'IDEA') noteType = NoteType.IDEA;
        
        return {
            content: r.content, // We add content to the result for batch processing
            title: r.title,
            tags: r.tags,
            type: noteType
        };
    });

  } catch (error) {
    console.error("Error processing batch:", error);
    return [];
  }
};

/**
 * Semantic search / Q&A over notes
 */
export const askMyNotes = async (query: string, notes: Note[]): Promise<string> => {
  const ai = getAI();
  if (!ai) return "I need an API key to help you search.";

  // Limit context to recent 50 notes to avoid token limits in this demo
  const relevantNotes = notes.slice(0, 50);
  
  const context = relevantNotes.map(n => 
    `[ID: ${n.id}] [${n.type}] [${n.isCompleted ? 'DONE' : 'OPEN'}] (${new Date(n.createdAt).toLocaleDateString()}) ${n.content}`
  ).join('\n---\n');

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are a helpful personal assistant. 
      The user is asking a question about their notes.
      Here is the user's question: "${query}"
      
      Here are the user's notes:
      ${context}
      
      Answer the question based ONLY on the notes provided. 
      If the answer isn't in the notes, say "I couldn't find that in your notes."
      Be concise and friendly.`,
    });

    return response.text || "No answer generated.";
  } catch (error) {
    console.error("Error searching notes:", error);
    return "Sorry, I had trouble reading your notes right now.";
  }
};