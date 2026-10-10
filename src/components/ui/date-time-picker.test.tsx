import { useState } from "react";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DatePicker, TimePicker, parseDateValue } from "./date-time-picker";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

afterEach(cleanup);

describe("date-only values", () => {
  it("rejects invalid or non-ISO dates", () => {
    expect(parseDateValue("2026-02-30")).toBeUndefined();
    expect(parseDateValue("10/10/2026")).toBeUndefined();
    expect(parseDateValue("")).toBeUndefined();
    expect(parseDateValue("2028-02-29")?.getDate()).toBe(29);
  });
});

function Form() {
  const [value, setValue] = useState("2026-10-10");
  const [time, setTime] = useState("");
  return <Dialog defaultOpen><DialogContent aria-describedby={undefined}><DialogTitle>Test form</DialogTitle><DatePicker id="date" label="Date" value={value} onChange={setValue} /><TimePicker id="time" label="Notify Time" value={time} onChange={setTime} /><output data-testid="iso">{value}</output><output data-testid="time-value">{time}</output></DialogContent></Dialog>;
}

describe("nested modal pickers", () => {
  it("selects an ISO date, displays dd/MM/yyyy and returns to the parent", () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: /^Date$/ }));
    const calendar = screen.getByRole("grid");
    const day = calendar.querySelector('button[name="day"]');
    expect(day).not.toBeNull();
    if (day) fireEvent.click(day);
    expect(screen.getByTestId("iso").textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole("button", { name: /^Date$/ }).textContent).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("commits time only on Done and supports clearing optional dates", () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Notify Time" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("time-value")).toHaveTextContent("09:00");
    fireEvent.click(screen.getByRole("button", { name: /^Date$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("iso")).toBeEmptyDOMElement();
  });
});