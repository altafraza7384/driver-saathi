import { describe, it, expect } from "vitest";
import { isStopCommand, listenRetryDelay } from "./drivingVoice";

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

describe("listenRetryDelay", () => {
  it("backs off and caps", () => {
    expect(listenRetryDelay(0)).toBe(300);
    expect(listenRetryDelay(1)).toBe(500);
    expect(listenRetryDelay(2)).toBe(1000);
    expect(listenRetryDelay(4)).toBe(4000);
    expect(listenRetryDelay(10)).toBe(6000);
  });
});
