import { describe, it, expect } from "vitest";
import { detectBargeIn, isStopCommand, listenRetryDelay } from "./drivingVoice";

describe("isStopCommand", () => {
  it.each([
    "band karo", "Band kar do", "band kardo.", "please band karo", "driving mode band karo", "ab bas band karo",
    "stop", "Stop!", "बंद करो", "बंद कर दो", "बंद करा", "বন্ধ করো", "ಬಂದ್ ಮಾಡು", "ನಿಲ್ಲಿಸು",
  ])("stops on %s", (t) => expect(isStopCommand(t)).toBe(true));

  it.each([
    "", "haan", "500 kamaye", "petrol pump band tha 500 kharch hua",
    "dukaan band karo mat bolna kal", "मेरी दुकान आज बंद थी", "stop pe 200 diye",
  ])("does not stop on %s", (t) => expect(isStopCommand(t)).toBe(false));
});

describe("detectBargeIn", () => {
  const reply = "Aapne 500 rupaye ki kamai batayi hai, category Ride Earnings, aaj ki date. Sahi hai?";

  it("ignores the AI's own voice (echo)", () => {
    expect(detectBargeIn("aapne 500 rupaye ki kamai", reply)).toBeNull();
    expect(detectBargeIn("category ride earnings aaj ki", reply)).toBeNull();
    expect(detectBargeIn("aapne 500 rupay ki kamaai", reply)).toBeNull(); // spelling slip
  });

  it("interrupts on ruko / stop / bas", () => {
    expect(detectBargeIn("ruko", reply)).toBe("interrupt");
    expect(detectBargeIn("रुको रुको", reply)).toBe("interrupt");
    expect(detectBargeIn("bas", reply)).toBe("interrupt");
  });

  it("does not treat an interrupt word the AI itself is saying as barge-in", () => {
    expect(detectBargeIn("bas", "Bas 200 rupaye bache hain")).toBeNull();
  });

  it("interrupts when the user says something new", () => {
    expect(detectBargeIn("nahi nahi petrol ka kharcha tha", reply)).toBe("interrupt");
  });

  it("needs at least three new words", () => {
    expect(detectBargeIn("nahi tha", reply)).toBeNull();
  });

  it("exits on band karo", () => {
    expect(detectBargeIn("band karo", reply)).toBe("exit");
  });
});

describe("listenRetryDelay", () => {
  it("backs off and caps", () => {
    expect(listenRetryDelay(0)).toBe(300);
    expect(listenRetryDelay(1)).toBe(500);
    expect(listenRetryDelay(2)).toBe(1000);
    expect(listenRetryDelay(4)).toBe(4000);
    expect(listenRetryDelay(10)).toBe(6000);
  });
});
