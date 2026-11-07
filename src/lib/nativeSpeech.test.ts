import { describe, expect, it } from "vitest";
import { inferSpeechLangFromText } from "./nativeSpeech";

describe("inferSpeechLangFromText", () => {
  it("learns Hindi from Devanagari", () => {
    expect(inferSpeechLangFromText("आज पेट्रोल में कितना खर्च हुआ", "en-IN")).toBe("hi-IN");
  });

  it("learns Marathi from Devanagari", () => {
    expect(inferSpeechLangFromText("मला आज किती खर्च झाला", "en-IN")).toBe("mr-IN");
  });

  it("learns Hinglish from Roman words", () => {
    expect(inferSpeechLangFromText("aaj petrol ka kharcha batao", "en-IN")).toBe("hi-IN");
  });

  it("learns Roman Marathi without changing on a weak English signal", () => {
    expect(inferSpeechLangFromText("mala aaj kiti kharch zala", "en-IN")).toBe("mr-IN");
    expect(inferSpeechLangFromText("I earned five hundred", "en-IN")).toBe("en-IN");
  });
});
