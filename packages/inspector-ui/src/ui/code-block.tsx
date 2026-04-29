import { useEffect, useState } from "react";

import { codeToHtml, type BundledLanguage } from "shiki/bundle/web";
import type { ThemeRegistration } from "shiki/types";

const INSPECTOR_THEME = {
  name: "openturn-inspector",
  type: "dark",
  fg: "#d1d5e0",
  bg: "transparent",
  colors: {
    "editor.background": "transparent",
    "editor.foreground": "#d1d5e0",
  },
  settings: [
    {
      settings: {
        foreground: "#d1d5e0",
      },
    },
    {
      scope: ["support.type.property-name.json", "meta.object-literal.key"],
      settings: {
        foreground: "#6c8cff",
      },
    },
    {
      scope: ["string", "string.quoted.double.json"],
      settings: {
        foreground: "#34d399",
      },
    },
    {
      scope: ["constant.numeric", "constant.numeric.json"],
      settings: {
        foreground: "#fb923c",
      },
    },
    {
      scope: ["constant.language.boolean", "keyword"],
      settings: {
        foreground: "#fbbf24",
      },
    },
    {
      scope: ["constant.language.null"],
      settings: {
        foreground: "#7b8196",
      },
    },
  ],
} satisfies ThemeRegistration;

type CodeBlockProps = {
  code: string;
  language?: BundledLanguage;
};

export function CodeBlock({ code, language = "json" }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);

    void codeToHtml(code, {
      lang: language,
      theme: INSPECTOR_THEME,
    })
      .then((result) => {
        if (!cancelled) {
          setHtml(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html === null || html.length === 0) {
    return <pre className="ot-inspector__code-block ot-inspector__code-block--fallback">{code}</pre>;
  }

  return (
    <div
      className="ot-inspector__code-block"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
