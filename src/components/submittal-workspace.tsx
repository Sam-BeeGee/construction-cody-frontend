"use client";

import { type ChangeEvent, type FormEvent, useState } from "react";
import {
  type AnalysisResult,
  analysisErrorSchema,
  analysisResultSchema,
  MAX_SPEC_CHARACTERS,
  requirementLabels,
} from "@/lib/submittals/schema";

type WorkspaceState =
  | { phase: "idle" }
  | { phase: "analyzing" }
  | { phase: "error"; message: string }
  | { phase: "complete"; result: AnalysisResult };

export default function SubmittalWorkspace() {
  const [sourceName, setSourceName] = useState("");
  const [specification, setSpecification] = useState("");
  const [state, setState] = useState<WorkspaceState>({ phase: "idle" });
  const [importing, setImporting] = useState(false);
  const busy = state.phase === "analyzing" || importing;
  const invalid =
    !specification.trim() ||
    !sourceName.trim() ||
    specification.length > MAX_SPEC_CHARACTERS;

  function resetResults() {
    setState({ phase: "idle" });
  }

  async function importText(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    resetResults();
    if (
      !file.name.toLowerCase().endsWith(".txt") ||
      file.size > MAX_SPEC_CHARACTERS * 4
    ) {
      setState({
        phase: "error",
        message:
          "Choose a UTF-8 .txt file with at most 20,000 characters. For PDFs, paste the relevant section text.",
      });
      return;
    }
    setImporting(true);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (
        !text.trim() ||
        text.includes("\0") ||
        text.length > MAX_SPEC_CHARACTERS
      )
        throw new Error("unsupported text");
      setSpecification(text);
      setSourceName(file.name.slice(0, 120));
    } catch {
      setState({
        phase: "error",
        message:
          "This file could not be imported as UTF-8 text, is empty, or exceeds 20,000 characters.",
      });
    } finally {
      setImporting(false);
    }
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || invalid) return;
    setState({ phase: "analyzing" });
    try {
      const response = await fetch("/api/submittals/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specification, sourceName: sourceName.trim() }),
        signal: AbortSignal.timeout(45_000),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const error = analysisErrorSchema.safeParse(data);
        setState({
          phase: "error",
          message: error.success
            ? error.data.error.message
            : "Analysis failed. The server returned an unexpected error response.",
        });
        return;
      }
      const result = analysisResultSchema.safeParse(data);
      if (!result.success) {
        setState({
          phase: "error",
          message:
            "The server returned an invalid requirements response. No results were displayed.",
        });
        return;
      }
      setState({ phase: "complete", result: result.data });
    } catch (error) {
      setState({
        phase: "error",
        message:
          error instanceof Error &&
          ["TimeoutError", "AbortError"].includes(error.name)
            ? "Analysis timed out. Try again with a shorter excerpt."
            : "Could not obtain a valid response from the server. Check your connection and try again.",
      });
    }
  }

  function download(result: AnalysisResult) {
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "construction-cody-requirements.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="workspace">
      <header className="workspace-header">
        <a className="wordmark" href="/">
          Construction Cody<span className="beta">MVP</span>
        </a>
        <span className="header-caption">
          Specifications → Requirements → Human review
        </span>
      </header>
      <section className="intro" aria-labelledby="workspace-title">
        <p className="eyebrow">Submittal requirements workspace</p>
        <h1 id="workspace-title">
          Start with what the specs actually require.
        </h1>
        <p>
          Extract a reviewable requirements register from one specification
          excerpt. Every finding links to source lines; product selection and
          compliance review come later.
        </p>
      </section>

      <form className="panel" onSubmit={analyze} aria-busy={busy}>
        <div className="panel-heading">
          <h2>1. Add your source</h2>
          <span className="muted">One section at a time</span>
        </div>
        <label htmlFor="source-name">Source name / section reference</label>
        <input
          id="source-name"
          type="text"
          placeholder="e.g. Section 26 24 16 — Panelboards, Rev 2"
          value={sourceName}
          maxLength={120}
          disabled={busy}
          required
          onChange={(event) => {
            setSourceName(event.target.value);
            resetResults();
          }}
        />
        <label htmlFor="specification">Specification text</label>
        <textarea
          id="specification"
          rows={12}
          value={specification}
          placeholder="Paste the submittals article and relevant requirements, including conditions and exceptions…"
          disabled={busy}
          required
          aria-describedby="input-help input-count"
          onChange={(event) => {
            setSpecification(event.target.value);
            resetResults();
          }}
        />
        <div className="input-meta">
          <p id="input-help">
            Text only. Paste extracted PDF text or import a UTF-8 .txt file.
          </p>
          <p
            id="input-count"
            className={
              specification.length > MAX_SPEC_CHARACTERS ? "over-limit" : ""
            }
          >
            {specification.length.toLocaleString()} / 20,000 characters
          </p>
        </div>
        <p className="privacy-note">
          Analyzing sends this excerpt to Google Gemini. This app does not save
          it to a project database. Submit only documents you are authorized to
          process.
        </p>
        <div className="actions">
          <div className="file-import">
            <label htmlFor="text-file">Import text file</label>
            <input
              id="text-file"
              type="file"
              accept=".txt,text/plain"
              disabled={busy}
              onChange={importText}
            />
          </div>
          <button className="primary" type="submit" disabled={busy || invalid}>
            {state.phase === "analyzing"
              ? "Analyzing source…"
              : importing
                ? "Importing…"
                : "Extract requirements"}
          </button>
        </div>
      </form>

      <div aria-live="polite" aria-atomic="true" className="status-message">
        {state.phase === "analyzing" && (
          <p>
            Reading the excerpt and checking every returned quote against its
            source. This can take up to 30 seconds.
          </p>
        )}
        {state.phase === "error" && (
          <p className="error-message" role="alert">
            {state.message}
          </p>
        )}
        {state.phase === "complete" && (
          <p>
            {state.result.requirements.length} candidate requirements found.
            Human review required.
          </p>
        )}
      </div>

      {state.phase === "complete" && (
        <section className="results" aria-labelledby="results-title">
          <div className="panel-heading">
            <h2 id="results-title">2. Review requirements</h2>
            <button
              className="secondary"
              type="button"
              onClick={() => download(state.result)}
            >
              Download requirements JSON
            </button>
          </div>
          <div className="review-notice">
            {state.result.limitations.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
          {state.result.status === "no_requirements_found" && (
            <div className="panel empty-state">
              <h3>No explicit requirements identified</h3>
              <p>
                This does not mean no submittals are required. Check the
                excerpt, referenced sections and project-wide requirements
                before proceeding.
              </p>
            </div>
          )}
          {state.result.requirements.map((item, index) => (
            <article key={item.id} className="panel requirement">
              <div className="requirement-heading">
                <h3>
                  {index + 1}. {requirementLabels[item.kind]}
                </h3>
                <span className="review-badge">Needs review</span>
              </div>
              <p className="muted">AI classification · source quote below</p>
              <blockquote>{item.quote}</blockquote>
              <a
                className="source-link"
                href={`#source-line-${item.startLine}`}
              >
                {state.result.source.name} · lines {item.startLine}–
                {item.endLine}
              </a>
            </article>
          ))}
          <section
            className="panel source-panel"
            aria-labelledby="source-title"
          >
            <h3 id="source-title">
              Analyzed source · {state.result.source.name}
            </h3>
            <p className="muted">
              Line numbers refer to this excerpt, not PDF page numbers.
            </p>
            <ol className="source-lines">
              {state.result.source.text.split("\n").map((line, index) => (
                // Line number is the stable identity within this immutable result.
                // biome-ignore lint/suspicious/noArrayIndexKey: source line number is the identity
                <li id={`source-line-${index + 1}`} key={index}>
                  <span>{line || " "}</span>
                </li>
              ))}
            </ol>
          </section>
        </section>
      )}
      {state.phase === "idle" && (
        <p className="empty-hint">
          Add a source to begin. Your results will include quoted requirements
          and a downloadable register for review.
        </p>
      )}
      <footer className="workspace-footer">
        Construction Cody · Requirements extraction MVP · No approved-product or
        compliance claims
      </footer>
    </main>
  );
}
