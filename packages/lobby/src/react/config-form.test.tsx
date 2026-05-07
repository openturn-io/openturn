import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => cleanup());

import { ConfigForm } from "./config-form";

describe("<ConfigForm />", () => {
  test("renders a number field with min/max as a slider", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ConfigForm
        schema={{ n: { type: "number", default: 5, min: 0, max: 10, label: "N" } }}
        values={{ n: 5 }}
        disabled={false}
        onChange={onChange}
      />,
    );
    // The label wraps both the field name and a value-display span; query by
    // the input's id directly for robustness against label restructuring.
    const input = container.querySelector("#n") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe("range");
    expect(input.value).toBe("5");
  });

  test("renders a number field without min/max as a stepper", () => {
    const { container } = render(
      <ConfigForm
        schema={{ n: { type: "number", default: 5, label: "N" } }}
        values={{ n: 5 }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    const input = container.querySelector("#n") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe("number");
  });

  test("renders a boolean field as a checkbox", () => {
    render(
      <ConfigForm
        schema={{ b: { type: "boolean", default: false, label: "B" } }}
        values={{ b: true }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("B") as HTMLInputElement;
    expect(input.type).toBe("checkbox");
    expect(input.checked).toBe(true);
  });

  test("renders a small enum as radio group", () => {
    render(
      <ConfigForm
        schema={{
          v: {
            type: "enum",
            options: ["a", "b", "c"] as const,
            default: "a",
            label: "V",
            labels: { a: "Alpha", b: "Beta" },
          },
        }}
        values={{ v: "b" }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Alpha")).toBeTruthy();
    expect(screen.getByLabelText("Beta")).toBeTruthy();
    expect(screen.getByLabelText("c")).toBeTruthy();  // option without explicit label
    const beta = screen.getByLabelText("Beta") as HTMLInputElement;
    expect(beta.checked).toBe(true);
  });

  test("renders a large enum as a dropdown", () => {
    render(
      <ConfigForm
        schema={{
          v: {
            type: "enum",
            options: ["a", "b", "c", "d", "e"] as const,
            default: "a",
            label: "V",
          },
        }}
        values={{ v: "c" }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("V") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("c");
  });

  test("disabled prop disables all inputs", () => {
    const { container } = render(
      <ConfigForm
        schema={{
          n: { type: "number", default: 1, label: "N" },
          b: { type: "boolean", default: false, label: "B" },
        }}
        values={{ n: 1, b: false }}
        disabled={true}
        onChange={vi.fn()}
      />,
    );
    expect((container.querySelector("#n") as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector("#b") as HTMLInputElement).disabled).toBe(true);
  });

  test("calls onChange with field key + new value on edit", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ConfigForm
        schema={{ n: { type: "number", default: 5, min: 0, max: 10, label: "N" } }}
        values={{ n: 5 }}
        disabled={false}
        onChange={onChange}
      />,
    );
    fireEvent.change(container.querySelector("#n") as HTMLInputElement, { target: { value: "8" } });
    expect(onChange).toHaveBeenCalledWith("n", 8);
  });

  test("custom renderer overrides default for a field", () => {
    const Custom = vi.fn(() => <div data-testid="custom">custom</div>);
    render(
      <ConfigForm
        schema={{
          n: { type: "number", default: 1, label: "N" },
          b: { type: "boolean", default: false, label: "B" },
        }}
        values={{ n: 1, b: false }}
        disabled={false}
        onChange={vi.fn()}
        renderers={{ n: Custom }}
      />,
    );
    expect(screen.getByTestId("custom")).toBeTruthy();
    expect(screen.getByLabelText("B")).toBeTruthy();  // boolean still uses default
  });
});
