import React from "react";
import { Body, Button, Container, Head, Html, Img, Link, Preview, Section, Text } from "@react-email/components";

export type LetterEmailProps = {
  siteName: string;
  senderName: string;
  gifUrl: string;
  letterUrl: string;
  blockUrl: string;
  body: string;
};

const paper = "#efe8dc"; // the GIF's baked backdrop: no visible box around it
const ink = "#2a2420";

/** Paragraphs from the letter body: blank lines split paragraphs, single newlines stay. */
export function paragraphs(body: string): string[][] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.split("\n"))
    .filter((p) => p.join("").trim());
}

export default function LetterEmail({ siteName, senderName, gifUrl, letterUrl, blockUrl, body }: LetterEmailProps) {
  return (
    <Html lang="en">
      <Head>
        {/* The envelope is a picture of paper; inverting it in dark mode would ruin it. */}
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      {/* Never letter text in the preheader. */}
      <Preview>{`A letter from ${senderName}, sealed and stamped.`}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: paper }}>
        <Container style={{ width: "100%", maxWidth: 600, margin: "0 auto", backgroundColor: paper }}>
          <Section>
            <Link href={letterUrl}>
              <Img src={gifUrl} width="600" alt={`An envelope from ${senderName}, opening`} style={{ display: "block", width: "100%", maxWidth: 600, height: "auto", border: 0 }} />
            </Link>
          </Section>
          <Section style={{ padding: "8px 32px 8px", fontFamily: "Georgia, 'Times New Roman', serif", color: ink }}>
            {paragraphs(body).map((lines, i) => (
              <Text key={i} style={{ fontSize: 17, lineHeight: "27px", margin: "0 0 16px", color: ink }}>
                {lines.map((l, j) => (
                  <span key={j}>
                    {l}
                    {j < lines.length - 1 ? <br /> : null}
                  </span>
                ))}
              </Text>
            ))}
            <Text style={{ fontSize: 17, lineHeight: "27px", margin: "8px 0 24px", fontStyle: "italic", color: ink }}>{senderName}</Text>
            <Button
              href={letterUrl}
              style={{ backgroundColor: ink, color: "#fbf6ee", padding: "12px 22px", borderRadius: 3, fontFamily: "Georgia, serif", fontSize: 15, textDecoration: "none" }}
            >
              Open in full
            </Button>
          </Section>
          <Section style={{ padding: "28px 32px 36px", fontFamily: "Georgia, serif", color: "#7a6e62" }}>
            <Text style={{ fontSize: 13, lineHeight: "20px", margin: 0, color: "#7a6e62" }}>
              Sent with {siteName}.<br />
              Don&apos;t want letters from {siteName}? <Link href={blockUrl} style={{ color: "#7a6e62", textDecoration: "underline" }}>Block future letters</Link>.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
