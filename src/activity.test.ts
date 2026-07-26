import { describe, expect, it } from "vitest";
import { ACTIVITY_EVENT_LABELS, eventLabel } from "./activity";

describe("activity event labels", () => {
  it("humanizes the minimum event taxonomy", () => {
    expect(Object.keys(ACTIVITY_EVENT_LABELS).sort()).toEqual([
      "claimed",
      "completed",
      "deliverable_submitted",
      "floor_reached",
      "listed",
      "target_reached",
    ]);
    expect(eventLabel("floor_reached")).toBe("Floor reached");
    expect(eventLabel("deliverable_submitted")).toBe("Deliverable submitted");
    expect(eventLabel("custom_thing")).toBe("Custom thing");
  });
});
