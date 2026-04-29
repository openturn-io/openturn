// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

type CodeToHtmlMock = ReturnType<typeof vi.fn<(code: string) => Promise<string>>>;

const codeToHtmlMock = vi.fn<(code: string) => Promise<string>>();

vi.mock("shiki/bundle/web", () => ({
  codeToHtml: (code: string) => getCodeToHtmlMock()(code),
}));

describe("CodeBlock", () => {
  test("renders shiki HTML when highlighting succeeds", async () => {
    setCodeToHtmlMock();
    codeToHtmlMock.mockResolvedValueOnce(
      '<pre class="shiki mock-theme"><code><span class="line"><span style="color:#fff">"cells"</span></span></code></pre>',
    );

    const { CodeBlock } = await import("./code-block");
    const { container } = render(<CodeBlock code='{"cells":[]}' />);

    await waitFor(() => {
      expect(container.querySelector(".shiki.mock-theme")).toBeTruthy();
      expect(container.textContent).toContain('"cells"');
    });
  });

  test("falls back to plain text when highlighting fails", async () => {
    setCodeToHtmlMock();
    codeToHtmlMock.mockRejectedValueOnce(new Error("highlight failed"));

    const { CodeBlock } = await import("./code-block");
    render(<CodeBlock code='{"cells":[]}' />);

    await waitFor(() => {
      const fallback = screen.getByText('{"cells":[]}');
      expect(fallback.className).toContain("ot-inspector__code-block--fallback");
    });
  });
});

function setCodeToHtmlMock(): void {
  codeToHtmlMock.mockReset();
  globalThis.__openturnCodeToHtmlMock = codeToHtmlMock;
}

function getCodeToHtmlMock(): CodeToHtmlMock {
  return globalThis.__openturnCodeToHtmlMock;
}

declare global {
  // eslint-disable-next-line no-var
  var __openturnCodeToHtmlMock: CodeToHtmlMock;
}
