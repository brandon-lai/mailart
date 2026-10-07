"use client";

import { useEffect, useMemo, useState } from "react";
import { composeEnvelope, defaultLibrary, envelopeSeed, NAME_MAX, type EnvelopeSpec } from "@mailart/envelope";
import { EnvelopeFront } from "./Stage";

type Draft = {
  body: string;
  recipientName: string;
  recipientEmail: string;
  addressLine: string;
  senderName: string;
  senderEmail: string;
  senderCity: string;
};

const EMPTY: Draft = { body: "", recipientName: "", recipientEmail: "", addressLine: "", senderName: "", senderEmail: "", senderCity: "" };
const STORE = "mailart-draft";
type Preview = { index: number; spec: EnvelopeSpec };

/**
 * Write → address → pick an envelope → send. With a database the server owns
 * the letter (moderation, limits, previews, the stored spec). Without one the
 * same envelope engine runs in the browser so the flow can be seen, and
 * sending says plainly that it is off.
 */
export default function Compose({ canSend, replyTo }: { canSend: boolean; replyTo?: string }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [d, setD] = useState<Draft>(EMPTY);
  const [err, setErr] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [letterId, setLetterId] = useState<string | null>(null);
  const [shuffle, setShuffle] = useState(0);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<"verify" | "queued" | null>(null);

  // Keep an unsent draft in this browser only.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) setD({ ...EMPTY, ...JSON.parse(saved) });
    } catch {}
    if (replyTo) setD((x) => ({ ...x, recipientName: x.recipientName || replyTo }));
  }, [replyTo]);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(d));
    } catch {}
  }, [d]);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });

  async function api(path: string, init?: RequestInit) {
    const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { field: json.field });
    return json;
  }

  const localPreviews = useMemo(
    () => (n: number, id: string): Preview[] =>
      [0, 1, 2].map((k) => ({
        index: n * 3 + k,
        spec: composeEnvelope(
          { seed: envelopeSeed(id, n * 3 + k), recipientName: d.recipientName, addressLine: d.addressLine || undefined, senderCity: d.senderCity, sentAt: new Date().toISOString().slice(0, 10) + "T12:00:00Z" },
          defaultLibrary,
        ),
      })),
    [d.recipientName, d.addressLine, d.senderCity],
  );

  async function loadPreviews(id: string, n: number) {
    setChosen(null);
    if (!canSend) return setPreviews(localPreviews(n, id));
    const json = await api(`/api/letters/${id}/previews?shuffle=${n}`);
    setPreviews(json.specs);
  }

  async function toEnvelopes() {
    setErr(null);
    setBusy(true);
    try {
      let id = letterId;
      if (!canSend) {
        id = id ?? `local-${Math.random().toString(36).slice(2, 10)}`;
      } else if (!id) {
        const json = await api("/api/letters", { method: "POST", body: JSON.stringify(d) });
        id = json.id as string;
      }
      setLetterId(id);
      setShuffle(0);
      await loadPreviews(id!, 0);
      setStep(3);
    } catch (e) {
      const ex = e as Error & { field?: string };
      setErr({ message: ex.message, field: ex.field });
      if (ex.field === "body") setStep(1);
    } finally {
      setBusy(false);
    }
  }

  async function doShuffle() {
    if (!letterId) return;
    setBusy(true);
    try {
      await loadPreviews(letterId, shuffle + 1);
      setShuffle(shuffle + 1);
    } catch (e) {
      setErr({ message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function seal() {
    if (!letterId || chosen === null) return;
    setErr(null);
    setBusy(true);
    try {
      await api(`/api/letters/${letterId}/choose`, { method: "POST", body: JSON.stringify({ index: chosen }) });
      const json = await api(`/api/letters/${letterId}/send`, { method: "POST" });
      setOutcome(json.state);
      setStep(4);
      try {
        localStorage.removeItem(STORE);
      } catch {}
    } catch (e) {
      setErr({ message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // Editing the address after a draft exists makes a new draft: previews show what was submitted.
  const editAddress = () => {
    setLetterId(null);
    setStep(2);
  };

  const fieldErr = (f: string) => (err?.field === f ? <span className="field-err">{err.message}</span> : null);
  const addrValid = d.recipientName && d.recipientEmail && d.senderName && d.senderEmail && d.senderCity;

  return (
    <div className="compose">
      <ol className="compose-steps" aria-label="Progress">
        {/* The PRD flow: write, address, pick an envelope, confirm your email, sent. */}
        {["Write", "Address", "Pick an envelope", "Confirm your email", "Sent"].map((s, i) => {
          const at = step < 4 ? step : outcome === "verify" ? 4 : 5;
          return (
            <li key={s} className={at === i + 1 ? "on" : at > i + 1 ? "done" : ""}>
              <span className="step-n">{i + 1}</span> {s}
            </li>
          );
        })}
      </ol>

      {!canSend && (
        <p className="notice warn" data-demo>
          Preview mode: this deployment has no database or email provider yet, so you can write, address and choose an envelope, but sending is switched off.
        </p>
      )}

      {step === 1 && (
        <div className="compose-card">
          <h2>Write your letter</h2>
          <div className="field">
            <label htmlFor="body">Letter</label>
            <textarea id="body" className="textarea" value={d.body} onChange={set("body")} placeholder={"Dear …"} maxLength={6000} />
            <span className="hint">{d.body.length.toLocaleString()} / 6,000. The first line is typed on the sheet that slides out of the envelope.</span>
            {fieldErr("body")}
          </div>
          <div className="row-end">
            <button className="btn" disabled={!d.body.trim()} onClick={() => setStep(2)}>Address it</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="compose-card">
          <h2>Address it</h2>
          <div className="grid2">
            <fieldset>
              <legend className="kicker">To</legend>
              <div className="field">
                <label htmlFor="rn">Their name</label>
                <input id="rn" className="input" value={d.recipientName} onChange={set("recipientName")} maxLength={NAME_MAX} autoComplete="off" />
                <span className="hint">Handwritten on the envelope. {NAME_MAX - d.recipientName.length} characters left.</span>
                {fieldErr("recipientName")}
              </div>
              <div className="field">
                <label htmlFor="al">A line under the name <span className="opt">(optional)</span></label>
                <input id="al" className="input" value={d.addressLine} onChange={set("addressLine")} maxLength={NAME_MAX} placeholder="c/o the 4th floor" />
                {fieldErr("addressLine")}
              </div>
              <div className="field">
                <label htmlFor="re">Their email</label>
                <input id="re" className="input" type="email" value={d.recipientEmail} onChange={set("recipientEmail")} autoComplete="off" />
                <span className="hint">Never drawn on the envelope or shown on the letter page.</span>
                {fieldErr("recipientEmail")}
              </div>
            </fieldset>
            <fieldset>
              <legend className="kicker">From</legend>
              <div className="field">
                <label htmlFor="sn">Your name</label>
                <input id="sn" className="input" value={d.senderName} onChange={set("senderName")} maxLength={60} autoComplete="name" />
                <span className="hint">Signs the letter.</span>
                {fieldErr("senderName")}
              </div>
              <div className="field">
                <label htmlFor="se">Your email</label>
                <input id="se" className="input" type="email" value={d.senderEmail} onChange={set("senderEmail")} autoComplete="email" />
                <span className="hint">We confirm it once. Replies come straight to you.</span>
                {fieldErr("senderEmail")}
              </div>
              <div className="field">
                <label htmlFor="sc">Your city</label>
                <input id="sc" className="input" value={d.senderCity} onChange={set("senderCity")} maxLength={30} autoComplete="address-level2" />
                <span className="hint">Goes on the postmark.</span>
                {fieldErr("senderCity")}
              </div>
            </fieldset>
          </div>
          {err && !err.field && <p className="notice err">{err.message}</p>}
          <div className="row-between">
            <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn" disabled={!addrValid || busy} onClick={toEnvelopes}>{busy ? "Checking…" : "Choose an envelope"}</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="compose-card">
          <h2>Pick an envelope</h2>
          <p className="muted">Each one is made once, for this letter. Don&rsquo;t see the one? Shuffle for three more.</p>
          <div className="previews" role="radiogroup" aria-label="Envelopes">
            {previews.map((p) => (
              <button
                key={p.index}
                role="radio"
                aria-checked={chosen === p.index}
                className={`preview ${chosen === p.index ? "picked" : ""}`}
                onClick={() => setChosen(p.index)}
              >
                <EnvelopeFront spec={p.spec} />
              </button>
            ))}
          </div>
          {err && <p className="notice err">{err.message}</p>}
          <div className="row-between">
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" onClick={editAddress}>Back</button>
              <button className="btn ghost" onClick={doShuffle} disabled={busy}>Shuffle</button>
            </div>
            <button className="btn accent" disabled={chosen === null || busy || !canSend} onClick={seal} title={canSend ? "" : "Sending is off on this deployment"}>
              {busy ? "Sealing…" : "Seal and send"}
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="compose-card done">
          {outcome === "verify" ? (
            <>
              <h2>One more thing</h2>
              <p>We sent a link to <strong>{d.senderEmail}</strong>. Click it to confirm it&rsquo;s you, and your letter to {d.recipientName} will be sealed and sent. The link lasts 24 hours.</p>
            </>
          ) : (
            <>
              <h2>Your letter is on its way</h2>
              <p>{d.recipientName} will find it in their inbox shortly.</p>
            </>
          )}
          <button
            className="btn ghost"
            onClick={() => {
              setD({ ...EMPTY, senderName: d.senderName, senderEmail: d.senderEmail, senderCity: d.senderCity });
              setLetterId(null);
              setStep(1);
            }}
          >
            Write another
          </button>
        </div>
      )}
    </div>
  );
}
